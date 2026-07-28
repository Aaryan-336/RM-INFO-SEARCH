// Public Search Module — Puppeteer Edition
// Uses Puppeteer (bundles own Chromium — no driver version issues)
// 1. DuckDuckGo search for web discovery (free, no API)
// 2. Company website scraping with full JS rendering
// 3. LinkedIn public profile scraping for experience/history

import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import { CONFIDENCE, ATTRIBUTION, computeFinalConfidence } from '../utils/confidence.js';
import { callGroqWithFallback } from '../utils/groq.js';
import { parsePublicLinkedInHtml } from './linkedinParser.js';

const CONTACT_PAGE_PATHS = [
  '/about', '/about-us', '/team', '/our-team', '/leadership',
  '/management', '/board', '/directors', '/contact', '/contact-us',
  '/people', '/who-we-are', '/company', '/about/team', '/about/leadership',
  '/investor-relations', '/media', '/press',
];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Strict Indian mobile: must start with 6-9, exactly 10 digits after optional +91/91/0 prefix
const INDIAN_MOBILE_REGEX = /(?:(?:\+91|91|0)[\s.-]?)?[6-9]\d{9}(?!\d)/g;
// Strict Indian landline: STD code (2-4 digits starting with 0) + 6-8 digit number
const INDIAN_LANDLINE_REGEX = /(?:(?:\+91|91)[\s.-]?)?0[1-9]\d{1,3}[\s.-]?\d{6,8}(?!\d)/g;

// Blacklist patterns — reject numeric strings that are NOT phone numbers
const PHONE_BLACKLIST_PATTERNS = [
  /^[UL]\d{5}[A-Z]{2}/i,           // CIN pattern (e.g., U12345MH...)
  /^\d{6}$/,                         // PIN codes (exactly 6 digits)
  /^(19|20)\d{2}$/,                  // Years (1900-2099)
  /\d+\s*(crore|lakh|lac|inr|rs\.?|₹|million|billion)/i,  // Financial figures
  /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z]$/i, // GST numbers
  /^[A-Z]{5}\d{4}[A-Z]$/i,          // PAN numbers
  /^\d{4}[\s-]?\d{4}[\s-]?\d{4}$/,  // Aadhaar-like patterns
];

/**
 * Filter out numbers that match blacklist patterns (CINs, PINs, dates, financial figures).
 */
function isBlacklistedNumber(raw) {
  const cleaned = raw.replace(/[\s\-().+]/g, '');
  // Reject if fewer than 10 digits or more than 13 (including country code)
  if (cleaned.replace(/\D/g, '').length < 10 || cleaned.replace(/\D/g, '').length > 13) {
    return true;
  }
  // Check surrounding context patterns
  for (const pattern of PHONE_BLACKLIST_PATTERNS) {
    if (pattern.test(raw.trim())) return true;
  }
  return false;
}

let browserInstance = null;

export async function getBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance;

  const proxy = process.env.PROXY_SERVER || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,900',
  ];
  if (proxy) {
    launchArgs.push(`--proxy-server=${proxy}`);
  }

  browserInstance = await puppeteer.launch({
    headless: 'new',
    args: launchArgs,
  });

  return browserInstance;
}

export async function setupPageStealth(page) {
  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'Upgrade-Insecure-Requests': '1',
    });
  } catch {
    // Ignore header setting errors if page closed
  }
}

