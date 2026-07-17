// App Controller — state management, routing, SSE connection

import { renderSearchView } from './ui/searchView.js';
import { renderResultsView } from './ui/resultsView.js';
import { renderPropertyResultsView } from './ui/propertyResultsView.js';
import { EnginePanel } from './ui/enginePanel.js';

class App {
  constructor() {
    this.root = document.getElementById('app');
    this.state = {
      view: 'search', // 'search' | 'loading' | 'results' | 'property-results'
      activeTab: 'person', // 'person' | 'property'
      query: null,
      results: null,
    };
    this.enginePanel = new EnginePanel();
    this.render();
  }

  render() {
    let content = '';

    switch (this.state.view) {
      case 'search':
        content = renderSearchView();
        break;
      case 'loading':
        content = this.renderLoadingView();
        break;
      case 'results':
        content = renderResultsView(this.state.results);
        break;
      case 'property-results':
        content = renderPropertyResultsView(this.state.results, this.state.query);
        break;
    }

    // Add engine panel
    content += this.enginePanel.render();

    this.root.innerHTML = content;
    this.bindEvents();
  }

  renderLoadingView() {
    return `
      <header class="app-header">
        <div class="app-logo">
          <div class="app-logo-icon">A</div>
          ASK Intelligence
        </div>
        <div class="api-status">
          <span class="api-status-dot" style="background: var(--warning)"></span>
          Processing
        </div>
      </header>
      <div class="loading-view">
        <div class="loading-spinner"></div>
        <div class="loading-stage" id="loading-stage">Starting intelligence pipeline...</div>
        <div class="loading-detail" id="loading-detail">Connecting to data sources</div>
      </div>
    `;
  }

  bindEvents() {
    // Tab switching elements
    const tabPerson = document.getElementById('tab-person');
    const tabProperty = document.getElementById('tab-property');
    const formPerson = document.getElementById('search-form');
    const formProperty = document.getElementById('property-form');

    // Keep active tab highlighted after render
    if (tabPerson && tabProperty && formPerson && formProperty) {
      if (this.state.activeTab === 'person') {
        tabPerson.classList.add('search-tab--active');
        tabPerson.style.borderBottomColor = 'var(--accent)';
        tabPerson.style.color = 'var(--accent)';
        tabProperty.classList.remove('search-tab--active');
        tabProperty.style.borderBottomColor = 'transparent';
        tabProperty.style.color = 'var(--primary-muted)';
        formPerson.style.display = 'block';
        formProperty.style.display = 'none';
      } else {
        tabProperty.classList.add('search-tab--active');
        tabProperty.style.borderBottomColor = 'var(--accent)';
        tabProperty.style.color = 'var(--accent)';
        tabPerson.classList.remove('search-tab--active');
        tabPerson.style.borderBottomColor = 'transparent';
        tabPerson.style.color = 'var(--primary-muted)';
        formProperty.style.display = 'block';
        formPerson.style.display = 'none';
      }

      tabPerson.addEventListener('click', () => {
        this.state.activeTab = 'person';
        tabPerson.style.borderBottomColor = 'var(--accent)';
        tabPerson.style.color = 'var(--accent)';
        tabProperty.style.borderBottomColor = 'transparent';
        tabProperty.style.color = 'var(--primary-muted)';
        formPerson.style.display = 'block';
        formProperty.style.display = 'none';
      });

      tabProperty.addEventListener('click', () => {
        this.state.activeTab = 'property';
        tabProperty.style.borderBottomColor = 'var(--accent)';
        tabProperty.style.color = 'var(--accent)';
        tabPerson.style.borderBottomColor = 'transparent';
        tabPerson.style.color = 'var(--primary-muted)';
        formProperty.style.display = 'block';
        formPerson.style.display = 'none';
      });
    }

    // Person Search form submit
    if (formPerson) {
      formPerson.addEventListener('submit', (e) => {
        e.preventDefault();
        const personName = document.getElementById('person-name').value.trim();
        const companyName = document.getElementById('company-name').value.trim();
        const linkedinUrl = document.getElementById('linkedin-url')?.value.trim() || '';
        if (personName && companyName) {
          this.startPipeline(personName, companyName, linkedinUrl);
        }
      });
    }

    // Property Search form submit
    if (formProperty) {
      formProperty.addEventListener('submit', (e) => {
        e.preventDefault();
        const searchType = document.getElementById('property-search-type').value;
        const queryValue = document.getElementById('property-query-value').value.trim();
        const district = document.getElementById('property-district').value;
        if (searchType && queryValue) {
          this.startPropertyPipeline(searchType, queryValue, district);
        }
      });
    }

    // Back button
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.state.view = 'search';
        this.state.results = null;
        this.enginePanel.reset();
        this.render();
      });
    }

    // Engine panel toggle
    this.enginePanel.bindEvents();
  }

  async startPropertyPipeline(searchType, queryValue, district) {
    this.state.view = 'loading';
    this.state.query = { searchType, queryValue, district };
    this.enginePanel.reset();
    this.render();
    this.enginePanel.expand();

    try {
      const response = await fetch('/api/property/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchType, queryValue, district }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'result') {
                this.state.results = data.data;
                this.state.view = 'property-results';
                this.render();
              } else if (data.type === 'done') {
                // Pipeline complete
              } else if (data.type === 'error') {
                this.handleError(data.message);
              } else {
                this.enginePanel.addLog(data);
                this.updateLoadingState(data);
              }
            } catch (e) {
              // Ignore partial parsing errors
            }
          }
        }
      }

      if (this.state.view === 'loading') {
        throw new Error('Connection closed before property search completed.');
      }
    } catch (err) {
      this.handleError(err.message);
    }
  }

  async startPipeline(personName, companyName, linkedinUrl) {
    this.state.view = 'loading';
    this.state.query = { personName, companyName };
    this.enginePanel.reset();
    this.render();

    // Expand engine panel during processing
    this.enginePanel.expand();

    try {
      const payload = { personName, companyName };
      if (linkedinUrl) payload.linkedinUrl = linkedinUrl;

      const response = await fetch('/api/intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'result') {
                // Got final result
                this.state.results = data.data;
                this.state.view = 'results';
                this.render();
              } else if (data.type === 'done') {
                // Pipeline complete
                if (this.state.view !== 'results') {
                  // If we haven't rendered results yet
                }
              } else if (data.type === 'error') {
                this.handleError(data.message);
              } else {
                // Log event
                this.enginePanel.addLog(data);
                this.updateLoadingState(data);
              }
            } catch (e) {
              // Ignore JSON parse errors from partial data
            }
          }
        }
      }

      // Check if we exited the stream loop but never received a result
      if (this.state.view === 'loading') {
        throw new Error('Connection closed by server before pipeline completed.');
      }
    } catch (err) {
      this.handleError(err.message);
    }
  }

  updateLoadingState(log) {
    const stageEl = document.getElementById('loading-stage');
    const detailEl = document.getElementById('loading-detail');

    if (stageEl && log.stage) {
      stageEl.textContent = log.stage;
    }
    if (detailEl && log.message) {
      detailEl.textContent = log.message;
    }
  }

  handleError(message) {
    this.state.view = 'search';
    this.render();

    // Show error in engine panel
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
