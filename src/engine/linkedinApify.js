// Apify LinkedIn Profile Scraper Module
// Integrates Apify harvestapi/linkedin-profile-scraper actor

import { CONFIDENCE, computeNameSimilarity } from '../utils/confidence.js';
import { parseHeadlineJobTitleAndCompany } from './linkedinParser.js';

// 1-hour in-memory TTL cache: linkedinUrl -> { data, timestamp }
const profileCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Checks if Apify is configured via environment variables
 */
export function isApifyLinkedInConfigured() {
  return !!(process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN || process.env.APIFY_API_KEY);
}

/**
 * Scrapes LinkedIn profile using Apify's harvestapi/linkedin-profile-scraper actor
 */
export async function scrapeLinkedInProfileWithApify(linkedinUrl, logger, targetName = null) {
  if (!linkedinUrl) return null;

  const apiToken = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN || process.env.APIFY_API_KEY;
  if (!apiToken) {
    logger?.skipped('Public Search', 'Apify: APIFY_API_TOKEN not configured');
    return null;
  }

  // Check 1-hour in-memory TTL cache
  const cached = profileCache.get(linkedinUrl);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    logger?.success('Public Search', `Apify: Using cached profile for ${linkedinUrl}`);
    return cached.data;
  }

  logger?.running('Public Search', `Apify: Triggering LinkedIn Profile Scraper for ${linkedinUrl}...`);

  const rawActorId = process.env.APIFY_LINKEDIN_ACTOR_ID || 'harvestapi/linkedin-profile-scraper';
  // Apify REST API endpoints use tilde (~) in place of slash (/) for actor names
  const formattedActorId = rawActorId.replace('/', '~');

  const endpointUrl = `https://api.apify.com/v2/acts/${formattedActorId}/run-sync-get-dataset-items?token=${apiToken}&timeout=60`;
  const payload = {
    urls: [linkedinUrl],
  };

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(65000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger?.warning('Public Search', `Apify HTTP ${response.status}: ${errText.slice(0, 150)}`);
      return null;
    }

    const items = await response.json();
    if (!Array.isArray(items) || items.length === 0) {
      logger?.warning('Public Search', `Apify returned empty dataset for ${linkedinUrl}`);
      return null;
    }

    const rawRecord = items[0];
    if (!rawRecord || rawRecord.error || rawRecord.message) {
      const errMsg = rawRecord?.error || rawRecord?.message || 'Empty or error dataset';
      logger?.warning('Public Search', `Apify notice: ${errMsg}`);
      return null;
    }

    const normalized = normalizeApifyLinkedInRecord(rawRecord, linkedinUrl, targetName);

    if (normalized) {
      logger?.success('Public Search', `Apify: Received profile dataset for ${normalized.name || linkedinUrl}`);
      profileCache.set(linkedinUrl, { data: normalized, timestamp: Date.now() });
    }

    return normalized;
  } catch (err) {
    logger?.warning('Public Search', `Apify profile scraper notice: ${err.message}`);
    return null;
  }
}

// Alias for convenience
export const scrapeLinkedInProfile = scrapeLinkedInProfileWithApify;

/**
 * Maps Apify dataset output fields to application schema
 */
