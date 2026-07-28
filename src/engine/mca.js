// MCA Intelligence Module — Smart Fuzzy Matching & Snippet Intelligence Edition
// Tries MULTIPLE company name variants across search engines and scrapes details
// Implements "Snippet Intelligence": extracts corporate data and directors list
// directly from search engine snippets using AI, bypassing Cloudflare blocks.

import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import { getBrowser } from './publicSearch.js';
import { CONFIDENCE } from '../utils/confidence.js';
import { callGroqWithFallback } from '../utils/groq.js';

export async function fetchMCAIntelligence(identity, logger) {
  const start = Date.now();
  const companyName = identity.company.normalized;
  const companyVariants = identity.company.variants || [companyName];

  logger.running('MCA Intelligence', `Launching out-of-the-box Snippet Intelligence for "${companyName}"`);

  const result = {
    company: null,
    directors: [],
    filings: [],
    source: null,
    confidence: 0,
  };

  try {
    // ── Strategy 1: AI Search Snippet Extraction (Out-of-the-box, Cloudflare-proof) ──
    logger.running('MCA Intelligence', 'Performing search discovery to extract corporate records...');
    const coreTerm = identity.company.coreWords && identity.company.coreWords.length > 0 ? identity.company.coreWords.join(' ') : companyName;
    const searchQueries = [
      `${companyName} directors zaubacorp`,
      `${coreTerm} CIN tofler instafinancials zaubacorp`,
      `${companyName} company master data`
    ];

    let allSnippets = [];
    for (const query of searchQueries) {
      const snippets = await searchDDG(query, logger);
      allSnippets.push(...snippets);
    }

    // Deduplicate snippets by URL
    const uniqueSnippets = [];
    const seenUrls = new Set();
    for (const s of allSnippets) {
      if (!seenUrls.has(s.url)) {
        seenUrls.add(s.url);
        uniqueSnippets.push(s);
      }
    }

    if (uniqueSnippets.length > 0) {
      const limitedSnippets = uniqueSnippets.slice(0, 12);
      logger.running('MCA Intelligence', `Analyzing ${limitedSnippets.length} search signals with AI...`);
      const aiExtracted = await extractCorporateDataWithAI(companyName, limitedSnippets, logger);
      
      if (aiExtracted && aiExtracted.company && aiExtracted.company.companyName) {
        result.company = aiExtracted.company;
        result.directors = aiExtracted.directors || [];
        result.source = 'MCA Corporate Registry (Search Intelligence)';
        result.confidence = CONFIDENCE.MCA_DATA;
        
        result.company.source = result.source;
        result.company.confidence = result.confidence;
        result.company.timestamp = new Date().toISOString();

        // Standardize ROC/Jurisdiction
        if (result.company.rocJurisdiction && !result.company.jurisdiction) {
          result.company.jurisdiction = result.company.rocJurisdiction;
        }

        const duration = Date.now() - start;
        logger.success('MCA Intelligence', 
          `Found: ${result.company.companyName} — ${result.directors.length} director(s) via Search Intelligence`,
          { durationMs: duration, confidence: result.confidence }
        );
        return result;
      }
    }

    // ── Strategy 2: Traditional Scraper Fallback (in case AI/Search fails) ──
    logger.running('MCA Intelligence', 'Snippet extraction returned no clear matches. Falling back to direct URL discovery...');
    const discoveredCompanyUrls = await discoverCompanyUrls(companyName, identity, logger);
    
    for (const url of discoveredCompanyUrls) {
      if (result.company) break;
      
      if (url.includes('zaubacorp.com')) {
        const zbResult = await scrapeZaubacorpPage(url, identity, logger);
        if (zbResult) {
          result.company = zbResult.company;
          result.directors = zbResult.directors;
          result.source = 'Zaubacorp (Fuzzy Match)';
          result.confidence = CONFIDENCE.MCA_DATA;
          break;
        }
      } else if (url.includes('tofler.in')) {
        const toflerResult = await scrapeToflerPage(url, identity, logger);
        if (toflerResult) {
          result.company = toflerResult.company;
          result.directors = toflerResult.directors;
          result.source = 'Tofler (Fuzzy Match)';
          result.confidence = CONFIDENCE.DIRECTOR_DATA;
          break;
        }
      } else if (url.includes('instafinancials.com')) {
        const instaResult = await scrapeInstaFinancialsPage(url, identity, logger);
        if (instaResult) {
          result.company = instaResult.company;
          result.directors = instaResult.directors;
          result.source = 'InstaFinancials (Fuzzy Match)';
          result.confidence = CONFIDENCE.MCA_DATA;
          break;
        }
      }
    }

    // ── Strategy 3: Try variants on OpenCorporates API ──
    if (!result.company) {
      for (const variant of companyVariants.slice(0, 3)) {
        if (result.company) break;
        const ocResult = await tryOpenCorporates(variant, identity, logger);
        if (ocResult) {
          result.company = ocResult.company;
          result.directors = ocResult.directors;
          result.source = 'OpenCorporates Registry';
          result.confidence = CONFIDENCE.MCA_DATA;
          break;
        }
      }
    }

    const duration = Date.now() - start;
    if (result.company) {
      logger.success('MCA Intelligence',
        `Found: ${result.company.companyName} — ${result.directors.length} director(s)`,
        { durationMs: duration, confidence: result.confidence, source: result.source }
      );
    } else {
      logger.warning('MCA Intelligence',
        `No corporate records found after trying all intelligence tiers`,
        { durationMs: duration }
      );
    }

    return result;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error('MCA Intelligence', `Error: ${err.message}`, { durationMs: duration });
    return result;
  }
}

