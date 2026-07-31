// App Controller — dual tab state management & SSE routing

import { renderSearchView } from './ui/searchView.js';
import { renderResultsView } from './ui/resultsView.js';
import { renderAffluenseContactView } from './ui/affluenseContactView.js';
import { renderAffluenseResultsView } from './ui/affluenseResultsView.js';
import { EnginePanel } from './ui/enginePanel.js';

class App {
  constructor() {
    this.root = document.getElementById('app');
    this.state = {
      activeTab: '360', // '360' | 'affluense'
      view: 'search', // 'search' | 'loading' | 'results'
      query: null,
      results: null,
    };
    this.enginePanel = new EnginePanel();
    this.render();
  }

  render() {
    let content = '';

    // Render global navigation header with tab switcher
    const navHeader = this.renderNavHeader();

    let mainContent = '';
    try {
      if (this.state.activeTab === '360') {
        switch (this.state.view) {
          case 'search':
            mainContent = renderSearchView();
            break;
          case 'loading':
            mainContent = this.renderLoadingView('Starting 360° Intelligence Pipeline...');
            break;
          case 'results':
            mainContent = renderResultsView(this.state.results);
            break;
        }
      } else {
        // Affluense Contact Engine Dedicated Testing Tab
        switch (this.state.view) {
          case 'search':
            mainContent = renderAffluenseContactView();
            break;
          case 'loading':
            mainContent = this.renderLoadingView('Executing 5-Layer Affluense Contact Engine...');
            break;
          case 'results':
            mainContent = renderAffluenseResultsView(this.state.results);
            break;
        }
      }
    } catch (renderErr) {
      console.error('Rendering error:', renderErr);
      mainContent = `
        <div style="padding: 40px; text-align: center; color: var(--error);">
          <h2>Results Display Error</h2>
          <p>${renderErr.message}</p>
          <button id="back-btn" class="btn btn--primary" style="margin-top: 15px;">← Return to Search</button>
        </div>
      `;
    }

    content = navHeader + mainContent + this.enginePanel.render();
    this.root.innerHTML = content;
    this.bindEvents();
  }

  renderNavHeader() {
    return `
      <header class="app-header" style="display:flex; justify-content:space-between; align-items:center; padding:12px 24px; background:rgba(11, 61, 63, 0.95); border-bottom:1px solid rgba(197, 165, 90, 0.25); backdrop-filter:blur(10px);">
        <div style="display:flex; align-items:center; gap:20px;">
          <div class="app-logo" style="display:flex; align-items:center; gap:10px; font-family:'Playfair Display', serif; font-weight:700; font-size:1.1rem; color:var(--accent);">
            <div class="app-logo-icon" style="width:28px; height:28px; background:rgba(197, 165, 90, 0.2); border:1px solid var(--accent); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:14px; color:var(--accent);">A</div>
            ASK Intelligence
          </div>

          <!-- TAB SWITCHER NAVIGATION -->
          <nav class="app-tabs" style="display:flex; align-items:center; gap:6px; background:rgba(0,0,0,0.3); padding:4px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
            <button 
              id="tab-360-btn" 
              class="tab-nav-btn ${this.state.activeTab === '360' ? 'active' : ''}"
              style="padding:6px 14px; border:none; border-radius:6px; font-size:13px; font-weight:500; cursor:pointer; transition:all 0.2s; ${this.state.activeTab === '360' ? 'background:var(--accent); color:#000; font-weight:600;' : 'background:transparent; color:rgba(255,255,255,0.7);'}"
            >
              360° Intelligence
            </button>
            
            <button 
              id="tab-affluense-btn" 
              class="tab-nav-btn ${this.state.activeTab === 'affluense' ? 'active' : ''}"
              style="padding:6px 14px; border:none; border-radius:6px; font-size:13px; font-weight:500; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; gap:6px; ${this.state.activeTab === 'affluense' ? 'background:linear-gradient(135deg, #2ecc71 0%, #27ae60 100%); color:#fff; font-weight:600;' : 'background:transparent; color:rgba(255,255,255,0.8);'}"
            >
              <span>⚡ Affluense Contact Engine</span>
              <span style="font-size:10px; background:rgba(255,255,255,0.25); padding:1px 5px; border-radius:4px; text-transform:uppercase; font-weight:700;">TESTING TAB</span>
            </button>
          </nav>
        </div>

        <div class="api-status" style="display:flex; align-items:center; gap:8px; font-size:12px; opacity:0.8;">
          <span class="api-status-dot" style="width:8px; height:8px; border-radius:50%; background:${this.state.view === 'loading' ? 'var(--warning)' : '#2ecc71'}; display:inline-block;"></span>
          ${this.state.view === 'loading' ? 'Processing' : 'Live Engine Active'}
        </div>
      </header>
    `;
  }

