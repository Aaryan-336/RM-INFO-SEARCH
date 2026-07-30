// Identity Resolution Module
// Normalizes names, strips honorifics, generates search variants
// Generates MULTIPLE fuzzy company name variants for smarter matching

const HONORIFICS = [
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sir', 'shri', 'smt', 'ca', 'cs', 'adv',
  'justice', 'hon', 'capt', 'col', 'maj', 'gen', 'lt', 'cmdr',
];

const SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv', 'esq', 'phd', 'md', 'cfa', 'cpa'];

const COMPANY_NOISE_WORDS = [
  'private', 'limited', 'pvt', 'ltd', 'llp', 'inc', 'corp', 'corporation',
  'co', 'company', 'enterprises', 'holdings', 'group', 'india',
  'services', 'solutions', 'technologies', 'industries',
  'and', 'or', 'of', 'for', 'with', 'amp',
];

export async function resolveIdentity(personName, companyName, logger) {
  const start = Date.now();
  logger.running('Identity Resolution', `Resolving identity: "${personName}" at "${companyName}"`);

  try {
    const normalized = normalizeName(personName);
    const companyNorm = normalizeCompany(companyName);
    const variants = generateSearchVariants(normalized);
    const companyDomains = generateCompanyDomains(companyNorm);
    const companyVariants = generateCompanyVariants(companyName);

    const result = {
      original: { personName, companyName },
      normalized: {
        fullName: normalized.full,
        firstName: normalized.first,
        lastName: normalized.last,
        middleName: normalized.middle,
      },
      company: {
        normalized: companyNorm,
        possibleDomains: companyDomains,
        variants: companyVariants,    // NEW: fuzzy variants for MCA search
        coreWords: extractCoreWords(companyName), // NEW: core meaningful words
      },
      searchVariants: variants,
      confidence: 0.97,
      source: 'Identity Engine',
      timestamp: new Date().toISOString(),
    };

    const duration = Date.now() - start;
    logger.success('Identity Resolution',
      `Resolved: ${normalized.full} — ${variants.length} name variants, ${companyVariants.length} company variants`,
      { durationMs: duration, confidence: 0.97 }
    );

    return result;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error('Identity Resolution', `Failed: ${err.message}`, { durationMs: duration });
    throw err;
  }
}

function normalizeName(name) {
  let parts = name.trim().replace(/\s+/g, ' ').split(' ');
  parts = parts.filter(p => !HONORIFICS.includes(p.toLowerCase().replace(/[.]/g, '')));
  parts = parts.filter(p => !SUFFIXES.includes(p.toLowerCase().replace(/[.,]/g, '')));
  parts = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());

  const first = parts[0] || '';
  const last = parts[parts.length - 1] || '';
  const middle = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';

  return { full: parts.join(' '), first, last, middle, parts };
}

function normalizeCompany(company) {
  return company
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b(pvt\.?|private)\s+(ltd\.?|limited)\b/gi, 'Private Limited')
    .replace(/\b(ltd\.?|limited)\b/gi, 'Limited')
    .replace(/\b(llp)\b/gi, 'LLP')
    .trim();
}

// ── NEW: Generate multiple company name variants for fuzzy search ──