// ─── Search engine wrapper ────────────────────────────────
async function searchDDG(query, logger) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok || res.status !== 200) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];
    
    $('.result__body').each((_, el) => {
      const anchor = $(el).find('a.result__a');
      const snippet = $(el).find('.result__snippet');
      let href = anchor.attr('href') || '';
      
      if (href.includes('uddg=')) {
        try {
          const match = href.match(/uddg=([^&]+)/);
          if (match) href = decodeURIComponent(match[1]);
        } catch (e) {}
      }
      if (href.startsWith('//')) href = 'https:' + href;

      if (anchor.text().trim()) {
        results.push({
          title: anchor.text().trim(),
          snippet: snippet.text().trim(),
          url: href
        });
      }
    });

    if (results.length === 0) {
      throw new Error('0 results returned (silent rate limit)');
    }
    
    return results;
  } catch (e) {
    logger.warning('MCA Intelligence', `DDG search failed for "${query}" (${e.message}) — trying Google Stealth fallback...`);
    return await searchGoogleStealth(query, logger);
  }
}

async function searchGoogleStealth(query, logger) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await new Promise(r => setTimeout(r, 1200));

    const results = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('h3').forEach(h3 => {
        const anchor = h3.closest('a');
        if (!anchor) return;
        let href = anchor.getAttribute('href') || anchor.href || '';
        if (href.includes('/url?q=')) {
          const match = href.match(/\/url\?q=([^&]+)/);
          if (match) href = decodeURIComponent(match[1]);
        }
        const container = h3.closest('div.g, div.MjjYud, div[data-sokoban-container]') || h3.parentElement?.parentElement;
        const snippetEl = container ? container.querySelector('div[data-sncf], div.VwiC3b, span.aCOpRe') : null;
        
        if (href.startsWith('http') && !href.includes('google.com')) {
          items.push({
            title: h3.textContent.trim(),
            url: href,
            snippet: snippetEl ? snippetEl.textContent.trim() : (container ? container.textContent.trim().substring(0, 300) : '')
          });
        }
      });
      return items;
    });

    if (results.length > 0) {
      logger.success('MCA Intelligence', `Google Stealth search found ${results.length} corporate signals for query "${query}"`);
    }

    return results;
  } catch (err) {
    logger.error('MCA Intelligence', `Google Stealth search fallback failed: ${err.message}`);
    return [];
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ─── AI Extraction ────────────────────────────────────────
export async function extractCorporateDataWithAI(companyName, snippets, logger) {
  const snippetsText = snippets.map((r, i) => `[Signal #${i+1}]\nTitle: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`).join('\n\n');
  
  const prompt = `You are a precise corporate registry data extraction engine.
Analyze the following search signals for the company "${companyName}" and extract the company's master details and list of directors.

SEARCH SIGNALS:
${snippetsText}

Generate a JSON response with exactly this structure:
{
  "company": {
    "companyName": "Official Company Name (e.g. ASK WEALTH ADVISORS PRIVATE LIMITED)",
    "cin": "21-character Corporate Identification Number (e.g. U67190MH2006PTC162465)",
    "status": "Active/Inactive",
    "companyType": "Private/Public/LLP etc.",
    "incorporationDate": "DD-MMM-YYYY or YYYY-MM-DD",
    "registeredAddress": "Registered Address",
    "authorizedCapital": "Authorized Capital value",
    "paidUpCapital": "Paid-up Capital value",
    "industry": "Business activity/industry description",
    "email": "Registered/official email address if found in the search signals (otherwise null)",
    "telephone": "Registered/official contact number/telephone if found in the search signals (otherwise null)"
  },
  "directors": [
    {
      "name": "Director Name",
      "designation": "Designation (Director, MD, etc.)",
      "din": "8-digit DIN if mentioned (otherwise null)",
      "appointmentDate": "Date of appointment if mentioned (otherwise null)"
    }
  ]
}

Rules:
- In "directors", extract ONLY individual human names. DO NOT include company names, partnership names, or corporate entities (e.g. ignore names containing "PRIVATE LIMITED", "LTD", "HOLDINGS", "FINANCIAL", "LLP", "GROUP", "INVESTMENT").
- Rectify spelling mistakes and merge duplicate directors under the most complete name.
- Resolve company name variations.
- Base your extraction ONLY on the provided snippets. Do not make up info.
- Return ONLY the JSON object, no formatting or extra text.`;

  // Try Groq first, Gemini second
  if (process.env.GROQ_API_KEY) {
    try {
      const text = await callGroqWithFallback(
        'You are a precise corporate data extractor. Return valid JSON only.',
        prompt,
        {
          timeout: 12000,
          temperature: 0.1,
          stage: 'MCA Intelligence'
        },
        logger
      );
      return JSON.parse(text);
    } catch (e) {
      logger.warning('MCA Intelligence', `Groq extraction failed: ${e.message}. Trying Gemini fallback...`);
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
        return JSON.parse(match[0]);
      }
    } catch (e) {
      logger.warning('MCA Intelligence', `Gemini extraction fallback failed: ${e.message}`);
    }
  }

  return null;
}