  renderLoadingView(stageTitle) {
    return `
      <div class="loading-view" style="padding:60px 20px; text-align:center;">
        <div class="loading-spinner" style="width:48px; height:48px; border:4px solid rgba(197,165,90,0.2); border-top-color:var(--accent); border-radius:50%; animation:spin 1s linear infinite; margin:0 auto 20px;"></div>
        <div class="loading-stage" id="loading-stage" style="font-size:1.4rem; font-family:'Playfair Display', serif; color:var(--accent); margin-bottom:8px;">${stageTitle}</div>
        <div class="loading-detail" id="loading-detail" style="opacity:0.7; font-size:0.95rem;">Executing discovery layers...</div>
      </div>
    `;
  }

  bindEvents() {
    // Tab switching
    const tab360Btn = document.getElementById('tab-360-btn');
    if (tab360Btn) {
      tab360Btn.addEventListener('click', () => {
        if (this.state.activeTab !== '360') {
          this.state.activeTab = '360';
          this.state.view = 'search';
          this.state.results = null;
          this.enginePanel.reset();
          this.render();
        }
      });
    }

    const tabAffBtn = document.getElementById('tab-affluense-btn');
    if (tabAffBtn) {
      tabAffBtn.addEventListener('click', () => {
        if (this.state.activeTab !== 'affluense') {
          this.state.activeTab = 'affluense';
          this.state.view = 'search';
          this.state.results = null;
          this.enginePanel.reset();
          this.render();
        }
      });
    }

    // Form 1: Main 360 Search Form
    const formPerson = document.getElementById('search-form');
    if (formPerson) {
      formPerson.addEventListener('submit', (e) => {
        e.preventDefault();
        const personName = document.getElementById('person-name').value.trim();
        const companyName = document.getElementById('company-name').value.trim();
        const linkedinUrl = document.getElementById('linkedin-url')?.value.trim() || '';
        if (personName && companyName) {
          this.startPipeline('/api/intelligence', { personName, companyName, linkedinUrl });
        }
      });
    }

    // Form 2: Affluense Contact Engine Form
    const affForm = document.getElementById('affluense-contact-form');
    if (affForm) {
      affForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const personName = document.getElementById('aff-person-name').value.trim();
        const companyName = document.getElementById('aff-company-name').value.trim();
        const linkedinUrl = document.getElementById('aff-linkedin-url')?.value.trim() || '';
        const country = document.getElementById('aff-country')?.value || 'IN';
        if (personName && companyName) {
          this.startPipeline('/api/affluense-contact', { personName, companyName, linkedinUrl, country });
        }
      });
    }

    // Back buttons
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.state.view = 'search';
        this.state.results = null;
        this.enginePanel.reset();
        this.render();
      });
    }

    const affBackBtn = document.getElementById('aff-back-btn');
    if (affBackBtn) {
      affBackBtn.addEventListener('click', () => {
        this.state.view = 'search';
        this.state.results = null;
        this.enginePanel.reset();
        this.render();
      });
    }

    // Export to PDF / Print Handler
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (exportPdfBtn) {
      exportPdfBtn.addEventListener('click', () => {
        window.print();
      });
    }

    this.enginePanel.bindEvents();
  }

  async startPipeline(endpointUrl, payload) {
    this.state.view = 'loading';
    this.state.query = payload;
    this.enginePanel.reset();
    this.render();

    this.enginePanel.expand();

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        const lines = buffer.split('\n');
        buffer = done ? '' : (lines.pop() || '');

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));

              if (data.type === 'result') {
                this.state.results = data.data;
                this.state.view = 'results';
                this.render();
              } else if (data.type === 'error') {
                this.handleError(data.message);
              } else if (data.stage || data.message) {
                this.enginePanel.addLog(data);
                this.updateLoadingState(data);
              }
            } catch (e) {
              // Ignore partial JSON parse errors
            }
          }
        }

        if (done) break;
      }

      if (this.state.view === 'loading') {
        throw new Error('Connection closed before pipeline completed.');
      }
    } catch (err) {
      this.handleError(err.message);
    }
  }

  updateLoadingState(log) {
    const stageEl = document.getElementById('loading-stage');
    const detailEl = document.getElementById('loading-detail');

    if (stageEl && (log.stage || log.layer)) {
      stageEl.textContent = log.stage || log.layer;
    }
    if (detailEl && log.message) {
      detailEl.textContent = log.message;
    }
  }

  handleError(message) {
    this.state.view = 'search';
    this.render();

    this.enginePanel.addLog({
      timestamp: new Date().toISOString(),
      stage: 'Error',
      status: 'error',
      message: message || 'Unknown error occurred',
    });

    alert(`Error: ${message}\n\nCheck the engine panel for details.`);
  }
}

// Initialize
const app = new App();
