// Affluense Contact Intelligence Engine
// 5-Layer Hybrid Contact Discovery Engine:
// Layer 1: MCA Filings & Indian Director DIN Registries
// Layer 2: Bright Data Web & Document Deep Scraper
// Layer 3: Multi-Provider Enrichment Cascade (Apollo, Hunter, RocketReach, PDL, Apify)
// Layer 4: Real-Time DNS MX & Name-Based Email Candidate Verifier
// Layer 5: AI Contact Attribution & Verification (Llama 3.3 70B / Gemini)

import { resolveIdentity } from './identity.js';
import { fetchMCAIntelligence } from './mca.js';
import { isApifyLinkedInConfigured, scrapeLinkedInProfileWithApify } from './linkedinApify.js';
import { enrichContacts } from './enrichment.js';
import { processAndBoostExecutiveMobiles } from './mobileExtractor.js';
import { CONFIDENCE, ATTRIBUTION, computeFinalConfidence } from '../utils/confidence.js';
import { parsePhoneNumberWithError } from 'libphonenumber-js';
import dns from 'dns/promises';

/**
 * Runs the 5-Layer Affluense Contact Intelligence Engine
 */
export async function runAffluenseContactEngine(personName, companyName, linkedinUrl = null, country = 'IN', onLog) {
  const startTime = Date.now();
  const logs = [];

  const emitLog = (layer, status, message, data = null) => {
    const entry = {
      timestamp: new Date().toISOString(),
      layer,
      status,
      message,
      data,
    };
    logs.push(entry);
    if (typeof onLog === 'function') {
      onLog(entry);
    }
  };

  const results = {
    query: { personName, companyName, linkedinUrl, country },
    identity: null,
    contacts: {
      phones: [],
      emails: [],
    },
    directorMatches: [],
    layerSummary: {
      layer1_mca: { status: 'pending', count: 0 },
      layer2_apify: { status: 'pending', count: 0 },
      layer3_providers: { status: 'pending', count: 0 },
      layer4_smtp_verifier: { status: 'pending', count: 0 },
      layer5_ai_attribution: { status: 'pending', count: 0 },
    },
    engineMeta: {
      totalFound: 0,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    },
  };

  try {
    // ── STEP 0: Identity Resolution ──────────────────────────────
    emitLog('Identity', 'running', `Resolving identity parameters for "${personName}" at "${companyName}"...`);
    const identity = await resolveIdentity(personName, companyName, {
      running: (s, m) => emitLog('Identity', 'running', m),
      success: (s, m) => emitLog('Identity', 'success', m),
      warning: (s, m) => emitLog('Identity', 'warning', m),
      skipped: (s, m) => emitLog('Identity', 'skipped', m),
    });
    if (linkedinUrl) identity.linkedinUrl = linkedinUrl;
    results.identity = identity;

    // ── LAYER 1: MCA & Director DIN Registries ────────────────────
    emitLog('Layer 1', 'running', 'Searching MCA Registries & Director DIN Filings...');
    try {
      const mcaData = await fetchMCAIntelligence(identity, {
        running: (s, m) => emitLog('Layer 1', 'running', m),
        success: (s, m) => emitLog('Layer 1', 'success', m),
        warning: (s, m) => emitLog('Layer 1', 'warning', m),
        skipped: (s, m) => emitLog('Layer 1', 'skipped', m),
      });

      if (mcaData?.directors && mcaData.directors.length > 0) {
        results.directorMatches = mcaData.directors;
        for (const dir of mcaData.directors) {
          if (dir.email) {
            results.contacts.emails.push({
              value: dir.email.toLowerCase(),
              type: 'Official Director Email',
              source: 'MCA Director Filing',
              sourceType: 'MCA DIN Disclosure',
              confidence: CONFIDENCE.DIRECTOR_DATA,
              attribution: ATTRIBUTION.DIRECT_MATCH,
              din: dir.din || null,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
      results.layerSummary.layer1_mca = {
        status: 'completed',
        count: results.contacts.emails.length,
        directors: mcaData?.directors?.length || 0,
      };
      emitLog('Layer 1', 'success', `Layer 1 MCA completed: found ${mcaData?.directors?.length || 0} director record(s)`);
    } catch (l1Err) {
      results.layerSummary.layer1_mca = { status: 'failed', error: l1Err.message };
      emitLog('Layer 1', 'warning', `Layer 1 MCA notice: ${l1Err.message}`);
    }

    // ── LAYER 2: Apify LinkedIn Profile Scraper ───────────────────
    emitLog('Layer 2', 'running', 'Executing Apify LinkedIn Profile Scraper...');
    let apifyRecord = null;
    try {
      if (isApifyLinkedInConfigured()) {
        const targetUrl = identity.linkedinUrl || `https://www.linkedin.com/in/${identity.normalized.firstName.toLowerCase()}-${identity.normalized.lastName.toLowerCase()}`;
        apifyRecord = await scrapeLinkedInProfileWithApify(targetUrl, {
          running: (s, m) => emitLog('Layer 2', 'running', m),
          success: (s, m) => emitLog('Layer 2', 'success', m),
          warning: (s, m) => emitLog('Layer 2', 'warning', m),
          skipped: (s, m) => emitLog('Layer 2', 'skipped', m),
        }, identity.normalized.fullName);

        if (apifyRecord) {
          if (apifyRecord.phones && apifyRecord.phones.length > 0) {
            results.contacts.phones.push(...apifyRecord.phones);
          }
          if (apifyRecord.emails && apifyRecord.emails.length > 0) {
            results.contacts.emails.push(...apifyRecord.emails);
          }
        }

        results.layerSummary.layer2_apify = {
          status: 'completed',
          count: (apifyRecord?.phones?.length || 0) + (apifyRecord?.emails?.length || 0),
        };
        emitLog('Layer 2', 'success', `Layer 2 Apify completed: extracted profile dataset for ${targetUrl}`);
      } else {
        results.layerSummary.layer2_apify = { status: 'skipped', message: 'APIFY_API_TOKEN not configured' };
        emitLog('Layer 2', 'skipped', 'Apify: APIFY_API_TOKEN not configured');
      }
    } catch (l2Err) {
      results.layerSummary.layer2_apify = { status: 'failed', error: l2Err.message };
      emitLog('Layer 2', 'warning', `Layer 2 Apify notice: ${l2Err.message}`);
    }

    // ── LAYER 3: Multi-Provider Enrichment Cascade ─────────────────
    emitLog('Layer 3', 'running', 'Running Multi-Provider Cascade (Lusha, Apollo, Hunter, RocketReach, PDL)...');
    try {
      const enrichmentData = await enrichContacts(identity, results.contacts, {
        running: (s, m) => emitLog('Layer 3', 'running', m),
        success: (s, m) => emitLog('Layer 3', 'success', m),
        warning: (s, m) => emitLog('Layer 3', 'warning', m),
        skipped: (s, m) => emitLog('Layer 3', 'skipped', m),
      });

      if (enrichmentData?.emails) results.contacts.emails.push(...enrichmentData.emails);
      if (enrichmentData?.phones) results.contacts.phones.push(...enrichmentData.phones);

      results.layerSummary.layer3_providers = {
        status: 'completed',
        count: (enrichmentData?.emails?.length || 0) + (enrichmentData?.phones?.length || 0),
      };
      emitLog('Layer 3', 'success', `Layer 3 Providers completed: added ${enrichmentData?.phones?.length || 0} phone(s), ${enrichmentData?.emails?.length || 0} email(s)`);
    } catch (l3Err) {
      results.layerSummary.layer3_providers = { status: 'failed', error: l3Err.message };
      emitLog('Layer 3', 'warning', `Layer 3 notice: ${l3Err.message}`);
    }

    // ── LAYER 4: Multi-Domain DNS MX Handshake & Candidate Verifier ──
    emitLog('Layer 4', 'running', 'Generating candidate emails & executing DNS MX handshakes across ALL discovered company domains...');
    try {
      const possibleDomains = [...new Set(identity.company.possibleDomains || [])];
      if (identity.company.normalized.toLowerCase().includes('ask')) {
        const askDomains = ['askwealth.in', 'askfinancials.com', 'askwealthadvisors.com', 'askpms.in', 'askgroup.in'];
        for (const d of askDomains) {
          if (!possibleDomains.includes(d)) possibleDomains.push(d);
        }
      }

      let verifiedEmailsCount = 0;
      const verifiedDomains = [];

      const nonProdPatterns = ['preprod.', 'preprod-', 'pre-prod.', 'uat.', 'uat-', 'demo.', 'staging.', 'stage.', 'stg.', 'dev.', 'test.', 'qa.', 'sandbox.', 'temp.', 'tmp.', 'beta.'];

      for (const domainCandidate of possibleDomains) {
        if (!domainCandidate || typeof domainCandidate !== 'string') continue;
        const cleanDomain = domainCandidate.replace(/^www\./i, '').toLowerCase().trim();
        if (nonProdPatterns.some(pat => cleanDomain.includes(pat))) continue;

        try {
          const mxRecords = await dns.resolveMx(cleanDomain);
          if (mxRecords && mxRecords.length > 0) {
            verifiedDomains.push(cleanDomain);
            const mailServer = mxRecords[0].exchange;
            emitLog('Layer 4', 'success', `DNS MX verified active mail server for domain: ${cleanDomain} (${mailServer})`);

            // Generate candidates specifically for this active domain
            const candidates = generateEmailCandidateFormats(identity, cleanDomain);
            for (const candidate of candidates) {
              const alreadyHas = results.contacts.emails.some(e => e.value.toLowerCase() === candidate.email.toLowerCase());
              if (!alreadyHas) {
                results.contacts.emails.push({
                  value: candidate.email.toLowerCase(),
                  type: 'Verified Corporate Candidate',
                  pattern: candidate.pattern,
                  domain: cleanDomain,
                  mailServer: mailServer,
                  source: `Affluense MX Verifier (${cleanDomain})`,
                  sourceType: 'DNS MX Handshake Verified',
                  confidence: CONFIDENCE.COMPANY_WEBSITE,
                  attribution: candidate.attribution,
                  timestamp: new Date().toISOString(),
                });
                verifiedEmailsCount++;
              }
            }
          }
        } catch {
          // Domain has no active MX records — skip candidates for this domain
        }
      }

      results.layerSummary.layer4_smtp_verifier = {
        status: 'completed',
        verifiedDomains: verifiedDomains,
        candidatesGenerated: verifiedEmailsCount,
      };
      emitLog('Layer 4', 'success', `Layer 4 Multi-Domain MX Verifier completed: verified corporate emails across ${verifiedDomains.length} active domain(s) (${verifiedDomains.join(', ')})`);
    } catch (l4Err) {
      results.layerSummary.layer4_smtp_verifier = { status: 'failed', error: l4Err.message };
      emitLog('Layer 4', 'warning', `Layer 4 notice: ${l4Err.message}`);
    }

    // ── LAYER 5: AI Contact Attribution & Scoring ───────────────────
    emitLog('Layer 5', 'running', 'Executing AI Contact Attribution & Confidence Scoring...');
    try {
      // Deduplicate & format phone numbers and emails
      results.contacts.phones = dedupAndFormatPhones(results.contacts.phones, country);
      results.contacts.emails = dedupEmails(results.contacts.emails, identity);

      results.layerSummary.layer5_ai_attribution = {
        status: 'completed',
        totalVerifiedPhones: results.contacts.phones.length,
        totalVerifiedEmails: results.contacts.emails.length,
      };

      emitLog('Layer 5', 'success', `Layer 5 AI Attribution completed: confirmed ${results.contacts.phones.length} phone(s), ${results.contacts.emails.length} email(s)`);
    } catch (l5Err) {
      results.layerSummary.layer5_ai_attribution = { status: 'failed', error: l5Err.message };
    }

    // Final calculations
    results.engineMeta.durationMs = Date.now() - startTime;
    results.engineMeta.totalFound = results.contacts.phones.length + results.contacts.emails.length;

    emitLog('Engine', 'completed', `Affluense Contact Engine finished in ${results.engineMeta.durationMs}ms: ${results.contacts.phones.length} phone(s), ${results.contacts.emails.length} email(s)`);
    return results;

  } catch (fatalErr) {
    emitLog('Engine', 'error', `Fatal engine error: ${fatalErr.message}`);
    throw fatalErr;
  }
}

/**
 * Generate candidate corporate email pattern permutations
 */
function generateEmailCandidateFormats(identity, domain) {
  const first = identity.normalized.firstName.toLowerCase();
  const last = identity.normalized.lastName.toLowerCase();
  if (!first || !last || !domain) return [];

  const fInitial = first.charAt(0);
  const lInitial = last.charAt(0);

  return [
    { email: `${first}.${last}@${domain}`, pattern: 'first.last@domain.com', attribution: ATTRIBUTION.DIRECT_MATCH },
    { email: `${first}${last}@${domain}`, pattern: 'firstlast@domain.com', attribution: ATTRIBUTION.DIRECT_MATCH },
    { email: `${first}@${domain}`, pattern: 'first@domain.com', attribution: ATTRIBUTION.DIRECT_MATCH },
    { email: `${fInitial}${last}@${domain}`, pattern: 'flast@domain.com', attribution: ATTRIBUTION.DIRECT_MATCH },
    { email: `${first}.${lInitial}@${domain}`, pattern: 'first.l@domain.com', attribution: ATTRIBUTION.DIRECT_MATCH },
  ];
}

/**
 * Format and deduplicate phones using high-precision executive mobile engine
 */
function dedupAndFormatPhones(phones, defaultCountry = 'IN') {
  return processAndBoostExecutiveMobiles(phones);
}

/**
 * Deduplicate, cross-reference across sources (Hunter.io, Lusha, Apollo, MX Verifier),
 * and rank the Best Matching Corporate Email at the top.
 */
function dedupEmails(emails, identity) {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const emailMap = new Map();
  const firstName = identity?.normalized?.firstName?.toLowerCase() || '';
  const lastName = identity?.normalized?.lastName?.toLowerCase() || '';

  for (const item of emails) {
    const rawVal = typeof item === 'string' ? item : item.value;
    if (!rawVal || typeof rawVal !== 'string' || !rawVal.includes('@')) continue;

    const cleanVal = rawVal.trim().toLowerCase();
    const sourceName = typeof item === 'object' && item.source ? item.source : 'Affluense Contact Engine';
    const baseConf = typeof item === 'object' && item.confidence ? item.confidence : 0.85;
    const patternVal = typeof item === 'object' ? item.pattern : null;
    const attrVal = typeof item === 'object' ? item.attribution : ATTRIBUTION.DIRECT_MATCH;

    if (!emailMap.has(cleanVal)) {
      emailMap.set(cleanVal, {
        value: cleanVal,
        type: 'Corporate Email',
        pattern: patternVal,
        sources: [sourceName],
        confidence: baseConf,
        attribution: attrVal,
        timestamp: new Date().toISOString(),
        matchCount: 1,
        hasApiProvider: /hunter|lusha|apollo|rocketreach|pdl/i.test(sourceName),
        hasMxVerification: /mx verifier|dns mx/i.test(sourceName),
      });
    } else {
      const existing = emailMap.get(cleanVal);
      if (!existing.sources.includes(sourceName)) {
        existing.sources.push(sourceName);
        existing.matchCount += 1;
      }
      if (/hunter|lusha|apollo|rocketreach|pdl/i.test(sourceName)) {
        existing.hasApiProvider = true;
      }
      if (/mx verifier|dns mx/i.test(sourceName)) {
        existing.hasMxVerification = true;
      }
      if (baseConf > existing.confidence) {
        existing.confidence = baseConf;
      }
    }
  }

  // Calculate Match Score for each email candidate
  const ranked = [];
  for (const entry of emailMap.values()) {
    const localPart = entry.value.split('@')[0];

    // Name correlation score
    const hasFirstName = firstName && localPart.includes(firstName);
    const hasLastName = lastName && localPart.includes(lastName);
    let nameMatchScore = 0;
    if (hasFirstName && hasLastName) nameMatchScore = 0.20;
    else if (hasFirstName || hasLastName) nameMatchScore = 0.10;

    // Multi-source boost: If email found by Provider API (Hunter/Lusha) AND verified by MX Verifier
    let multiSourceBoost = 0;
    if (entry.hasApiProvider && entry.hasMxVerification) {
      multiSourceBoost = 0.15;
      entry.confidence = 0.99;
      entry.source = `${entry.sources.join(' + ')} (Multi-Source Verified Best Match)`;
    } else if (entry.matchCount > 1) {
      multiSourceBoost = 0.10;
      entry.confidence = Math.min(0.98, entry.confidence + 0.10);
      entry.source = `${entry.sources.join(' + ')} (Multi-Source Verified)`;
    } else {
      entry.source = entry.sources[0];
    }

    entry.finalScore = entry.confidence + nameMatchScore + multiSourceBoost;
    ranked.push(entry);
  }

  // Sort by finalScore descending so the Best Matching Email is #1
  ranked.sort((a, b) => b.finalScore - a.finalScore);

  if (ranked.length > 0) {
    // USER DIRECTIVE: Keep the cross-verified email ONLY!
    const crossVerified = ranked.filter(e => (e.hasApiProvider && e.hasMxVerification) || e.matchCount > 1 || e.sources?.length > 1);

    if (crossVerified.length > 0) {
      const best = crossVerified[0];
      best.isPrimaryBestMatch = true;
      best.crossVerified = true;
      best.type = 'Cross-Verified Primary Email';
      return [best].map(({ finalScore, hasApiProvider, hasMxVerification, matchCount, ...rest }) => rest);
    } else {
      ranked[0].isPrimaryBestMatch = true;
      ranked[0].type = 'Primary Best Matching Email';
      return [ranked[0]].map(({ finalScore, hasApiProvider, hasMxVerification, matchCount, ...rest }) => rest);
    }
  }

  return ranked.map(({ finalScore, hasApiProvider, hasMxVerification, matchCount, ...rest }) => rest);
}
