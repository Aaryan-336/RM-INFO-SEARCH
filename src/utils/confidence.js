// Confidence scoring utilities per DATA_SOURCES.md and VALIDATION_ENGINE.md
// Two-dimensional model: Source Confidence × Attribution Confidence

export const CONFIDENCE = {
  MCA_DATA: 0.99,
  DIRECTOR_DATA: 0.98,
  COMPANY_WEBSITE: 0.98,
  COMPANY_PDF: 0.95,
  CONFERENCE_BROCHURE: 0.90,
  APOLLO: 0.90,
  HUNTER: 0.88,
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