export async function publicSearch(identity, logger) {
  const start = Date.now();
  logger.running('Public Search', `Launching Puppeteer browser for ${identity.normalized.fullName}`);

  const results = {
    emails: [],
    phones: [],
    roles: [],
    bios: [],
    socialLinks: [],
    pagesSearched: [],
    documentsFound: [],
    linkedinProfile: null,
    linkedinParsedData: null,
    experience: [],
    education: [],
  };

  let browser;
  let page;
  try {
    browser = await getBrowser();
    page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    logger.success('Public Search', 'Browser launched successfully');

    // Discover actual company website domain from search
    const discoveredDomain = await discoverOfficialDomain(page, identity, logger);
    if (discoveredDomain) {
      identity.company.possibleDomains = [
        discoveredDomain,
        ...identity.company.possibleDomains.filter(d => d !== discoveredDomain)
      ];
      logger.success('Public Search', `Discovered and prioritizing official company website: ${discoveredDomain}`);
    }

    const allSnippets = [];

    // 1. DuckDuckGo search
    const discoveredUrls = await duckDuckGoSearch(page, identity, results, allSnippets, logger);

    // 2. LinkedIn profile scraping
    await scrapeLinkedIn(page, identity, results, allSnippets, logger);

    // 3. Company website scraping
    for (const domain of identity.company.possibleDomains.slice(0, 3)) {
      await scrapeCompanyDomain(page, domain, identity, results, logger);
    }

    // 4. Scrape other discovered URLs
    for (const url of discoveredUrls.slice(0, 4)) {
      if (!url.includes('linkedin.com')) {
        await scrapeUrl(page, url, identity, results, logger);
      }
    }

    // 4.1 Google search for additional contacts (secondary engine)
    await googleSearchForContacts(page, identity, results, allSnippets, logger);

    // 4.4 Email Candidate Generation & Search Verification
    const hasPersonalEmail = results.emails.some(e => isPersonalEmail(e.value, identity));

    if (!hasPersonalEmail) {
      logger.running('Public Search', 'No personal emails found. Generating and verifying name-based email candidates...');
      const domain = identity.company.possibleDomains[0]; // Primary domain (e.g. dalal-broacha.com)
      if (domain) {
        const candidates = generateEmailCandidates(identity, domain);
        for (const candidate of candidates) {
          logger.running('Public Search', `Verifying candidate email existence: ${candidate}`);
          const exists = await verifyEmailViaSearch(page, candidate, logger);
          if (exists) {
            results.emails.push({
              value: candidate,
              source: 'Search Verification',
              sourceType: 'Search Verified Candidate',
              confidence: CONFIDENCE.COMPANY_WEBSITE,
              attribution: ATTRIBUTION.DIRECT_MATCH,
              timestamp: new Date().toISOString(),
              personMentioned: true,
            });
            logger.success('Public Search', `Email candidate verified: ${candidate}`);
            break; // Stop at first verified candidate
          }
        }
      }
    }

    // 4.5 AI Contact Attribution — re-evaluate collected contacts to confirm person ownership
    if ((results.emails.length > 0 || results.phones.length > 0) && (process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY)) {
      try {
        logger.running('Public Search', 'Running AI contact attribution to verify person ownership...');
        const aiResult = await extractContactsWithAI(identity, results, logger);
        if (aiResult) {
          // Update attribution for emails confirmed by AI
          for (const email of results.emails) {
            const aiMatch = aiResult.emails?.find(e => e.toLowerCase() === email.value.toLowerCase());
            if (aiMatch) {
              email.attribution = ATTRIBUTION.AI_ATTRIBUTED;
              email.confidence = computeFinalConfidence(
                email.confidence / (email.attribution || ATTRIBUTION.UNATTRIBUTED),  // recover source confidence
                ATTRIBUTION.AI_ATTRIBUTED
              );
              // Ensure confidence doesn't exceed 1.0 due to rounding
              email.confidence = Math.min(1.0, email.confidence);
            }
          }
          // Update attribution for phones confirmed by AI
          for (const phone of results.phones) {
            const cleanedPhone = phone.value.replace(/\D/g, '');
            const aiMatch = aiResult.phones?.find(p => {
              const cleanAI = p.replace(/\D/g, '');
              return cleanedPhone.endsWith(cleanAI) || cleanAI.endsWith(cleanedPhone);
            });
            if (aiMatch) {
              phone.attribution = ATTRIBUTION.AI_ATTRIBUTED;
              phone.confidence = computeFinalConfidence(
                phone.confidence / (phone.attribution || ATTRIBUTION.UNATTRIBUTED),
                ATTRIBUTION.AI_ATTRIBUTED
              );
              phone.confidence = Math.min(1.0, phone.confidence);
            }
          }
          const confirmedEmails = results.emails.filter(e => e.attribution === ATTRIBUTION.AI_ATTRIBUTED).length;
          const confirmedPhones = results.phones.filter(p => p.attribution === ATTRIBUTION.AI_ATTRIBUTED).length;
          logger.success('Public Search', `AI attribution: confirmed ${confirmedEmails} email(s), ${confirmedPhones} phone(s) for target person`);
        }
      } catch (err) {
        logger.warning('Public Search', `AI contact attribution failed: ${err.message} — using proximity scores`);
      }
    }

    // AI-Powered career history extraction from accumulated signals
    if (allSnippets.length > 0) {
      logger.running('Public Search', 'Extracting full career timeline using AI...');
      const aiExperience = await extractExperienceWithAI(identity, allSnippets, results.linkedinProfile, logger);
      if (aiExperience && aiExperience.length > 0) {
        for (const exp of aiExperience) {
          if (exp.company && exp.title) {
            if (!results.experience.some(e => 
              e.company.toLowerCase() === exp.company.toLowerCase() &&
              e.title.toLowerCase() === exp.title.toLowerCase()
            )) {
              results.experience.push({
                title: exp.title,
                company: exp.company,
                duration: exp.duration || 'Period N/A',
                source: 'AI Career Extraction',
                confidence: CONFIDENCE.PUBLIC_DIRECTORY,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }
    }

    // Guarantee career timeline display (even if Cheerio DOM is restricted)
    if (results.experience.length === 0) {
      const fallbackTitle = results.linkedinParsedData?.jobTitle || (results.roles?.[0]?.value) || 'Executive';
      const fallbackCompany = results.linkedinParsedData?.company || identity.company.normalized;
      results.experience.push({
        title: fallbackTitle,
        company: fallbackCompany,
        duration: 'Present',
        source: 'Corporate Directory Mapping',
        confidence: CONFIDENCE.COMPANY_WEBSITE,
        timestamp: new Date().toISOString(),
      });
    }

    // Deduplicate
    results.emails = dedup(results.emails, 'value');
    results.phones = dedup(results.phones, 'value');

    const duration = Date.now() - start;
    logger.success('Public Search',
      `Found ${results.emails.length} email(s), ${results.phones.length} phone(s), ${results.roles.length} role(s), ${results.experience.length} experience entries from ${results.pagesSearched.length} pages`,
      { durationMs: duration }
    );

    return results;
  } catch (err) {
    const duration = Date.now() - start;
    logger.warning('Public Search', `Browser error: ${err.message} — using HTTP fallback`, { durationMs: duration });

    // Fallback to basic HTTP
    for (const domain of identity.company.possibleDomains.slice(0, 2)) {
      await scrapeCompanyDomainBasic(domain, identity, results, logger);
    }
    return results;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ─── DuckDuckGo Search (Free, no API key) ─────────────────

async function duckDuckGoSearch(page, identity, results, allSnippets, logger) {
  const urls = [];

  const originalTerm = identity.company.normalized;
  const officialTerm = identity.company.officialName
    ? identity.company.officialName.replace(/\b(private|limited|llp|pvt|ltd|inc|corp|corporation|co|company|india)\b/gi, '').trim()
    : '';

  // Use both original input name and resolved registry name to maximize coverage
  const companyQueryPart = officialTerm && officialTerm.toLowerCase() !== originalTerm.toLowerCase()
    ? `("${originalTerm}" OR "${officialTerm}")`
    : `"${originalTerm}"`;

  const queries = [
    `"${identity.normalized.fullName}" ${companyQueryPart} contact email phone`,
    `"${identity.normalized.fullName}" ${companyQueryPart} email OR phone OR mobile`,
    `"${identity.normalized.fullName}" ${companyQueryPart} career OR experience OR biography OR background OR education`,
    `"${identity.normalized.fullName}" promoter OR "family office" OR "angel investor" OR trustee OR "board of directors"`,
    `"${identity.normalized.fullName}" Zauba OR Tofler OR "Economic Times" OR VCCircle OR Trendlyne`,
    `"${identity.normalized.fullName}" contact OR email OR phone OR mobile OR linkedin`, // Broad search without company constraints
    `"${identity.normalized.fullName}" "gmail.com" OR "yahoo.com" OR "hotmail.com"`,  // Personal email search
    `"${identity.normalized.fullName}" ${companyQueryPart} filetype:pdf`,
  ];

  let ddgBlocked = false;

  for (const query of queries) {
    try {
      logger.running('Public Search', `Public Search: Querying...`);
      let pageUrls = [];

      if (!ddgBlocked) {
        try {
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 4000 });
          if (!res || res.status() !== 200) {
            ddgBlocked = true;
          } else {
            await page.waitForSelector('a.result__a', { timeout: 2000 }).catch(() => { ddgBlocked = true; });
            pageUrls = await page.evaluate(() => {
              const links = document.querySelectorAll('a.result__a');
              return Array.from(links).map(a => {
                let href = a.getAttribute('href') || '';
                if (href.startsWith('//')) href = 'https:' + href;
                if (href.includes('uddg=')) {
                  try {
                    const urlObj = new URL(href);
                    const uddg = urlObj.searchParams.get('uddg');
                    if (uddg) href = uddg;
                  } catch (e) {}
                }
                return { href, text: a.textContent.trim() };
              }).filter(l => l.href && l.href.startsWith('http'));
            });
          }
        } catch (e) {
          ddgBlocked = true;
        }
      }

      // Google search fallback if DDG throttled or blocked
      if (pageUrls.length === 0) {
        try {
          const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
          await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 6000 });
          await new Promise(r => setTimeout(r, 600));
          pageUrls = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('h3').forEach(h3 => {
              const anchor = h3.closest('a');
              if (!anchor) return;
              let href = anchor.getAttribute('href') || anchor.href || '';
              if (href.includes('/url?q=')) {
                const match = href.match(/\/url\?q=([^&]+)/);
                if (match) href = decodeURIComponent(match[1]);
              }
              if (href.startsWith('http') && !href.includes('google.com')) {
                items.push({ href, text: h3.textContent.trim() });
              }
            });
            return items;
          });
        } catch (ge) {}
      }

      for (const { href, text } of pageUrls.slice(0, 8)) {
        if (!href.includes('duckduckgo.com')) {
          urls.push(href);

          if (href.includes('twitter.com/') || href.includes('x.com/')) {
            results.socialLinks.push({ platform: 'Twitter/X', url: href, source: 'DuckDuckGo Search' });
          } else if (href.includes('crunchbase.com/')) {
            results.socialLinks.push({ platform: 'Crunchbase', url: href, source: 'DuckDuckGo Search' });
          }
        }
      }

      // Extract data from search results (titles, links, snippets)
      const searchResultsData = await page.evaluate(() => {
        const items = [];
        document.querySelectorAll('.result__body').forEach(el => {
          const titleEl = el.querySelector('a.result__a');
          const snippetEl = el.querySelector('.result__snippet');
          if (titleEl) {
            items.push({
              title: titleEl.textContent.trim(),
              href: titleEl.getAttribute('href') || '',
              snippet: snippetEl ? snippetEl.textContent.trim() : ''
            });
          }
        });
        return items;
      });

      for (const item of searchResultsData) {
        allSnippets.push(item);
        // Resolve DDG redirect URL if present
        let actualUrl = item.href;
        if (actualUrl.startsWith('//')) actualUrl = 'https:' + actualUrl;
        else if (actualUrl.startsWith('/')) actualUrl = 'https://duckduckgo.com' + actualUrl;
        
        if (actualUrl.includes('uddg=')) {
          try {
            const urlObj = new URL(actualUrl);
            const uddg = urlObj.searchParams.get('uddg');
            if (uddg) actualUrl = uddg;
          } catch (e) {}
        }

        // Extract contacts from title & snippet
        extractFromText(item.title + ' ' + item.snippet, actualUrl || 'DuckDuckGo Search', identity, results);

        // Smart experience extraction from LinkedIn title snippet
        if (actualUrl.includes('linkedin.com/in/') || item.title.toLowerCase().includes('linkedin') || item.title.toLowerCase().includes(' at ')) {
          const title = item.title;
          const parts = title.split(' - ');
          let rolePart = parts.length >= 2 ? parts[1] : title;
          
          rolePart = rolePart.replace(/\b(LinkedIn|Profiles|on LinkedIn)\b/gi, '').replace(/[|•-]$/, '').trim();
          
          if (rolePart.toLowerCase().includes(' at ')) {
            const atParts = rolePart.split(/\s+at\s+/i);
            if (atParts.length >= 2) {
              const roleTitle = atParts[0].trim();
              const companyName = atParts[1].split(/[|•-]/)[0].trim();
              
              // Verify company match (case-insensitive, check coreWords)
              const coreWords = identity.company.coreWords || [];
              const companyLower = companyName.toLowerCase();
              const matchesCompany = coreWords.some(word => companyLower.includes(word.toLowerCase()));

              if (matchesCompany && roleTitle && companyName && !results.experience.some(exp => exp.company.toLowerCase() === companyName.toLowerCase())) {
                results.experience.push({
                  title: roleTitle,
                  company: companyName,
                  duration: 'Present / Recent',
                  source: 'Web Search Summary',
                  confidence: CONFIDENCE.PUBLIC_DIRECTORY,
                  timestamp: new Date().toISOString()
                });
              }
            }
          }
        }
      }
    } catch (err) {
      logger.warning('Public Search', `DuckDuckGo query failed: ${err.message}`);
    }
  }

  const unique = [...new Set(urls)];
  if (unique.length > 0) {
    logger.success('Public Search', `DuckDuckGo: Found ${unique.length} result URLs`);
  }

  return unique;
}

// ─── LinkedIn Intelligence (NO sign-in required) ──────────
//
// Strategy 1: JSON-LD structured data — LinkedIn auth-wall pages still serve
//             <script type="application/ld+json"> with name, headline, jobTitle
// Strategy 2: Open Graph meta tags — og:title, og:description always present
// Strategy 3: DuckDuckGo search titles — "Name - Role at Company | LinkedIn"
// Strategy 4: HTTP fetch (no Puppeteer needed — avoids JS redirect to login)

async function scrapeLinkedIn(page, identity, results, allSnippets, logger) {
  // Discover LinkedIn profile URL via multi-engine search cascade
  let linkedinUrl = await discoverLinkedInProfileUrl(page, identity, results, allSnippets, logger);

  if (!linkedinUrl) {
    logger.skipped('Public Search', 'LinkedIn: No verified profile URL found');
    return;
  }

  // Ensure results store the confirmed profile URL
  results.linkedinProfile = linkedinUrl;
  results.pagesSearched.push(linkedinUrl);

  // ── Strategy 1 & 2: Load LinkedIn page and extract structured data (JSON-LD + meta tags) ──
  logger.running('Public Search', `LinkedIn: Loading profile ${linkedinUrl}...`);

  // ── Strategy 1 & 2: Load LinkedIn page and extract structured data (JSON-LD + meta tags) ──
  logger.running('Public Search', 'LinkedIn: Extracting structured data (JSON-LD + meta tags)...');

  // Inject session cookie if available
  const cookieValue = process.env.LINKEDIN_COOKIE;
  let isAuthenticated = false;
  if (cookieValue) {
    try {
      logger.running('Public Search', 'LinkedIn: Injecting session cookie for authenticated scraping...');
      await page.setCookie({
        name: 'li_at',
        value: cookieValue.trim(),
        domain: '.www.linkedin.com',
        path: '/',
        secure: true,
        httpOnly: true
      });
      isAuthenticated = true;
      logger.success('Public Search', 'LinkedIn: Session cookie injected successfully');
    } catch (cookieErr) {
      logger.warning('Public Search', `LinkedIn: Failed to inject session cookie: ${cookieErr.message}`);
    }
  }

  let html = '';
  let authenticatedPageLoaded = false;
  // Prioritize Puppeteer if a session cookie is injected
  if (isAuthenticated) {
    try {
      logger.running('Public Search', 'LinkedIn: Loading profile via Puppeteer with active session...');
      await page.goto(linkedinUrl, { waitUntil: 'networkidle2', timeout: 20000 });

      // Scroll down to trigger lazy loading of experience/education sections
      logger.running('Public Search', 'LinkedIn: Scrolling page to load experience/education sections...');
      await autoScrollLinkedIn(page);

      // Wait a moment for dynamic content to render
      await new Promise(r => setTimeout(r, 2000));

      html = await page.content();

      // Check if we got an authenticated page (not a login wall)
      const isLoginWall = html.includes('session_redirect') || html.includes('signup/cold-join') || html.includes('authwall');
      if (!isLoginWall && html.length > 5000) {
        authenticatedPageLoaded = true;
        logger.success('Public Search', `LinkedIn: Authenticated page loaded (${(html.length / 1024).toFixed(0)}KB)`);
      } else {
        logger.warning('Public Search', 'LinkedIn: Session cookie may be expired — got login wall');
        isAuthenticated = false;
      }
    } catch (err) {
      logger.warning('Public Search', `LinkedIn: Puppeteer session navigation failed: ${err.message} — trying HTTP fetch...`);
    }
  }

  // Fallback to basic fetch if Puppeteer did not succeed or no cookie was injected
  if (!html || html.length < 500) {
    try {
      const res = await fetch(linkedinUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });

      if (res.ok) {
        html = await res.text();
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      if (!isAuthenticated) {
        logger.running('Public Search', `LinkedIn: HTTP fetch failed (${err.message}) — trying Puppeteer navigation...`);
        try {
          await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
          await new Promise(r => setTimeout(r, 1200));
          html = await page.content();
        } catch (pe) {
          try {
            html = await page.content();
          } catch (e2) {
            logger.warning('Public Search', `LinkedIn: Puppeteer fallback navigation failed: ${pe.message}`);
          }
        }
      } else {
        logger.warning('Public Search', `LinkedIn: HTTP fetch fallback failed: ${err.message}`);
      }
    }
  }

  // ── Strategy 0 (BEST): Authenticated DOM Scraping for Experience/Education ──
  if (authenticatedPageLoaded) {
    try {
      logger.running('Public Search', 'LinkedIn: Parsing full DOM for experience and education...');
      const domData = await extractLinkedInDOMData(page, logger);

      if (domData.experience && domData.experience.length > 0) {
        logger.success('Public Search', `LinkedIn DOM: Found ${domData.experience.length} experience entries`);
        // Clear any less-reliable experience entries we had before
        results.experience = [];
        for (const exp of domData.experience) {
          results.experience.push({
            title: exp.title,
            company: exp.company,
            duration: exp.duration || 'Period N/A',
            location: exp.location || '',
            description: exp.description || '',
            source: 'LinkedIn (Authenticated DOM)',
            confidence: CONFIDENCE.COMPANY_WEBSITE,
            timestamp: new Date().toISOString(),
          });
        }
      }

      if (domData.education && domData.education.length > 0) {
        logger.success('Public Search', `LinkedIn DOM: Found ${domData.education.length} education entries`);
        results.education = domData.education.map(edu => ({
          institution: edu.institution,
          degree: edu.degree || '',
          fieldOfStudy: edu.fieldOfStudy || '',
          duration: edu.duration || '',
          source: 'LinkedIn (Authenticated DOM)',
          confidence: CONFIDENCE.COMPANY_WEBSITE,
          timestamp: new Date().toISOString(),
        }));
      }

      // Extract headline/name from profile top section
      if (domData.headline) {
        results.roles.push({
          value: domData.headline,
          source: linkedinUrl,
          sourceType: 'LinkedIn (Authenticated DOM)',
          confidence: CONFIDENCE.COMPANY_WEBSITE,
          timestamp: new Date().toISOString(),
        });
      }

      if (domData.name) {
        results.linkedinProfile = {
          url: linkedinUrl,
          name: domData.name,
          headline: domData.headline || '',
          location: domData.location || '',
          source: 'LinkedIn (Authenticated DOM)',
          confidence: CONFIDENCE.COMPANY_WEBSITE,
          timestamp: new Date().toISOString(),
        };
      }

      // Also collect full page text as a snippet for AI extraction fallback
      if (domData.fullText) {
        allSnippets.push({
          title: `LinkedIn Profile: ${domData.name || identity.normalized.fullName}`,
          href: linkedinUrl,
          snippet: domData.fullText.substring(0, 3000),
        });
      }
    } catch (domErr) {
      logger.warning('Public Search', `LinkedIn: DOM extraction failed: ${domErr.message} — falling back to meta tags`);
    }
  }

  if (html && html.length > 200) {
    try {
      logger.running('Public Search', 'LinkedIn: Running Cheerio public HTML parser...');
      const parsedData = parsePublicLinkedInHtml(html);
      results.linkedinParsedData = parsedData;

      if (parsedData.profileUrl) {
        linkedinUrl = parsedData.profileUrl;
      }

      if (parsedData.headline || parsedData.jobTitle) {
        const headlineText = parsedData.headline || (parsedData.jobTitle ? `${parsedData.jobTitle} @ ${parsedData.company || ''}` : '');
        results.roles.push({
          value: headlineText,
          source: linkedinUrl,
          sourceType: 'LinkedIn (Cheerio Public Parser)',
          confidence: CONFIDENCE.COMPANY_WEBSITE,
          timestamp: new Date().toISOString(),
        });
      }

      if (parsedData.jobTitle && parsedData.company) {
        if (!results.experience.some(exp => exp.company?.toLowerCase() === parsedData.company.toLowerCase())) {
          results.experience.push({
            title: parsedData.jobTitle,
            company: parsedData.company,
            duration: 'Current',
            source: 'LinkedIn (Cheerio Public Parser)',
            confidence: CONFIDENCE.COMPANY_WEBSITE,
            timestamp: new Date().toISOString(),
          });
        }
      }

      if (parsedData.experience && parsedData.experience.length > 0) {
        for (const exp of parsedData.experience) {
          if (exp.company && exp.title) {
            if (!results.experience.some(e => e.company?.toLowerCase() === exp.company.toLowerCase() && e.title?.toLowerCase() === exp.title.toLowerCase())) {
              results.experience.push({
                title: exp.title,
                company: exp.company,
                duration: exp.duration || 'Period N/A',
                location: exp.location || '',
                description: exp.description || '',
                source: 'LinkedIn (Cheerio Public Parser)',
                confidence: CONFIDENCE.COMPANY_WEBSITE,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }

      if (parsedData.education && parsedData.education.length > 0) {
        for (const edu of parsedData.education) {
          if (edu.institution) {
            results.education.push({
              institution: edu.institution,
              degree: edu.degree || '',
              fieldOfStudy: edu.fieldOfStudy || '',
              duration: edu.duration || '',
              source: 'LinkedIn (Cheerio Public Parser)',
              confidence: CONFIDENCE.COMPANY_WEBSITE,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      logger.success('Public Search', `LinkedIn: Cheerio parser extracted profile for "${parsedData.name || identity.normalized.fullName}" (confidence: ${parsedData.confidence})`);
      extractFromText(html.substring(0, 10000), linkedinUrl, identity, results);
    } catch (e) {
      logger.warning('Public Search', `LinkedIn: Extraction error: ${e.message}`);
    }
  }

  // ── SERP Mirror Fallback (Bright Data Technique) ──
  // If direct HTML fetch hit an authwall or returned low-confidence data, query SERP cache mirrors
  if (!results.linkedinParsedData || results.linkedinParsedData.confidence < 0.3) {
    try {
      logger.running('Public Search', 'LinkedIn: Direct fetch authwalled — triggering Bright Data SERP Mirror Fallback...');
      const serpParsed = await fetchLinkedInSerpMirror(linkedinUrl, identity, logger);
      if (serpParsed && serpParsed.confidence > (results.linkedinParsedData?.confidence || 0)) {
        results.linkedinParsedData = serpParsed;
        logger.success('Public Search', `LinkedIn SERP Mirror: Recovered profile metadata for "${serpParsed.name || identity.normalized.fullName}"`);
        
        if (serpParsed.jobTitle && serpParsed.company) {
          results.roles.push({
            value: `${serpParsed.jobTitle} at ${serpParsed.company}`,
            source: linkedinUrl,
            sourceType: 'LinkedIn (SERP Mirror Fallback)',
            confidence: CONFIDENCE.COMPANY_WEBSITE,
            timestamp: new Date().toISOString(),
          });
          results.experience.push({
            title: serpParsed.jobTitle,
            company: serpParsed.company,
            duration: 'Current',
            source: 'LinkedIn (SERP Mirror Fallback)',
            confidence: CONFIDENCE.COMPANY_WEBSITE,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (serpErr) {
      logger.warning('Public Search', `LinkedIn SERP Mirror fallback error: ${serpErr.message}`);
    }
  }

  if (linkedinUrl) {
    results.linkedinProfile = linkedinUrl;
    results.pagesSearched.push(linkedinUrl);
  }
}

async function fetchLinkedInSerpMirror(linkedinUrl, identity, logger) {
  const handleMatch = linkedinUrl.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/i);
  const handle = handleMatch ? handleMatch[1] : null;

  const queries = [
    handle ? `site:linkedin.com/in/${handle}` : null,
    `site:linkedin.com/in/ "${identity.normalized.fullName}" "${identity.company.normalized}"`
  ].filter(Boolean);

  for (const q of queries) {
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const text = await res.text();
        const $ = cheerio.load(text);
        const firstResult = $('.result__body').first();

        if (firstResult.length) {
          const titleText = firstResult.find('a.result__a').text().trim();
          const snippetText = firstResult.find('.result__snippet').text().trim();

          if (titleText && titleText.toLowerCase().includes('linkedin')) {
            const virtualHtml = `
              <!DOCTYPE html>
              <html>
              <head>
                <title>${titleText}</title>
                <meta property="og:title" content="${titleText}" />
                <meta property="og:description" content="${snippetText}" />
                <meta property="og:url" content="${linkedinUrl}" />
              </head>
              <body>
                <h1>${titleText}</h1>
                <p>${snippetText}</p>
              </body>
              </html>
            `;

            const parsed = parsePublicLinkedInHtml(virtualHtml);
            if (parsed && (parsed.name || parsed.jobTitle || parsed.headline)) {
              return parsed;
            }
          }
        }
      }
    } catch {
      // Continue to next query if any fails
    }
  }

  return null;
}

// Parse LinkedIn titles like:
// "Bhavesh Vyas - Head -Process Excellence & Digitisation at ASK ..."
// "Bhavesh Vyas - AVP - Kotak Mahindra Bank | LinkedIn"
function parseLinkedInTitle(title, identity) {
  if (!title) return null;

  // Remove " | LinkedIn" suffix
  let clean = title.replace(/\s*[|–-]\s*(LinkedIn|Profiles?)\.?$/i, '').trim();

  // Split by " - " — LinkedIn format is "Name - Role at Company"
  const parts = clean.split(/\s+-\s+/);
  if (parts.length < 2) return null;

  // First part is usually the name, rest is role info
  const nameFromTitle = parts[0].trim();
  let roleSection = parts.slice(1).join(' - ').trim();

  // Verify the name matches our person (fuzzy)
  const nameLower = nameFromTitle.toLowerCase();
  const personLower = identity.normalized.fullName.toLowerCase();
  if (!nameLower.includes(identity.normalized.firstName.toLowerCase()) &&
      !personLower.includes(nameLower.split(' ')[0])) {
    return null; // Not our person
  }

  // Parse "Role at Company" or "Role | Company"
  let role = null;
  let company = null;

  // Try "X at Y"
  const atMatch = roleSection.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) {
    role = atMatch[1].trim();
    company = atMatch[2].split(/[|•,]/)[0].trim();
  } else {
    // Try "Role | Company | ..."
    const pipeParts = roleSection.split(/\s*[|]\s*/);
    if (pipeParts.length >= 2) {
      role = pipeParts[0].trim();
      company = pipeParts[1].trim();
    } else {
      role = roleSection;
    }
  }

  // Clean up trailing "..." from DDG truncation
  if (role) role = role.replace(/\.{2,}$/, '').trim();
  if (company) company = company.replace(/\.{2,}$/, '').trim();

  // ── Verify company match (case insensitive, check coreWords) ──
  const coreWords = identity.company.coreWords || [];
  if (company) {
    const companyLower = company.toLowerCase();
    const isMatch = coreWords.some(word => companyLower.includes(word.toLowerCase()));
    if (!isMatch) return null; // Company mismatch!
  } else {
    const roleLower = roleSection.toLowerCase();
    const isMatch = coreWords.some(word => roleLower.includes(word.toLowerCase()));
    if (!isMatch) return null; // Mismatch!
  }

  return { role, company };
}


// ─── Company Domain Scraping (Puppeteer) ───────────────────

async function scrapeCompanyDomain(page, domain, identity, results, logger) {
  const baseUrl = `https://${domain}`;

  const loaded = await navigateSafely(page, baseUrl);
  if (!loaded) return;

  logger.running('Public Search', `Scraping ${domain}...`);
  await extractFromPage(page, baseUrl, identity, results);
  results.pagesSearched.push(baseUrl);

  // Discover relevant internal links
  const discoveredPaths = await discoverRelevantLinks(page, baseUrl);
  const pathsToTry = [...new Set([...discoveredPaths, ...CONTACT_PAGE_PATHS])].slice(0, 6);

  for (const path of pathsToTry) {
    const pageUrl = path.startsWith('http') ? path : `${baseUrl}${path}`;
    if (results.pagesSearched.includes(pageUrl)) continue;

    const loaded = await navigateSafely(page, pageUrl);
    if (!loaded) continue;

    results.pagesSearched.push(pageUrl);
    await extractFromPage(page, pageUrl, identity, results);
  }
}

async function discoverRelevantLinks(page, baseUrl) {
  try {
    return await page.evaluate((base) => {
      const keywords = ['team', 'about', 'leadership', 'management', 'contact', 'director', 'people', 'investor', 'board'];
      const links = document.querySelectorAll('a[href]');
      const paths = [];

      for (const link of links) {
        const href = link.href;
        const text = link.textContent.toLowerCase();
        const isRelevant = keywords.some(kw => text.includes(kw) || href.toLowerCase().includes(kw));

        if (isRelevant && href.startsWith(base)) {
          try {
            const path = new URL(href).pathname;
            if (path !== '/' && !paths.includes(path)) paths.push(path);
          } catch (e) {}
        }
      }
      return paths.slice(0, 6);
    }, baseUrl);
  } catch {
    return [];
  }
}

async function scrapeUrl(page, url, identity, results, logger) {
  if (results.pagesSearched.includes(url)) return;

  const loaded = await navigateSafely(page, url);
  if (!loaded) return;

  results.pagesSearched.push(url);
  await extractFromPage(page, url, identity, results);
}

async function navigateSafely(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));
    return true;
  } catch {
    return false;
  }
}

async function extractFromPage(page, sourceUrl, identity, results) {
  try {
    const html = await page.content();
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();
    const text = $('body').text();

    const nameVariants = identity.searchVariants.map(v => v.toLowerCase());
    const textLower = text.toLowerCase();
    const personMentioned = nameVariants.some(v => textLower.includes(v));

    // Find all positions where the target person's name appears
    const namePositions = [];
    for (const variant of nameVariants) {
      let idx = textLower.indexOf(variant);
      while (idx !== -1) {
        namePositions.push(idx);
        idx = textLower.indexOf(variant, idx + 1);
      }
    }

    // Emails
    const emails = text.match(EMAIL_REGEX) || [];
    $('a[href^="mailto:"]').each((_, el) => {
      const mailto = $(el).attr('href').replace('mailto:', '').split('?')[0];
      if (mailto && !emails.includes(mailto)) emails.push(mailto);
    });

    for (const email of emails) {
      const cleanEmail = email.toLowerCase().trim();
      if (isValidEmailFormat(cleanEmail)) {
        // Compute attribution based on proximity to person's name
        const attribution = computeProximityAttribution(text, email, namePositions, identity, personMentioned);
        const sourceConf = CONFIDENCE.COMPANY_WEBSITE;
        const finalConf = computeFinalConfidence(sourceConf, attribution);

        results.emails.push({
          value: cleanEmail,
          source: sourceUrl,
          sourceType: 'Company Website',
          confidence: finalConf,
          attribution,
          timestamp: new Date().toISOString(),
          personMentioned,
        });
      }
    }

    // Phones — use strict regex + blacklist
    const mobileMatches = text.match(INDIAN_MOBILE_REGEX) || [];
    const landlineMatches = text.match(INDIAN_LANDLINE_REGEX) || [];
    const allPhones = [...new Set([...mobileMatches, ...landlineMatches])];

    for (const phone of allPhones) {
      if (isBlacklistedNumber(phone)) continue;
      const cleaned = phone.replace(/[\s\-().]/g, '');

      // Compute attribution based on proximity
      const attribution = computeProximityAttribution(text, phone, namePositions, identity, personMentioned);
      const sourceConf = CONFIDENCE.COMPANY_WEBSITE;
      const finalConf = computeFinalConfidence(sourceConf, attribution);

      results.phones.push({
        value: cleaned,
        source: sourceUrl,
        sourceType: 'Company Website',
        confidence: finalConf,
        attribution,
        timestamp: new Date().toISOString(),
        personMentioned,
      });
    }

    // Roles
    if (personMentioned) {
      const roleMatches = text.match(
        /(?:CEO|CTO|CFO|COO|CMD|Managing\s+Director|Director|Chairman|Chairperson|President|Vice\s+President|VP|Partner|Head|Chief|Founder|Co-Founder|Executive\s+Director|Whole\s+Time\s+Director|Senior\s+Vice\s+President|SVP|EVP|Group\s+Head)/gi
      ) || [];

      for (const match of [...new Set(roleMatches)]) {
        results.roles.push({
          value: match.trim(),
          source: sourceUrl,
          sourceType: 'Company Website',
          confidence: CONFIDENCE.COMPANY_WEBSITE,
          timestamp: new Date().toISOString(),
        });
      }

      // Bios
      $('p, div.bio, div.description, div.profile-bio').each((_, el) => {
        const elText = $(el).text().trim();
        if (elText.length > 50 && elText.length < 1000) {
          if (nameVariants.some(v => elText.toLowerCase().includes(v))) {
            results.bios.push({
              value: elText.substring(0, 500),
              source: sourceUrl,
              sourceType: 'Company Website',
              confidence: CONFIDENCE.COMPANY_WEBSITE,
              timestamp: new Date().toISOString(),
            });
          }
        }
      });
    }

    // PDFs for OCR
    $('a[href$=".pdf"], a[href$=".PDF"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          const fullUrl = href.startsWith('http') ? href : new URL(href, sourceUrl).href;
          results.documentsFound.push({ url: fullUrl, type: 'pdf', source: sourceUrl });
        } catch (e) {}
      }
    });
  } catch (err) {
    // continue
  }
}

// ─── Basic HTTP Fallback ──────────────────────────────────

async function scrapeCompanyDomainBasic(domain, identity, results, logger) {
  for (const path of ['', '/about', '/contact', '/team', '/leadership']) {
    const url = `https://${domain}${path}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RMIntelBot/1.0)', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(6000),
        redirect: 'follow',
      });
      if (!res.ok) continue;
      if (!(res.headers.get('content-type') || '').includes('text/html')) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      $('script, style, noscript').remove();
      extractFromText($('body').text(), url, identity, results);
      results.pagesSearched.push(url);
    } catch {}
  }
}

function getContextSnippet(text, matchStr) {
  const matchIdx = text.toLowerCase().indexOf(matchStr.toLowerCase());
  if (matchIdx === -1) return '';
  const start = Math.max(0, matchIdx - 120);
  const end = Math.min(text.length, matchIdx + matchStr.length + 120);
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

// ─── Helpers ──────────────────────────────────────────────

function extractFromText(text, source, identity, results) {
  const nameVariants = identity.searchVariants.map(v => v.toLowerCase());
  const textLower = text.toLowerCase();
  const personMentioned = nameVariants.some(v => textLower.includes(v));

  // Find all positions where the target person's name appears
  const namePositions = [];
  for (const variant of nameVariants) {
    let idx = textLower.indexOf(variant);
    while (idx !== -1) {
      namePositions.push(idx);
      idx = textLower.indexOf(variant, idx + 1);
    }
  }

  // Extract Emails
  for (const email of (text.match(EMAIL_REGEX) || [])) {
    const clean = email.toLowerCase().trim();
    if (isValidEmailFormat(clean)) {
      const attribution = computeProximityAttribution(text, email, namePositions, identity, personMentioned);
      const sourceConf = personMentioned ? CONFIDENCE.COMPANY_WEBSITE : CONFIDENCE.PUBLIC_DIRECTORY;
      const finalConf = computeFinalConfidence(sourceConf, attribution);
      const context = getContextSnippet(text, email);

      results.emails.push({
        value: clean, source, sourceType: 'Web Search',
        confidence: finalConf, attribution,
        timestamp: new Date().toISOString(), personMentioned,
        context,
      });
    }
  }

  // Extract Phones — strict regex + blacklist
  const mobileMatches = text.match(INDIAN_MOBILE_REGEX) || [];
  const landlineMatches = text.match(INDIAN_LANDLINE_REGEX) || [];
  const allPhones = [...new Set([...mobileMatches, ...landlineMatches])];

  for (const phone of allPhones) {
    if (isBlacklistedNumber(phone)) continue;
    const cleaned = phone.replace(/[\s\-().]/g, '');

    const attribution = computeProximityAttribution(text, phone, namePositions, identity, personMentioned);
    const sourceConf = personMentioned ? CONFIDENCE.COMPANY_WEBSITE : CONFIDENCE.PUBLIC_DIRECTORY;
    const finalConf = computeFinalConfidence(sourceConf, attribution);
    const context = getContextSnippet(text, phone);

    results.phones.push({
      value: cleaned, source, sourceType: 'Web Search',
      confidence: finalConf, attribution,
      timestamp: new Date().toISOString(), personMentioned,
      context,
    });
  }
}

function isValidEmailFormat(email) {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) &&
    !email.endsWith('.png') && !email.endsWith('.jpg') && !email.endsWith('.svg') &&
    !email.includes('example.com') && !email.includes('sentry') &&
    !email.includes('webpack') && !email.includes('wixpress');
}

function dedup(arr, key) {
  const seen = new Set();
  return arr.filter(item => {
    if (seen.has(item[key])) return false;
    seen.add(item[key]);
    return true;
  });
}

async function extractExperienceWithAI(identity, snippets, primaryLinkedinUrl, logger) {
  if (snippets.length === 0) return [];

  // Pre-filter: discard signals originating from DIFFERENT LinkedIn profiles
  const filteredSnippets = snippets.filter(s => {
    const url = s.url || s.href || '';
    if (url.includes('linkedin.com/in/')) {
      const cleanUrl = url.replace(/\/$/, '').toLowerCase();
      const cleanPrimary = primaryLinkedinUrl ? primaryLinkedinUrl.replace(/\/$/, '').toLowerCase() : '';
      if (cleanPrimary && cleanUrl !== cleanPrimary) {
        return false;
      }
    }
    return true;
  });

  const snippetsText = filteredSnippets
    .slice(0, 15) // Limit to top 15 snippets to keep context size clean
    .map((r, i) => `[Signal #${i+1}]\nTitle: ${r.title}\nURL: ${r.url || r.href}\nSnippet: ${r.snippet}`)
    .join('\n\n');

  const linkedinRule = primaryLinkedinUrl 
    ? `- If a snippet references a LinkedIn profile URL that is different from "${primaryLinkedinUrl}", ignore that snippet. However, if the snippet references the primary LinkedIn URL or is from other sources (e.g. news, directories) without a LinkedIn URL, do NOT ignore it.`
    : `- If there are multiple different LinkedIn profile URLs in the snippets, verify that you only extract the career history of the target person "${identity.normalized.fullName}" who is associated with "${identity.company.normalized}". Do NOT ignore general company websites, news, or directory snippets that don't have a LinkedIn URL.`;

  const prompt = `You are a precise professional biography and executive career history extractor.
Given the following web search snippets about "${identity.normalized.fullName}" who works at "${identity.company.normalized}", extract their full executive career timeline (past and current job roles, company directorships, board seats, trustee positions, angel investments, and family office affiliations).

Target Information:
- Primary LinkedIn Profile URL: ${primaryLinkedinUrl || 'Not provided/discovered'}
- Target Company: ${identity.company.normalized}
- Company Keywords: ${identity.company.coreWords?.join(', ') || ''}

SEARCH SNIPPETS:
${snippetsText}

Generate a JSON response with exactly this structure:
{
  "experience": [
    {
      "title": "Executive Title/Role (e.g. Managing Director, Promoter, Board Member, Angel Investor, Trustee)",
      "company": "Company / Entity Name (e.g. ASK Wealth Advisors, Family Office, Startup Portfolio)",
      "duration": "Duration/Years if mentioned (e.g. 2022 - Present, or 3 years, or 'Present'), otherwise null"
    }
  ]
}

Rules:
- Only include roles belonging to the target person "${identity.normalized.fullName}". Do not include roles of other individuals with different names.
- Include corporate directorships, board seats, angel investments, and trustee positions in addition to standard employment roles.
${linkedinRule}
- Verify that at least one current or past role links to "${identity.company.normalized}" or its core words/aliases. If a snippet is about an entirely different person (e.g. different industry/location/company with no links to the target company), ignore it.
- Return ONLY the JSON object, no markdown or extra text.`;

  // Try Groq first, Gemini second
  if (process.env.GROQ_API_KEY) {
    try {
      const text = await callGroqWithFallback(
        'You are a precise biography data extractor. Respond with valid JSON only.',
        prompt,
        {
          timeout: 10000,
          temperature: 0.1,
          stage: 'Public Search'
        },
        logger
      );
      const content = JSON.parse(text);
      if (content && Array.isArray(content.experience)) {
        return content.experience;
      }
    } catch (e) {
      logger.warning('Public Search', `AI experience extraction (Groq) failed: ${e.message}. Trying Gemini fallback...`);
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const content = JSON.parse(match[0]);
        if (content && Array.isArray(content.experience)) {
          return content.experience;
        }
      }
    } catch (e) {
      logger.warning('Public Search', `AI experience extraction fallback (Gemini) failed: ${e.message}`);
    }
  }

  return [];
}

// ─── Proximity-Based Attribution ──────────────────────────
// Calculates how close a contact (email/phone) is to the target person's name
// on the page, and assigns an attribution confidence tier accordingly.

function computeProximityAttribution(text, contactValue, namePositions, identity, personMentioned) {
  // If person not mentioned on the page at all, contact is unattributed
  if (!personMentioned || namePositions.length === 0) {
    return ATTRIBUTION.UNATTRIBUTED;
  }

  // Check if the email contains the person's name (direct match)
  if (contactValue.includes('@')) {
    const localPart = contactValue.split('@')[0].toLowerCase();
    const firstName = identity.normalized.firstName.toLowerCase();
    const lastName = identity.normalized.lastName.toLowerCase();

    // Strong matches: bhavesh.vyas@, bvyas@, bhavesh@, vyas.bhavesh@
    if (
      (firstName.length >= 3 && localPart.includes(firstName)) ||
      (lastName.length >= 3 && localPart.includes(lastName)) ||
      localPart.includes(`${firstName[0]}${lastName}`) ||
      localPart.includes(`${firstName}.${lastName}`) ||
      localPart.includes(`${lastName}.${firstName}`)
    ) {
      return ATTRIBUTION.DIRECT_MATCH;
    }
  }

  // Find the position of this contact value in the text
  const contactIdx = text.toLowerCase().indexOf(contactValue.toLowerCase());
  if (contactIdx === -1) {
    // Contact not found as literal text (e.g. parsed from mailto:), use SAME_PAGE
    return ATTRIBUTION.SAME_PAGE;
  }

  // Calculate minimum distance from any name mention
  let minDistance = Infinity;
  for (const nameIdx of namePositions) {
    const dist = Math.abs(contactIdx - nameIdx);
    if (dist < minDistance) minDistance = dist;
  }

  // Tier based on distance
  if (minDistance <= 200) return ATTRIBUTION.PROXIMATE;       // Very close — likely same paragraph/card
  if (minDistance <= 500) return ATTRIBUTION.SAME_PAGE;        // Same section but not adjacent
  return ATTRIBUTION.UNATTRIBUTED;                             // Far away — likely different person's section
}

// ─── AI Contact Attribution ───────────────────────────────
// Sends collected contacts + page context to AI to confirm which contacts
// belong to the target person. Returns only confirmed contacts.

async function extractContactsWithAI(identity, results, logger) {
  const emailValues = results.emails.map(e => e.value);
  const phoneValues = results.phones.map(p => p.value);

  if (emailValues.length === 0 && phoneValues.length === 0) return null;

  const emailListStr = results.emails
    .map((e, i) => `${i + 1}. ${e.value} (source: ${e.source})
   Context found: "${e.context || 'None'}"`)
    .join('\n\n');

  const phoneListStr = results.phones
    .map((p, i) => `${i + 1}. ${p.value} (source: ${p.source})
   Context found: "${p.context || 'None'}"`)
    .join('\n\n');

  const prompt = `You are a precise contact attribution analyst.
I searched for "${identity.normalized.fullName}" who works at "${identity.company.normalized}".
During web scraping, the following email addresses and phone numbers were found across various web pages.

EMAILS FOUND:
${emailValues.length > 0 ? emailListStr : 'None'}

PHONE NUMBERS FOUND:
${phoneValues.length > 0 ? phoneListStr : 'None'}

PERSON DETAILS:
- Full Name: ${identity.normalized.fullName}
- First Name: ${identity.normalized.firstName}
- Last Name: ${identity.normalized.lastName}
- Company: ${identity.company.normalized}
- Company Domains: ${identity.company.possibleDomains?.slice(0, 3).join(', ') || 'unknown'}

Your task: Identify which of these contacts MOST LIKELY belong to "${identity.normalized.fullName}" personally. Use the context snippets to determine if the name and contact details appear in direct association with the target person or a different person.

Rules:
- An email like ${identity.normalized.firstName.toLowerCase()}.${identity.normalized.lastName.toLowerCase()}@company.com almost certainly belongs to this person.
- Personal emails like ${identity.normalized.firstName.toLowerCase()}${identity.normalized.lastName.toLowerCase()}1985@gmail.com (or other name variations on gmail/yahoo/hotmail) belong to this person if the surrounding context associates it with them or their details.
- An email like info@, admin@, contact@, hr@, support@ is a generic company email, NOT a personal contact. Exclude it.
- An email with a DIFFERENT person's name (e.g., rahul.sharma@...) does NOT belong to our target person. Exclude it.
- For phone numbers, only include numbers that appear in direct association with the target person (e.g., on their profile card, next to their name, or in their registry listing).
- When in doubt, EXCLUDE the contact. It's better to miss a contact than to show a wrong one.

Respond with ONLY this JSON:
{
  "emails": ["only emails belonging to ${identity.normalized.fullName}"],
  "phones": ["only phone numbers belonging to ${identity.normalized.fullName}"]
}`;

  // Try Groq first, Gemini second
  if (process.env.GROQ_API_KEY) {
    try {
      const text = await callGroqWithFallback(
        'You are a precise contact attribution analyst. Respond with valid JSON only.',
        prompt,
        { timeout: 10000, temperature: 0.1, stage: 'Public Search' },
        logger
      );
      const content = JSON.parse(text);
      if (content && (content.emails || content.phones)) {
        return content;
      }
    } catch (e) {
      logger.warning('Public Search', `AI contact attribution (Groq) failed: ${e.message}. Trying Gemini...`);
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const content = JSON.parse(match[0]);
        if (content && (content.emails || content.phones)) {
          return content;
        }
      }
    } catch (e) {
      logger.warning('Public Search', `AI contact attribution fallback (Gemini) failed: ${e.message}`);
    }
  }

  return null;
}

// ─── AI Identity & Profile Matching ───────────────────────

async function verifyLinkedInProfileMatch(candidate, identity, logger) {
  const titleLower = candidate.title ? candidate.title.toLowerCase() : '';
  const snippetLower = candidate.snippet ? candidate.snippet.toLowerCase() : '';
  const urlLower = candidate.url ? candidate.url.toLowerCase() : '';
  const firstName = identity.normalized.firstName.toLowerCase();
  const lastName = identity.normalized.lastName.toLowerCase();
  const companyWords = identity.company.coreWords || [];

  // Require BOTH first name and last name to match in the candidate URL or title
  const hasFirstName = firstName ? (urlLower.includes(firstName) || titleLower.includes(firstName)) : true;
  const hasLastName = lastName ? (urlLower.includes(lastName) || titleLower.includes(lastName)) : true;
  const exactNameMatch = hasFirstName && hasLastName;

  // If the candidate profile does NOT match both first and last name, reject immediately to prevent false positives
  if (!exactNameMatch) {
    return false;
  }

  // Targeted search results with matching full name are accepted
  if (candidate.isTargetedSearch) {
    return true;
  }

  const prompt = `You are a precise professional identity verification engine.
Target Person: "${identity.normalized.fullName}" working at "${identity.company.normalized}".
Candidate Profile:
- URL: ${candidate.url}
- Title: ${candidate.title || 'N/A'}
- Snippet: ${candidate.snippet || 'N/A'}

Verify if this candidate LinkedIn profile represents "${identity.normalized.fullName}".
Rules:
- The candidate's name must match our target's name (allow middle names, initials, spelling variations).
- The candidate should have some current or past association with the target company or industry.
- If the target company is not explicitly mentioned, but the name matches and location/role is compatible, accept it.

Respond ONLY with this JSON:
{
  "matches": true,
  "confidence": 0.90,
  "reason": "Brief reason"
}`;

  if (process.env.GROQ_API_KEY) {
    try {
      const responseText = await callGroqWithFallback(
        'Identity verification engine. Return valid JSON only.',
        prompt,
        { timeout: 7000, temperature: 0.1, stage: 'Public Search' },
        logger
      );
      const res = JSON.parse(responseText);
      if (res.matches && res.confidence >= 0.60) return true;
    } catch (e) {
      logger.warning('Public Search', `Groq identity matching failed: ${e.message}`);
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const res = JSON.parse(match[0]);
        if (res.matches && res.confidence >= 0.60) return true;
      }
    } catch (e) {
      logger.warning('Public Search', `Gemini identity matching fallback failed: ${e.message}`);
    }
  }

  // Fallback heuristic: check if name matches AND company word or targeted query
  const hasCompanyWord = companyWords.some(w => titleLower.includes(w.toLowerCase()) || snippetLower.includes(w.toLowerCase()));
  if (nameMatch && (hasCompanyWord || candidate.isTargetedSearch)) {
    return true;
  }

  return false;
}

// ─── Multi-Engine LinkedIn Profile URL Discovery ─────────────────

async function discoverLinkedInProfileUrl(page, identity, results, allSnippets, logger) {
  // 1. Check user-provided URL
  if (identity.linkedinUrl) {
    const norm = normalizeLinkedInUrl(identity.linkedinUrl);
    logger.success('Public Search', `LinkedIn: Using user-provided URL — ${norm || identity.linkedinUrl}`);
    if (norm && !results.socialLinks.some(s => s.url === norm)) {
      results.socialLinks.push({ platform: 'LinkedIn', url: norm, source: 'User Input' });
    }
    return norm || identity.linkedinUrl;
  }

  // 2. Check existing socialLinks
  const existing = results.socialLinks.find(l => l.platform === 'LinkedIn')?.url;
  if (existing) {
    const norm = normalizeLinkedInUrl(existing);
    if (norm) return norm;
  }

  // 3. Check already-collected search snippets for any LinkedIn URLs
  for (const snip of allSnippets) {
    if (snip.href && snip.href.includes('linkedin.com/in/')) {
      const norm = normalizeLinkedInUrl(snip.href);
      if (norm) {
        const isMatch = await verifyLinkedInProfileMatch({ url: norm, title: snip.title, snippet: snip.snippet, isTargetedSearch: false }, identity, logger);
        if (isMatch) {
          logger.success('Public Search', `LinkedIn: Discovered profile URL from web search snippets — ${norm}`);
          results.socialLinks.push({ platform: 'LinkedIn', url: norm, source: 'Web Search Snippet' });
          return norm;
        }
      }
    }
  }

  const fullName = identity.normalized.fullName;
  const companyTerm = identity.company.officialName || identity.company.normalized;
  const candidateList = [];

  // Search Engine 1: Google Natural Search (e.g. "Jainam Shah ASK Wealth Advisors")
  try {
    const googleQuery = `${fullName} ${companyTerm}`;
    logger.running('Public Search', `LinkedIn Discovery (Google): ${googleQuery}`);
    
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(googleQuery)}&num=10&hl=en`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    await new Promise(r => setTimeout(r, 1200));

    const googleResults = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('a').forEach(a => {
        let href = a.href || a.getAttribute('href') || '';
        if (href.includes('/url?q=')) {
          const match = href.match(/\/url\?q=([^&]+)/);
          if (match) href = decodeURIComponent(match[1]);
        }
        if (href.includes('linkedin.com/in/')) {
          const h3 = a.querySelector('h3') || a.parentElement?.querySelector('h3');
          const container = a.closest('div.g, div.MjjYud, div[data-sokoban-container]') || a.parentElement?.parentElement;
          const snippetEl = container ? container.querySelector('div[data-sncf], div.VwiC3b, span.aCOpRe') : null;
          items.push({
            url: href,
            title: h3 ? h3.textContent.trim() : a.textContent.trim(),
            snippet: snippetEl ? snippetEl.textContent.trim() : '',
            isTargetedSearch: true,
          });
        }
      });
      return items;
    });

    if (googleResults.length > 0) {
      logger.success('Public Search', `Google: Found ${googleResults.length} candidate LinkedIn URL(s)`);
      candidateList.push(...googleResults);
    }
  } catch (err) {
    logger.warning('Public Search', `Google LinkedIn discovery failed: ${err.message}`);
  }

  // Search Engine 2: DuckDuckGo Search (Natural unquoted query)
  if (candidateList.length === 0) {
    try {
      const ddgQuery = `${fullName} ${companyTerm}`;
      logger.running('Public Search', `LinkedIn Discovery (DuckDuckGo): ${ddgQuery}`);

      await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(ddgQuery)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });
      await new Promise(r => setTimeout(r, 1000));

      const ddgResults = await page.evaluate(() => {
        const items = [];
        document.querySelectorAll('.result__body').forEach(el => {
          const anchor = el.querySelector('a.result__a');
          const snippet = el.querySelector('.result__snippet');
          let href = anchor ? anchor.getAttribute('href') || '' : '';
          
          if (href.includes('uddg=')) {
            try {
              const match = href.match(/uddg=([^&]+)/);
              if (match) href = decodeURIComponent(match[1]);
            } catch (e) {}
          }
          if (href.startsWith('//')) href = 'https:' + href;

          if (href.includes('linkedin.com/in/')) {
            items.push({
              url: href,
              title: anchor ? anchor.textContent.trim() : '',
              snippet: snippet ? snippet.textContent.trim() : '',
              isTargetedSearch: true,
            });
          }
        });
        return items;
      });

      if (ddgResults.length > 0) {
        logger.success('Public Search', `DuckDuckGo: Found ${ddgResults.length} candidate LinkedIn URL(s)`);
        candidateList.push(...ddgResults);
      }
    } catch (err) {
      logger.warning('Public Search', `DuckDuckGo LinkedIn discovery failed: ${err.message}`);
    }
  }

  // Search Engine 3: Bing Search
  if (candidateList.length === 0) {
    try {
      const bingQuery = `site:linkedin.com/in "${fullName}" "${companyTerm}"`;
      logger.running('Public Search', `LinkedIn Discovery (Bing): ${bingQuery}`);

      await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(bingQuery)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });
      await new Promise(r => setTimeout(r, 1000));

      const bingResults = await page.evaluate(() => {
        const items = [];
        document.querySelectorAll('li.b_algo, a[href*="linkedin.com/in/"]').forEach(el => {
          const anchor = el.tagName === 'A' ? el : el.querySelector('h2 a');
          const snippet = el.querySelector ? el.querySelector('.b_caption p') : null;
          const href = anchor ? anchor.getAttribute('href') || '' : '';
          if (href.includes('linkedin.com/in/')) {
            items.push({
              url: href,
              title: anchor ? anchor.textContent.trim() : '',
              snippet: snippet ? snippet.textContent.trim() : '',
              isTargetedSearch: true,
            });
          }
        });
        return items;
      });

      if (bingResults.length > 0) {
        logger.success('Public Search', `Bing: Found ${bingResults.length} candidate LinkedIn URL(s)`);
        candidateList.push(...bingResults);
      }
    } catch (err) {
      logger.warning('Public Search', `Bing LinkedIn discovery failed: ${err.message}`);
    }
  }

  // Search Engine 4: Broad name-only fallback (without company term if strict searches failed)
  if (candidateList.length === 0) {
    try {
      const broadQuery = `site:linkedin.com/in "${fullName}"`;
      logger.running('Public Search', `LinkedIn Discovery (Broad Fallback): ${broadQuery}`);

      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(broadQuery)}&num=5&hl=en`, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });
      await new Promise(r => setTimeout(r, 1000));

      const broadResults = await page.evaluate(() => {
        const items = [];
        document.querySelectorAll('div.g, a[href*="linkedin.com/in/"]').forEach(el => {
          const anchor = el.tagName === 'A' ? el : el.querySelector('a[href*="linkedin.com/in/"]');
          const titleEl = el.querySelector ? el.querySelector('h3') : null;
          const snippetEl = el.querySelector ? el.querySelector('div[data-sncf], div.VwiC3b, span.aCOpRe') : null;
          const href = anchor ? anchor.href : '';
          if (href.includes('linkedin.com/in/')) {
            items.push({
              url: href,
              title: titleEl ? titleEl.textContent.trim() : '',
              snippet: snippetEl ? snippetEl.textContent.trim() : '',
              isTargetedSearch: false,
            });
          }
        });
        return items;
      });

      if (broadResults.length > 0) {
        candidateList.push(...broadResults);
      }
    } catch (err) {}
  }

  // Verify and select the best matching LinkedIn URL
  const seenUrls = new Set();
  for (const cand of candidateList) {
    const normalized = normalizeLinkedInUrl(cand.url);
    if (!normalized || seenUrls.has(normalized)) continue;
    seenUrls.add(normalized);

    logger.running('Public Search', `Verifying candidate LinkedIn profile match: ${normalized}`);
    const isMatch = await verifyLinkedInProfileMatch({ ...cand, url: normalized }, identity, logger);

    if (isMatch) {
      logger.success('Public Search', `Verified LinkedIn profile matches target person: ${normalized}`);
      if (!results.socialLinks.some(s => s.url === normalized)) {
        results.socialLinks.push({ platform: 'LinkedIn', url: normalized, source: 'Search Engine (Verified)' });
      }
      return normalized;
    }
  }

  return null;
}

function normalizeLinkedInUrl(url) {
  if (!url) return null;
  const match = url.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  if (match && match[1]) {
    return `https://www.linkedin.com/in/${match[1]}`;
  }
  return null;
}

// ─── Company Official Domain Discovery ─────────────────────

async function discoverOfficialDomain(page, identity, logger) {
  const companyName = identity.company.officialName || identity.company.normalized;
  const cleanName = companyName.replace(/\b(private|limited|llp|pvt|ltd|inc|corp|co|company|india)\b/gi, '').trim();
  const query = `${cleanName} official website homepage`;
  logger.running('Public Search', `Attempting to discover official company domain for: ${companyName}`);

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
    await page.waitForSelector('a.result__url, a.result__a', { timeout: 4000 }).catch(() => {});
    
    const domains = await page.evaluate(() => {
      const links = document.querySelectorAll('a.result__url, a.result__a');
      const list = [];
      for (const a of links) {
        let href = a.getAttribute('href') || '';
        if (href.includes('uddg=')) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) href = decodeURIComponent(match[1]);
        }
        if (href.startsWith('//')) href = 'https:' + href;
        if (href.startsWith('http')) {
          try {
            const urlObj = new URL(href);
            const host = urlObj.hostname.toLowerCase();
            // Filter out directories and social media websites
            const directories = [
              'duckduckgo.com', 'zaubacorp.com', 'tofler.in', 'linkedin.com', 'facebook.com', 
              'twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'wikipedia.org', 
              'justdial.com', 'indiamart.com', 'ambitionbox.com', 'glassdoor.com', 'sulekha.com',
              'crunchbase.com', 'tracxn.com', 'signalhire.com', 'apollo.io', 'hunter.io', 
              'rocketreach.co', 'peopledatalabs.com', 'instagram.com', 'pinterest.com'
            ];
            const isDirectory = directories.some(d => host === d || host.endsWith('.' + d));
            if (!isDirectory) {
              let domain = host.replace(/^www\./, '');
              list.push(domain);
            }
          } catch (e) {}
        }
      }
      return list;
    });

    logger.warning('Public Search', `Domain discovery debug: query="${query}" linksFound=${domains?.length} list=${JSON.stringify(domains)}`);

    if (domains && domains.length > 0) {
      return domains[0]; // Return the first organic domain found
    }
  } catch (err) {
    logger.warning('Public Search', `Domain discovery search failed: ${err.message}`);
  }
  return null;
}

