// IGR Maharashtra Direct Property Search Module
// Implements multi-strategy transaction search by:
// - Society Name
// - Building Name
// - CTS Number
// - Survey Number
// - Registration Number
//
// Follows strict Priority Order:
// 1. Intercept/call IGR backend XHR/API JSON endpoints (GetDistrict, GetSRO, GetPropertyDetails)
// 2. Extract transaction data from Index II / eSearch tables
// 3. Browser automation via Puppeteer/Playwright fallback to control portal forms
// 4. HTML snippet and portal web scraping as a last resort fallback

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { getBrowser } from './publicSearch.js';
import Tesseract from 'tesseract.js';
import { callGroqWithFallback } from '../utils/groq.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache configuration
const CACHE_DIR = path.join(__dirname, '../../.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'property_search_cache.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL

// Major SRO mappings for automated searches (District Name → Codes)
const DISTRICT_CODES = {
  'mumbai city': '31',
  'mumbai suburban': '32',
  'thane': '33',
  'pune': '25',
};

/**
 * Normalizes a CTS / Survey number into a standard canonical format
 * e.g., "CTS No. 05-A/1" -> "5A1", "Plot 0014" -> "14"
 */
export function normalizeCTS(cts) {
  if (!cts) return '';
  return cts
    .toUpperCase()
    .replace(/(?:CTS|NO\.?|NUMBER|PLOT|SURVEY|GAT|SECTOR)/gi, '') // Remove prefix words
    .replace(/[^A-Z0-9]/gi, '') // Remove spaces, hyphens, slashes
    .replace(/^0+/, '') // Remove leading zeros
    .trim();
}

/**
 * Normalizes a party name (buyer/seller) to standard Title Case and strips noise
 * e.g. "MR. RAJESH KUMAR PVT. LTD." -> "Rajesh Kumar"
 */
export function normalizePartyName(name) {
  if (!name) return '';
  
  let cleaned = name.toLowerCase().trim();

  // Strip corporate designators and abbreviations
  const noise = [
    /\bpvt\b\.?/g, /\bltd\b\.?/g, /\blimited\b/g, /\bprivate\b/g,
    /\bllp\b\.?/g, /\bco\b\.?/g, /\bcompany\b/g, /\bcorp\b\.?/g,
    /\bcorporation\b/g, /\bpartnership\b/g, /\band sons\b/g,
    /\bassociates\b/g, /\bindia\b/g, /\bproprietorship\b/g
  ];

  for (const regex of noise) {
    cleaned = cleaned.replace(regex, '');
  }

  // Strip individual titles
  const titles = [
    /\bmr\b\.?/g, /\bmrs\b\.?/g, /\bms\b\.?/g, /\bshri\b\.?/g,
    /\bsmt\b\.?/g, /\bdr\b\.?/g, /\badvocate\b\.?/g, /\badv\b\.?/g
  ];

  for (const regex of titles) {
    cleaned = cleaned.replace(regex, '');
  }

  // Strip trailing ampersands, commas, dots, and hyphens
  cleaned = cleaned.replace(/[\s&,\-.]+$/, '');

  // Clean spacing and capitalize words
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Deduplicates property transaction records by matching keys
 */
export function deduplicateRecords(records) {
  const seen = new Set();
  return records.filter(rec => {
    const canonicalCts = normalizeCTS(rec.ctsNumber || rec.propertyDescription);
    const amount = String(rec.considerationAmount || rec.marketValue || '0').replace(/[^0-9]/g, '');
    const date = rec.registrationDate || rec.executionDate || 'N/A';
    
    // Group records by unique compound key
    const key = `${rec.documentNo || ''}_${canonicalCts}_${amount}_${date}`.toLowerCase().replace(/[^a-z0-9]/gi, '');
    if (key && !seen.has(key)) {
      seen.add(key);
      return true;
    }
    return false;
  });
}

/**
 * Reads local JSON property cache
 */
function readCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      // Clean expired entries
      const now = Date.now();
      let updated = false;
      for (const key in data) {
        if (now - data[key].timestamp > CACHE_TTL_MS) {
          delete data[key];
          updated = true;
        }
      }
      if (updated) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
      }
      return data;
    }
  } catch (e) {
    console.error('[CACHE ERROR] Failed reading property cache:', e);
  }
  return {};
}

