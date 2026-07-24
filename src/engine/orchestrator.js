// Pipeline Orchestrator
// Runs the 9-stage intelligence pipeline sequentially, streaming logs via callback

import { resolveIdentity } from './identity.js';
import { publicSearch } from './publicSearch.js';
import { processOCR } from './ocr.js';
import { fetchMCAIntelligence } from './mca.js';
import { enrichContacts } from './enrichment.js';
import { validateContacts } from './validation.js';
import { runComplianceChecks } from './compliance.js';
import { generateBriefing } from './briefing.js';
import { scrapeIGRProperties } from './igrScraper.js';
import { createLogger, STAGES } from '../utils/logger.js';

export async function runPipeline(personName, companyName, linkedinUrl, onLog) {
  const pipelineStart = Date.now();
  const logger = createLogger(onLog);

  const result = {
    query: { personName, companyName },
    identity: null,
    contacts: { phones: [], emails: [] },
    person: { roles: [], bios: [] },
    company: null,
    directors: [],
    briefing: null,
    socialLinks: [],
    compliance: null,
    realEstate: null,
    engineMeta: {
      stages: STAGES,
      totalStages: STAGES.length,
      startTime: new Date().toISOString(),
    },
  };

  try {
    // ── Stage 1: Identity Resolution ────────────────────────
    const identity = await resolveIdentity(personName, companyName, logger);
    result.identity = identity;

    // Attach user-provided LinkedIn URL to identity for downstream use
    if (linkedinUrl) {
      identity.linkedinUrl = linkedinUrl;
      logger.success('Identity Resolution', `LinkedIn URL provided: ${linkedinUrl}`);
    }

    // ── Stage 2: MCA Intelligence ───────────────────────────
    const mcaData = await fetchMCAIntelligence(identity, logger);
    result.company = mcaData.company;
    result.directors = mcaData.directors;

    // If official company name was found, enrich company search parameters with correct spellings
    if (mcaData?.company?.companyName) {
      const officialName = mcaData.company.companyName;
      identity.company.officialName = officialName;
      logger.success('Identity Resolution', `Enriching company identity with official registry name: "${officialName}"`);
      
      const noise = ['private', 'limited', 'llp', 'pvt', 'ltd', 'inc', 'corp', 'co', 'company', 'india', 'and', 'or', 'of', 'for', 'with', 'amp'];
      const rawWords = officialName
        .split(/\s+/)
        .map(w => w.replace(/[^a-z0-9]/gi, ''))
        .filter(w => w.length >= 2)
        .filter(w => !noise.includes(w.toLowerCase()));
      
      for (const word of rawWords) {
        const cleanWord = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        if (!identity.company.coreWords.includes(cleanWord)) {
          identity.company.coreWords.push(cleanWord);
        }
      }
      
      // Add hyphenated and joined variants of the official name
      if (rawWords.length >= 2) {
        const base = rawWords.join(' ');
        if (!identity.company.variants.includes(base)) {
          identity.company.variants.push(base);
        }
        
        // Full official name combinations
        const joinedFull = rawWords.join('').toLowerCase();
        const hyphenFull = rawWords.join('-').toLowerCase();
        identity.company.possibleDomains.unshift(`${joinedFull}.com`, `${hyphenFull}.com`);

        // First 2 words combinations (e.g. dalal-broacha.com)
        const firstTwo = rawWords.slice(0, 2);
        const joinedTwo = firstTwo.join('').toLowerCase();
        const hyphenTwo = firstTwo.join('-').toLowerCase();
        identity.company.possibleDomains.unshift(`${joinedTwo}.com`, `${joinedTwo}.in`, `${joinedTwo}.co.in`);
        identity.company.possibleDomains.unshift(`${hyphenTwo}.com`, `${hyphenTwo}.in`, `${hyphenTwo}.co.in`);

        // First 3 words combinations (e.g. dalal-broacha-stock.com)
        if (rawWords.length >= 3) {
          const firstThree = rawWords.slice(0, 3);
          const joinedThree = firstThree.join('').toLowerCase();
          const hyphenThree = firstThree.join('-').toLowerCase();
          identity.company.possibleDomains.unshift(`${joinedThree}.com`, `${hyphenThree}.com`);
        }
      }
    }

    // ── Stage 3: Public Search ──────────────────────────────
    const searchResults = await publicSearch(identity, logger);
    result.socialLinks = searchResults.socialLinks || [];

    if (searchResults.linkedinProfile && !identity.linkedinUrl) {
      identity.linkedinUrl = searchResults.linkedinProfile;
      logger.success('Identity Resolution', `LinkedIn URL discovered and verified: ${identity.linkedinUrl}`);
    }

    // ── Stage 4: OCR Processing ─────────────────────────────
    const ocrResults = await processOCR(searchResults.documentsFound, identity, logger);

    // ── Stage 5: Contact Enrichment ─────────────────────────
    const enrichmentResults = await enrichContacts(identity, searchResults, logger);

    // Collect all profiles for briefing
    const allProfiles = enrichmentResults.profiles || [];

    // ── Stage 6: Validation ─────────────────────────────────
    const allContacts = {
      publicSearch: searchResults,
      ocr: ocrResults,
      enrichment: enrichmentResults,
      mca: mcaData,
    };
    const validated = await validateContacts(allContacts, identity, logger);
    result.contacts = {
      phones: validated.phones,
      emails: validated.emails,
    };
    result.person.roles = validated.roles;
    result.person.bios = searchResults.bios || [];
    result.person.experience = searchResults.experience || [];
    result.person.education = searchResults.education || [];

    // Add enrichment profile data
    for (const profile of allProfiles) {
      if (profile.linkedin) {
        result.socialLinks.push({ platform: 'LinkedIn', url: profile.linkedin, source: profile.source });
      }
      if (profile.title && !result.person.roles.some(r => r.value === profile.title)) {
        result.person.roles.push({
          value: profile.title,
          source: profile.source,
          sourceType: `Enrichment Provider (${profile.source})`,
          confidence: profile.confidence,
          timestamp: profile.timestamp,
        });
      }
    }

    // ── Stage 7: Compliance ─────────────────────────────────
    const compliance = runComplianceChecks(validated, mcaData, logger);
    result.compliance = compliance;

    // ── Stage 8: AI Briefing ────────────────────────────────
    const briefing = await generateBriefing(identity, validated, mcaData, allProfiles, logger);
    result.briefing = briefing;

    // ── Stage 9: Real Estate Intelligence ───────────────────
    // Only run if identity has been resolved (person name confirmed)
    if (identity && identity.person) {
      const realEstateData = await scrapeIGRProperties(identity, logger);
      result.realEstate = realEstateData;
    } else {
      logger.skipped('Real Estate Intelligence', 'Identity not resolved — skipping IGR search');
    }

  } catch (err) {
    logger.error('Pipeline', `Fatal error: ${err.message}`);
  }

  // Finalize
  const totalDuration = Date.now() - pipelineStart;
  result.engineMeta.totalDurationMs = totalDuration;
  result.engineMeta.endTime = new Date().toISOString();
  result.engineMeta.logs = logger.getLogs();

  onLog({
    timestamp: new Date().toISOString(),
    stage: 'Pipeline Complete',
    status: 'success',
    message: `Total pipeline duration: ${totalDuration}ms`,
    durationMs: totalDuration,
  });

  return result;
}
