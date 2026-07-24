// Search View — ASK Wealth inspired single-purpose person intelligence search

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
        <p>Generate verified private wealth insights — contact details, career history, company intelligence, and real estate portfolio.</p>
      </div>

      <div class="search-card" style="max-width: 540px;">
        <form id="search-form">
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
      </div>
    </main>
  `;
}