/**
 * Writes records to property cache
 */
function writeCache(key, records, summary, analytics) {
  try {
    const data = readCache();
    data[key.toLowerCase()] = {
      timestamp: Date.now(),
      records,
      summary,
      analytics,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[CACHE ERROR] Failed writing property cache:', e);
  }
}

/**
 * Property search execution flow with multi-tier fallbacks
 */
export async function executePropertySearch(searchType, queryValue, district, logger) {
  const start = Date.now();
  const cacheKey = `${searchType}_${queryValue}_${district || 'all'}`;

  // Check cache first
  const cache = readCache();
  if (cache[cacheKey.toLowerCase()]) {
    logger.success('Real Estate Intelligence', `Cache hit for property query: "${queryValue}" (Loaded instantly)`);
    return {
      ...cache[cacheKey.toLowerCase()],
      isCached: true,
    };
  }

  logger.running('Real Estate Intelligence', `Initiating property search for [${searchType.toUpperCase()}] "${queryValue}"`);
  
  let records = [];
  let executionSource = '';

  // ── Priority 1 & 3: Browser automation with API/XHR Interception (Playwright/Puppeteer) ──
  try {
    logger.running('Real Estate Intelligence', 'Running eSearch portal transaction interceptor...');
    const portalRecords = await runBrowserInterceptor(searchType, queryValue, district, logger);
    if (portalRecords && portalRecords.length > 0) {
      records.push(...portalRecords);
      executionSource = 'IGR Maharashtra eSearch (XHR Interception)';
    }
  } catch (err) {
    logger.warning('Real Estate Intelligence', `eSearch XHR interception failed: ${err.message}`);
  }

  // ── Priority 2: Extract Index II logs from search engines if portal is blocked ──
  if (records.length === 0) {
    try {
      logger.running('Real Estate Intelligence', 'Running Index II document extractors via public signals...');
      const publicDocs = await searchIndexIISignals(searchType, queryValue, district, logger);
      if (publicDocs && publicDocs.length > 0) {
        records.push(...publicDocs);
        executionSource = 'Index II Registries (Search Intelligence)';
      }
    } catch (err) {
      logger.warning('Real Estate Intelligence', `Index II search signal extraction failed: ${err.message}`);
    }
  }

  // ── Priority 4: Last Resort Fallback scraping ──
  if (records.length === 0) {
    try {
      logger.running('Real Estate Intelligence', 'Executing HTML fallback crawler...');
      const fallbackRecords = await runHtmlFallbackSearch(searchType, queryValue, logger);
      if (fallbackRecords && fallbackRecords.length > 0) {
        records.push(...fallbackRecords);
        executionSource = 'Public Registry Aggregators (HTML Scraping)';
      }
    } catch (err) {
      logger.warning('Real Estate Intelligence', `HTML fallback scraping failed: ${err.message}`);
    }
  }

  // Normalize and Deduplicate final records
  const normalizedRecords = records.map(rec => ({
    type: rec.type || 'Transaction',
    articleName: rec.articleName || rec.type || 'Sale Deed',
    documentNo: rec.documentNo || 'N/A',
    registrationDate: rec.registrationDate || rec.executionDate || 'N/A',
    executionDate: rec.executionDate || rec.registrationDate || 'N/A',
    buyerName: normalizePartyName(rec.buyerName || rec.partyNames?.split('To')?.[1] || rec.rawData?.['buyer'] || 'Unknown'),
    sellerName: normalizePartyName(rec.sellerName || rec.partyNames?.split('To')?.[0] || rec.rawData?.['seller'] || 'Unknown'),
    considerationAmount: formatCurrencyRaw(rec.considerationAmount || rec.rawData?.['amount'] || '0'),
    marketValue: formatCurrencyRaw(rec.marketValue || rec.rawData?.['market_value'] || '0'),
    ctsNumber: normalizeCTS(rec.ctsNumber || rec.propertyDescription),
    propertyDescription: rec.propertyDescription || 'N/A',
    sroName: rec.sroName || district || 'Maharashtra',
    source: rec.source || executionSource,
    confidence: rec.confidence || 0.7,
  }));

  const deduplicated = deduplicateRecords(normalizedRecords);
  
  // Aggregate Analytics & run AI briefing
  const summary = buildSummaryStats(deduplicated);
  const analyticsBrief = await generatePropertyAnalyticsBrief(queryValue, deduplicated, summary, logger);

  // Write to cache
  writeCache(cacheKey, deduplicated, summary, analyticsBrief);

  const duration = Date.now() - start;
  logger.success('Real Estate Intelligence', 
    `Completed property transaction search in ${(duration / 1000).toFixed(1)}s (${deduplicated.length} records)`,
    { durationMs: duration }
  );

  return {
    records: deduplicated,
    summary,
    analytics: analyticsBrief,
    isCached: false,
    source: executionSource || 'IGR Maharashtra Portal',
  };
}

// ═══════════════════════════════════════════════════════════════════
// PRIORITY 1 & 3: Browser XHR / XHR Interception (Puppeteer)
// ═══════════════════════════════════════════════════════════════════

async function runBrowserInterceptor(searchType, queryValue, district, logger) {
  let browser = null;
  let page = null;
  const interceptedTransactions = [];

  try {
    browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });

    // Enable network interception to capture internal XHR payloads
    await page.setRequestInterception(true);

    page.on('request', request => {
      request.continue();
    });

    page.on('response', async response => {
      const url = response.url();
      // Check if this response belongs to eSearch backend calls or XHR endpoints
      if (url.includes('GetPropertyDetails') || url.includes('GetIndex2') || url.includes('GetIndexII') || url.includes('/Search/')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await response.json();
            if (json && (Array.isArray(json) || json.records || json.data)) {
              logger.running('Real Estate Intelligence', `Intercepted IGR backend XHR: ${url.substring(0, 80)}`);
              const records = Array.isArray(json) ? json : (json.records || json.data || []);
              interceptedTransactions.push(...records);
            }
          }
        } catch (e) {
          // Response body was not JSON or failed reading
        }
      }
    });

    // Navigate to eSearch portal
    await page.goto('https://freesearchigrservice.maharashtra.gov.in/', {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });

    // Navigate to correct search tab (Property Details)
    const tabLink = await page.$('a[href*="mnuSearchType"]');
    if (tabLink) {
      await tabLink.evaluate(el => el.click()).catch(async () => {
        await tabLink.click().catch(() => {});
      });
    } else {
      await page.evaluate(() => {
        setTimeout(() => {
          if (typeof __doPostBack === 'function') {
            __doPostBack('mnuSearchType', '1');
          }
        }, 0);
      });
    }

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    // Choose district
    const distCode = DISTRICT_CODES[String(district || '').toLowerCase()] || '32'; // Default Suburban
    const districtSelector = 'select[id*="District"], select[name*="District"], #ddlDistrict';
    
    await page.waitForSelector(districtSelector, { timeout: 5000 });
    await page.select(districtSelector, distCode);
    await new Promise(r => setTimeout(r, 2000));

    // Fill in values depending on search type
    let searchFieldFound = false;
    const inputSelectors = ['input[type="text"]', '#txtPartyName', '#txtCTS', '#txtSurvey'];

    // Select the first input and type the query
    for (const sel of inputSelectors) {
      const el = await page.$(sel);
      if (el && await el.evaluate(node => node.offsetParent !== null)) {
        await el.click({ clickCount: 3 });
        await el.type(queryValue, { delay: 40 });
        searchFieldFound = true;
        break;
      }
    }

    if (!searchFieldFound) {
      throw new Error('Search input field not found on eSearch form');
    }

    // Capture simple CAPTCHA image and solve via Tesseract OCR
    const captchaImg = await page.$('img[id*="captcha"], img[id*="Captcha"], #imgCaptcha');
    if (captchaImg) {
      const captchaBuffer = await captchaImg.screenshot({ encoding: 'base64' });
      const captchaUrl = `data:image/png;base64,${captchaBuffer}`;
      const { data } = await Tesseract.recognize(captchaUrl, 'eng', { logger: () => {} });
      const solvedText = data.text.trim().replace(/[^a-zA-Z0-9]/g, '');

      if (solvedText.length >= 3) {
        await page.evaluate((text) => {
          const inputs = document.querySelectorAll('input[type="text"]');
          const capInput = Array.from(inputs).find(i => i.id.toLowerCase().includes('captcha')) || inputs[inputs.length - 1];
          if (capInput) capInput.value = text;
        }, solvedText);
      }
    }

    // Submit
    const submitBtn = await page.$('input[type="submit"], button[type="submit"], #btnSearch');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }

    // If interception found structured transaction JSON, return it
    if (interceptedTransactions.length > 0) {
      return interceptedTransactions;
    }

    // Priority 2: If XHR response wasn't captured, extract transaction tables from Index II result page
    const extractedTableRows = await page.evaluate(() => {
      const results = [];
      const tables = document.querySelectorAll('table[id*="grd"], table[id*="Grid"], table.Grid, table[class*="grid"]');
      
      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        if (rows.length < 2) continue;

        const headers = Array.from(rows[0].querySelectorAll('th, td')).map(c => c.innerText.trim().toLowerCase());
        
        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll('td');
          if (cells.length < 3) continue;

          const rowData = {};
          cells.forEach((cell, idx) => {
            const h = headers[idx] || `col_${idx}`;
            rowData[h] = cell.innerText.trim();
          });

          results.push({
            documentNo: rowData['document no'] || rowData['doc no'] || rowData['col_0'] || '',
            articleName: rowData['article'] || rowData['document type'] || rowData['col_1'] || '',
            registrationDate: rowData['registration date'] || rowData['date'] || '',
            partyNames: rowData['party name'] || rowData['parties'] || '',
            propertyDescription: rowData['property'] || rowData['description'] || '',
            considerationAmount: rowData['consideration'] || rowData['amount'] || '',
            marketValue: rowData['market value'] || '',
            sroName: rowData['sro'] || rowData['office'] || '',
          });
        }
      }
      return results;
    });

    if (extractedTableRows.length > 0) {
      logger.success('Real Estate Intelligence', `Index II table parser extracted ${extractedTableRows.length} transaction row(s)`);
      return extractedTableRows;
    }

  } catch (err) {
    logger.warning('Real Estate Intelligence', `Direct browser interception failed: ${err.message}`);
  } finally {
    if (page) await page.close().catch(() => {});
  }

  return [];
}

