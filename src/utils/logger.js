// Structured logger for engine pipeline events

export function createLogger(emitFn) {
  const logs = [];

  function log(stage, status, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      timeMs: Date.now(),
      stage,
      status, // 'running' | 'success' | 'warning' | 'error' | 'skipped'
      message,
      ...meta,
    };
    logs.push(entry);
    if (emitFn) emitFn(entry);
    return entry;
  }

  return {
    running: (stage, msg, meta) => log(stage, 'running', msg, meta),
    success: (stage, msg, meta) => log(stage, 'success', msg, meta),
    warning: (stage, msg, meta) => log(stage, 'warning', msg, meta),
    error: (stage, msg, meta) => log(stage, 'error', msg, meta),
    skipped: (stage, msg, meta) => log(stage, 'skipped', msg, meta),
    getLogs: () => logs,
  };
}

export const STAGES = [
  'Identity Resolution',
  'Public Search',
  'OCR Processing',
  'MCA Intelligence',
  'Contact Enrichment',
  'Validation',
  'Compliance',
  'AI Briefing',
  'Real Estate Intelligence',
];
