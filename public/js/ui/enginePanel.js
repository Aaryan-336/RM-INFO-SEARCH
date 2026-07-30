// Engine Panel — ASK Wealth styled real-time log display

const STAGE_ORDER = [
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

const STATUS_ICONS = {
  running: '◌',
  success: '✓',
  warning: '⚠',
  error: '✗',
  skipped: '○',
};

export class EnginePanel {
  constructor() {
    this.logs = [];
    this.collapsed = true;
    this.completedStages = new Set();
    this.currentStage = null;
    this.totalDuration = null;
    this.element = null;
  }

  render() {
    const progress = (this.completedStages.size / STAGE_ORDER.length) * 100;
    const stageText = this.totalDuration
      ? `Complete — ${(this.totalDuration / 1000).toFixed(1)}s`
      : this.currentStage
        ? `${this.completedStages.size + 1}/${STAGE_ORDER.length} ${this.currentStage}`
        : 'Idle';

    return `
      <div class="engine-panel ${this.collapsed ? 'engine-panel--collapsed' : ''}" id="engine-panel">
        <button class="engine-toggle" id="engine-toggle">
          <span class="engine-toggle-title">
            <span class="engine-toggle-arrow">▲</span>
            Engine Pipeline
          </span>
          <span class="engine-progress">
            <span class="engine-progress-bar">
              <span class="engine-progress-fill" style="width: ${progress}%"></span>
            </span>
            <span class="engine-progress-text">${stageText}</span>
          </span>
        </button>
        <div class="engine-logs" id="engine-logs">
          ${this.logs.map(log => this.renderLogEntry(log)).join('')}
        </div>
      </div>
    `;
  }

  renderLogEntry(log) {
    const ts = log.timestamp ? new Date(log.timestamp) : new Date();
    const time = isNaN(ts.getTime()) ? '' : ts.toLocaleTimeString('en-IN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });

    const icon = STATUS_ICONS[log.status] || '·';
    const duration = log.durationMs ? `${log.durationMs}ms` : '';
    const confidence = log.confidence ? `${(log.confidence * 100).toFixed(0)}%` : '';
    const meta = [duration, confidence].filter(Boolean).join(' · ');

    return `
      <div class="engine-log">
        <span class="engine-log-time">${time}</span>
        <span class="engine-log-status engine-log-status--${log.status}">${icon}</span>
        <span class="engine-log-msg">${escHtml(log.stage ? `${log.stage} — ` : '')}${escHtml(log.message)}</span>
        ${meta ? `<span class="engine-log-meta">${meta}</span>` : ''}
      </div>
    `;
  }

  addLog(log) {
    this.logs.push(log);

    // Track stages
    if (log.status === 'running' && STAGE_ORDER.includes(log.stage)) {
      this.currentStage = log.stage;
    }
    if ((log.status === 'success' || log.status === 'skipped') && STAGE_ORDER.includes(log.stage)) {
      this.completedStages.add(log.stage);
    }
    if (log.stage === 'Pipeline Complete') {
      this.totalDuration = log.durationMs;
    }

    this.updateDOM();
  }

  updateDOM() {
    const panel = document.getElementById('engine-panel');
    if (!panel) return;

    // Update progress
    const progress = (this.completedStages.size / STAGE_ORDER.length) * 100;
    const fill = panel.querySelector('.engine-progress-fill');
    if (fill) fill.style.width = `${progress}%`;

    const stageText = this.totalDuration
      ? `Complete — ${(this.totalDuration / 1000).toFixed(1)}s`
      : this.currentStage
        ? `${this.completedStages.size + 1}/${STAGE_ORDER.length} ${this.currentStage}`
        : 'Idle';
    const progressText = panel.querySelector('.engine-progress-text');
    if (progressText) progressText.textContent = stageText;

    // Add log entry
    const logsContainer = document.getElementById('engine-logs');
    if (logsContainer) {
      const lastLog = this.logs[this.logs.length - 1];
      if (lastLog) {
        logsContainer.insertAdjacentHTML('beforeend', this.renderLogEntry(lastLog));
        logsContainer.scrollTop = logsContainer.scrollHeight;
      }
    }
  }

  toggle() {
    this.collapsed = !this.collapsed;
    const panel = document.getElementById('engine-panel');
    if (panel) {
      panel.classList.toggle('engine-panel--collapsed', this.collapsed);
    }
  }

  reset() {
    this.logs = [];
    this.completedStages.clear();
    this.currentStage = null;
    this.totalDuration = null;
  }

  expand() {
    this.collapsed = false;
    const panel = document.getElementById('engine-panel');
    if (panel) panel.classList.remove('engine-panel--collapsed');
  }

  bindEvents() {
    const toggle = document.getElementById('engine-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => this.toggle());
    }
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