// ─── Traditional URL Discovery Fallback ───────────────────
async function discoverCompanyUrls(companyName, identity, logger) {
  const urls = [];
  const terms = [companyName, ...(identity?.company?.variants || [])].slice(0, 4);

  for (const term of terms) {
    if (urls.length >= 3) break;
    try {
      const q = `${term} zaubacorp OR tofler OR instafinancials`;
      const results = await searchDDG(q, logger);
      for (const r of results) {
        const url = r.url;
        if (url && (
            (url.includes('zaubacorp.com') && !url.includes('/company-list/')) || 
            (url.includes('tofler.in') && !url.includes('/companylist')) ||
            (url.includes('instafinancials.com') && !url.includes('/company-list')) ||
            (url.includes('thecompanycheck.com') && !url.includes('/search'))
        )) {
          urls.push(url);
        }
      }
    } catch (e) {
      logger.warning('MCA Intelligence', `URL discovery failed for "${term}": ${e.message}`);
    }
  }
  return [...new Set(urls)];
}

// ─── Zaubacorp scraping fallback via Puppeteer ────────────
async function scrapeZaubacorpPage(companyUrl, identity, logger) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Normalize URL format
    let targetUrl = companyUrl;
    if (companyUrl.includes('/company/') && !companyUrl.includes('/company/company/')) {
      // Remove '/company/' since Zaubacorp direct link doesn't have it
      targetUrl = companyUrl.replace('/company/', '/');
    }

    logger.running('MCA Intelligence', `Scraping Zaubacorp fallback page: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
    
    const pageTitle = await page.title();
    if (pageTitle.includes('Something went wrong') || pageTitle.includes('Just a moment')) {
      throw new Error('Blocked or error page returned');
    }

    const html = await page.content();
    const $c = cheerio.load(html);
    const company = {};
    const directors = [];

    // Extract company details
    $c('table tr, .company-detail tr').each((_, row) => {
      const cells = $c(row).find('td');
      if (cells.length >= 2) {
        const label = $c(cells[0]).text().trim().toLowerCase();
        const value = $c(cells[1]).text().trim();

        if (label.includes('cin')) company.cin = value;
        else if (label.includes('company name')) company.companyName = value;
        else if (label.includes('status')) company.status = value;
        else if (label.includes('type') || label.includes('class')) company.companyType = value;
        else if (label.includes('incorporation') || label.includes('date of')) company.incorporationDate = value;
        else if (label.includes('address')) company.registeredAddress = value;
        else if (label.includes('authorized capital')) company.authorizedCapital = value;
        else if (label.includes('paid up') || label.includes('paidup')) company.paidUpCapital = value;
        else if (label.includes('industry') || label.includes('activity')) company.industry = value;
        else if (label.includes('email')) company.email = value;
        else if (label.includes('telephone') || label.includes('phone') || label.includes('contact number')) company.telephone = value;
      }
    });

    // Extract directors
    $c('table').each((_, table) => {
      const headerText = $c(table).prev().text().toLowerCase() + $c(table).find('th').text().toLowerCase();
      if (headerText.includes('director') || headerText.includes('din')) {
        $c(table).find('tr').each((i, row) => {
          if (i === 0) return;
          const cells = $c(row).find('td');
          if (cells.length >= 2) {
            const din = $c(cells[0]).text().trim();
            const name = $c(cells[1]).text().trim();
            if (name && name.length > 2 && name.length < 80) {
              directors.push({
                name,
                din: din || null,
                designation: cells.length > 2 ? $c(cells[2]).text().trim() : null,
                appointmentDate: cells.length > 3 ? $c(cells[3]).text().trim() : null,
                status: 'Active'
              });
            }
          }
        });
      }
    });

    // Fallback company name from page title/h1 if not found in detail rows
    if (!company.companyName) {
      const h1Text = $c('h1').first().text().trim();
      if (h1Text) {
        // Strip suffixes like "Information", "Details", "Profile"
        company.companyName = h1Text.replace(/\s*(details|information|profile|company overview)\s*$/i, '').trim();
      }
    }

    if (!company.companyName && !company.cin) return null;

    company.source = 'Zaubacorp (Scraped)';
    company.confidence = CONFIDENCE.MCA_DATA;
    company.timestamp = new Date().toISOString();

    return { company, directors };
  } catch (e) {
    logger.warning('MCA Intelligence', `Zaubacorp fallback scraping failed: ${e.message}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ─── Tofler scraping fallback via Puppeteer ───────────────
async function scrapeToflerPage(companyUrl, identity, logger) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    logger.running('MCA Intelligence', `Scraping Tofler fallback page: ${companyUrl}`);
    await page.goto(companyUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
    
    const html = await page.content();
    const $c = cheerio.load(html);
    const company = {
      companyName: $c('h1').first().text().trim() || identity.company.normalized,
      source: 'Tofler (Scraped)',
      confidence: CONFIDENCE.DIRECTOR_DATA,
      timestamp: new Date().toISOString(),
    };

    $c('.info-item, .company-info tr, table tr').each((_, el) => {
      const text = $c(el).text().trim().toLowerCase();
      const value = $c(el).find('td:last-child, .info-value, span:last-child').text().trim();

      if (text.includes('cin') && value) company.cin = value;
      else if (text.includes('incorporat') && value) company.incorporationDate = value;
      else if (text.includes('status') && value) company.status = value;
      else if (text.includes('address') && value) company.registeredAddress = value;
      else if (text.includes('authorized') && value) company.authorizedCapital = value;
      else if (text.includes('paid') && value) company.paidUpCapital = value;
      else if (text.includes('industry') && value) company.industry = value;
      else if (text.includes('email') && value) company.email = value;
      else if ((text.includes('telephone') || text.includes('phone') || text.includes('contact')) && value) company.telephone = value;
    });

    const directors = [];
    $c('.director-name, td a[href*="din"], .director-item').each((_, el) => {
      const name = $c(el).text().trim();
      if (name && name.length > 2 && name.length < 60) {
        directors.push({
          name,
          source: 'Tofler (Scraped)',
          confidence: CONFIDENCE.DIRECTOR_DATA,
          timestamp: new Date().toISOString()
        });
      }
    });

    return { company, directors };
  } catch (e) {
    logger.warning('MCA Intelligence', `Tofler fallback scraping failed: ${e.message}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ─── OpenCorporates fallback (free API) ───────────────────
async function tryOpenCorporates(companyName, identity, logger) {
  try {
    const token = process.env.OPENCORPORATES_API_KEY;
    const query = encodeURIComponent(companyName);
    let url = `https://api.opencorporates.com/v0.4/companies/search?q=${query}&jurisdiction_code=in&per_page=5`;
    if (token) url += `&api_token=${token}`;

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    
    const data = await res.json();
    const companies = data?.results?.companies || [];
    if (companies.length === 0) return null;

    const best = companies[0].company;
    const company = {
      companyName: best.name,
      cin: best.company_number,
      companyType: best.company_type,
      status: best.current_status,
      incorporationDate: best.incorporation_date,
      registeredAddress: best.registered_address_in_full,
      source: 'OpenCorporates',
      confidence: CONFIDENCE.MCA_DATA,
      timestamp: new Date().toISOString()
    };

    const directors = [];
    try {
      let officersUrl = `https://api.opencorporates.com/v0.4/companies/in/${best.company_number}/officers`;
      if (token) officersUrl += `?api_token=${token}`;
      
      const offRes = await fetch(officersUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });
      if (offRes.ok) {
        const offData = await offRes.json();
        for (const off of (offData?.results?.officers || [])) {
          directors.push({
            name: off.officer.name,
            designation: off.officer.position,
            status: off.officer.end_date ? 'Resigned' : 'Active'
          });
        }
      }
    } catch (e) {}

    return { company, directors };
  } catch {
    return null;
  }
}

