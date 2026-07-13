// Validation Engine Module
// Real phone validation (libphonenumber-js) + real email validation (DNS MX)
// Per VALIDATION_ENGINE.md

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { promises as dns } from 'dns';
import { CONFIDENCE, ATTRIBUTION, computeFinalConfidence, boostConfidence, meetsThreshold } from '../utils/confidence.js';

export async function validateContacts(allContacts, identity, logger) {
  const start = Date.now();
  logger.running('Validation', 'Validating and cross-referencing all contacts');

  const validated = {
    phones: [],
    emails: [],
    roles: [],
  };

  // ── Phone Validation ──────────────────────────────────────

  const rawPhones = collectPhones(allContacts);
  const phoneMap = new Map(); // For cross-source dedup

  for (const phone of rawPhones) {
    const validationResult = validatePhone(phone.value);

    if (validationResult.valid) {
      const e164 = validationResult.e164;

      if (phoneMap.has(e164)) {
        // Cross-source match — boost confidence
        const existing = phoneMap.get(e164);
        existing.sources.push(phone.source);
        existing.confidence = boostConfidence(existing.confidence, existing.sources.length);
        existing.crossVerified = true;
      } else {
        phoneMap.set(e164, {
          value: e164,
          formatted: validationResult.formatted,
          country: validationResult.country,
          type: validationResult.type,
          sources: [phone.source],
          sourceType: phone.sourceType,
          confidence: phone.confidence,
          crossVerified: false,
          validationStatus: 'Format Valid',
          timestamp: phone.timestamp,
        });
      }
    }
  }

  // Filter by threshold and add to results
  for (const [_, phone] of phoneMap) {
    if (meetsThreshold(phone.confidence)) {
      // If it comes from web scraping, it must be proximate, AI-attributed, or cross-verified
      const isWebScraped = phone.sourceType === 'Company Website' || phone.sourceType === 'Web Search';
      if (isWebScraped && !phone.crossVerified) {
        const attribution = phone.attribution || 0;
        if (attribution < ATTRIBUTION.PROXIMATE) {
          continue; // Skip unattributed web contacts
        }
      }
      validated.phones.push(phone);
    }
  }

  // ── Email Validation ──────────────────────────────────────

  const rawEmails = collectEmails(allContacts);
  const emailMap = new Map();

  for (const email of rawEmails) {
    const validationResult = await validateEmail(email.value, identity);

    if (validationResult.valid) {
      const normalizedEmail = email.value.toLowerCase().trim();

      if (emailMap.has(normalizedEmail)) {
        const existing = emailMap.get(normalizedEmail);
        existing.sources.push(email.source);
        existing.confidence = boostConfidence(existing.confidence, existing.sources.length);
        existing.crossVerified = true;
      } else {
        // Adjust confidence based on domain match and name-email correlation
        let confidence = email.confidence;
        if (validationResult.companyDomainMatch) {
          confidence = Math.max(confidence, CONFIDENCE.COMPANY_WEBSITE);
        } else if (validationResult.isPersonalDomain) {
          confidence = Math.min(confidence, 0.75); // Lower confidence for personal emails
        }

        // Name-email correlation: boost or penalize based on whether the email contains the person's name
        const nameCorrelation = checkNameEmailCorrelation(normalizedEmail, identity);
        const incomingAttribution = email.attribution || ATTRIBUTION.SAME_PAGE;

        if (nameCorrelation === 'match') {
          // Email contains the target person's name — high attribution
          confidence = computeFinalConfidence(
            Math.max(confidence, CONFIDENCE.COMPANY_WEBSITE),
            ATTRIBUTION.DIRECT_MATCH
          );
        } else if (nameCorrelation === 'mismatch') {
          // Email contains a DIFFERENT person's name — penalize heavily
          confidence = computeFinalConfidence(confidence, ATTRIBUTION.UNATTRIBUTED);
        } else if (nameCorrelation === 'generic') {
          // Generic email (info@, contact@) — penalize moderately
          confidence = computeFinalConfidence(confidence, ATTRIBUTION.SAME_PAGE);
        }
        // If 'neutral', keep the existing confidence as-is

        emailMap.set(normalizedEmail, {
          value: normalizedEmail,
          domain: validationResult.domain,
          mxValid: validationResult.mxValid,
          companyDomainMatch: validationResult.companyDomainMatch,
          nameCorrelation,
          sources: [email.source],
          sourceType: email.sourceType,
          confidence,
          crossVerified: false,
          validationStatus: validationResult.mxValid ? 'MX Verified' : 'Format Valid',
          timestamp: email.timestamp,
        });
      }
    }
  }

  for (const [_, email] of emailMap) {
    if (meetsThreshold(email.confidence)) {
      // Discard generic emails or mismatched name emails
      if (email.nameCorrelation === 'mismatch' || email.nameCorrelation === 'generic') {
        continue;
      }
      validated.emails.push(email);
    }
  }



  // ── Role Dedup ────────────────────────────────────────────

  const roleSet = new Set();
  const rawRoles = collectRoles(allContacts);
  for (const role of rawRoles) {
    const normalized = role.value.trim();
    if (!roleSet.has(normalized.toLowerCase())) {
      roleSet.add(normalized.toLowerCase());
      validated.roles.push(role);
    }
  }

  // ── Sort by confidence ────────────────────────────────────

  validated.phones.sort((a, b) => b.confidence - a.confidence);
  validated.emails.sort((a, b) => b.confidence - a.confidence);

  const duration = Date.now() - start;
  const hiddenCount = (rawPhones.length - validated.phones.length) + (rawEmails.length - validated.emails.length);

  logger.success('Validation',
    `Validated: ${validated.phones.length} phone(s), ${validated.emails.length} email(s) — ${hiddenCount} hidden (below threshold)`,
    { durationMs: duration }
  );

  return validated;
}



