import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRoutes from './src/routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Prevent background library threads (like Tesseract worker) from crashing the server
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
process.on('SIGTERM', () => {
  console.log('[SIGTERM] Exiting process...');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[SIGINT] Exiting process...');
  process.exit(0);
});


app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`\n  RM Intelligence Platform`);
  console.log(`  ─────────────────────────`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Status:  Ready\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[PORT BUSY] Port ${PORT} is already in use by another process.`);
    console.error(`Try running: lsof -ti:${PORT} | xargs kill -9\n`);
  } else {
    console.error(`[SERVER ERROR] ${err.message}`);
  }
});
