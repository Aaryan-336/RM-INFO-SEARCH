// Contact Enrichment Module (Tier 3 — Fallback only)
// Cascading: Apollo (free 50/mo) → Hunter.io (free 25/mo) → RocketReach → PDL (free 100/mo)
// Only triggered when public search + OCR didn't find phone or email

import { CONFIDENCE, ATTRIBUTION } from '../utils/confidence.js';

export async function enrichContacts(identity, existingContacts, logger) {
  const start = Date.now();

  const hasEmail = existingContacts.emails && existingContacts.emails.length > 0;
  const hasPhone = existingContacts.phones && existingContacts.phones.length > 0;

  if (hasEmail && hasPhone) {
    logger.skipped('Contact Enrichment', 'Sufficient contacts found from public sources — skipping enrichment');
    return { emails: [], phones: [], profiles: [] };
  }

  logger.running('Contact Enrichment', 'Public sources insufficient — trying enrichment providers (fallback)');

  const results = { emails: [], phones: [], profiles: [] };

  // Cascade through providers
  const providers = [
    { name: 'Apify Google Search', fn: tryApify, keyEnv: 'APIFY_TOKEN', confidence: CONFIDENCE.PUBLIC_DIRECTORY },
    { name: 'Apollo', fn: tryApollo, keyEnv: 'APOLLO_API_KEY', confidence: CONFIDENCE.APOLLO },
    { name: 'Hunter.io', fn: tryHunter, keyEnv: 'HUNTER_API_KEY', confidence: CONFIDENCE.HUNTER },
    { name: 'RocketReach', fn: tryRocketReach, keyEnv: 'ROCKETREACH_API_KEY', confidence: CONFIDENCE.ROCKETREACH },
    { name: 'People Data Labs', fn: tryPDL, keyEnv: 'PDL_API_KEY', confidence: CONFIDENCE.PDL },
  ];

  for (const provider of providers) {
    const apiKey = process.env[provider.keyEnv];
    if (!apiKey) {
      logger.skipped('Contact Enrichment', `${provider.name}: No API key configured — skipping`);
      continue;
    }

    try {
      logger.running('Contact Enrichment', `Trying ${provider.name}...`);
      const providerResult = await provider.fn(identity, apiKey, provider.confidence);

      if (providerResult) {
        if (providerResult.email && !hasEmail) {
          results.emails.push(providerResult.email);
          logger.success('Contact Enrichment', `${provider.name}: Found email`, { confidence: provider.confidence });
        }
        if (providerResult.phone && !hasPhone) {
          results.phones.push(providerResult.phone);
          logger.success('Contact Enrichment', `${provider.name}: Found phone`, { confidence: provider.confidence });
        }
        if (providerResult.profile) {
          results.profiles.push(providerResult.profile);
        }

        // Stop cascade if we have both
        const nowHasEmail = hasEmail || results.emails.length > 0;
        const nowHasPhone = hasPhone || results.phones.length > 0;
        if (nowHasEmail && nowHasPhone) {
          logger.success('Contact Enrichment', `Sufficient contacts found via ${provider.name} — stopping cascade`);
          break;
        }
      }
    } catch (err) {
      logger.warning('Contact Enrichment', `${provider.name}: ${err.message}`);
    }
  }

  const duration = Date.now() - start;
  const totalFound = results.emails.length + results.phones.length;

  if (totalFound > 0) {
    logger.success('Contact Enrichment',
      `Enrichment found ${results.emails.length} email(s), ${results.phones.length} phone(s)`,
      { durationMs: duration }
    );
  } else {
    logger.warning('Contact Enrichment', 'No additional contacts found from enrichment providers', { durationMs: duration });
  }

  return results;
}

// ─── Apollo (Free: 50 credits/month) ──────────────────────────

