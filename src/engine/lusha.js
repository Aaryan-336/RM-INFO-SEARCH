// Lusha Contact Enrichment Module
// Direct REST API integration with Lusha Person API (https://api.lusha.com/person)

import { CONFIDENCE, ATTRIBUTION } from '../utils/confidence.js';

export function isLushaConfigured() {
  return !!(process.env.LUSHA_API_KEY || process.env.Lusha_API);
}

/**
 * Enriches target contact details using Lusha Person API
 */
export async function tryLusha(identity, apiKey, confidence = CONFIDENCE.LUSHA || 0.90, logger) {
  const key = apiKey || process.env.LUSHA_API_KEY || process.env.Lusha_API;
  if (!key) {
    logger?.skipped('Contact Enrichment', 'Lusha: LUSHA_API_KEY not configured');
    return null;
  }

  const firstName = identity.normalized.firstName;
  const lastName = identity.normalized.lastName;
  const company = identity.company.officialName || identity.company.normalized;
  const domain = identity.company.possibleDomains?.[0] || null;
  const linkedinUrl = identity.linkedinUrl || null;

  logger?.running('Contact Enrichment', `Lusha: Querying person API for "${firstName} ${lastName}" at "${company}"...`);

  const endpointUrl = process.env.LUSHA_ENDPOINT || 'https://api.lusha.com/v2/person';
  const url = new URL(endpointUrl);
  if (firstName) url.searchParams.append('firstName', firstName);
  if (lastName) url.searchParams.append('lastName', lastName);
  if (company) url.searchParams.append('companyName', company);
  if (domain) url.searchParams.append('companyDomain', domain);
  if (linkedinUrl) url.searchParams.append('linkedinUrl', linkedinUrl);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'api_key': key,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger?.warning('Contact Enrichment', `Lusha HTTP ${response.status}: ${errText.slice(0, 150)}`);
      return null;
    }

    const data = await response.json();
    return normalizeLushaResponse(data, identity, confidence, logger);
  } catch (err) {
    logger?.warning('Contact Enrichment', `Lusha API notice: ${err.message}`);
    return null;
  }
}

/**
 * Normalizes Lusha Person API response
 */
function normalizeLushaResponse(data, identity, defaultConfidence, logger) {
  if (!data || typeof data !== 'object' || data.errors) {
    return null;
  }

  const result = { email: null, phone: null, profile: null, emails: [], phones: [] };

  // 1. Parse Emails
  const rawEmails = Array.isArray(data.emailAddresses) ? data.emailAddresses : [];
  for (const emailObj of rawEmails) {
    const emailVal = typeof emailObj === 'string' ? emailObj : emailObj?.email;
    if (emailVal && emailVal.includes('@')) {
      const parsedEmail = {
        value: emailVal.toLowerCase().trim(),
        type: emailObj.type ? `Verified (${emailObj.type})` : 'Verified Work Email',
        source: 'Lusha API',
        sourceType: 'Lusha Enrichment API',
        confidence: defaultConfidence || 0.90,
        attribution: ATTRIBUTION.ENRICHMENT_API,
        timestamp: new Date().toISOString(),
      };
      if (!result.email) result.email = parsedEmail;
      result.emails.push(parsedEmail);
    }
  }

  // 2. Parse Phone Numbers
  const rawPhones = Array.isArray(data.phoneNumbers) ? data.phoneNumbers : [];
  for (const phoneObj of rawPhones) {
    const phoneVal = typeof phoneObj === 'string' ? phoneObj : (phoneObj?.number || phoneObj?.internationalNumber);
    if (phoneVal && phoneVal.trim().length >= 8) {
      const parsedPhone = {
        value: phoneVal.trim(),
        type: phoneObj.type ? `Direct Mobile (${phoneObj.type})` : 'Direct Mobile',
        source: 'Lusha API',
        sourceType: 'Lusha Enrichment API',
        confidence: defaultConfidence || 0.90,
        attribution: ATTRIBUTION.ENRICHMENT_API,
        timestamp: new Date().toISOString(),
      };
      if (!result.phone) result.phone = parsedPhone;
      result.phones.push(parsedPhone);
    }
  }

  // 3. Parse Person Profile Metadata
  if (data.jobTitle || data.company || data.location) {
    result.profile = {
      name: data.fullName || [data.firstName, data.lastName].filter(Boolean).join(' ') || identity.normalized.fullName,
      title: data.jobTitle || null,
      company: data.company?.name || identity.company.normalized,
      location: data.location?.country || null,
      source: 'Lusha API',
      confidence: defaultConfidence || 0.90,
      timestamp: new Date().toISOString(),
    };
  }

  if (result.emails.length > 0 || result.phones.length > 0 || result.profile) {
    logger?.success('Contact Enrichment', `Lusha API: Found ${result.emails.length} email(s), ${result.phones.length} phone(s)`);
    return result;
  }

  return null;
}
