// Dedicated High-Precision Executive Mobile Extractor Module
// Formats, validates, filters landlines/toll-frees, and cross-references mobile numbers for HNIs & Directors

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { CONFIDENCE, ATTRIBUTION, computeFinalConfidence, boostConfidence } from '../utils/confidence.js';

// Strict Indian Mobile Number Regex (10 digits starting with 6, 7, 8, 9)
const INDIAN_MOBILE_REGEX = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}|(?:\+91[\s-]?)?[6-9]\d{9}/g;

// Landline prefixes in India to strictly filter out
const LANDLINE_STD_PREFIXES = [
  '022', '011', '080', '044', '033', '020', '079', '040', '0172', '0120', '0124', '0265', '0731', '0141'
];

// Toll-free & service prefixes to strictly filter out
const TOLL_FREE_PREFIXES = ['1800', '1860', '18000', '18001', '18002', '18003', '18004', '18005', '18602'];

/**
 * Validates whether a raw string represents a clean, reachable 10-digit Indian Mobile Number
 */
export function isValidExecutiveMobile(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return false;

  const digits = rawPhone.replace(/\D/g, '');

  // Must be 10 digits (national) or 12 digits (with 91 country code)
  let nationalDigits = digits;
  if (digits.length === 12 && digits.startsWith('91')) {
    nationalDigits = digits.substring(2);
  }

  if (nationalDigits.length !== 10) return false;

  // Must start with 6, 7, 8, or 9
  const firstChar = nationalDigits.charAt(0);
  if (!['6', '7', '8', '9'].includes(firstChar)) return false;

  // Filter out repeating fake numbers (e.g. 9999999999, 8888888888, 1234567890)
  if (/^(\d)\1{9}$/.test(nationalDigits)) return false;
  if (nationalDigits === '1234567890' || nationalDigits === '9876543210') return false;

  // Filter out toll-free and landline STD prefix patterns
  for (const tf of TOLL_FREE_PREFIXES) {
    if (rawPhone.includes(tf) || nationalDigits.startsWith(tf)) return false;
  }

  for (const std of LANDLINE_STD_PREFIXES) {
    if (rawPhone.startsWith(std) || rawPhone.startsWith(`+91${std}`)) return false;
  }

  // libphonenumber-js validation
  try {
    const phoneNumber = parsePhoneNumberFromString(rawPhone, 'IN');
    if (phoneNumber) {
      const type = phoneNumber.getType();
      // Reject fixed line landlines
      if (type === 'FIXED_LINE' || type === 'TOLL_FREE' || type === 'PREMIUM_RATE') {
        return false;
      }
    }
  } catch (e) {}

  return true;
}

/**
 * Formats phone number to clean national / international format (+91 98201 12345)
 */
export function formatExecutiveMobile(rawPhone) {
  const digits = rawPhone.replace(/\D/g, '');
  let national = digits;
  if (digits.length === 12 && digits.startsWith('91')) {
    national = digits.substring(2);
  }
  if (national.length === 10) {
    return `+91 ${national.substring(0, 5)} ${national.substring(5)}`;
  }
  return rawPhone.trim();
}

/**
 * Extracts and attributes mobile numbers from document or web text proximate to target name/DIN
 */
export function extractExecutiveMobilesFromText(text, identity, sourceName, sourceWeight = CONFIDENCE.PUBLIC_DIRECTORY) {
  if (!text || typeof text !== 'string') return [];

  const textLower = text.toLowerCase();
  const nameVariants = (identity?.searchVariants || [identity?.normalized?.fullName || '']).map(v => v.toLowerCase());
  const companyWords = (identity?.company?.coreWords || []).map(w => w.toLowerCase());

  const matches = text.match(INDIAN_MOBILE_REGEX) || [];
  const extracted = [];
  const seen = new Set();

  for (const match of matches) {
    if (!isValidExecutiveMobile(match)) continue;

    const formatted = formatExecutiveMobile(match);
    const cleanDigits = formatted.replace(/\D/g, '');
    if (seen.has(cleanDigits)) continue;
    seen.add(cleanDigits);

    // Calculate proximity attribution score
    const pos = text.indexOf(match);
    const startIdx = Math.max(0, pos - 250);
    const endIdx = Math.min(text.length, pos + match.length + 250);
    const contextSnippet = textLower.substring(startIdx, endIdx);

    const hasNameMatch = nameVariants.some(name => name.length >= 3 && contextSnippet.includes(name));
    const hasCompanyMatch = companyWords.some(word => word.length >= 3 && contextSnippet.includes(word));
    const hasDirectorKeyword = /(?:director|din|promoter|partner|kmp|managing|ceo)/i.test(contextSnippet);

    let attribution = ATTRIBUTION.UNATTRIBUTED;
    if (hasNameMatch) {
      attribution = ATTRIBUTION.PROXIMATE;
    } else if (hasCompanyMatch && hasDirectorKeyword) {
      attribution = ATTRIBUTION.SAME_PAGE;
    }

    const finalConfidence = computeFinalConfidence(sourceWeight, attribution);

    extracted.push({
      value: formatted,
      raw: match,
      type: 'Direct Mobile',
      source: sourceName,
      sourceType: sourceName,
      confidence: finalConfidence,
      attribution,
      personMentioned: hasNameMatch,
      timestamp: new Date().toISOString(),
    });
  }

  return extracted;
}

/**
 * Cross-references mobile numbers across all sources, deduplicates, and applies multi-source confidence boosting
 */
export function processAndBoostExecutiveMobiles(phoneList) {
  if (!Array.isArray(phoneList) || phoneList.length === 0) return [];

  const phoneMap = new Map();

  for (const phone of phoneList) {
    if (!phone || !phone.value) continue;
    if (!isValidExecutiveMobile(phone.value)) continue;

    const formatted = formatExecutiveMobile(phone.value);
    const key = formatted.replace(/\D/g, '').slice(-10); // match by 10-digit national number

    if (!phoneMap.has(key)) {
      phoneMap.set(key, {
        value: formatted,
        type: phone.type || 'Direct Mobile',
        sources: [phone.source || 'Unknown Source'],
        confidence: phone.confidence || 0.70,
        attribution: phone.attribution || ATTRIBUTION.UNATTRIBUTED,
        timestamp: phone.timestamp || new Date().toISOString(),
        matchCount: 1,
      });
    } else {
      const existing = phoneMap.get(key);
      if (!existing.sources.includes(phone.source)) {
        existing.sources.push(phone.source || 'Unknown Source');
        existing.matchCount += 1;
      }
      // Keep highest confidence and attribution
      if (phone.confidence > existing.confidence) {
        existing.confidence = phone.confidence;
      }
      if ((phone.attribution || 0) > (existing.attribution || 0)) {
        existing.attribution = phone.attribution;
      }
    }
  }

  // Apply multi-source cross-reference boost (e.g. MCA PDF + Lusha API = 0.98)
  const results = [];
  for (const phone of phoneMap.values()) {
    if (phone.matchCount > 1) {
      phone.confidence = boostConfidence(phone.confidence, phone.matchCount);
      phone.source = `${phone.sources.join(' + ')} (Multi-Source Verified)`;
    } else {
      phone.source = phone.sources[0];
    }
    phone.confidence = Math.min(0.99, Math.round(phone.confidence * 100) / 100);
    results.push(phone);
  }

  // Sort by confidence descending
  return results.sort((a, b) => b.confidence - a.confidence);
}
