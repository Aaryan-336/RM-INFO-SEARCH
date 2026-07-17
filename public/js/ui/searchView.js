// Search View — ASK Wealth inspired search interface with tabs for Person Search & Property Registry

export function renderSearchView() {
  return `
    <header class="app-header">
      <div class="app-logo">
        <div class="app-logo-icon">A</div>
        ASK Intelligence
      </div>
      <div class="api-status">
        <span class="api-status-dot"></span>
        Live
      </div>
    </header>

    <main class="search-view">
      <div class="search-hero">
        <h1>Led by <span class="accent-text">foresight</span><br>realized by expertise</h1>
        <div class="search-divider"></div>
        <p>Generate verified private wealth insights. Select a tab below to search profiles or pull raw real estate transactions.</p>
      </div>

      <div class="search-card" style="max-width: 540px; padding: 0; overflow: hidden;">
        <!-- Tabs Header -->
        <div class="search-tabs" style="display: flex; background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--border);">
          <button class="search-tab search-tab--active" id="tab-person" style="flex: 1; padding: var(--space-md); background: none; border: none; border-bottom: 2px solid var(--accent); color: var(--accent); font-family: var(--font-serif); font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">
            👤 Person Intelligence
          </button>
          <button class="search-tab" id="tab-property" style="flex: 1; padding: var(--space-md); background: none; border: none; border-bottom: 2px solid transparent; color: var(--primary-muted); font-family: var(--font-serif); font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease;">
            🏠 Property Registry
          </button>
        </div>

        <div style="padding: var(--space-xl) var(--space-lg);">
          <!-- Form 1: Person Search -->
          <form id="search-form" style="display: block;">
            <div class="search-field">
              <label for="person-name">Person Name</label>
              <input 
                type="text" 
                id="person-name" 
                name="personName" 
                placeholder="e.g. Rajesh Kumar"
                required
                autocomplete="off"
              >
            </div>

            <div class="search-field">
              <label for="company-name">Company Name</label>
              <input 
                type="text" 
                id="company-name" 
                name="companyName" 
                placeholder="e.g. Infosys Limited"
                required
                autocomplete="off"
              >
            </div>

            <div class="search-field">
              <label for="linkedin-url">LinkedIn Profile URL <span style="opacity:0.4; font-weight:400; letter-spacing:0">(optional)</span></label>
              <input 
                type="url" 
                id="linkedin-url" 
                name="linkedinUrl" 
                placeholder="e.g. https://linkedin.com/in/rajesh-kumar"
                autocomplete="off"
              >
            </div>

            <button type="submit" class="search-btn" id="search-btn">
              Generate Intelligence
            </button>

            <div class="search-footer">
              MCA Records · LinkedIn · Company Websites · IGR Maharashtra · Enrichment APIs
            </div>
          </form>

          <!-- Form 2: Property Search (Hidden by default) -->
          <form id="property-form" style="display: none;">
            <div class="search-field">
              <label for="property-search-type">Search By</label>
              <select id="property-search-type" name="searchType" style="width: 100%; padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius-md); font-family: var(--font-sans); font-size: 0.95rem; color: var(--primary); background: rgba(255, 255, 255, 0.03); outline: none; transition: all 0.25s ease;">
                <option value="society" style="background: var(--bg-secondary);">Society Name</option>
                <option value="building" style="background: var(--bg-secondary);">Building Name</option>
                <option value="cts" style="background: var(--bg-secondary);">CTS Number</option>
                <option value="survey" style="background: var(--bg-secondary);">Survey/Gat Number</option>
                <option value="registration" style="background: var(--bg-secondary);">Document Registration Number</option>
              </select>
            </div>

            <div class="search-field">
              <label for="property-query-value">Search Value</label>
              <input 
                type="text" 
                id="property-query-value" 
                name="queryValue" 
                placeholder="Enter search value..."
                required
                autocomplete="off"
              >
            </div>

            <div class="search-field">
              <label for="property-district">District / Region</label>
              <select id="property-district" name="district" style="width: 100%; padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius-md); font-family: var(--font-sans); font-size: 0.95rem; color: var(--primary); background: rgba(255, 255, 255, 0.03); outline: none; transition: all 0.25s ease;">
                <option value="Mumbai Suburban" style="background: var(--bg-secondary);">Mumbai Suburban</option>
                <option value="Mumbai City" style="background: var(--bg-secondary);">Mumbai City</option>
                <option value="Thane" style="background: var(--bg-secondary);">Thane</option>
                <option value="Pune" style="background: var(--bg-secondary);">Pune</option>
              </select>
            </div>

            <button type="submit" class="search-btn" id="property-search-btn">
              Pull Property Transactions
            </button>

            <div class="search-footer">
              IGR Maharashtra eSearch · Direct Index II Records · Cache-Optimized Registry
            </div>
          </form>
        </div>
      </div>
    </main>
  `;
}