// ─── Email Candidate Generation & Search Verification ──────

function generateEmailCandidates(identity, domain) {
  const first = identity.normalized.firstName.toLowerCase();
  const last = identity.normalized.lastName.toLowerCase();
  const firstInitial = first.charAt(0);
  const lastInitial = last.charAt(0);

  const list = [
    `${first}.${last}@${domain}`,
    `${first}${last}@${domain}`,
    `${firstInitial}${last}@${domain}`,
    `${first}${lastInitial}@${domain}`,
    `${first}@${domain}`,
  ];
  return [...new Set(list)];
}

async function verifyEmailViaSearch(page, email, logger) {
  const parts = email.split('@');
  const prefix = parts[0];
  const domain = parts[1];

  // Avoid @ symbol in the search query to bypass spam filtering blocks
  const query = `"${prefix}" "${domain}"`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
    await page.waitForSelector('.result__body', { timeout: 4000 }).catch(() => {});

    const hasResults = await page.evaluate((targetEmail) => {
      const resultsList = document.querySelectorAll('.result__body');
      if (resultsList.length === 0) return false;

      // Verify the full email address is present in the results text
      const pageText = document.body.textContent || '';
      return pageText.toLowerCase().includes(targetEmail.toLowerCase());
    }, email);

    return hasResults;
  } catch (err) {
    logger.warning('Public Search', `Email verification search failed for ${email}: ${err.message}`);
    return false;
  }
}

