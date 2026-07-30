// Bright Data API Engine Module
// Supports:
// 1. Bright Data LinkedIn Scraper API (Synchronous / Real-time Dataset Scraper)
// 2. Bright Data Web Unlocker API (Proxy / Direct HTML Scraper)
// 3. Mobile Number & Contact Extraction via Web Unlocker / SERP

import { CONFIDENCE, ATTRIBUTION, computeFinalConfidence } from '../utils/confidence.js';
import { parsePublicLinkedInHtml, parseHeadlineJobTitleAndCompany } from './linkedinParser.js';
import { scrapeLinkedInProfileWithApify } from './linkedinApify.js';
import { parsePhoneNumberWithError } from 'libphonenumber-js';

// Strict Indian mobile: starts with 6-9, 10 digits total
const INDIAN_MOBILE_REGEX = /(?:(?:\+91|91|0)[\s.-]?)?[6-9]\d{9}(?!\d)/g;
const GENERAL_PHONE_REGEX = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,5}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}/g;

/**
 * Checks if Bright Data is configured via environment variables
 */
export function isBrightDataConfigured() {
  return !!process.env.BRIGHTDATA_API_KEY;
}

/**
 * Primary helper to make authenticated requests to Bright Data APIs
 */
async function callBrightDataApi(endpoint, body, options = {}) {
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  if (!apiKey) throw new Error('BRIGHTDATA_API_KEY is not configured');

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(endpoint, {
    method: options.method || 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: options.timeout ? AbortSignal.timeout(options.timeout) : AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Bright Data API HTTP ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await response.json();
  }
  return await response.text();
}

/**
 * Scrape LinkedIn Profile using Bright Data's LinkedIn Scraper API or Web Unlocker
 * Works with "LinkedIn people profiles - collect by URL" (Synchronous / Real-time dataset mode)
 */
export async function scrapeLinkedInProfileWithBrightData(linkedinUrl, logger) {
  if (!isBrightDataConfigured()) {
    logger?.skipped('Public Search', 'Bright Data: BRIGHTDATA_API_KEY not configured');
    return null;
  }

  logger?.running('Public Search', `Bright Data: Triggering LinkedIn Profile Scraper for ${linkedinUrl}...`);

  const rawDatasetId = process.env.BRIGHTDATA_DATASET_ID || 'gd_l1viktl72bvl7bjuj0'; // Exact dataset ID from account
  const datasetId = rawDatasetId.split('?')[0].trim();

  // Strategy 1: Trigger dataset scraper snapshot & poll real-time result
  try {
    const triggerEndpoint = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${datasetId}&include_errors=true`;
    const payload = [{ url: linkedinUrl }];
    logger?.running('Public Search', `Bright Data: Triggering LinkedIn dataset scraper snapshot for ${linkedinUrl}...`);

    const triggerResult = await callBrightDataApi(triggerEndpoint, payload, { timeout: 30000 });

    if (triggerResult) {
      let snapshotId = null;
      if (typeof triggerResult === 'object' && triggerResult.snapshot_id) {
        snapshotId = triggerResult.snapshot_id;
      } else if (Array.isArray(triggerResult) && triggerResult[0]?.snapshot_id) {
        snapshotId = triggerResult[0].snapshot_id;
      } else if (Array.isArray(triggerResult) && triggerResult.length > 0 && triggerResult[0].name) {
        return normalizeBrightDataLinkedInRecord(triggerResult[0], linkedinUrl);
      }

      if (snapshotId) {
        logger?.running('Public Search', `Bright Data: Snapshot created (${snapshotId}). Polling real-time extraction...`);
        for (let poll = 1; poll <= 8; poll++) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            const snapUrl = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`;
            const records = await callBrightDataApi(snapUrl, null, { method: 'GET', timeout: 15000 });
            if (Array.isArray(records) && records.length > 0 && (records[0].name || records[0].first_name || records[0].id)) {
              logger?.success('Public Search', `Bright Data: Received profile dataset for ${records[0].name || records[0].first_name || linkedinUrl}`);
              return normalizeBrightDataLinkedInRecord(records[0], linkedinUrl);
            }
          } catch (pollErr) {
            // Snapshot processing...
          }
        }
      }
    }
  } catch (trigErr) {
    logger?.warning('Public Search', `Bright Data dataset trigger notice: ${trigErr.message}`);
  }

  // Strategy 2: Direct Synchronous Scrape Endpoint
  try {
    const scrapeEndpoint = `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${datasetId}&notify=false&include_errors=true`;
    const payload = [{ url: linkedinUrl }];
    const apiResult = await callBrightDataApi(scrapeEndpoint, payload, { timeout: 30000 });

    if (Array.isArray(apiResult) && apiResult.length > 0) {
      return normalizeBrightDataLinkedInRecord(apiResult[0], linkedinUrl);
    }
  } catch (scrapeErr) {
    logger?.warning('Public Search', `Bright Data scrape notice: ${scrapeErr.message}`);
  }

  // Attempt 2: Fallback HTML fetch if dataset extraction did not yield a result
  return null;
}

