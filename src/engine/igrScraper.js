// IGR Maharashtra Real Estate Intelligence — Multi-Strategy Edition
// Strategy 1: Search snippet intelligence (DuckDuckGo → AI extraction) — PROVEN PATTERN
// Strategy 2: Direct scraping of property listing aggregators (IndiaFilings, Zauba, etc.)
// Strategy 3: IGR eSearch portal direct scraping (fallback)
//
// Mirrors the battle-tested approach from mca.js which reliably extracts
// corporate data from search snippets without needing to navigate complex portals.

import * as cheerio from 'cheerio';
import { getBrowser } from './publicSearch.js';
import { callGroqWithFallback } from '../utils/groq.js';

const DDG_URL = 'https://html.duckduckgo.com/html/';

/**
 * Main entry point — multi-strategy real estate intelligence
 */
export async function scrapeIGRProperties(identity, logger) {
  const start = Date.now();
  const personName = identity.person?.normalized || identity.normalized?.fullName || identity.searchVariants?.[0] || '';
  const companyName = identity.company?.normalized || identity.company?.raw || '';

  if (!personName) {
    logger.skipped('Real Estate Intelligence', 'No person name available for real estate search');
    return { properties: [], summary: {}, source: 'IGR Maharashtra' };
  }

  logger.running('Real Estate Intelligence', `Launching multi-strategy property search for "${personName}"`);

  let allProperties = [];

  // ── Strategy 1: Search Snippet Intelligence (most reliable) ──────────
  try {
    logger.running('Real Estate Intelligence', 'Strategy 1: Search snippet intelligence via DuckDuckGo...');
    const snippetProperties = await searchSnippetIntelligence(personName, companyName, logger);
    if (snippetProperties.length > 0) {
      allProperties.push(...snippetProperties);
      logger.success('Real Estate Intelligence', `Snippet intelligence found ${snippetProperties.length} property signal(s)`);
    }
  } catch (err) {
    logger.warning('Real Estate Intelligence', `Snippet intelligence failed: ${err.message}`);
  }

  // ── Strategy 2: Direct property portal scraping ──────────────────────
  try {
    logger.running('Real Estate Intelligence', 'Strategy 2: Scraping property aggregator portals...');
    const portalProperties = await scrapePropertyPortals(personName, companyName, logger);
    if (portalProperties.length > 0) {
      allProperties.push(...portalProperties);
      logger.success('Real Estate Intelligence', `Portal scraping found ${portalProperties.length} property record(s)`);
    }
  } catch (err) {
    logger.warning('Real Estate Intelligence', `Portal scraping failed: ${err.message}`);
  }

  // ── Strategy 3: IGR eSearch direct (last resort with fast timeout) ────
  if (allProperties.length === 0) {
    try {
      logger.running('Real Estate Intelligence', 'Strategy 3: Attempting IGR eSearch direct access...');
      const igrProperties = await Promise.race([
        scrapeIGRDirect(personName, logger),
        new Promise(r => setTimeout(() => r([]), 5000))
      ]);
      if (igrProperties.length > 0) {
        allProperties.push(...igrProperties);
        logger.success('Real Estate Intelligence', `IGR direct found ${igrProperties.length} record(s)`);
      }
    } catch (err) {
      logger.warning('Real Estate Intelligence', `IGR direct scraping failed: ${err.message}`);
    }
  }

  // Deduplicate by key fields
  allProperties = deduplicateProperties(allProperties);

  // Filter strictly for individual property records (omit generic corporate company premises)
  allProperties = allProperties.filter(p => {
    const desc = `${p.type} ${p.articleName} ${p.propertyDescription}`.toLowerCase();
    const isGenericCorp = desc.includes('corporate registered head office') || desc.includes('corporate commercial premises');
    return !isGenericCorp;
  });

  const summary = buildSummary(allProperties);
  const duration = Date.now() - start;

  if (allProperties.length > 0) {
    logger.success('Real Estate Intelligence',
      `Found ${allProperties.length} property record(s) via multi-strategy search`,
      { durationMs: duration }
    );
  } else {
    logger.warning('Real Estate Intelligence',
      `No property records found after all strategies. The person may not have Maharashtra property registrations.`,
      { durationMs: duration }
    );
  }

  return {
    properties: allProperties,
    summary,
    source: 'IGR Maharashtra / Property Intelligence',
  };
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY 1: Search Snippet Intelligence (DuckDuckGo → AI)
// ═══════════════════════════════════════════════════════════════════

async function searchSnippetIntelligence(personName, companyName, logger) {
  // Build targeted search queries for real estate data
  const searchQueries = [
    `"${personName}" property OR flat OR bungalow OR villa OR penthouse`,
    `"${personName}" "stamp duty" OR "sale deed" OR "conveyance" OR "igr maharashtra"`,
    `"${personName}" property transaction OR registration OR deed`,
    `"${personName}" real estate property mumbai OR pune OR gurgaon OR delhi`,
  ];

  // Add company-linked queries if company name is available
  if (companyName) {
    searchQueries.push(`"${personName}" "${companyName}" property OR office OR commercial`);
    searchQueries.push(`"${companyName}" property registration OR land OR office premises`);
  }

  // Search via DuckDuckGo
  let allSnippets = [];
  for (const query of searchQueries) {
    try {
      const snippets = await searchDDG(query, logger);
      allSnippets.push(...snippets);
    } catch (err) {
      logger.warning('Real Estate Intelligence', `Search query failed: ${err.message}`);
    }
  }

  // Deduplicate by URL
  const seenUrls = new Set();
  const uniqueSnippets = allSnippets.filter(s => {
    if (!s.url || seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    return true;
  });

  // Filter for relevant real estate results
  const realEstateKeywords = [
    'property', 'real estate', 'sale deed', 'agreement', 'registration',
    'stamp duty', 'conveyance', 'igr', 'maharashtra', 'land', 'flat',
    'apartment', 'building', 'plot', 'survey', 'cts', 'mortgage',
    'lease', 'sqft', 'sq.ft', 'carpet', 'built-up', 'floor',
    'magicbricks', '99acres', 'housing.com', 'makaan', 'squareyards',
    'commonfloor', 'proptiger', 'acres', 'hectare', 'gunta',
    'ready reckoner', 'ready-reckoner', 'market value', 'circle rate',
    'mutation', 'transfer', 'deed', 'registrar',
  ];

  const relevantSnippets = uniqueSnippets.filter(s => {
    const text = `${s.title} ${s.snippet}`.toLowerCase();
    return realEstateKeywords.some(kw => text.includes(kw));
  });

  if (relevantSnippets.length === 0) {
    logger.warning('Real Estate Intelligence', `No real estate signals found in ${uniqueSnippets.length} search results`);
    return [];
  }

  logger.running('Real Estate Intelligence', `Found ${relevantSnippets.length} real estate signals — extracting with AI...`);

  // Extract structured data with AI
  const limitedSnippets = relevantSnippets.slice(0, 15);
  const extracted = await extractRealEstateWithAI(personName, companyName, limitedSnippets, logger);

  return extracted;
}

/**
 * DuckDuckGo HTML search — same proven approach as mca.js
 */
async function searchDDG(query, logger) {
  const url = `${DDG_URL}?q=${encodeURIComponent(query)}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`DDG status ${res.status}`);

    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];

    $('.result__body').each((_, el) => {
      const anchor = $(el).find('a.result__a');
      const snippet = $(el).find('.result__snippet');
      let href = anchor.attr('href') || '';

      // Decode DDG redirect URL
      if (href.includes('uddg=')) {
        try {
          const match = href.match(/uddg=([^&]+)/);
          if (match) href = decodeURIComponent(match[1]);
        } catch (e) {}
      }
      if (href.startsWith('//')) href = 'https:' + href;

      results.push({
        title: anchor.text().trim(),
        snippet: snippet.text().trim(),
        url: href,
      });
    });

    return results;
  } catch (e) {
    // Fallback to Puppeteer-based search
    return await searchDDGPuppeteer(query, logger);
  }
}

async function searchDDGPuppeteer(query, logger) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const url = `${DDG_URL}?q=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });

    const results = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.result__body')).map(el => {
        const anchor = el.querySelector('a.result__a');
        const snippet = el.querySelector('.result__snippet');
        let href = anchor?.getAttribute('href') || '';
        if (href.includes('uddg=')) {
          try {
            const match = href.match(/uddg=([^&]+)/);
            if (match) href = decodeURIComponent(match[1]);
          } catch (e) {}
        }
        return {
          title: anchor?.textContent?.trim() || '',
          snippet: snippet?.textContent?.trim() || '',
          url: href,
        };
      });
    });
    return results;
  } catch (err) {
    return [];
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/**
 * AI extraction of real estate data from search snippets
 */
async function extractRealEstateWithAI(personName, companyName, snippets, logger) {
  const snippetsText = snippets
    .map((r, i) => `[Signal #${i + 1}]\nTitle: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
    .join('\n\n');

  const prompt = `You are a real estate intelligence data extraction engine for India (Maharashtra, Delhi NCR, Karnataka, etc.).
Analyze the following search signals and extract ALL property-related information for the person "${personName}"${companyName ? ` (associated with "${companyName}")` : ''}.

SEARCH SIGNALS:
${snippetsText}

Extract every property transaction, real estate holding, commercial office premises, or registered office land record you find.

Return a JSON response with exactly this structure:
{
  "properties": [
    {
      "type": "Commercial Office Premises / Sale Deed / Agreement to Sale / Mortgage / Conveyance / Lease / Gift Deed / Flat Purchase / Other",
      "articleName": "Specific document type or property classification",
      "propertyDescription": "Property details — address, flat/office no, building name, survey/CTS no, area (sqft/acres), etc.",
      "location": "Area/locality, City, District",
      "district": "Mumbai / Pune / Thane / Gurgaon / Delhi / Bengaluru / Other",
      "considerationAmount": "Transaction value in INR (e.g. 25000000 or 2.5 Cr) — numbers only if available",
      "marketValue": "Market value or stamp duty value if mentioned",
      "registrationDate": "Date of registration or transaction if mentioned",
      "executionDate": "Date of execution if mentioned",
      "partyNames": "Other parties or company involved in the transaction",
      "documentNo": "Registration document number if mentioned",
      "sroName": "Sub-Registrar Office name if mentioned",
      "area": "Area in sqft, sq.mt, acres, hectares etc if mentioned",
      "source": "The URL or source name where this info was found",
      "confidence": 0.0 to 1.0
    }
  ]
}

Rules:
- Extract ALL property transactions, residential holdings, AND registered corporate office premises associated with "${personName}" or "${companyName || 'their company'}".
- Include ALL properties found across all snippets.
- If a snippet mentions corporate registered office premises (e.g., Frontline Grandeur, Walton Street, Mumbai), extract it as a Commercial Office Premises asset.
- For amounts, extract the numeric value only (e.g., "2.5 Cr" → "25000000", "15 Lakh" → "1500000").
- If no property data is found at all, return {"properties": []}.
- Return ONLY the JSON object, no formatting or extra text.`;

  // Try Groq first (fast), Gemini second
  if (process.env.GROQ_API_KEY) {
    try {
      const text = await callGroqWithFallback(
        'You are a real estate data extraction engine for India. Return valid JSON only.',
        prompt,
        { timeout: 15000, temperature: 0.1, stage: 'Real Estate Intelligence' },
        logger
      );

      const parsed = JSON.parse(text);
      if (parsed.properties && Array.isArray(parsed.properties)) {
        return parsed.properties.map(p => ({
          ...p,
          source: p.source || 'Search Intelligence (DuckDuckGo + AI)',
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (e) {
      logger.warning('Real Estate Intelligence', `Groq extraction failed: ${e.message}. Trying Gemini...`);
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.properties && Array.isArray(parsed.properties)) {
          return parsed.properties.map(p => ({
            ...p,
            source: p.source || 'Search Intelligence (DuckDuckGo + Gemini)',
            timestamp: new Date().toISOString(),
          }));
        }
      }
    } catch (e) {
      logger.warning('Real Estate Intelligence', `Gemini extraction failed: ${e.message}`);
    }
  }

  logger.warning('Real Estate Intelligence', 'No AI API configured for real estate extraction. Set GROQ_API_KEY or GEMINI_API_KEY.');
  return [];
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY 2: Direct Property Portal Scraping
// ═══════════════════════════════════════════════════════════════════

async function scrapePropertyPortals(personName, companyName, logger) {
  const properties = [];
  let page = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Try scraping property-related pages from search results
    const portalSearchQueries = [
      `site:magicbricks.com "${personName}"`,
      `site:99acres.com "${personName}"`,
      `"${personName}" property sale purchase mumbai pune thane sqft`,
    ];

    for (const query of portalSearchQueries) {
      try {
        const results = await searchDDG(query, logger);
        const propertyUrls = results
          .filter(r => r.url && (
            r.url.includes('magicbricks') ||
            r.url.includes('99acres') ||
            r.url.includes('housing.com') ||
            r.url.includes('squareyards') ||
            r.url.includes('proptiger') ||
            r.url.includes('makaan')
          ))
          .slice(0, 3);

        for (const result of propertyUrls) {
          try {
            await page.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const pageData = await page.evaluate(() => {
              const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
              return {
                title: document.title,
                body: document.body?.innerText?.substring(0, 3000) || '',
              };
            });

            if (pageData.body.length > 100) {
              // Extract property info from the page text using pattern matching
              const extracted = extractPropertyFromText(pageData.body, personName, result.url);
              if (extracted) {
                properties.push(extracted);
              }
            }
          } catch (pageErr) {
            // Skip failed pages
          }
        }
      } catch (queryErr) {
        // Skip failed queries
      }
    }
  } catch (err) {
    logger.warning('Real Estate Intelligence', `Property portal scraping error: ${err.message}`);
  } finally {
    if (page) await page.close().catch(() => {});
  }

  return properties;
}

/**
 * Extract property data from page text using regex patterns
 */
function extractPropertyFromText(text, personName, sourceUrl) {
  const textLower = text.toLowerCase();
  const nameWords = personName.toLowerCase().split(/\s+/);

  // Check if the person is mentioned on this page
  const nameFound = nameWords.every(word => textLower.includes(word)) ||
    textLower.includes(personName.toLowerCase());

  if (!nameFound) return null;

  // Extract property details with regex
  const amountRegex = /(?:₹|Rs\.?|INR)\s*([0-9,.]+)\s*(?:crore|cr|lakh|lac|l|k)?/gi;
  const areaRegex = /([0-9,.]+)\s*(?:sq\.?\s*ft|sqft|sq\.?\s*mt|carpet|built[\s-]?up|super)/gi;
  const locationRegex = /(?:at|in|near|located)\s+([A-Z][a-zA-Z\s,]+?)(?:\.|,|\n|$)/g;

  const amounts = [];
  let match;
  while ((match = amountRegex.exec(text)) !== null) {
    amounts.push(match[0].trim());
  }

  const areas = [];
  while ((match = areaRegex.exec(text)) !== null) {
    areas.push(match[0].trim());
  }

  // Try to extract a property type
  const propertyTypes = ['flat', 'apartment', 'plot', 'land', 'bungalow', 'villa', 'office', 'commercial', 'shop', 'warehouse', 'building'];
  const foundType = propertyTypes.find(t => textLower.includes(t));

  // Only create a property entry if we have meaningful data
  if (amounts.length === 0 && areas.length === 0 && !foundType) return null;

  return {
    type: foundType ? foundType.charAt(0).toUpperCase() + foundType.slice(1) : 'Property',
    articleName: foundType ? `${foundType.charAt(0).toUpperCase() + foundType.slice(1)} Listing` : 'Property Listing',
    propertyDescription: areas.length > 0 ? `Area: ${areas[0]}` : '',
    location: '',
    district: '',
    considerationAmount: amounts.length > 0 ? amounts[0] : '',
    area: areas.length > 0 ? areas[0] : '',
    source: sourceUrl,
    confidence: 0.55,
    timestamp: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY 3: IGR eSearch Direct (Fallback)
// ═══════════════════════════════════════════════════════════════════

async function scrapeIGRDirect(personName, logger) {
  let page = null;
  const properties = [];

  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });

    // Navigate to IGR Free Search
    await page.goto('https://freesearchigrservice.maharashtra.gov.in/', {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });

    // Wait for the page to fully load
    await new Promise(r => setTimeout(r, 3000));

    // Check what's available on the page
    const pageState = await page.evaluate(() => {
      const allSelects = Array.from(document.querySelectorAll('select')).map(s => ({
        id: s.id,
        name: s.name,
        optionCount: s.options.length,
        options: Array.from(s.options).slice(0, 5).map(o => ({ value: o.value, text: o.text })),
      }));
      const allInputs = Array.from(document.querySelectorAll('input')).map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        placeholder: i.placeholder,
      }));
      const allLinks = Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent.trim().substring(0, 50),
        href: a.href,
      }));
      return {
        title: document.title,
        selectCount: allSelects.length,
        selects: allSelects,
        inputCount: allInputs.length,
        inputs: allInputs,
        linkCount: allLinks.length,
        links: allLinks.slice(0, 20),
        bodyText: document.body?.innerText?.substring(0, 1000) || '',
      };
    });

    logger.running('Real Estate Intelligence', `IGR page loaded: "${pageState.title}" — ${pageState.selectCount} dropdowns, ${pageState.inputCount} inputs`);

    // Log detailed form state for debugging
    if (pageState.selects.length > 0) {
      logger.running('Real Estate Intelligence', `Available dropdowns: ${pageState.selects.map(s => `${s.id || s.name}(${s.optionCount} opts)`).join(', ')}`);
    }

    // Try to navigate to Party Name search
    // The IGR portal uses postback — look for the right link
    const partyNameLink = pageState.links.find(l =>
      l.text.toLowerCase().includes('party') ||
      l.text.toLowerCase().includes('पार्टी') ||
      l.href.includes('mnuSearchType')
    );

    if (partyNameLink) {
      logger.running('Real Estate Intelligence', `Found party search link: "${partyNameLink.text}"`);

      // Click the party name search link
      await page.evaluate((linkText) => {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a =>
          a.textContent.trim().includes(linkText) ||
          a.href.includes('mnuSearchType')
        );
        if (target) target.click();
      }, partyNameLink.text);

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    } else {
      // Try direct postback
      await page.evaluate(() => {
        if (typeof __doPostBack === 'function') {
          __doPostBack('mnuSearchType', '1');
        }
      });
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }

    // Re-check form state after navigation
    const formState = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
      const captchaImg = document.querySelector('img[id*="captcha"], img[id*="Captcha"], img[src*="captcha"]');
      return {
        selectIds: selects.map(s => s.id || s.name),
        inputIds: inputs.map(i => i.id || i.name),
        hasCaptcha: !!captchaImg,
        bodyText: document.body?.innerText?.substring(0, 500) || '',
      };
    });

    logger.running('Real Estate Intelligence', `Form state: ${formState.selectIds.length} selects, ${formState.inputIds.length} inputs, captcha: ${formState.hasCaptcha}`);

    // Try to fill in the district dropdown (select first available district)
    if (formState.selectIds.length > 0) {
      for (const selectId of formState.selectIds) {
        if (!selectId) continue;
        const districtSelected = await page.evaluate((sid) => {
          const sel = document.getElementById(sid) || document.querySelector(`select[name="${sid}"]`);
          if (!sel || sel.options.length < 2) return false;
          // Look for Mumbai or any option that's not the default
          for (const opt of sel.options) {
            if (opt.text.toLowerCase().includes('mumbai') || opt.text.includes('मुंबई')) {
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
          // Just select the second option if Mumbai not found
          if (sel.options.length > 1) {
            sel.value = sel.options[1].value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        }, selectId);

        if (districtSelected) {
          logger.running('Real Estate Intelligence', `Selected district via dropdown: ${selectId}`);
          // Wait for dependent dropdowns to load
          await new Promise(r => setTimeout(r, 2000));
          break;
        }
      }
    }

    // Enter party name in any visible text input
    if (formState.inputIds.length > 0) {
      const nameEntered = await page.evaluate((name, inputIds) => {
        for (const inputId of inputIds) {
          const input = document.getElementById(inputId) || document.querySelector(`input[name="${inputId}"]`);
          if (input && input.offsetParent !== null) { // visible check
            input.value = name;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return inputId;
          }
        }
        return null;
      }, personName, formState.inputIds);

      if (nameEntered) {
        logger.running('Real Estate Intelligence', `Entered party name "${personName}" into field: ${nameEntered}`);
      }
    }

    // Handle CAPTCHA if present
    if (formState.hasCaptcha) {
      logger.warning('Real Estate Intelligence', 'CAPTCHA detected on IGR portal — attempting OCR...');

      const captchaElement = await page.$('img[id*="captcha"], img[id*="Captcha"], img[src*="captcha"]');
      if (captchaElement) {
        try {
          const Tesseract = (await import('tesseract.js')).default;
          const captchaBuffer = await captchaElement.screenshot({ encoding: 'base64' });
          const captchaDataUrl = `data:image/png;base64,${captchaBuffer}`;
          const { data } = await Tesseract.recognize(captchaDataUrl, 'eng', { logger: () => {} });
          const captchaText = data.text.trim().replace(/[^a-zA-Z0-9]/g, '');

          if (captchaText.length >= 3) {
            // Find and fill captcha input
            await page.evaluate((text) => {
              const inputs = document.querySelectorAll('input[type="text"]');
              // CAPTCHA input is usually the last text input
              const captchaInput = Array.from(inputs).find(i =>
                (i.id && i.id.toLowerCase().includes('captcha')) ||
                (i.name && i.name.toLowerCase().includes('captcha'))
              ) || inputs[inputs.length - 1];
              if (captchaInput) {
                captchaInput.value = text;
                captchaInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, captchaText);
            logger.running('Real Estate Intelligence', `CAPTCHA solved (OCR): "${captchaText}"`);
          }
        } catch (captchaErr) {
          logger.warning('Real Estate Intelligence', `CAPTCHA OCR failed: ${captchaErr.message}`);
        }
      }
    }

    // Submit the form
    const submitted = await page.evaluate(() => {
      // Try various submit buttons
      const submitBtn = document.querySelector('input[type="submit"], button[type="submit"], input[id*="btn"], input[value*="Search"], input[value*="search"], input[value*="शोधा"]');
      if (submitBtn) {
        submitBtn.click();
        return true;
      }
      // Try form submit
      const form = document.querySelector('form');
      if (form) {
        form.submit();
        return true;
      }
      return false;
    });

    if (submitted) {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));

      // Extract any results
      const results = await page.evaluate(() => {
        const tables = document.querySelectorAll('table');
        const records = [];

        for (const table of tables) {
          const rows = table.querySelectorAll('tr');
          if (rows.length < 2) continue;

          const headers = Array.from(rows[0].querySelectorAll('th, td')).map(c => c.textContent.trim());
          if (headers.length < 3) continue;

          for (let i = 1; i < Math.min(rows.length, 20); i++) {
            const cells = Array.from(rows[i].querySelectorAll('td')).map(c => c.textContent.trim());
            if (cells.length < 3) continue;

            const record = {};
            headers.forEach((h, idx) => {
              if (cells[idx]) record[h] = cells[idx];
            });
            records.push(record);
          }
        }

        // Also capture any visible result text
        const resultText = document.body?.innerText?.substring(0, 5000) || '';
        return { records, resultText, tableCount: tables.length };
      });

      if (results.records.length > 0) {
        logger.success('Real Estate Intelligence', `IGR direct: Found ${results.records.length} records in ${results.tableCount} tables`);
        for (const record of results.records) {
          properties.push({
            type: 'IGR Registry Record',
            articleName: record['Article'] || record['Document Type'] || record['article'] || '',
            documentNo: record['Document No'] || record['Doc No'] || record['document no'] || '',
            registrationDate: record['Registration Date'] || record['Date'] || record['date'] || '',
            partyNames: record['Party Name'] || record['Parties'] || record['party name'] || '',
            propertyDescription: record['Property'] || record['Survey No'] || record['property'] || '',
            considerationAmount: record['Consideration'] || record['Amount'] || record['amount'] || '',
            sroName: record['SRO'] || record['Office'] || '',
            district: 'Maharashtra',
            source: 'IGR Maharashtra eSearch (Direct)',
            confidence: 0.8,
            timestamp: new Date().toISOString(),
            rawData: record,
          });
        }
      } else {
        logger.warning('Real Estate Intelligence', `IGR direct: No tabular results. Page had ${results.tableCount} tables.`);
      }
    }

  } catch (err) {
    logger.warning('Real Estate Intelligence', `IGR direct scraping error: ${err.message}`);
  } finally {
    if (page) await page.close().catch(() => {});
  }

  return properties;
}

// ═══════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════

function deduplicateProperties(properties) {
  const seen = new Set();
  return properties.filter(p => {
    const key = `${(p.documentNo || '').toLowerCase()}_${(p.propertyDescription || '').toLowerCase().substring(0, 50)}_${p.considerationAmount || ''}`;
    if (key === '__' || !seen.has(key)) {
      if (key !== '__') seen.add(key);
      return true;
    }
    return false;
  });
}

function buildSummary(properties) {
  if (properties.length === 0) {
    return { totalProperties: 0, districts: [], documentTypes: {}, estimatedPortfolioValue: null };
  }

  const districtCounts = {};
  const docTypeCounts = {};
  let totalValue = 0;
  let valueCount = 0;

  for (const prop of properties) {
    const dist = prop.district || prop.location || 'Unknown';
    districtCounts[dist] = (districtCounts[dist] || 0) + 1;

    const docType = prop.articleName || prop.type || 'Unknown';
    docTypeCounts[docType] = (docTypeCounts[docType] || 0) + 1;

    if (prop.considerationAmount) {
      const amount = parseAmount(prop.considerationAmount);
      if (amount > 0) {
        totalValue += amount;
        valueCount++;
      }
    }
  }

  return {
    totalProperties: properties.length,
    districts: Object.entries(districtCounts).map(([name, count]) => ({ name, count })),
    documentTypes: docTypeCounts,
    estimatedPortfolioValue: valueCount > 0 ? totalValue : null,
    valueRecordsFound: valueCount,
  };
}

/**
 * Parse Indian currency amounts — handles Cr, Lakh, K, and plain numbers
 */
function parseAmount(str) {
  if (!str || typeof str !== 'string') return 0;
  const cleaned = str.replace(/[₹,Rs.INR\s]/gi, '').trim();

  // Check for Cr/Crore
  const crMatch = cleaned.match(/([\d.]+)\s*(?:cr|crore)/i);
  if (crMatch) return parseFloat(crMatch[1]) * 10000000;

  // Check for L/Lakh/Lac
  const lMatch = cleaned.match(/([\d.]+)\s*(?:l|lakh|lac)/i);
  if (lMatch) return parseFloat(lMatch[1]) * 100000;

  // Check for K
  const kMatch = cleaned.match(/([\d.]+)\s*k/i);
  if (kMatch) return parseFloat(kMatch[1]) * 1000;

  // Plain number
  const numMatch = cleaned.match(/[\d.]+/);
  if (numMatch) return parseFloat(numMatch[0]);

  return 0;
}
