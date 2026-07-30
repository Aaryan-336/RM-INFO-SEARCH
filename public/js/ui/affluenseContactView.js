// Affluense Contact Intelligence Engine — Dedicated Testing Tab UI

export function renderAffluenseContactView() {
  return `
    <div class="search-view">
      <div class="search-hero">
        <div class="tab-badge" style="display:inline-flex; align-items:center; gap:6px; background:rgba(197, 165, 90, 0.15); color:var(--accent); border:1px solid rgba(197, 165, 90, 0.4); padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600; letter-spacing:1px; margin-bottom:12px; text-transform:uppercase;">
          <span>⚡</span> Proprietary Contact Discovery Engine
        </div>
        <h1 style="font-size:2.4rem; margin-bottom:8px;">Affluense Contact Engine</h1>
        <div class="search-divider"></div>
        <p>5-Layer Multi-Source Contact Discovery & Real-Time SMTP Handshake Verification for Phone Numbers & Emails.</p>
      </div>

      <div class="search-card" style="max-width: 600px; margin:0 auto;">
        <form id="affluense-contact-form">
          <div class="search-field">
            <label for="aff-person-name">Target Person Name</label>
            <input 
              type="text" 
              id="aff-person-name" 
              name="personName" 
              placeholder="e.g. Jainam Shah or Rajesh Kumar"
              required
              autocomplete="off"
            >
          </div>

          <div class="search-field">
            <label for="aff-company-name">Company Name</label>
            <input 
              type="text" 
              id="aff-company-name" 
              name="companyName" 
              placeholder="e.g. ASK WEALTH ADVISORS PRIVATE LIMITED"
              required
              autocomplete="off"
            >
          </div>

          <div class="search-field">
            <label for="aff-linkedin-url">LinkedIn Profile URL <span style="opacity:0.4; font-weight:400; letter-spacing:0">(optional)</span></label>
            <input 
              type="url" 
              id="aff-linkedin-url" 
              name="linkedinUrl" 
              placeholder="e.g. https://www.linkedin.com/in/jainam-shah-b0081b258"
              autocomplete="off"
            >
          </div>

          <div class="search-field">
            <label for="aff-country">Target Region / Default Country Code</label>
            <select id="aff-country" name="country" style="width:100%; padding:10px 14px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); color:#fff; border-radius:6px; font-size:14px;">
              <option value="IN" selected>India (+91)</option>
              <option value="US">United States (+1)</option>
              <option value="GB">United Kingdom (+44)</option>
              <option value="AE">United Arab Emirates (+971)</option>
              <option value="SG">Singapore (+65)</option>
            </select>
          </div>

          <button type="submit" class="search-btn" id="aff-search-btn" style="background: linear-gradient(135deg, var(--accent) 0%, #a8883b 100%); color:#000; font-weight:700;">
            Run Affluense Contact Extraction
          </button>

          <div class="search-footer" style="margin-top:14px;">
            <span>Layer 1: MCA Directors</span> · 
            <span>Layer 2: Bright Data Deep Scraper</span> · 
            <span>Layer 3: Provider Cascade</span> · 
            <span>Layer 4: DNS MX Verifier</span> · 
            <span>Layer 5: AI Scoring</span>
          </div>
        </form>
      </div>
    </div>
  `;
}
