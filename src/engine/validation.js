// Validation Engine Module
// Real phone validation (libphonenumber-js) + real email validation (DNS MX)
// Per VALIDATION_ENGINE.md

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { promises as dns } from 'dns';
import { CONFIDENCE, ATTRIBUTION, computeFinalConfidence, boostConfidence, meetsThreshold } from '../utils/confidence.js';
import { isValidExecutiveMobile, formatExecutiveMobile } from './mobileExtractor.js';

export async function validateContacts(allContacts, identity, logger) {
  const start = Date.now();
  logger.running('Validation', 'Validating and cross-referencing all contacts');

  const validated = {
    phones: [],
    emails: [],
    roles: [],
    uanNumbers: allContacts.publicSearch?.uanNumbers || [],
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
      // But enrichment API contacts (Apollo, Hunter, etc.) are already person-matched, so skip this check
      const isWebScraped = phone.sourceType === 'Company Website' || phone.sourceType === 'Web Search';
      const isEnrichment = phone.sourceType?.includes('Enrichment') || phone.sourceType?.includes('Apollo') || phone.sourceType?.includes('Hunter') || phone.sourceType?.includes('RocketReach') || phone.sourceType?.includes('PDL');
      if (isWebScraped && !phone.crossVerified && !isEnrichment) {
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

        // Flag generated / unconfirmed candidate emails or catch-all domain emails
        const isCandidate = email.sourceType === 'Search Verified Candidate' || email.source === 'Search Verification';
        const isCatchAll = validationResult.isCatchAll || isCandidate;
        let validationStatus = validationResult.mxValid ? 'MX Verified' : 'Format Valid';

        if (isCatchAll) {
          validationStatus = 'plausible guess, not confirmed';
          confidence = Math.min(confidence, 0.70); // Capped confidence for catch-all / unconfirmed candidates
        }

        emailMap.set(normalizedEmail, {
          value: normalizedEmail,
          domain: validationResult.domain,
          mxValid: validationResult.mxValid,
          companyDomainMatch: validationResult.companyDomainMatch,
          nameCorrelation,
          isCatchAll,
          sources: [email.source],
          sourceType: email.sourceType,
          confidence,
          crossVerified: false,
          validationStatus,
          timestamp: email.timestamp,
        });
      }
    }
  }

  for (const [_, email] of emailMap) {
    if (meetsThreshold(email.confidence)) {
      // Discard generic emails or mismatched name emails
      // But allow enrichment API results through since they're already person-matched
      const isEnrichment = email.sourceType?.includes('Enrichment') || email.sourceType?.includes('Apollo') || email.sourceType?.includes('Hunter') || email.sourceType?.includes('RocketReach') || email.sourceType?.includes('PDL');
      if ((email.nameCorrelation === 'mismatch' || email.nameCorrelation === 'generic') && !isEnrichment) {
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

  // ── Filter to strictly keep ONLY cross-verified email ────────────────────

  validated.phones.sort((a, b) => b.confidence - a.confidence);
  validated.emails.sort((a, b) => b.confidence - a.confidence);

  if (validated.emails.length > 0) {
    // Look for cross-verified emails (found across multiple sources or Hunter + MX Verifier)
    const crossVerified = validated.emails.filter(e => e.crossVerified || e.sources?.length > 1 || e.isPrimaryBestMatch || e.source?.includes('+'));
    
    if (crossVerified.length > 0) {
      const topCross = crossVerified[0];
      topCross.crossVerified = true;
      topCross.isPrimaryBestMatch = true;
      validated.emails = [topCross];
    } else {
      // Fallback: if no multi-source cross-verified email exists, return top verified email
      validated.emails = [validated.emails[0]];
    }
  }

  // ── Temporal Consistency Check (MCA vs LinkedIn) ─────────────
  const mcaDirectors = allContacts.mca?.directors || [];
  const linkedinExperience = allContacts.publicSearch?.experience || [];
  validated.temporalConsistency = checkTemporalConsistency(mcaDirectors, linkedinExperience);

  if (validated.temporalConsistency.discrepancies.length > 0) {
    logger.warning('Validation', `Temporal consistency notice: ${validated.temporalConsistency.discrepancies.length} date mismatch(es) / gap(s) flagged`);
  }

  const duration = Date.now() - start;
  const hiddenCount = (rawPhones.length - validated.phones.length) + (rawEmails.length - validated.emails.length);

  logger.success('Validation',
    `Validated: ${validated.phones.length} phone(s), ${validated.emails.length} email(s) — ${hiddenCount} hidden (below threshold)`,
    { durationMs: duration }
  );

  return validated;
}

/**
 * Cross-references Stage 2 MCA director appointment/cessation dates against Stage 3 LinkedIn timeline entries
 */
export function checkTemporalConsistency(mcaDirectors = [], linkedinExperience = []) {
  const report = {
    consistent: true,
    mcaRecordsCount: mcaDirectors.length,
    linkedinRecordsCount: linkedinExperience.length,
    discrepancies: [],
  };

  if (mcaDirectors.length === 0 || linkedinExperience.length === 0) {
    return report;
  }

  for (const dir of mcaDirectors) {
    const appDateStr = dir.appointmentDate || dir.appointment_date || '';
    const compName = dir.companyName || dir.company_name || dir.company || '';
    if (!compName) continue;

    const matchedLinkedIn = linkedinExperience.find(exp =>
      exp.company && (exp.company.toLowerCase().includes(compName.toLowerCase()) || compName.toLowerCase().includes(exp.company.toLowerCase()))
    );

    if (!matchedLinkedIn) {
      report.discrepancies.push({
        type: 'Missing LinkedIn Experience',
        company: compName,
        mcaAppointmentDate: appDateStr || 'N/A',
        details: `Official MCA directorship at "${compName}" not listed in LinkedIn timeline`,
      });
      report.consistent = false;
    } else {
      // Check date overlaps if appointment date exists
      const appYearMatch = appDateStr.match(/\b(19|20)\d{2}\b/);
      if (appYearMatch && matchedLinkedIn.duration) {
        const appYear = parseInt(appYearMatch[0], 10);
        const liYearMatch = matchedLinkedIn.duration.match(/\b(19|20)\d{2}\b/);
        if (liYearMatch) {
          const liStartYear = parseInt(liYearMatch[0], 10);
          if (Math.abs(appYear - liStartYear) > 2) {
            report.discrepancies.push({
              type: 'Date Mismatch',
              company: compName,
              mcaAppointmentYear: appYear,
              linkedInStartYear: liStartYear,
              details: `MCA directorship appointment (${appYear}) differs from LinkedIn start year (${liStartYear}) by > 2 years`,
            });
            report.consistent = false;
          }
        }
      }
    }
  }

  return report;
}



// ─── Phone Validation (libphonenumber-js) ────────────────────

function validatePhone(raw) {
  if (!isValidExecutiveMobile(raw)) {
    return { valid: false };
  }

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
  if (allContacts.candidateMxEmails) emails.push(...allContacts.candidateMxEmails);
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
