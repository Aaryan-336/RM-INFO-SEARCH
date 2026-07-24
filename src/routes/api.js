// API Routes
// POST /api/intelligence — starts pipeline, returns results

import { Router } from 'express';
import { runPipeline } from '../engine/orchestrator.js';

const router = Router();

// Active SSE connections per request ID
const sseClients = new Map();

// POST /api/intelligence — start intelligence pipeline
router.post('/intelligence', async (req, res) => {
  const { personName, companyName, linkedinUrl } = req.body;

  if (!personName || !companyName) {
    return res.status(400).json({
      error: 'Both personName and companyName are required',
    });
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

  // Log callback — sends to SSE clients and console
  const onLog = (entry) => {
    entry.requestId = requestId;

    // Send to any connected SSE clients
    const clients = sseClients.get(requestId) || [];
    for (const client of clients) {
      client.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
  };

  // Run pipeline
  try {
    // Send requestId immediately so frontend can connect SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Request-Id': requestId,
    });

    // Register this response as an SSE client
    if (!sseClients.has(requestId)) {
      sseClients.set(requestId, []);
    }
    sseClients.get(requestId).push(res);

    // Send initial event
    res.write(`data: ${JSON.stringify({ stage: 'Pipeline', status: 'running', message: 'Starting intelligence pipeline...', requestId })}\n\n`);

    const result = await runPipeline(personName, companyName, linkedinUrl, onLog);

    // Send final result
    res.write(`data: ${JSON.stringify({ type: 'result', data: result })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

    // Cleanup
    sseClients.delete(requestId);
  } catch (err) {
    const errorEvent = { type: 'error', message: err.message };
    res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
    res.end();
    sseClients.delete(requestId);
  }
});

// Health check
router.get('/health', (req, res) => {
  const keys = {
    groq: !!process.env.GROQ_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    apollo: !!process.env.APOLLO_API_KEY,
    hunter: !!process.env.HUNTER_API_KEY,
    rocketreach: !!process.env.ROCKETREACH_API_KEY,
    pdl: !!process.env.PDL_API_KEY,
  };

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    configuredApis: keys,
    freeApisAvailable: ['OpenCorporates', 'Zaubacorp', 'Tofler', 'Web Scraping', 'Tesseract OCR', 'DNS MX Validation'],
  });
});

export default router;
