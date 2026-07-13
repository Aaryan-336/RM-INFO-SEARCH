// Search View — clean centered card with Person Name + Company Name inputs

export function renderSearchView() {
  return `
    <header class="app-header">
      <div class="app-logo">
        <div class="app-logo-icon">RM</div>
        RM Intelligence
      </div>
      <div class="api-status">
        <span class="api-status-dot"></span>
        Live
      </div>
    </header>

    <main class="search-view">
      <div class="search-hero">
        <h1>Intelligence Platform</h1>
        <p>Generate a verified 360° business profile from public records, corporate filings, and enrichment sources.</p>
      </div>

      <form class="search-card" id="search-form">
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
          <label for="linkedin-url">LinkedIn Profile URL <span style="opacity:0.5; font-weight:400">(optional)</span></label>
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
          Sources: MCA Records · Company Websites · LinkedIn · Public Documents · Enrichment APIs
        </div>
      </form>
    </main>
  `;
}