// ─── Phone Validation (libphonenumber-js) ────────────────────

function validatePhone(raw) {
  try {
    // Try parsing with India as default country
    let phoneNumber = parsePhoneNumberFromString(raw, 'IN');

    if (!phoneNumber) {
      // Try with + prefix
      phoneNumber = parsePhoneNumberFromString(`+${raw}`, 'IN');
    }

    if (!phoneNumber || !phoneNumber.isValid()) {
      return { valid: false };
    }

    return {
      valid: true,
      e164: phoneNumber.format('E.164'),
      formatted: phoneNumber.formatInternational(),
      country: phoneNumber.country,
      type: phoneNumber.getType() || 'UNKNOWN',
    };
  } catch {
    return { valid: false };
  }
}

// ─── Email Validation (Syntax + DNS MX) ──────────────────────

async function validateEmail(email, identity) {
  const emailLower = email.toLowerCase().trim();

  // Syntax check
  const syntaxValid = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(emailLower);
  if (!syntaxValid) return { valid: false };

  const domain = emailLower.split('@')[1];
  const personalDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'rediffmail.com', 'aol.com', 'protonmail.com'];
  const isPersonalDomain = personalDomains.includes(domain);

  // Check if domain matches company
  const companyDomainMatch = identity.company.possibleDomains.some(d =>
    domain === d || domain.endsWith(`.${d}`)
  );

  // DNS MX record lookup
  let mxValid = false;
  try {
    const mxRecords = await dns.resolveMx(domain);
    mxValid = mxRecords && mxRecords.length > 0;
  } catch {
    mxValid = false;
  }

  return {
    valid: true,
    domain,
    mxValid,
    companyDomainMatch,
    isPersonalDomain,
  };
}

// ─── Name-Email Correlation ──────────────────────────────────
// Checks whether an email's local part matches the target person's name,
// a different person's name, or is a generic/neutral address.

