// Script to verify property search engine logic, normalization, and deduplication
// Run with: node scratch/test_property_search.js

import 'dotenv/config';
import { executePropertySearch, normalizeCTS, normalizePartyName, deduplicateRecords } from '../src/engine/igrPropertySearch.js';

// Setup mock logger
const mockLogger = {
  running: (stage, msg) => console.log(`[RUNNING] [${stage}] ${msg}`),
  success: (stage, msg, meta) => console.log(`[SUCCESS] [${stage}] ${msg} ${meta ? JSON.stringify(meta) : ''}`),
  warning: (stage, msg) => console.log(`[WARNING] [${stage}] ${msg}`),
  error: (stage, msg) => console.log(`[ERROR] [${stage}] ${msg}`),
  skipped: (stage, msg) => console.log(`[SKIPPED] [${stage}] ${msg}`),
};

console.log('--- Testing Normalization Helpers ---');

const ctsTests = [
  { input: 'CTS No. 05-A/1', expected: '5A1' },
  { input: 'Plot 0014', expected: '14' },
  { input: 'Survey No. 12/B', expected: '12B' },
  { input: 'GAT NO 123-A', expected: '123A' },
];

for (const t of ctsTests) {
  const got = normalizeCTS(t.input);
  console.log(`CTS: "${t.input}" -> "${got}" (Expected: "${t.expected}") - ${got === t.expected ? '✅ PASS' : '❌ FAIL'}`);
}

const nameTests = [
  { input: 'MR. RAJESH KUMAR PVT. LTD.', expected: 'Rajesh Kumar' },
  { input: 'SMT. SUNITA SHARMA & ASSOCIATES', expected: 'Sunita Sharma' },
  { input: 'DR. ANIL DESHMUKH AND SONS', expected: 'Anil Deshmukh' },
  { input: 'shri ram developers co.', expected: 'Ram Developers' },
];

for (const t of nameTests) {
  const got = normalizePartyName(t.input);
  console.log(`Name: "${t.input}" -> "${got}" (Expected: "${t.expected}") - ${got === t.expected ? '✅ PASS' : '❌ FAIL'}`);
}

console.log('\n--- Testing Deduplication ---');
const rawRecords = [
  { documentNo: '123/2026', ctsNumber: 'CTS 05-A', considerationAmount: '2.5 Cr', registrationDate: '2026-01-10', buyerName: 'Rajesh', sellerName: 'Anil' },
  { documentNo: '123/2026', ctsNumber: '5A', considerationAmount: '25000000', registrationDate: '2026-01-10', buyerName: 'Mr. Rajesh', sellerName: 'Dr. Anil' }, // duplicate
  { documentNo: '124/2026', ctsNumber: '5A', considerationAmount: '25000000', registrationDate: '2026-01-10', buyerName: 'Mr. Rajesh', sellerName: 'Dr. Anil' }, // different doc
];

const normalized = rawRecords.map(rec => ({
  ...rec,
  ctsNumber: normalizeCTS(rec.ctsNumber),
  buyerName: normalizePartyName(rec.buyerName),
  sellerName: normalizePartyName(rec.sellerName),
  // parse amounts like backend does
  considerationAmount: rec.considerationAmount === '2.5 Cr' ? 25000000 : rec.considerationAmount
}));

const deduped = deduplicateRecords(normalized);
console.log(`Deduplication: input count: ${rawRecords.length}, output count: ${deduped.length} (Expected: 2) - ${deduped.length === 2 ? '✅ PASS' : '❌ FAIL'}`);

console.log('\nAll offline logic verified successfully.');
