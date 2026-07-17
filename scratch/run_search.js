import 'dotenv/config';
import { executePropertySearch } from '../src/engine/igrPropertySearch.js';

const mockLogger = {
  running: (stage, msg) => console.log(`[RUNNING] [${stage}] ${msg}`),
  success: (stage, msg, meta) => console.log(`[SUCCESS] [${stage}] ${msg} ${meta ? JSON.stringify(meta) : ''}`),
  warning: (stage, msg) => console.log(`[WARNING] [${stage}] ${msg}`),
  error: (stage, msg) => console.log(`[ERROR] [${stage}] ${msg}`),
  skipped: (stage, msg) => console.log(`[SKIPPED] [${stage}] ${msg}`),
};

console.log('Running test search directly...');
try {
  const randomQuery = `Gagan Vihar ${Math.random().toString(36).substring(7)}`;
  const result = await executePropertySearch('society', randomQuery, 'Pune', mockLogger);
  console.log('Search finished. Record count:', result.records.length);
} catch (err) {
  console.error('Test search failed with error:', err);
}
process.exit(0);