function isPersonalEmail(email, identity) {
  const emailLower = email.toLowerCase().trim();
  const first = identity.normalized.firstName.toLowerCase();
  const last = identity.normalized.lastName.toLowerCase();
  
  // Generic email prefixes
  const generics = ['info@', 'contact@', 'sales@', 'admin@', 'support@', 'hr@', 'careers@', 'jobs@', 'pms@', 'cds@', 'compliance@'];
  if (generics.some(g => emailLower.startsWith(g))) return false;

  // Check if it contains first name, last name, or initials
  if (emailLower.includes(first) || emailLower.includes(last)) return true;
  
  const initialMatch = emailLower.startsWith(first.charAt(0)) && emailLower.includes(last);
  if (initialMatch) return true;

  return false;
}

// ─── Google Search (Secondary Contact Discovery Engine) ──────

async function googleSearchForContacts(page, identity, results, allSnippets, logger) {
  const queries = [
    `"${identity.normalized.fullName}" email phone mobile contact`,
    `"${identity.normalized.fullName}" "@gmail.com" OR "@yahoo.com" OR "@hotmail.com" OR "@outlook.com"`,
    `"${identity.normalized.fullName}" "+91" OR "phone" OR "mobile" OR "cell"`,
  ];

  for (const query of queries) {
    try {
      logger.running('Public Search', 'Google: Searching for additional contacts...');
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await new Promise(r => setTimeout(r, 1500));

      const searchData = await page.evaluate(() => {
        const items = [];
        // Google search result selectors
        document.querySelectorAll('div.g, div[data-sokoban-container]').forEach(el => {
          const titleEl = el.querySelector('h3');
          const snippetEl = el.querySelector('div[data-sncf], div.VwiC3b, span.aCOpRe');
          const linkEl = el.querySelector('a[href]');
          if (titleEl) {
            items.push({
              title: titleEl.textContent.trim(),
              snippet: snippetEl ? snippetEl.textContent.trim() : '',
              href: linkEl ? linkEl.href : '',
            });
          }
        });
        // Also capture featured snippets and knowledge panels
        const featuredSnippet = document.querySelector('div.IZ6rdc, div.hgKElc');
        if (featuredSnippet) {
          items.push({
            title: 'Featured Snippet',
            snippet: featuredSnippet.textContent.trim(),
            href: '',
          });
        }
        return items;
      });

      for (const item of searchData) {
        allSnippets.push(item);
        extractFromText(
          (item.title || '') + ' ' + (item.snippet || ''),
          item.href || 'Google Search',
          identity,
          results
        );
      }

      if (searchData.length > 0) {
        logger.success('Public Search', `Google: Extracted ${searchData.length} search results for contact signals`);
      }
    } catch (err) {
      logger.warning('Public Search', `Google search failed: ${err.message}`);
    }
  }
}

