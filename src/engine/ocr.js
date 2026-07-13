// OCR Processing Module
// Uses Tesseract.js (free, open source) for OCR on PDFs and images

import Tesseract from 'tesseract.js';
import { CONFIDENCE } from '../utils/confidence.js';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g;
const NAME_NEAR_REGEX = /(?:director|chairman|ceo|cto|cfo|managing|partner|founder|head|chief|president)/gi;

export async function processOCR(documentsFound, identity, logger) {
  const start = Date.now();

  if (!documentsFound || documentsFound.length === 0) {
    logger.skipped('OCR Processing', 'No documents found for OCR processing');
    return { contacts: [], entities: [], textExtracts: [] };
  }

  logger.running('OCR Processing', `Processing ${documentsFound.length} document(s) with Tesseract.js`);

  const results = {
    contacts: [],
    entities: [],
    textExtracts: [],
  };

  // Process up to 3 documents (OCR is CPU intensive)
  const docsToProcess = documentsFound.slice(0, 3);

  for (const doc of docsToProcess) {
    try {
      const urlLower = doc.url.toLowerCase();
      const isImage = urlLower.endsWith('.png') || urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg') || urlLower.endsWith('.webp');
      
      if (isImage) {
        logger.running('OCR Processing', `Performing OCR on: ${doc.url.substring(0, 80)}...`);

        const { data } = await Tesseract.recognize(doc.url, 'eng', {
          logger: () => {}, // Suppress Tesseract's own logging
        });

        if (data.text && data.text.trim().length > 20) {
          const ocrConfidence = data.confidence / 100;
          const confidenceScore = ocrConfidence >= 0.85 ? CONFIDENCE.OCR_HIGH :
                                  ocrConfidence >= 0.70 ? CONFIDENCE.OCR_MEDIUM : CONFIDENCE.OCR_LOW;

          results.textExtracts.push({
            source: doc.url,
            text: data.text.substring(0, 2000),
            ocrConfidence: ocrConfidence,
            timestamp: new Date().toISOString(),
          });

          // Extract contacts from OCR text
          extractContactsFromText(data.text, doc.url, confidenceScore, identity, results);
        }
      } else {
        logger.skipped('OCR Processing', `Skipped unsupported format (non-image): ${doc.url.substring(0, 60)}`);
      }
    } catch (err) {
      logger.warning('OCR Processing', `Failed to process ${doc.url.substring(0, 60)}: ${err.message}`);
    }
  }

  const duration = Date.now() - start;
  logger.success('OCR Processing',
    `Processed ${docsToProcess.length} document(s) — extracted ${results.contacts.length} contact(s)`,
    { durationMs: duration }
  );

  return results;
}

function extractContactsFromText(text, source, confidence, identity, results) {
  const nameVariants = identity.searchVariants.map(v => v.toLowerCase());
  const textLower = text.toLowerCase();
  const personMentioned = nameVariants.some(v => textLower.includes(v));

  // Extract emails
  const emails = text.match(EMAIL_REGEX) || [];
  for (const email of emails) {
    const clean = email.toLowerCase().trim();
    if (clean.includes('.') && !clean.endsWith('.pdf') && !clean.endsWith('.png')) {
      results.contacts.push({
        type: 'email',
        value: clean,
        source,
        sourceType: 'OCR — Public Document',
        confidence: personMentioned ? confidence : confidence * 0.8,
        timestamp: new Date().toISOString(),
        personMentioned,
      });
    }
  }

  // Extract phones
  const phones = text.match(PHONE_REGEX) || [];
  for (const phone of phones) {
    const cleaned = phone.replace(/[\s-()]/g, '');
    if (cleaned.length >= 10 && cleaned.length <= 15) {
      results.contacts.push({
        type: 'phone',
        value: cleaned,
        source,
        sourceType: 'OCR — Public Document',
        confidence: personMentioned ? confidence : confidence * 0.8,
        timestamp: new Date().toISOString(),
        personMentioned,
      });
    }
  }

  // Extract named entities (roles, designations)
  const roleMatches = text.match(NAME_NEAR_REGEX) || [];
  for (const role of roleMatches) {
    results.entities.push({
      type: 'role',
      value: role.trim(),
      source,
      sourceType: 'OCR — Public Document',
      confidence,
      timestamp: new Date().toISOString(),
    });
  }
}