function generateCompanyVariants(rawName) {
  const variants = new Set();
  const name = rawName.trim();

  // Original
  variants.add(name);

  // Normalized
  const normalized = normalizeCompany(name);
  variants.add(normalized);

  // Without suffixes (Pvt Ltd, Limited, LLP, etc.)
  const withoutSuffix = name
    .replace(/\b(private|pvt\.?|ltd\.?|limited|llp|inc\.?|corp\.?|corporation)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  variants.add(withoutSuffix);

  // With full suffixes added
  variants.add(`${withoutSuffix} Private Limited`);
  variants.add(`${withoutSuffix} Limited`);
  variants.add(`${withoutSuffix} LLP`);

  // Core words only (e.g., "ASK Private Wealth" → "ASK Wealth")
  const coreWords = extractCoreWords(name);
  if (coreWords.length > 0) {
    variants.add(coreWords.join(' '));
    variants.add(`${coreWords.join(' ')} Private Limited`);
    variants.add(`${coreWords.join(' ')} Limited`);

    // Reordered core words
    if (coreWords.length >= 2) {
      variants.add(`${coreWords[0]} ${coreWords.slice(1).join(' ')} Advisors`);
      variants.add(`${coreWords[0]} ${coreWords.slice(1).join(' ')} Advisory`);
      variants.add(`${coreWords[0]} ${coreWords.slice(1).join(' ')} Management`);
      variants.add(`${coreWords[0]} ${coreWords.slice(1).join(' ')} Services`);
    }
  }

  // Common abbreviation patterns
  // "ASK Wealth Advisors" → "ASK", "ASKWA"
  const words = withoutSuffix.split(/\s+/);
  if (words.length >= 2) {
    const acronym = words.map(w => w.charAt(0).toUpperCase()).join('');
    variants.add(acronym);
  }

  // Remove noise and try again
  const cleanedWords = words.filter(w => !COMPANY_NOISE_WORDS.includes(w.toLowerCase()));
  if (cleanedWords.length > 0 && cleanedWords.join(' ') !== withoutSuffix) {
    variants.add(cleanedWords.join(' '));
    variants.add(`${cleanedWords.join(' ')} Private Limited`);
  }

  return [...variants].filter(v => v.length >= 2);
}

function extractCoreWords(name) {
  return name
    .trim()
    .split(/\s+/)
    .filter(w => !COMPANY_NOISE_WORDS.includes(w.toLowerCase()))
    .filter(w => w.length >= 2);
}

const EXECUTIVE_DESIGNATIONS = [
  'promoter', 'managing director', 'md', 'director', 'chairman', 'co-founder',
  'founder', 'ceo', 'trustee', 'partner', 'designated partner', 'general partner'
];

function generateSearchVariants(normalized) {
  const { full, first, last, middle } = normalized;
  const variants = [full];

  if (first && last) {
    variants.push(`${first} ${last}`);
    variants.push(`${last}, ${first}`);
    variants.push(`${first.charAt(0)}. ${last}`);
    if (middle) {
      variants.push(`${first} ${middle.charAt(0)}. ${last}`);
    }
  }

  // HNI & UHNI Wealth & Executive Search Query Variants
  const hniVariants = [
    `"${full}" promoter OR director OR founder`,
    `"${full}" "family office" OR "holdings" OR "capital"`,
    `"${full}" DIN OR Zauba OR Tofler OR "MCA"`,
    `"${full}" angel investment OR startup OR investor`
  ];
  variants.push(...hniVariants);

  return [...new Set(variants)];
}

function generateCompanyDomains(company) {
  const cleanCompany = company
    .toLowerCase()
    .replace(/\b(private|limited|llp|pvt|ltd|inc|corp|corporation|co|company)\b/g, '')
    .replace(/[^a-z0-9\s&]/g, '')
    .replace(/&/g, ' and ')
    .trim();

  // Words with conjunctions
  const rawWords = cleanCompany.split(/\s+/).filter(w => w.length > 0);

  // Words without conjunctions/prepositions
  const conjunctions = ['and', 'or', 'of', 'for', 'with'];
  const filteredWords = rawWords.filter(w => !conjunctions.includes(w));

  const domains = new Set();

  const addDomainExtensions = (baseStr) => {
    if (baseStr && baseStr.length >= 2) {
      domains.add(`${baseStr}.com`);
      domains.add(`${baseStr}.in`);
      domains.add(`${baseStr}.co.in`);
      domains.add(`${baseStr}.org`);
      domains.add(`${baseStr}.net`);
    }
  };

  // 1. Raw combined
  const rawBase = rawWords.join('');
  addDomainExtensions(rawBase);

  // 2. Filtered combined (stripping 'and', etc.)
  const filteredBase = filteredWords.join('');
  addDomainExtensions(filteredBase);

  // 3. Filtered hyphenated (e.g. dalal-broacha)
  const filteredHyphen = filteredWords.join('-');
  addDomainExtensions(filteredHyphen);

  // 4. Raw hyphenated (e.g. dalal-and-broacha)
  if (rawWords.length > 1) {
    addDomainExtensions(rawWords.join('-'));
  }

  // 5. Acronyms/Shorthand & Common Corporate Suffix Expansions
  if (filteredWords.length > 1) {
    const acronym = filteredWords.map(w => w.charAt(0)).join('');
    addDomainExtensions(acronym);

    // Expand with common corporate domains (e.g. askwealth -> askwealthadvisors.com, askgroup.in)
    addDomainExtensions(`${filteredBase}advisors`);
    addDomainExtensions(`${filteredBase}group`);
    addDomainExtensions(`${filteredBase}capital`);
    addDomainExtensions(`${filteredBase}wealth`);
  }

  return [...domains];
}