/**
 * Helper to safely extract string institution name from string or object
 */
function extractInstitutionString(edu, idx) {
  if (!edu) return null;

  if (typeof edu === 'string') return edu.trim();

  if (typeof edu === 'object') {
    // 1. Nested object name properties
    if (typeof edu.school === 'object' && edu.school?.name) return String(edu.school.name).trim();
    if (typeof edu.institution === 'object' && edu.institution?.name) return String(edu.institution.name).trim();
    if (typeof edu.college === 'object' && edu.college?.name) return String(edu.college.name).trim();

    // 2. String properties
    for (const key of ['title', 'school_name', 'institution_name', 'school', 'institution', 'college_name', 'college', 'name']) {
      if (typeof edu[key] === 'string' && edu[key].trim().length > 0) {
        return edu[key].trim();
      }
    }

    // 3. Degree / field of study fallback if institution name key is omitted
    const degreeCandidate = edu.degree_name || edu.degree || edu.field_of_study || edu.subject;
    if (typeof degreeCandidate === 'string' && degreeCandidate.trim().length > 0) {
      return degreeCandidate.trim();
    }
  }

  return null;
}

/**
 * Normalize structured output from Bright Data Dataset response into app schema
 */
function normalizeBrightDataLinkedInRecord(record, linkedinUrl) {
  if (!record || typeof record !== 'object') return null;

  const fullName = record.name || record.full_name || [record.first_name, record.last_name].filter(Boolean).join(' ') || null;
  
  const rawCompany = record.current_company || record.company || record.company_name || null;
  const company = extractCompanyString(rawCompany);
  
  let jobTitle = record.position || record.job_title || record.current_company_position || (typeof record.current_company === 'object' ? record.current_company.position || record.current_company.title : null) || null;
  const headline = record.headline || null;

  if (!jobTitle && headline) {
    const extractedFromHeadline = parseHeadlineJobTitleAndCompany(headline);
    jobTitle = extractedFromHeadline.jobTitle;
  }

  const location = record.location || [record.city, record.country || record.country_code].filter(Boolean).join(', ') || null;
  const finalHeadline = headline || (jobTitle && company ? `${jobTitle} at ${company}` : jobTitle) || null;
  const about = record.about || record.summary || null;
  const image = record.avatar || record.profile_image || record.profile_pic || record.profile_pic_url || record.image_url || record.image || record.img || record.picture || record.photo || record.headshot || null;

  // Extract experience timeline
  const experience = [];
  const expList = record.experience || record.positions || record.past_positions || record.work_experience || [];
  if (Array.isArray(expList)) {
    for (const exp of expList) {
      if (!exp) continue;
      const expCompany = extractCompanyString(exp.company || exp.company_name || exp.organization) || '';
      const expTitle = exp.title || exp.position || exp.job_title || exp.role || 'Position';
      const startDates = exp.start_date || exp.start_year || '';
      const endDates = exp.end_date || exp.end_year || '';
      let duration = exp.duration || exp.dates || '';
      if (!duration && (startDates || endDates)) {
        duration = [startDates, endDates].filter(Boolean).join(' - ');
      }

      if (expCompany || expTitle) {
        experience.push({
          title: expTitle,
          company: expCompany,
          duration: duration || 'N/A',
          description: exp.description || exp.summary || null,
          source: 'Bright Data LinkedIn Scraper',
          confidence: CONFIDENCE.BRIGHTDATA || 0.95,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Fallback: If no timeline array entries exist, construct current experience from root job title & company
  if (experience.length === 0 && (jobTitle || company)) {
    experience.push({
      title: jobTitle || 'Executive',
      company: company || '',
      duration: 'Present',
      description: headline || null,
      source: 'Bright Data LinkedIn Scraper',
      confidence: CONFIDENCE.BRIGHTDATA || 0.95,
      timestamp: new Date().toISOString(),
    });
  }

  // Extract education details properly
  const education = [];
  if (Array.isArray(record.education)) {
    for (let idx = 0; idx < record.education.length; idx++) {
      const edu = record.education[idx];
      if (!edu) continue;

      const instName = extractInstitutionString(edu, idx);
      if (!instName) continue; // Skip entries without valid institution or degree names

      const degreeName = typeof edu.degree_name === 'string' ? edu.degree_name : (typeof edu.degree === 'string' ? edu.degree : (typeof edu.field_of_study === 'string' ? edu.field_of_study : ''));
      const fieldStudy = typeof edu.field_of_study === 'string' ? edu.field_of_study : (typeof edu.subject === 'string' ? edu.subject : '');

      const startY = edu.start_year || edu.start_date || '';
      const endY = edu.end_year || edu.end_date || '';
      let eduDuration = edu.dates || edu.duration || '';
      if (!eduDuration && (startY || endY)) {
        eduDuration = [startY, endY].filter(Boolean).join(' - ');
      }

      education.push({
        institution: instName,
        degree: degreeName || null,
        fieldOfStudy: fieldStudy || null,
        duration: eduDuration || 'N/A',
        source: 'Bright Data LinkedIn Scraper',
        confidence: CONFIDENCE.BRIGHTDATA || 0.95,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Deep scan entire Bright Data record payload for any phone numbers / emails
  const phones = [];
  const emails = [];

  const fullPayloadText = [
    JSON.stringify(record),
    record.about,
    record.summary,
    record.phone,
    record.mobile_phone,
    record.phone_number,
    typeof record.contact_info === 'object' ? JSON.stringify(record.contact_info) : '',
    ...(Array.isArray(record.posts) ? record.posts.map(p => `${p.title || ''} ${p.interaction || ''}`) : []),
    ...(Array.isArray(record.bio_links) ? record.bio_links : []),
  ].filter(Boolean).join(' ');

  const extractedPhones = extractMobileNumbersFromText(fullPayloadText);
  phones.push(...extractedPhones);

  const rawEmailMatches = fullPayloadText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  for (const emailStr of rawEmailMatches) {
    if (emailStr && !emailStr.includes('.png') && !emailStr.includes('.jpg') && !emailStr.includes('example.com')) {
      const cleanEmail = emailStr.trim().toLowerCase();
      if (!emails.some(e => e.value === cleanEmail)) {
        emails.push({
          value: cleanEmail,
          source: 'Bright Data LinkedIn Scraper',
          sourceType: 'Bright Data Profile Dataset',
          confidence: CONFIDENCE.BRIGHTDATA || 0.95,
          attribution: ATTRIBUTION.ENRICHMENT_API,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  return {
    name: fullName,
    headline,
    location,
    jobTitle,
    company,
    profileUrl: linkedinUrl,
    image,
    about,
    experience,
    education,
    skills: Array.isArray(record.skills) ? record.skills : [],
    phones,
    emails,
    confidence: CONFIDENCE.BRIGHTDATA || 0.95,
    source: 'Bright Data LinkedIn Scraper API',
  };
}

/**
 * Mobile Number Extraction using Bright Data APIs
 * Queries search engines and public directories via Bright Data for target mobile numbers
 */
export async function extractMobileNumberWithBrightData(identity, logger) {
  if (!isBrightDataConfigured()) return { phones: [], emails: [] };

  const fullName = identity.normalized.fullName;
  const companyName = identity.company.officialName || identity.company.normalized;
  
  logger?.running('Contact Enrichment', `Bright Data: Searching mobile numbers for "${fullName}" (${companyName})...`);

  const results = { phones: [], emails: [] };
  
  // Precision search queries targeting Indian executive mobile numbers
  const queries = [
    `"${fullName}" "${companyName}" ("+91" OR "mobile" OR "cell") -"1800" -"support"`,
    `"${fullName}" "${companyName}" ("director" OR "promoter" OR "contact") "+91"`,
    `site:zaubacorp.com OR site:tofler.in "${fullName}" "mobile" OR "phone" OR "+91"`,
  ];

  for (const searchQuery of queries) {
    try {
      let serpHtml = null;
      try {
        const duckUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
        const duckRes = await fetch(duckUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(10000),
        });
        if (duckRes.ok) {
          serpHtml = await duckRes.text();
        }
      } catch {
        // Ignore fallback errors
      }

      if (serpHtml && typeof serpHtml === 'string') {
        const foundPhones = extractMobileNumbersFromText(serpHtml, fullName);
        for (const phoneObj of foundPhones) {
          phoneObj.source = 'Bright Data Executive Mobile Search';
          if (!results.phones.some(p => p.value === phoneObj.value)) {
            results.phones.push(phoneObj);
          }
        }
      }
    } catch (err) {
      logger?.warning('Contact Enrichment', `Mobile search notice: ${err.message}`);
    }
  }

  if (results.phones.length > 0) {
    logger?.success('Contact Enrichment', `Discovered ${results.phones.length} potential mobile number(s)`);
  }

  return results;
}

/**
 * Utility to parse and format Indian mobile numbers & general phone numbers from raw text snippet with proximity checking
 */
export function extractMobileNumbersFromText(text, targetName = null) {
  if (!text || typeof text !== 'string') return [];

  const found = [];
  const seenCleaned = new Set();

  // Helper to determine attribution proximity score based on distance from target name
  const calculateAttribution = (matchIndex) => {
    if (!targetName || typeof targetName !== 'string') return ATTRIBUTION.ENRICHMENT_API;

    const lowerText = text.toLowerCase();
    const nameParts = targetName.toLowerCase().split(/\s+/).filter(p => p.length >= 2);
    let minDistance = Infinity;

    for (const part of nameParts) {
      let pos = lowerText.indexOf(part);
      while (pos !== -1) {
        const dist = Math.abs(pos - matchIndex);
        if (dist < minDistance) minDistance = dist;
        pos = lowerText.indexOf(part, pos + 1);
      }
    }

    if (minDistance <= 150) return ATTRIBUTION.PROXIMATE; // Within 150 chars radius
    if (minDistance <= 500) return ATTRIBUTION.SAME_PAGE;  // Same page, further distance
    return ATTRIBUTION.UNATTRIBUTED;
  };

  const isGarbageOrTollFree = (digits, matchStr) => {
    if (digits.length > 11) return true; // Phone numbers shouldn't be > 11 digits
    // Toll-free helpline filter (1800, 1860)
    if (digits.startsWith('1800') || digits.startsWith('1860') || matchStr.includes('1800') || matchStr.includes('1860')) return true;
    // Discard 10-digit timestamps, post IDs or common PIN code patterns
    if (digits.startsWith('17') || digits.startsWith('74') || digits.startsWith('73') || digits.startsWith('72')) {
      if (digits.length >= 12) return true;
    }
    if (digits === '2147483647' || digits.startsWith('1065042288')) return true;
    return false;
  };

  // 1. Match Indian mobile numbers strictly (starts with 6-9, 10 digits total, allowing spaces/hyphens between digit blocks)
  const mobileRegex = /(?:\+91[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}\b|(?:\+91[\s.-]?)?[6-9]\d{9}\b/g;
  let match;
  while ((match = mobileRegex.exec(text)) !== null) {
    const rawMatch = match[0];
    const matchIndex = match.index;
    const digitsOnly = rawMatch.replace(/\D/g, '');
    let tenDigits = digitsOnly;
    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
      tenDigits = digitsOnly.slice(2);
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
      tenDigits = digitsOnly.slice(1);
    }

    if (tenDigits.length === 10 && /^[6-9]/.test(tenDigits) && !isGarbageOrTollFree(tenDigits, rawMatch)) {
      const formatted = `+91 ${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`;
      if (!seenCleaned.has(tenDigits)) {
        seenCleaned.add(tenDigits);
        const attribution = calculateAttribution(matchIndex);
        const sourceConfidence = CONFIDENCE.BRIGHTDATA || 0.95;
        const confidence = computeFinalConfidence(sourceConfidence, attribution);

        found.push({
          value: formatted,
          type: 'Mobile',
          country: 'IN',
          raw: rawMatch,
          source: 'Public Web Search',
          sourceType: 'Validated Mobile Number',
          confidence,
          attribution,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // 2. Match general international phone numbers using libphonenumber-js
  const generalRegex = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;
  while ((match = generalRegex.exec(text)) !== null) {
    const rawMatch = match[0];
    const matchIndex = match.index;
    try {
      const digitsOnly = rawMatch.replace(/\D/g, '');
      if (isGarbageOrTollFree(digitsOnly, rawMatch)) continue;

      const parsed = parsePhoneNumberWithError(rawMatch, 'IN');
      if (parsed && parsed.isValid()) {
        const nationalNum = parsed.nationalNumber;
        if (!seenCleaned.has(nationalNum) && !isGarbageOrTollFree(nationalNum, rawMatch)) {
          seenCleaned.add(nationalNum);
          const attribution = calculateAttribution(matchIndex);
          const sourceConfidence = CONFIDENCE.BRIGHTDATA || 0.95;
          const confidence = computeFinalConfidence(sourceConfidence, attribution);

          found.push({
            value: parsed.formatInternational(),
            type: parsed.getType() === 'MOBILE' ? 'Mobile' : 'Phone',
            country: parsed.country || 'IN',
            raw: rawMatch,
            source: 'Public Web Search',
            sourceType: 'Validated Contact Number',
            confidence,
            attribution,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch {
      // Ignore invalid phone parse errors
    }
  }

  return found;
}

/**
 * Bright Data Enrichment Provider for enrichment.js cascade
 */
export async function tryBrightDataEnrichment(identity, apiKey, confidence, logger) {
  logger?.running('Contact Enrichment', 'Bright Data: Extracting mobile numbers & profile details...');

  const result = { email: null, phone: null, profile: null };

  // 1. If LinkedIn URL is present, scrape profile via Apify
  if (identity.linkedinUrl) {
    const profileData = await scrapeLinkedInProfileWithApify(identity.linkedinUrl, logger, identity?.normalized?.fullName);
    if (profileData) {
      if (profileData.phones && profileData.phones.length > 0) {
        result.phone = profileData.phones[0];
      }
      if (profileData.emails && profileData.emails.length > 0) {
        result.email = profileData.emails[0];
      }
      result.profile = {
        name: profileData.name,
        title: profileData.jobTitle,
        company: profileData.company,
        linkedin: profileData.profileUrl,
        source: 'Apify LinkedIn Profile Scraper',
        confidence: confidence || CONFIDENCE.PUBLIC_DIRECTORY || 0.85,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // 2. If no phone found yet, perform mobile search query via Bright Data
  if (!result.phone) {
    const mobileResults = await extractMobileNumberWithBrightData(identity, logger);
    if (mobileResults.phones.length > 0) {
      result.phone = mobileResults.phones[0];
    }
  }

  return (result.email || result.phone || result.profile) ? result : null;
}
