// Confidence scoring utilities per DATA_SOURCES.md and VALIDATION_ENGINE.md
// Two-dimensional model: Source Confidence × Attribution Confidence

export const CONFIDENCE = {
  MCA_DATA: 0.99,
  DIRECTOR_DATA: 0.98,
  COMPANY_WEBSITE: 0.98,
  COMPANY_PDF: 0.95,
  CONFERENCE_BROCHURE: 0.90,
  BRIGHTDATA: 0.95,
  LUSHA: 0.90,
  APOLLO: 0.90,
  HUNTER: 0.98,
  ROCKETREACH: 0.88,
  PDL: 0.85,
  OCR_HIGH: 0.92,
  OCR_MEDIUM: 0.85,
  OCR_LOW: 0.80,
  PUBLIC_DIRECTORY: 0.70,
  UNKNOWN_WEBSITE: 0.40,
  CROSS_SOURCE_BOOST: 0.05,
  DISPLAY_THRESHOLD: 0.70,
};

// Attribution Confidence — how sure are we this contact belongs to the TARGET person?
export const ATTRIBUTION = {
  AI_ATTRIBUTED:  1.00,  // AI confirmed contact belongs to target person
  ENRICHMENT_API: 1.00,  // Enrichment provider searched by person name — inherently person-specific
  DIRECT_MATCH:   0.95,  // Email contains person's name (e.g. bhavesh.vyas@company.com)
  PROXIMATE:      0.80,  // Found within ~200 chars of person's name on page
  SAME_PAGE:      0.50,  // Found on same page as person's name, but not proximate
  UNATTRIBUTED:   0.30,  // Found on company page, person not mentioned or not near
};

/**
 * Compute final confidence = sourceConfidence × attributionConfidence
 * This ensures contacts from wrong people drop below the display threshold
 * even if they come from a high-trust source.
 */
export function computeFinalConfidence(sourceConfidence, attribution) {
  const attrScore = typeof attribution === 'number' ? attribution : ATTRIBUTION.UNATTRIBUTED;
  return Math.round(sourceConfidence * attrScore * 100) / 100;
}

export const CONFIDENCE_LABELS = {
  VERIFIED: { min: 0.95, label: 'Verified', color: 'green' },
  HIGH: { min: 0.85, label: 'High Confidence', color: 'blue' },
  MEDIUM: { min: 0.70, label: 'Medium Confidence', color: 'amber' },
  LOW: { min: 0, label: 'Low Confidence', color: 'red' },
};

export function getConfidenceLabel(score) {
  if (score >= CONFIDENCE_LABELS.VERIFIED.min) return CONFIDENCE_LABELS.VERIFIED;
  if (score >= CONFIDENCE_LABELS.HIGH.min) return CONFIDENCE_LABELS.HIGH;
  if (score >= CONFIDENCE_LABELS.MEDIUM.min) return CONFIDENCE_LABELS.MEDIUM;
  return CONFIDENCE_LABELS.LOW;
}

export function boostConfidence(score, matchCount) {
  if (matchCount > 1) {
    return Math.min(1.0, score + CONFIDENCE.CROSS_SOURCE_BOOST * (matchCount - 1));
  }
  return score;
}

export function meetsThreshold(score) {
  return score >= CONFIDENCE.DISPLAY_THRESHOLD;
}

/**
 * Computes fuzzy name similarity score (0.0 to 1.0) combining token overlap and Levenshtein distance ratio.
 */
export function computeNameSimilarity(name1, name2) {
  if (!name1 || !name2) return 0;
  
  const clean = (str) => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  const tokens1 = clean(name1);
  const tokens2 = clean(name2);

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  // Jaccard token overlap score
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  const jaccardScore = intersection.size / union.size;

  // Levenshtein similarity ratio
  const str1 = tokens1.join(' ');
  const str2 = tokens2.join(' ');
  const distance = levenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  const levenshteinScore = maxLen > 0 ? (1 - distance / maxLen) : 0;

  // Return highest of Jaccard and Levenshtein score
  return Math.min(1.0, Math.max(jaccardScore, levenshteinScore));
}

function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

