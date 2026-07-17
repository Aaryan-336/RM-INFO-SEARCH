// Property Results View — ASK Wealth styled direct property search output view

export function renderPropertyResultsView(data, query) {
  const { records, summary, analytics, isCached, source } = data;

  // Build document type pills list
  const docTypesHtml = Object.entries(summary.documentTypes || {})
    .map(([type, count]) => `
      <span class="source-pill" style="margin-bottom: 4px;">
        ${escHtml(type)}: <strong>${count}</strong>
      </span>
    `).join(' ');

  // Renders stat cards
  const statsHtml = `
    <div class="realestate-summary">
      <div class="realestate-stat">
        <div class="realestate-stat-value">${summary.totalProperties}</div>
        <div class="realestate-stat-label">Transactions</div>
      </div>
      <div class="realestate-stat">
        <div class="realestate-stat-value">₹${formatCurrency(summary.totalVolume)}</div>
        <div class="realestate-stat-label">Total Volume</div>
      </div>
      <div class="realestate-stat">
        <div class="realestate-stat-value">₹${formatCurrency(summary.averageValue)}</div>
        <div class="realestate-stat-label">Avg Valuation</div>
      </div>
      <div class="realestate-stat">
        <div class="realestate-stat-value" style="font-size: 1rem; padding-top: var(--space-xs);">${Object.keys(summary.documentTypes).length} Types</div>
        <div class="realestate-stat-label">Doc Mix</div>
      </div>
    </div>
  `;

  // Render transaction items
  let transactionCards = '';
  if (records.length === 0) {
    transactionCards = `
      <div class="no-data">
        <div class="no-data-icon">🏚️</div>
        No transaction records found matching the search criteria.
      </div>
    `;
  } else {
    transactionCards = records.map((rec, index) => `
      <div class="property-card" style="animation-delay: ${index * 0.03}s">
        <div class="property-card-header">
          <span class="property-type-badge">🏠 ${escHtml(rec.articleName || rec.type)}</span>
          <span class="property-date">${escHtml(rec.registrationDate)}</span>
        </div>
        <div class="property-details">
          <div class="property-detail-item">
            <div class="property-detail-label">Buyer / Transferee</div>
            <div class="property-detail-value" style="color: var(--primary); font-weight: 600;">${escHtml(rec.buyerName || 'N/A')}</div>
          </div>
          <div class="property-detail-item">
            <div class="property-detail-label">Seller / Transferor</div>
            <div class="property-detail-value">${escHtml(rec.sellerName || 'N/A')}</div>
          </div>
          <div class="property-detail-item" style="grid-column: span 2;">
            <div class="property-detail-label">Property Description / CTS</div>
            <div class="property-detail-value">${escHtml(rec.propertyDescription || 'N/A')}</div>
          </div>
          <div class="property-detail-item">
            <div class="property-detail-label">Consideration</div>
            <div class="property-detail-value property-amount" style="font-size: 0.95rem;">₹${rec.considerationAmount ? rec.considerationAmount.toLocaleString('en-IN') : '0'}</div>
          </div>
          <div class="property-detail-item">
            <div class="property-detail-label">Market Value</div>
            <div class="property-detail-value property-amount" style="font-size: 0.95rem;">₹${rec.marketValue ? rec.marketValue.toLocaleString('en-IN') : '0'}</div>
          </div>
          <div class="property-detail-item">
            <div class="property-detail-label">Document No</div>
            <div class="property-detail-value" style="font-family: var(--font-mono); font-size: 0.8rem;">${escHtml(rec.documentNo)}</div>
          </div>
          <div class="property-detail-item">
            <div class="property-detail-label">SRO / Office</div>
            <div class="property-detail-value" style="font-size: 0.8rem;">${escHtml(rec.sroName)}</div>
          </div>
        </div>
      </div>
    `).join('');
  }

  return `
    <header class="app-header">
      <div class="app-logo">
        <div class="app-logo-icon">A</div>
        ASK Intelligence
      </div>
      <div class="api-status">
        <span class="api-status-dot"></span>
        ${isCached ? 'Cached' : 'Complete'}
      </div>
    </header>

    <main class="results-view">
      <div class="results-header">
        <button class="back-btn" id="back-btn">← New Search</button>
        <div class="results-title">
          <h2>[${escHtml(query.searchType.toUpperCase())}] ${escHtml(query.queryValue)}</h2>
          <p>${escHtml(query.district || 'Maharashtra Districts')}</p>
        </div>
        <div class="results-meta">
          ${source}
          <br>${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>

      <!-- Stats -->
      ${statsHtml}

      <!-- AI RM Analytical Brief -->
      <div class="section-card">
        <div class="section-card-header">
          <span class="section-icon">🧠</span>
          <h3>Real Estate Wealth Analytics</h3>
        </div>
        <div class="section-card-body">
          <div class="brief-summary" style="border: none; margin-bottom: 0; padding-bottom: 0; font-style: normal; line-height: 1.7;">
            ${analytics ? escHtml(analytics).replace(/\n/g, '<br>') : 'Analysis summary unavailable.'}
          </div>
        </div>
      </div>

      <!-- Transaction Log -->
      <div class="section-card">
        <div class="section-card-header">
          <span class="section-icon">📋</span>
          <h3>Transaction Records (Index II)</h3>
          <div style="margin-left: auto;">
            ${docTypesHtml}
          </div>
        </div>
        <div class="section-card-body">
          <div class="realestate-grid">
            ${transactionCards}
          </div>
        </div>
      </div>
    </main>
  `;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCurrency(amount) {
  if (!amount || isNaN(amount)) return '0';
  if (amount >= 10000000) return (amount / 10000000).toFixed(2) + ' Cr';
  if (amount >= 100000) return (amount / 100000).toFixed(2) + ' L';
  if (amount >= 1000) return (amount / 1000).toFixed(0) + 'K';
  return amount.toString();
}