// ═══════════════════════════════════════════════════════════════════
// PRIORITY 2: Search Index II extracts (Search Engines + AI)
// ═══════════════════════════════════════════════════════════════════

async function searchIndexIISignals(searchType, queryValue, district, logger) {
  const qStr = `${searchType.toUpperCase()}: ${queryValue}`;
  const queries = [
    `"${queryValue}" Index II registration maharashtra`,
    `"${queryValue}" property transaction registry stamp duty mumbai`,
    `"${queryValue}" sale deed registration document number`,
  ];

  let snippets = [];
  for (const q of queries) {
    try {
      const searchRes = await searchDDG(q, logger);
      snippets.push(...searchRes);
    } catch (e) {
      // Ignore query errors
    }
  }

  // Deduplicate snippets
  const uniqueSnippets = [];
  const urls = new Set();
  for (const s of snippets) {
    if (s.url && !urls.has(s.url)) {
      urls.add(s.url);
      uniqueSnippets.push(s);
    }
  }

  if (uniqueSnippets.length === 0) return [];

  // Extract property transaction list using AI
  return await extractIndexIITransactionsWithAI(qStr, uniqueSnippets.slice(0, 15), logger);
}

async function extractIndexIITransactionsWithAI(query, snippets, logger) {
  const snippetsText = snippets
    .map((r, i) => `[Signal #${i + 1}]\nTitle: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
    .join('\n\n');

  const prompt = `You are a professional real estate records database parser.
Analyze the following search signals and extract ALL property registration records matching the query: "${query}".

SEARCH SIGNALS:
${snippetsText}

Extract every single transaction record.

Return a JSON response with exactly this structure:
{
  "properties": [
    {
      "type": "Sale Deed / Agreement to Sale / Mortgage / Gift Deed / Conveyance",
      "articleName": "Specific registration article name",
      "documentNo": "Document Registration Number (e.g. 4821/2025)",
      "registrationDate": "DD-MM-YYYY or YYYY-MM-DD",
      "executionDate": "DD-MM-YYYY or YYYY-MM-DD",
      "buyerName": "Full name of buyer or transferee",
      "sellerName": "Full name of seller or transferor",
      "considerationAmount": "Numeric consideration/transaction value in INR",
      "marketValue": "Market value of the property in INR",
      "ctsNumber": "CTS / Survey / Plot number",
      "propertyDescription": "Full details - Flat no, floor, wing, carpet area, building name",
      "sroName": "Sub-Registrar Office",
      "source": "URL of the signal",
      "confidence": 0.0 to 1.0
    }
  ]
}

If no records are found, return {"properties": []}.
Return ONLY valid JSON. No markup fences or extra characters.`;

  if (process.env.GROQ_API_KEY) {
    try {
      const text = await callGroqWithFallback(
        'You are an Index II data extractor. Return JSON only.',
        prompt,
        { timeout: 12000, temperature: 0.1, stage: 'Real Estate Intelligence' },
        logger
      );
      return JSON.parse(text).properties || [];
    } catch (e) {
      logger.warning('Real Estate Intelligence', `Groq signals extraction failed: ${e.message}`);
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
        return JSON.parse(match[0]).properties || [];
      }
    } catch (e) {
      logger.warning('Real Estate Intelligence', `Gemini signals extraction failed: ${e.message}`);
    }
  }

  return [];
}

// ═══════════════════════════════════════════════════════════════════
// PRIORITY 4: HTML Fallback Scraping (Last Resort)
// ═══════════════════════════════════════════════════════════════════

async function runHtmlFallbackSearch(searchType, queryValue, logger) {
  // Queries land registry indexes and real estate records pages directly
  const query = `${queryValue} property index 2 logs squareyards zapkey landeed`;
  const searchResults = await searchDDG(query, logger);
  
  const relevantLinks = searchResults.filter(r => 
    r.url && (r.url.includes('zapkey') || r.url.includes('squareyards') || r.url.includes('landeed') || r.url.includes('indextap'))
  );

  const fallbackRecords = [];

  for (const link of relevantLinks.slice(0, 2)) {
    try {
      const res = await fetch(link.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        
        // Extract plain tables or list elements showing Index II transactions
        $('table tr').each((_, el) => {
          const cells = $(el).find('td');
          if (cells.length >= 4) {
            const text = cells.text().toLowerCase();
            if (text.includes('sale') || text.includes('agreement') || text.includes('buyer') || text.includes('seller')) {
              fallbackRecords.push({
                type: 'Property Transaction',
                propertyDescription: $(cells[0]).text().trim(),
                buyerName: $(cells[1]).text().trim(),
                sellerName: $(cells[2]).text().trim(),
                considerationAmount: $(cells[3]).text().trim(),
                source: link.url,
                confidence: 0.5,
              });
            }
          }
        });
      }
    } catch (e) {
      // Continue next link
    }
  }

  return fallbackRecords;
}

// ═══════════════════════════════════════════════════════════════════
// Helper / Calculation Utilities
// ═══════════════════════════════════════════════════════════════════

function formatCurrencyRaw(amount) {
  if (!amount) return 0;
  if (typeof amount === 'number') return amount;
  
  const cleaned = amount.toLowerCase().replace(/[₹,rs.inr\s]/gi, '').trim();

  // Cr
  const cr = cleaned.match(/([\d.]+)\s*(?:cr|crore)/i);
  if (cr) return Math.round(parseFloat(cr[1]) * 10000000);

  // Lakh
  const lakh = cleaned.match(/([\d.]+)\s*(?:l|lakh|lac)/i);
  if (lakh) return Math.round(parseFloat(lakh[1]) * 100000);

  // Plain number
  const num = cleaned.replace(/[^0-9.]/g, '');
  return Math.round(parseFloat(num) || 0);
}

function buildSummaryStats(records) {
  if (records.length === 0) {
    return {
      totalProperties: 0,
      totalVolume: 0,
      averageValue: 0,
      documentTypes: {},
      districts: [],
    };
  }

  let totalVolume = 0;
  const docTypes = {};
  const districtCounts = {};

  for (const rec of records) {
    totalVolume += rec.considerationAmount || 0;
    
    const type = rec.articleName || rec.type || 'Transaction';
    docTypes[type] = (docTypes[type] || 0) + 1;

    const dist = rec.sroName || 'Maharashtra';
    districtCounts[dist] = (districtCounts[dist] || 0) + 1;
  }

  return {
    totalProperties: records.length,
    totalVolume,
    averageValue: Math.round(totalVolume / records.length),
    documentTypes: docTypes,
    districts: Object.entries(districtCounts).map(([name, count]) => ({ name, count })),
  };
}

/**
 * Generates an RM analytical brief summarizing the property/building transaction logs
 */
async function generatePropertyAnalyticsBrief(query, records, summary, logger) {
  if (records.length === 0) {
    return 'No transaction analytics available for this search criteria.';
  }

  const prompt = `You are a senior real estate wealth analyst for private clients.
Analyze the following compiled list of Maharashtra property transaction logs for: "${query}".

TRANSACTION SUMMARY:
- Total Transactions Found: ${summary.totalProperties}
- Total Registry Volume: INR ${summary.totalVolume.toLocaleString('en-IN')}
- Average Deal Valuation: INR ${summary.averageValue.toLocaleString('en-IN')}

TRANSACTION LOG DETAILS (Sample):
${JSON.stringify(records.slice(0, 10), null, 2)}

Generate a private banking executive brief including:
1. An overall market summary of this asset/building.
2. The key price range and valuation trend based on transaction amounts.
3. Top active buyers or sellers (e.g. key developers or sponsors) and what signals they indicate.
4. Any wealth indicators, collateral/mortgage leverage notes, or risk signals for a Relationship Manager to note before engaging.

Write it in elegant, formal private banking style. Avoid generic commentary. Max 250 words.`;

  if (process.env.GROQ_API_KEY) {
    try {
      return await callGroqWithFallback(
        'You are an expert private wealth real estate analyst. Write a concise executive summary.',
        prompt,
        { timeout: 12000, temperature: 0.3, response_format: null, stage: 'Real Estate Intelligence' },
        logger
      );
    } catch (e) {
      // Fallback
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (e) {
      // Fallback
    }
  }

  // Rule-based fallback summary
  return `Real Estate analysis for "${query}": A total of ${summary.totalProperties} transactions were compiled with a total volume of INR ${summary.totalVolume.toLocaleString('en-IN')} at an average deal value of INR ${summary.averageValue.toLocaleString('en-IN')}. The records suggest active transaction types including: ${Object.keys(summary.documentTypes).join(', ')}.`;
}

/**
 * DuckDuckGo Search wrapper
 */
async function searchDDG(query, logger) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`DDG status ${res.status}`);
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
      results.push({
        title: anchor.text().trim(),
        snippet: snippet.text().trim(),
        url: href,
      });
    });
    return results;
  } catch (e) {
    return [];
  }
}