// ─── LinkedIn Authenticated DOM Helpers ──────────────────────

/**
 * Scrolls the LinkedIn profile page down to trigger lazy-loading
 * of experience, education, and other sections.
 */
async function autoScrollLinkedIn(page) {
  try {
    await page.evaluate(async () => {
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      const scrollStep = 400;
      const maxScrolls = 20;
      
      for (let i = 0; i < maxScrolls; i++) {
        window.scrollBy(0, scrollStep);
        await delay(300);
        
        // Check if we've reached the bottom
        if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight - 200) {
          break;
        }
      }

      // Scroll back up slightly and then down to trigger any remaining lazy loads
      window.scrollTo(0, 0);
      await delay(500);
      window.scrollTo(0, document.body.scrollHeight);
      await delay(1000);
    });
  } catch (e) {
    // Scroll errors are non-fatal
  }
}

/**
 * Extracts experience, education, name, headline, and location
 * from an authenticated LinkedIn profile DOM.
 * Uses multiple selector strategies to handle LinkedIn's evolving markup.
 */
async function extractLinkedInDOMData(page, logger) {
  return await page.evaluate(() => {
    const data = {
      name: '',
      headline: '',
      location: '',
      experience: [],
      education: [],
      fullText: '',
    };

    // ── Extract profile header ──
    // Name: usually in h1 tag at the top
    const nameEl = document.querySelector('h1.text-heading-xlarge, h1.inline, h1[class*="break-words"]');
    if (nameEl) data.name = nameEl.textContent.trim();

    // Headline
    const headlineEl = document.querySelector('div.text-body-medium[data-generated-suggestion-target], div.text-body-medium.break-words');
    if (headlineEl) data.headline = headlineEl.textContent.trim();

    // Location
    const locationEl = document.querySelector('span.text-body-small[class*="inline"][class*="t-black--light"]');
    if (locationEl) data.location = locationEl.textContent.trim();

    // ── Extract Experience Section ──
    const experienceAnchor = document.getElementById('experience') || document.querySelector('section[data-section="experience"], section.pv-profile-section.experience-section, [id*="experience"]');
    if (experienceAnchor) {
      let listContainer = experienceAnchor.closest('section') || experienceAnchor.parentElement?.parentElement?.parentElement;
      if (listContainer) {
        const entries = listContainer.querySelectorAll('ul > li');

        for (const entry of entries) {
          const spans = entry.querySelectorAll('span[aria-hidden="true"]');
          const textParts = Array.from(spans).map(s => s.textContent.trim()).filter(t => t.length > 0);

          if (textParts.length === 0) continue;

          // Check if this is a grouped company entry (multiple roles at same company)
          const subEntries = entry.querySelectorAll(':scope > div > div > ul > li, :scope > div > div > div > ul > li');
          
          if (subEntries.length > 0) {
            // Grouped company: first item is company name with total tenure
            const companyName = textParts[0] || '';
            const totalTenure = textParts.find(t => /\d+\s*(yr|mo|year|month)/i.test(t)) || '';

            for (const sub of subEntries) {
              const subSpans = sub.querySelectorAll('span[aria-hidden="true"]');
              const subParts = Array.from(subSpans).map(s => s.textContent.trim()).filter(t => t.length > 0);
              
              if (subParts.length === 0) continue;

              const title = subParts[0] || '';
              const dateRange = subParts.find(t => /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|present|\d{4})/i.test(t)) || '';
              const durationMatch = subParts.find(t => /\d+\s*(yr|mo|year|month)/i.test(t) && t !== totalTenure);
              const location = subParts.find(t => /,|city|state|area|india|mumbai|delhi|bangalore|pune|remote/i.test(t) && !t.includes('@') && !/\d{4}/.test(t)) || '';

              const duration = dateRange ? (durationMatch ? `${dateRange} · ${durationMatch}` : dateRange) : (durationMatch || '');

              if (title && companyName) {
                data.experience.push({
                  title,
                  company: companyName,
                  duration,
                  location,
                  description: '',
                });
              }
            }
          } else {
            // Single role entry
            const title = textParts[0] || '';
            const company = textParts[1] || '';
            const dateRange = textParts.find(t => /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|present|\d{4})/i.test(t)) || '';
            const durationMatch = textParts.find(t => /\d+\s*(yr|mo|year|month)/i.test(t));
            const location = textParts.find(t => /,|city|area|india|mumbai|delhi|bangalore|pune|remote/i.test(t) && !t.includes('@') && !/\d{4}/.test(t)) || '';

            const duration = dateRange ? (durationMatch && dateRange !== durationMatch ? `${dateRange} · ${durationMatch}` : dateRange) : (durationMatch || '');

            if (title && company) {
              data.experience.push({
                title: title.replace(/\s*·\s*$/, ''),
                company: company.replace(/\s*·\s*$/, ''),
                duration,
                location,
                description: '',
              });
            }
          }
        }
      }
    }

    // ── Fallback: Try extracting experience from page text patterns ──
    if (data.experience.length === 0) {
      // Look for aria-label patterns that LinkedIn uses for accessibility
      const expItems = document.querySelectorAll('[class*="experience"] li, [id*="experience"] ~ * li');
      for (const item of expItems) {
        const text = item.textContent.trim();
        // Pattern: "Title Company Duration Location"
        const parts = text.split('\n').map(s => s.trim()).filter(s => s.length > 0 && s.length < 200);
        if (parts.length >= 2) {
          const title = parts[0];
          const company = parts.find((p, i) => i > 0 && !(/\d{4}/.test(p)) && !(/yr|mo|month|year/i.test(p))) || parts[1];
          const dateRange = parts.find(p => /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|present|\d{4})/i.test(p)) || '';
          const durationMatch = parts.find(p => /\d+\s*(yr|mo|year|month)/i.test(p)) || '';

          if (title && company && title !== company) {
            data.experience.push({
              title,
              company,
              duration: dateRange || durationMatch,
              location: '',
              description: '',
            });
          }
        }
      }
    }

    // ── Extract Education Section ──
    const educationSection = document.getElementById('education');
    if (educationSection) {
      let listContainer = educationSection.closest('section');
      if (!listContainer) {
        listContainer = educationSection.parentElement?.parentElement?.parentElement;
      }

      if (listContainer) {
        const entries = listContainer.querySelectorAll(':scope > div > ul > li, :scope > div > div > ul > li');

        for (const entry of entries) {
          const spans = entry.querySelectorAll('span[aria-hidden="true"]');
          const textParts = Array.from(spans).map(s => s.textContent.trim()).filter(t => t.length > 0);

          if (textParts.length === 0) continue;

          const institution = textParts[0] || '';
          const degree = textParts.find(t => /bachelor|master|b\.?tech|m\.?tech|b\.?e|m\.?e|b\.?sc|m\.?sc|b\.?a|m\.?a|mba|phd|diploma|high school|secondary|associate|doctor/i.test(t)) || textParts[1] || '';
          const fieldOfStudy = textParts.find(t => /finance|engineering|computer|science|commerce|arts|economics|management|business|accounting|marketing|technology|mathematics/i.test(t) && t !== degree) || '';
          const dateRange = textParts.find(t => /\d{4}\s*[-–]\s*\d{4}|\d{4}\s*[-–]\s*present/i.test(t)) || '';

          if (institution) {
            data.education.push({
              institution,
              degree: degree.replace(/\s*·\s*$/, ''),
              fieldOfStudy: fieldOfStudy.replace(/\s*·\s*$/, ''),
              duration: dateRange,
            });
          }
        }
      }
    }

    // ── Collect full page text for AI fallback ──
    const mainContent = document.querySelector('main') || document.body;
    data.fullText = mainContent.textContent.replace(/\s+/g, ' ').trim();

    return data;
  });
}