async function tryApollo(identity, apiKey, confidence) {
  const url = 'https://api.apollo.io/v1/people/match';
  const body = {
    first_name: identity.normalized.firstName,
    last_name: identity.normalized.lastName,
    organization_name: identity.company.normalized,
  };
  if (identity.linkedinUrl) {
    body.linkedin_url = identity.linkedinUrl;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const person = data.person;
  if (!person) return null;

  const result = { profile: null, email: null, phone: null };

  if (person.email) {
    result.email = {
      value: person.email,
      source: 'Apollo',
      sourceType: 'Enrichment Provider (Apollo)',
      confidence,
      attribution: ATTRIBUTION.ENRICHMENT_API,
      timestamp: new Date().toISOString(),
    };
  }

  if (person.phone_numbers && person.phone_numbers.length > 0) {
    result.phone = {
      value: person.phone_numbers[0].sanitized_number || person.phone_numbers[0].raw_number,
      source: 'Apollo',
      sourceType: 'Enrichment Provider (Apollo)',
      confidence,
      attribution: ATTRIBUTION.ENRICHMENT_API,
      timestamp: new Date().toISOString(),
    };
  }

  result.profile = {
    title: person.title,
    headline: person.headline,
    linkedin: person.linkedin_url,
    city: person.city,
    country: person.country,
    organization: person.organization?.name,
    source: 'Apollo',
    confidence,
    timestamp: new Date().toISOString(),
  };

  return result;
}

// ─── Hunter.io (Free: 25 searches/month) ──────────────────────

async function tryHunter(identity, apiKey, confidence) {
  // First try email finder
  const finderUrl = `https://api.hunter.io/v2/email-finder?domain=${identity.company.possibleDomains[0]}&first_name=${encodeURIComponent(identity.normalized.firstName)}&last_name=${encodeURIComponent(identity.normalized.lastName)}&api_key=${apiKey}`;

  const res = await fetch(finderUrl, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.data || !data.data.email) return null;

  return {
    email: {
      value: data.data.email,
      source: 'Hunter.io',
      sourceType: 'Enrichment Provider (Hunter.io)',
      confidence: data.data.score ? data.data.score / 100 : confidence,
      attribution: ATTRIBUTION.ENRICHMENT_API,
      timestamp: new Date().toISOString(),
    },
    phone: null,
    profile: {
      position: data.data.position,
      linkedin: data.data.linkedin,
      twitter: data.data.twitter,
      source: 'Hunter.io',
      confidence,
      timestamp: new Date().toISOString(),
    },
  };
}

// ─── RocketReach ──────────────────────────────────────────────

async function tryRocketReach(identity, apiKey, confidence) {
  const url = `https://api.rocketreach.co/v2/api/lookupProfile`;

  const body = {};
  if (identity.linkedinUrl) {
    body.linkedin_url = identity.linkedinUrl;
  } else {
    body.name = identity.normalized.fullName;
    body.current_employer = identity.company.normalized;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const result = { email: null, phone: null, profile: null };

  if (data.emails && data.emails.length > 0) {
    result.email = {
      value: data.emails[0].email,
      source: 'RocketReach',
      sourceType: 'Enrichment Provider (RocketReach)',
      confidence,
      attribution: ATTRIBUTION.ENRICHMENT_API,
      timestamp: new Date().toISOString(),
    };
  }

  if (data.phones && data.phones.length > 0) {
    result.phone = {
      value: data.phones[0].number,
      source: 'RocketReach',
      sourceType: 'Enrichment Provider (RocketReach)',
      confidence,
      attribution: ATTRIBUTION.ENRICHMENT_API,
      timestamp: new Date().toISOString(),
    };
  }

  result.profile = {
    title: data.current_title,
    linkedin: data.linkedin_url,
    source: 'RocketReach',
    confidence,
    timestamp: new Date().toISOString(),
  };

  return result;
}

// ─── People Data Labs (Free: 100 records/month) ──────────────

async function tryPDL(identity, apiKey, confidence) {
  const params = new URLSearchParams();
  if (identity.linkedinUrl) {
    params.append('profile_url', identity.linkedinUrl);
  } else {
    params.append('first_name', identity.normalized.firstName);
    params.append('last_name', identity.normalized.lastName);
    params.append('company', identity.company.normalized);
  }
  params.append('pretty', 'true');

  const url = `https://api.peopledatalabs.com/v5/person/enrich?${params}`;

  const res = await fetch(url, {
    headers: { 'X-Api-Key': apiKey },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== 200) return null;

  const result = { email: null, phone: null, profile: null };

  if (data.data?.work_email) {
    result.email = {
      value: data.data.work_email,
      source: 'People Data Labs',
      sourceType: 'Enrichment Provider (PDL)',
      confidence,
      attribution: ATTRIBUTION.ENRICHMENT_API,
      timestamp: new Date().toISOString(),
    };
  }

  if (data.data?.mobile_phone) {
    result.phone = {
      value: data.data.mobile_phone,
      source: 'People Data Labs',
      sourceType: 'Enrichment Provider (PDL)',
      confidence,
      attribution: ATTRIBUTION.ENRICHMENT_API,
      timestamp: new Date().toISOString(),
    };
  }

  result.profile = {
    title: data.data?.job_title,
    linkedin: data.data?.linkedin_url,
    industry: data.data?.industry,
    location: data.data?.location_name,
    source: 'People Data Labs',
    confidence,
    timestamp: new Date().toISOString(),
  };

  return result;
}

// ─── Apify Google Search (Free: $5 credits/month) ─────────────

async function tryApify(identity, apiKey, confidence) {
  const query = `"${identity.normalized.fullName}" contact OR email OR phone OR mobile OR "@gmail.com"`;
  const url = `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${apiKey}&timeout=60`;
  
  const body = {
    queries: query,
    maxPagesPerQuery: 1,
    resultsPerPage: 8,
    countryCode: "in"
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) return null;

  const items = await res.json();
  if (!Array.isArray(items) || items.length === 0) return null;

  // Compile snippets text from organic results
  const organicResults = items[0]?.organicResults || [];
  if (organicResults.length === 0) return null;

  // We reuse results object format to extract
  const results = { emails: [], phones: [] };
  
  const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const INDIAN_MOBILE_REGEX = /(?:(?:\+91|91|0)[\s.-]?)?[6-9]\d{9}(?!\d)/g;
  const INDIAN_LANDLINE_REGEX = /(?:(?:\+91|91)[\s.-]?)?0[1-9]\d{1,3}[\s.-]?\d{6,8}(?!\d)/g;

  for (const item of organicResults) {
    const text = (item.title || '') + ' ' + (item.description || '');
    
    // Extract emails
    const emails = text.match(EMAIL_REGEX) || [];
    for (const email of emails) {
      const clean = email.toLowerCase().trim();
      if (!results.emails.some(e => e.value === clean)) {
        results.emails.push({
          value: clean,
          source: 'Apify Google Search',
          sourceType: 'Enrichment Provider (Apify)',
          confidence,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Extract phones
    const mobiles = text.match(INDIAN_MOBILE_REGEX) || [];
    const landlines = text.match(INDIAN_LANDLINE_REGEX) || [];
    for (const phone of [...new Set([...mobiles, ...landlines])]) {
      const cleaned = phone.replace(/[\s\-().]/g, '');
      if (cleaned.length >= 10 && cleaned.length <= 13 && !results.phones.some(p => p.value === cleaned)) {
        results.phones.push({
          value: cleaned,
          source: 'Apify Google Search',
          sourceType: 'Enrichment Provider (Apify)',
          confidence,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  // If we found any candidates, return the first ones
  return {
    email: results.emails[0] || null,
    phone: results.phones[0] || null,
    profile: null
  };
}