// ─── InstaFinancials scraping fallback via Puppeteer ──────
async function scrapeInstaFinancialsPage(companyUrl, identity, logger) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    logger.running('MCA Intelligence', `Scraping InstaFinancials fallback page: ${companyUrl}`);
    await page.goto(companyUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
    
    const html = await page.content();
    const $c = cheerio.load(html);
    let extractedName = $c('h1.company-name, h1.title, .company-header h1, h1').first().text().trim();
    const coreWords = identity.company.coreWords || [];
    const isValidName = extractedName && extractedName.length < 80 && coreWords.some(w => extractedName.toLowerCase().includes(w.toLowerCase()));
    
    const company = {
      companyName: isValidName ? extractedName : identity.company.normalized,
      source: 'InstaFinancials (Scraped)',
      confidence: CONFIDENCE.MCA_DATA,
      timestamp: new Date().toISOString(),
    };

    $c('tr, .data-row').each((_, el) => {
      const label = $c(el).find('th, td:first-child, .label').text().trim().toLowerCase();
      const value = $c(el).find('td:last-child, .value').text().trim();

      if (label.includes('cin') && value) company.cin = value;
      else if (label.includes('incorporation') && value) company.incorporationDate = value;
      else if (label.includes('status') && value) company.status = value;
      else if (label.includes('address') && value) company.registeredAddress = value;
      else if (label.includes('authorized') && value) company.authorizedCapital = value;
      else if (label.includes('paid up') && value) company.paidUpCapital = value;
      else if (label.includes('industry') && value) company.industry = value;
    });

    const directors = [];
    $c('a[href*="director"], td a[href*="din"], .director-item').each((_, el) => {
      const name = $c(el).text().trim();
      if (name && name.length > 2 && name.length < 60 && !name.toLowerCase().includes('director')) {
        directors.push({
          name,
          source: 'InstaFinancials (Scraped)',
          confidence: CONFIDENCE.DIRECTOR_DATA,
          timestamp: new Date().toISOString()
        });
      }
    });

    return { company, directors };
  } catch (e) {
    logger.warning('MCA Intelligence', `InstaFinancials fallback scraping failed: ${e.message}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}