function normalizeApifyLinkedInRecord(record, linkedinUrl, targetName = null) {
  if (!record || typeof record !== 'object') return null;

  // Name extraction
  const firstName = record.firstName || '';
  const lastName = record.lastName || '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || record.fullName || record.name || null;

  const headline = record.headline || null;
  const currentPos = record.currentPosition || {};
  let company = currentPos.companyName || record.companyName || record.company || null;
  let jobTitle = currentPos.position || record.position || record.jobTitle || null;

  if (!jobTitle && headline) {
    const parsed = parseHeadlineJobTitleAndCompany(headline);
    jobTitle = parsed.jobTitle;
    if (!company) company = parsed.company;
  }

  const finalHeadline = headline || (jobTitle && company ? `${jobTitle} at ${company}` : jobTitle) || null;

  // Location mapping
  const location = record.addressWithoutCountry || record.addressWithCountry || record.location?.parsed?.text || record.location?.linkedinText || (typeof record.location === 'string' ? record.location : null) || null;

  // Avatar / Profile photo
  const avatar = record.profilePicHighQuality || record.profilePic || record.profilePicture?.url || record.profilePicture || record.avatar || record.picture || null;

  // About / Summary
  const about = record.about || record.summary || null;

  // Total Experience Years / First Role Year
  const totalExpYearsNum = record.totalExperienceYears || (record.firstRoleYear ? (new Date().getFullYear() - record.firstRoleYear) : null);

  // Mapped experience array (supporting all Apify actor field variants)
  const experience = [];
  const rawExperience = record.experiences || record.experience || record.positions || record.employmentHistory || record.workExperience || record.history || [];
  if (Array.isArray(rawExperience)) {
    for (const exp of rawExperience) {
      if (!exp) continue;
      const expCompany = exp.companyName || (typeof exp.company === 'string' ? exp.company : (exp.company?.name || ''));
      const expTitle = exp.title || exp.position || exp.job_title || exp.role || 'Position';
      const startDate = exp.jobStartedOn || exp.startDate || exp.start_date || '';
      const endDate = exp.jobStillWorking ? 'Present' : (exp.jobEndedOn || exp.endDate || exp.end_date || 'Present');
      let duration = exp.duration || (startDate || endDate ? [startDate, endDate].filter(Boolean).join(' - ') : 'N/A');

      if (expCompany || expTitle) {
        experience.push({
          title: expTitle,
          company: expCompany,
          duration,
          location: exp.jobLocation || exp.location || null,
          description: exp.jobDescription || exp.description || exp.summary || null,
          logo: exp.logo || null,
          source: 'Apify LinkedIn Profile Scraper',
          confidence: CONFIDENCE.PUBLIC_DIRECTORY || 0.85,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Fallback: If no experience timeline items returned, construct current role
  if (experience.length === 0 && (jobTitle || company || finalHeadline)) {
    experience.push({
      title: jobTitle || 'Executive',
      company: company || '',
      duration: record.currentJobDuration || 'Present',
      description: finalHeadline,
      source: 'Apify LinkedIn Profile Scraper',
      confidence: CONFIDENCE.PUBLIC_DIRECTORY || 0.85,
      timestamp: new Date().toISOString(),
    });
  }

  // Mapped education array (supporting all Apify actor field variants)
  const education = [];
  const rawEducation = record.educations || record.education || record.schools || record.academicHistory || record.studies || [];
  if (Array.isArray(rawEducation)) {
    for (const edu of rawEducation) {
      if (!edu) continue;
      let rawTitle = edu.title || edu.schoolName || edu.school || edu.institution || edu.school_name || '';
      let subtitle = edu.subtitle || edu.degree || edu.degree_name || '';
      let fieldStudy = edu.fieldOfStudy || edu.field_of_study || '';

      let instName = rawTitle;
      let degreeName = subtitle;

      // Clean up "Degree , Institution Name" format in title (e.g. "MBA , Mumbai University")
      if (rawTitle.includes(' , ')) {
        const parts = rawTitle.split(' , ');
        degreeName = parts[0].trim();
        instName = parts.slice(1).join(' ').trim();
      } else if (rawTitle.includes(',')) {
        const parts = rawTitle.split(',');
        degreeName = parts[0].trim();
        instName = parts.slice(1).join(' ').trim();
      }

      if (!instName && !degreeName) continue;

      let eduDuration = 'N/A';
      if (edu.period && (edu.period.startedOn || edu.period.endedOn)) {
        eduDuration = [edu.period.startedOn, edu.period.endedOn].filter(Boolean).join(' - ');
      } else if (edu.dates || edu.duration) {
        eduDuration = edu.dates || edu.duration;
      }

      education.push({
        institution: instName || 'Educational Institution',
        degree: degreeName || null,
        fieldOfStudy: subtitle || fieldStudy || null,
        duration: eduDuration,
        logo: edu.logo || null,
        source: 'Apify LinkedIn Profile Scraper',
        confidence: CONFIDENCE.PUBLIC_DIRECTORY || 0.85,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Mapped skills array (supporting string or `{ title: "..." }`)
  const skills = Array.isArray(record.skills)
    ? record.skills.map(s => typeof s === 'string' ? s : (s.title || s.name)).filter(Boolean)
    : [];

  // Mapped languages array
  const languages = Array.isArray(record.languages)
    ? record.languages.map(l => typeof l === 'string' ? l : `${l.name}${l.proficiency ? ` (${l.proficiency})` : ''}`).filter(Boolean)
    : [];

  // Related profiles (moreProfiles / peopleAlsoViewed)
  const relatedProfiles = Array.isArray(record.moreProfiles || record.peopleAlsoViewed)
    ? (record.moreProfiles || record.peopleAlsoViewed).map(p => ({
        name: p.fullName || p.name || p.title || 'Related Executive',
        url: p.profileUrl || p.url || p.linkedinUrl || null,
        headline: p.headline || p.subtitle || null,
      })).filter(p => p.name)
    : [];

  // Emails & Mobile Numbers
  const emails = [];
  if (record.email) {
    emails.push({
      value: String(record.email).toLowerCase().trim(),
      type: 'Direct Contact Email',
      source: 'Apify LinkedIn Profile Scraper',
      sourceType: 'LinkedIn Direct Disclosure',
      confidence: 0.90,
      timestamp: new Date().toISOString(),
    });
  }
  if (Array.isArray(record.emails)) {
    for (const emailVal of record.emails) {
      if (typeof emailVal === 'string' && emailVal.includes('@')) {
        emails.push({
          value: emailVal.toLowerCase().trim(),
          type: 'Unverified Candidate Email',
          source: 'Apify Email Search',
          sourceType: 'Third-Party Provider (Apify)',
          confidence: 0.50,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Fuzzy Name Match Check
  let nameMismatch = false;
  let nameSim = 1.0;
  if (targetName && fullName) {
    nameSim = computeNameSimilarity(fullName, targetName);
    if (nameSim < 0.60) {
      nameMismatch = true;
    }
  }

  // Dynamic Confidence Scoring
  let confidence = CONFIDENCE.PUBLIC_DIRECTORY || 0.85;
  if (fullName && (jobTitle || company)) confidence += 0.05;
  if (experience.length > 1) confidence += 0.05;
  if (nameMismatch) confidence = Math.min(confidence, 0.25);

  return {
    name: fullName,
    jobTitle,
    company,
    headline: finalHeadline,
    location,
    image: avatar,
    profileUrl: linkedinUrl,
    about,
    experience,
    education,
    skills,
    connections_count: record.connectionsCount || 0,
    follower_count: record.followerCount || 0,
    related_profiles: relatedProfiles,
    emails,
    phones: [],
    nameMismatch,
    nameSimilarity: nameSim,
    confidence,
    _raw: record, // Full raw Apify response
  };
}