function checkNameEmailCorrelation(email, identity) {
  const localPart = email.split('@')[0].toLowerCase();
  const firstName = identity.normalized.firstName.toLowerCase();
  const lastName = identity.normalized.lastName.toLowerCase();

  // Generic email prefixes — these aren't anyone's personal email
  const genericPrefixes = [
    'info', 'admin', 'contact', 'support', 'hr', 'help', 'sales', 'office',
    'hello', 'team', 'careers', 'noreply', 'no-reply', 'webmaster', 'mail',
    'enquiry', 'enquiries', 'feedback', 'service', 'billing', 'accounts',
  ];

  if (genericPrefixes.includes(localPart) || genericPrefixes.some(p => localPart.startsWith(p + '.'))) {
    return 'generic';
  }

  // Check if email contains target person's name
  const hasFirstName = firstName.length >= 3 && localPart.includes(firstName);
  const hasLastName = lastName.length >= 3 && localPart.includes(lastName);
  const hasInitialLastName = localPart.includes(`${firstName[0]}${lastName}`);
  const hasFirstDotLast = localPart.includes(`${firstName}.${lastName}`);
  const hasLastDotFirst = localPart.includes(`${lastName}.${firstName}`);

  if (hasFirstName || hasLastName || hasInitialLastName || hasFirstDotLast || hasLastDotFirst) {
    return 'match';
  }

  // Check if email contains a DIFFERENT person's name
  // Heuristic: if the local part has a name-like pattern (letters with dots/underscores)
  // and it does NOT match our target, flag as mismatch
  const looksLikePersonName = /^[a-z]+[._][a-z]+$/.test(localPart);
  if (looksLikePersonName) {
    return 'mismatch';
  }

  // If we can't determine, it's neutral
  return 'neutral';
}

// ─── Collectors ──────────────────────────────────────────────

function collectPhones(allContacts) {
  const phones = [];
  if (allContacts.publicSearch?.phones) phones.push(...allContacts.publicSearch.phones);
  if (allContacts.ocr?.contacts) {
    phones.push(...allContacts.ocr.contacts.filter(c => c.type === 'phone'));
  }
  if (allContacts.enrichment?.phones) phones.push(...allContacts.enrichment.phones);
  if (allContacts.mca?.company?.telephone) {
    phones.push({
      value: allContacts.mca.company.telephone,
      source: allContacts.mca.source || 'MCA Registry',
      sourceType: 'MCA Registry',
      confidence: CONFIDENCE.MCA_DATA || 0.95,
      timestamp: new Date().toISOString()
    });
  }
  return phones;
}

function collectEmails(allContacts) {
  const emails = [];
  if (allContacts.publicSearch?.emails) emails.push(...allContacts.publicSearch.emails);
  if (allContacts.ocr?.contacts) {
    emails.push(...allContacts.ocr.contacts.filter(c => c.type === 'email'));
  }
  if (allContacts.enrichment?.emails) emails.push(...allContacts.enrichment.emails);
  if (allContacts.mca?.company?.email) {
    emails.push({
      value: allContacts.mca.company.email,
      source: allContacts.mca.source || 'MCA Registry',
      sourceType: 'MCA Registry',
      confidence: CONFIDENCE.MCA_DATA || 0.95,
      timestamp: new Date().toISOString()
    });
  }
  return emails;
}

function collectRoles(allContacts) {
  const roles = [];
  if (allContacts.publicSearch?.roles) roles.push(...allContacts.publicSearch.roles);
  if (allContacts.ocr?.entities) {
    roles.push(...allContacts.ocr.entities.filter(e => e.type === 'role'));
  }
  if (allContacts.enrichment?.profiles) {
    for (const p of allContacts.enrichment.profiles) {
      if (p.title) {
        roles.push({
          value: p.title,
          source: p.source,
          sourceType: `Enrichment Provider (${p.source})`,
          confidence: p.confidence,
          timestamp: p.timestamp,
        });
      }
    }
  }
  return roles;
}
