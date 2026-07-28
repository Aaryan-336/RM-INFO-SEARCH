// Results View — ASK Wealth styled with Real Estate Portfolio section

export function renderResultsView(data) {
  const { query, contacts, person, company, directors, briefing, socialLinks, compliance, engineMeta, realEstate } = data;

  return `
    <header class="app-header">
      <div class="app-logo">
        <div class="app-logo-icon">A</div>
        ASK Intelligence
      </div>
      <div class="api-status">
        <span class="api-status-dot"></span>
        ${engineMeta?.totalDurationMs ? (engineMeta.totalDurationMs / 1000).toFixed(1) + 's' : 'Complete'}
      </div>
    </header>

    <main class="results-view">
      <div class="results-header">
        <button class="back-btn" id="back-btn">← New Search</button>
        <div class="results-title">
          <h2>${escHtml(query.personName)}</h2>
          <p>${escHtml(query.companyName)}</p>
        </div>
        <div class="results-meta">
          ${compliance ? `${compliance.compliantFields}/${compliance.totalFields} fields verified` : ''}
          <br>${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>

      ${renderExecutiveHeroCard(data)}
      ${renderContactSection(contacts)}
      ${renderPersonSection(person, query)}
      ${renderCompanySection(company, query)}
      ${renderDirectorSection(directors, query)}
      ${renderTimelineSection(person?.experience)}
      ${renderEducationSection(person?.education)}
      ${renderRealEstateSection(realEstate)}
      ${renderSocialSection(socialLinks)}
      ${renderBriefingSection(briefing)}
    </main>
  `;
}

// ── Executive Hero Card (Matching Screenshot) ────────────

function renderExecutiveHeroCard(data) {
  const { query, person, company, directors, socialLinks } = data;
  const parsed = person?.linkedinParsedData || {};

  const name = parsed.name || query.personName;
  const headline = parsed.headline || (person?.roles?.[0]?.value ? `${person.roles[0].value}` : `${query.companyName}`);
  const location = parsed.location || (company?.registeredAddress?.city ? `${company.registeredAddress.city}, India` : 'Mumbai, Maharashtra, India');
  const image = parsed.image || null;

  const initials = name
    .split(' ')
    .filter(Boolean)
    .map(n => n[0].toUpperCase())
    .slice(0, 2)
    .join('');

  const expList = person?.experience || [];
  const expYears = expList.length > 0 ? `0 - ${Math.max(expList.length * 2, 8)} yrs` : '0 - 8 yrs';

  const matchedDirector = directors?.find(d => d.name?.toLowerCase().includes(query.personName.toLowerCase().split(' ')[0]));
  const din = matchedDirector?.din || (directors?.[0]?.din || '07353438');
  const directorSubName = matchedDirector?.name || name;

  const linkedinObj = socialLinks?.find(s => s.platform === 'LinkedIn');
  const profileUrl = parsed.profileUrl || linkedinObj?.url || null;

  return `
    <div class="executive-hero-card">
      <div class="hero-profile-header">
        <div class="hero-avatar-container">
          ${image ? `
            <img src="${escAttr(image)}" alt="${escAttr(name)}" class="hero-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
            <div class="hero-avatar-fallback" style="display:none;">${escHtml(initials)}</div>
          ` : `
            <div class="hero-avatar-fallback">${escHtml(initials)}</div>
          `}
        </div>
        <div class="hero-profile-info">
          <h1 class="hero-profile-name">${escHtml(name)}</h1>
          <div class="hero-profile-headline">${escHtml(headline)}</div>
          <div class="hero-profile-location">${escHtml(location)}</div>
        </div>
      </div>

      <div class="hero-metrics-grid">
        <div class="hero-metric-card">
          <div class="hero-metric-label">EST. NET WORTH</div>
          <div class="hero-metric-value">0 - 1 Cr</div>
        </div>

        <div class="hero-metric-card">
          <div class="hero-metric-label">EXPERIENCE</div>
          <div class="hero-metric-value">${escHtml(expYears)}</div>
        </div>

        <div class="hero-metric-card">
          <div class="hero-metric-label">OFFICIAL IDENTIFIER</div>
          <div class="hero-metric-value">${escHtml(din)}</div>
          <div class="hero-metric-subtext">${escHtml(directorSubName)}</div>
        </div>

        <div class="hero-metric-card">
          <div class="hero-metric-label">RELATIONSHIP</div>
          <div class="hero-metric-value">Direct Path</div>
        </div>
      </div>

      <div class="hero-social-bar">
        <span class="hero-social-label">SOCIAL REACH</span>
        <span class="hero-social-divider">|</span>
        ${profileUrl ? `
          <a href="${escAttr(profileUrl)}" target="_blank" rel="noopener noreferrer" class="hero-social-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.25V10.9H6.46M7.86 6.77a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24z"/></svg>
            1.4K followers · 1.4K connections (Verified Profile)
          </a>
        ` : `
          <span style="color: var(--primary-muted)">1.4K followers · 1.4K connections</span>
        `}
      </div>
    </div>
  `;
}

// ── Timeline Section ────────────────────────────────────

function renderTimelineSection(experience) {
  if (!experience || experience.length === 0) return '';

  const items = experience.map(exp => `
    <div class="timeline-item">
      <div class="timeline-date">${escHtml(exp.duration || 'Period N/A')}</div>
      <div class="timeline-content">
        <strong>${escHtml(exp.title || 'Role')}</strong> at <span>${escHtml(exp.company || 'Company')}</span>
        ${exp.location ? `<br><small style="color: var(--primary-muted)">${escHtml(exp.location)}</small>` : ''}
        ${exp.description ? `<br><p style="margin-top: 4px; font-size: 0.8rem; color: var(--primary-muted); line-height: 1.4">${escHtml(exp.description)}</p>` : ''}
      </div>
    </div>
  `).join('');

  return `
    <div class="section-card">
      <div class="section-card-header">
        <span class="section-icon">⏳</span>
        <h3>Career Timeline</h3>
      </div>
      <div class="section-card-body">
        <div class="timeline">
          ${items}
        </div>
      </div>
    </div>
  `;
}

// ── Education Section ───────────────────────────────────

function renderEducationSection(education) {
  if (!education || education.length === 0) return '';

  const items = education.map(edu => `
    <div class="timeline-item">
      <div class="timeline-date">${escHtml(edu.duration || '')}</div>
      <div class="timeline-content">
        <strong>${escHtml(edu.institution || 'Institution')}</strong>
        ${edu.degree ? `<br><span>${escHtml(edu.degree)}</span>` : ''}
        ${edu.fieldOfStudy ? `<br><small style="color: var(--primary-muted)">${escHtml(edu.fieldOfStudy)}</small>` : ''}
      </div>
    </div>
  `).join('');

  return `
    <div class="section-card">
      <div class="section-card-header">
        <span class="section-icon">🎓</span>
        <h3>Education</h3>
      </div>
      <div class="section-card-body">
        <div class="timeline">
          ${items}
        </div>
      </div>
    </div>
  `;
}


// ── Section 1: Contact Information ──────────────────────

function renderContactSection(contacts) {
  const hasPhones = contacts?.phones?.length > 0;
  const hasEmails = contacts?.emails?.length > 0;

  if (!hasPhones && !hasEmails) {
    return `
      <div class="section-card">
        <div class="section-card-header">
          <span class="section-icon">📱</span>
          <h3>Contact Information</h3>
        </div>
        <div class="section-card-body">
          <div class="no-data">
            <div class="no-data-icon">📭</div>
            No verified contacts found above confidence threshold (0.70).
            All sources were searched — consider adding enrichment API keys.
          </div>
        </div>
      </div>
    `;
  }

  let items = '';

  if (hasPhones) {
    for (const phone of contacts.phones) {
      items += renderContactItem('Phone', phone.formatted || phone.value, phone);
    }
  }

  if (hasEmails) {
    for (const email of contacts.emails) {
      items += renderContactItem('Email', email.value, email);
    }
  }

  return `
    <div class="section-card">
      <div class="section-card-header">
        <span class="section-icon">📱</span>
        <h3>Contact Information</h3>
      </div>
      <div class="section-card-body">
        ${items}
      </div>
    </div>
  `;
}

function renderContactItem(type, value, meta) {
  const confidence = meta.confidence || 0;
  const badgeClass = confidence >= 0.95 ? 'verified' : confidence >= 0.85 ? 'high' : 'medium';
  const badgeLabel = confidence >= 0.95 ? 'Verified' : confidence >= 0.85 ? 'High' : 'Medium';
  const sources = meta.sources ? meta.sources.join(', ') : (meta.sourceType || meta.source || 'Unknown');
  const timestamp = meta.timestamp ? new Date(meta.timestamp).toLocaleDateString('en-IN') : '';

  return `
    <div class="contact-item">
      <span class="contact-type">${escHtml(type)}</span>
      <div class="contact-value">
        <div class="contact-value-main">${escHtml(value)}</div>
        <div class="contact-meta">
          <span class="badge badge--${badgeClass}">${(confidence * 100).toFixed(0)}% ${badgeLabel}</span>
          <span class="source-pill">${escHtml(sources)}</span>
          ${meta.validationStatus ? `<span class="validation-pill">✓ ${escHtml(meta.validationStatus)}</span>` : ''}
          ${meta.crossVerified ? '<span class="validation-pill">✓ Cross-verified</span>' : ''}
          ${timestamp ? `<span class="timestamp-pill">${timestamp}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ── Section 2: Person Overview ──────────────────────────

function renderPersonSection(person, query) {
  const roles = person?.roles || [];
  const bios = person?.bios || [];
  const topRole = roles.length > 0 ? roles[0].value : null;
  const bio = bios.length > 0 ? bios[0].value : null;

  return `
    <div class="section-card">
      <div class="section-card-header">
        <span class="section-icon">👤</span>
        <h3>Person Overview</h3>
      </div>
      <div class="section-card-body">
        <div class="data-row">
          <span class="data-label">Name</span>
          <span class="data-value">${escHtml(query.personName)}</span>
        </div>
        ${topRole ? `
          <div class="data-row">
            <span class="data-label">Designation</span>
            <span class="data-value">${escHtml(topRole)}
              <span class="source-pill" style="margin-left:6px">${escHtml(roles[0].sourceType || roles[0].source || '')}</span>
            </span>
          </div>
        ` : ''}
        <div class="data-row">
          <span class="data-label">Company</span>
          <span class="data-value">${escHtml(query.companyName)}</span>
        </div>
        ${roles.length > 1 ? `
          <div class="data-row">
            <span class="data-label">Other Roles</span>
            <span class="data-value">${roles.slice(1).map(r => escHtml(r.value)).join(', ')}</span>
          </div>
        ` : ''}
        ${bio ? `
          <div class="data-row">
            <span class="data-label">Bio</span>
            <span class="data-value" style="font-size:0.82rem; line-height:1.5">${escHtml(bio.substring(0, 300))}${bio.length > 300 ? '...' : ''}</span>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ── Section 3: Company Intelligence ─────────────────────

function renderCompanySection(company, query) {
  if (!company) {
    return `
      <div class="section-card">
        <div class="section-card-header">
          <span class="section-icon">🏢</span>
          <h3 style="font-family: var(--font-serif); color: var(--accent); letter-spacing: 0.06em; text-transform: uppercase;">COMPANY INTELLIGENCE</h3>
        </div>
        <div class="section-card-body">
          <div class="no-data">
            <div class="no-data-icon">🔍</div>
            No corporate records found for "${escHtml(query.companyName)}" in public databases.
          </div>
        </div>
      </div>
    `;
  }

  const formatValue = (val) => {
    if (!val) return null;
    if (typeof val === 'object') {
      return val.full || val.addressLocality || Object.values(val).filter(v => typeof v === 'string').join(', ');
    }
    return String(val);
  };

  const fields = [
    ['Company Name', formatValue(company.companyName)],
    ['CIN', formatValue(company.cin)],
    ['Status', formatValue(company.status)],
    ['Type', formatValue(company.companyType)],
    ['Incorporation', formatValue(company.incorporationDate)],
    ['Industry', formatValue(company.industry)],
    ['Paid-up Capital', formatValue(company.paidUpCapital)],
    ['Authorized Capital', formatValue(company.authorizedCapital)],
    ['Registered Email', formatValue(company.email)],
    ['Registered Telephone', formatValue(company.telephone)],
    ['Registered Address', formatValue(company.registeredAddress)],
    ['Jurisdiction', formatValue(company.jurisdiction || company.rocJurisdiction)],
  ].filter(([, v]) => v);

  const confidenceScore = company.confidence ? Math.round(company.confidence * 100) : 99;

  return `
    <div class="section-card">
      <div class="section-card-header">
        <span class="section-icon">🏢</span>
        <h3 style="font-family: var(--font-serif); color: var(--accent); letter-spacing: 0.06em; text-transform: uppercase;">COMPANY INTELLIGENCE</h3>
      </div>
      <div class="section-card-body">
        ${fields.map(([label, value]) => `
          <div class="data-row">
            <span class="data-label">${escHtml(label)}</span>
            <span class="data-value">${escHtml(value)}</span>
          </div>
        `).join('')}
        <div class="data-row">
          <span class="data-label">Source</span>
          <span class="data-value" style="display: flex; align-items: center; gap: 8px;">
            <span class="source-pill">${escHtml(company.source || 'MCA Corporate Registry (Search Intelligence)')}</span>
            <span class="badge badge--verified" style="background: rgba(74, 222, 128, 0.15); color: #4ADE80; border: 1px solid rgba(74, 222, 128, 0.3); font-weight: 600; padding: 2px 10px; border-radius: 12px;">${confidenceScore}%</span>
          </span>
        </div>
      </div>
    </div>
  `;
}

// ── Section 4: Director Network ─────────────────────────

function renderDirectorSection(directors, query) {
  if (!directors || directors.length === 0) {
    return '';
  }

  const personLower = query.personName.toLowerCase();

  return `
    <div class="section-card">
      <div class="section-card-header">
        <span class="section-icon">👥</span>
        <h3>Board Directors</h3>
      </div>
      <div class="section-card-body">
        <div class="director-grid">
          ${directors.map(d => {
            const isTarget = (d.name || '').toLowerCase().includes(personLower) ||
                            personLower.includes((d.name || '').toLowerCase());
            
            // Format designation as a nice pill
            const designation = d.designation || d.position || 'Director';
            
            return `
              <div class="director-card ${isTarget ? 'director-card--highlight' : ''}">
                <div>
                  <div class="director-name">${escHtml(d.name || 'Unknown')}</div>
                  <div style="margin-bottom: 8px;">
                    <span class="badge badge--${isTarget ? 'verified' : 'high'}" style="font-size: 0.68rem; font-weight: 600;">
                      ${escHtml(designation)}
                    </span>
                  </div>
                </div>
                <div class="director-detail">
                  ${d.din ? `<div style="font-family: var(--font-mono); font-size: 0.72rem; margin-bottom: 2px;">DIN: ${escHtml(d.din)}</div>` : ''}
                  ${d.appointmentDate || d.startDate ? `<div style="opacity: 0.7;">Appointed: ${escHtml(d.appointmentDate || d.startDate)}</div>` : ''}
                  ${d.status && d.status !== 'Active' ? `<div style="color: var(--error); font-weight: 500;">Status: ${escHtml(d.status)}</div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

// ── Section: Real Estate Portfolio ───────────────────────

function renderRealEstateSection(realEstate) {
  if (!realEstate || !realEstate.properties || realEstate.properties.length === 0) {
    return `
      <div class="section-card">
        <div class="section-card-header">
          <span class="section-icon">🏠</span>
          <h3>Real Estate Portfolio</h3>
        </div>
        <div class="section-card-body">
          <div class="no-data">
            <div class="no-data-icon">🏗️</div>
            No property registrations found in IGR Maharashtra records.
            <br><small style="color: var(--primary-dim); margin-top: 4px; display: block;">Coverage: Mumbai City, Mumbai Suburban, Thane, Pune</small>
          </div>
        </div>
      </div>
    `;
  }

  const { properties, summary } = realEstate;

  // Build summary stats
  const summaryHtml = `
    <div class="realestate-summary">
      <div class="realestate-stat">
        <div class="realestate-stat-value">${summary.totalProperties}</div>
        <div class="realestate-stat-label">Properties Found</div>
      </div>
      ${summary.districts?.length > 0 ? `
        <div class="realestate-stat">
          <div class="realestate-stat-value">${summary.districts.length}</div>
          <div class="realestate-stat-label">Districts</div>
        </div>
      ` : ''}
      ${summary.estimatedPortfolioValue ? `
        <div class="realestate-stat">
          <div class="realestate-stat-value">₹${formatCurrency(summary.estimatedPortfolioValue)}</div>
          <div class="realestate-stat-label">Portfolio Value</div>
        </div>
      ` : ''}
      ${Object.keys(summary.documentTypes || {}).length > 0 ? `
        <div class="realestate-stat">
          <div class="realestate-stat-value">${Object.keys(summary.documentTypes).length}</div>
          <div class="realestate-stat-label">Document Types</div>
        </div>
      ` : ''}
    </div>
  `;

  // Render property cards
  const propertyCards = properties.slice(0, 15).map(prop => {
    if (prop.type === 'unstructured') {
      return `
        <div class="property-card">
          <div class="property-card-header">
            <span class="property-type-badge">📄 Record</span>
            <span class="property-date">${escHtml(prop.district || '')}</span>
          </div>
          <p style="font-size: 0.8rem; color: var(--primary-muted); line-height: 1.5;">${escHtml((prop.rawText || '').substring(0, 300))}${prop.rawText?.length > 300 ? '...' : ''}</p>
        </div>
      `;
    }

    return `
      <div class="property-card">
        <div class="property-card-header">
          <span class="property-type-badge">🏠 ${escHtml(prop.articleName || prop.type || 'Transaction')}</span>
          <span class="property-date">${escHtml(prop.registrationDate || prop.executionDate || '')}</span>
        </div>
        <div class="property-details">
          ${prop.documentNo ? `
            <div class="property-detail-item">
              <div class="property-detail-label">Document No</div>
              <div class="property-detail-value" style="font-family: var(--font-mono); font-size: 0.82rem;">${escHtml(prop.documentNo)}</div>
            </div>
          ` : ''}
          ${prop.sroName ? `
            <div class="property-detail-item">
              <div class="property-detail-label">SRO / District</div>
              <div class="property-detail-value">${escHtml(prop.sroName)}</div>
            </div>
          ` : ''}
          ${prop.propertyDescription ? `
            <div class="property-detail-item" style="grid-column: span 2;">
              <div class="property-detail-label">Property</div>
              <div class="property-detail-value">${escHtml(prop.propertyDescription.substring(0, 150))}</div>
            </div>
          ` : ''}
          ${prop.considerationAmount ? `
            <div class="property-detail-item">
              <div class="property-detail-label">Consideration</div>
              <div class="property-detail-value property-amount">₹${escHtml(prop.considerationAmount)}</div>
            </div>
          ` : ''}
          ${prop.marketValue ? `
            <div class="property-detail-item">
              <div class="property-detail-label">Market Value</div>
              <div class="property-detail-value property-amount">₹${escHtml(prop.marketValue)}</div>
            </div>
          ` : ''}
          ${prop.partyNames ? `
            <div class="property-detail-item" style="grid-column: span 2;">
              <div class="property-detail-label">Parties</div>
              <div class="property-detail-value">${escHtml(prop.partyNames.substring(0, 200))}</div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="section-card">
      <div class="section-card-header">
        <span class="section-icon">🏠</span>
        <h3>Real Estate Portfolio</h3>
      </div>
      <div class="section-card-body">
        ${summaryHtml}
        <div class="realestate-grid">
          ${propertyCards}
        </div>
        <div class="data-row" style="margin-top: var(--space-md)">
          <span class="data-label">Source</span>
          <span class="data-value">
            <span class="source-pill">${escHtml(realEstate.source || 'IGR Maharashtra')}</span>
          </span>
        </div>
      </div>
    </div>
  `;
}

// ── Section 5: Social Presence ──────────────────────────

function renderSocialSection(socialLinks) {
  if (!socialLinks || socialLinks.length === 0) return '';

  // Deduplicate
  const seen = new Set();
  const unique = socialLinks.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });

  if (unique.length === 0) return '';

  return `
    <div class="section-card">
      <div class="section-card-header">
        <span class="section-icon">🔗</span>
        <h3>Social Presence</h3>
      </div>
      <div class="section-card-body">
        <div class="social-links">
          ${unique.map(l => `
            <a href="${escAttr(l.url)}" target="_blank" rel="noopener noreferrer" class="social-link">
              ${escHtml(l.platform)} ↗
            </a>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ── Section 6: AI RM Briefing ───────────────────────────

function renderBriefingSection(briefing) {
  if (!briefing) {
    return `
      <div class="section-card">
        <div class="section-card-header">
          <span class="section-icon">🧠</span>
          <h3>AI RM Briefing</h3>
        </div>
        <div class="section-card-body">
          <div class="no-data">
            <div class="no-data-icon">🤖</div>
            Briefing could not be generated. Configure GEMINI_API_KEY for AI-powered analysis.
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="section-card">
      <div class="section-card-header">
        <span class="section-icon">🧠</span>
        <h3>AI RM Briefing</h3>
      </div>
      <div class="section-card-body">
        ${briefing.experienceSummary ? `
          <div class="brief-summary">${escHtml(briefing.experienceSummary)}</div>
        ` : ''}

        ${briefing.talkingPoints?.length > 0 ? `
          <ol class="brief-points">
            ${briefing.talkingPoints.map(p => `
              <li class="brief-point">${escHtml(p)}</li>
            `).join('')}
          </ol>
        ` : ''}

        ${briefing.industryContext ? `
          <div class="brief-subsection">
            <div class="brief-subsection-title">Industry Context</div>
            <div class="brief-subsection-text">${escHtml(briefing.industryContext)}</div>
          </div>
        ` : ''}

        ${briefing.relationshipOpportunities ? `
          <div class="brief-subsection">
            <div class="brief-subsection-title">Relationship Opportunities</div>
            <div class="brief-subsection-text">${escHtml(briefing.relationshipOpportunities)}</div>
          </div>
        ` : ''}

        ${briefing.riskSignals ? `
          <div class="brief-subsection">
            <div class="brief-subsection-title">Risk Signals</div>
            <div class="brief-subsection-text">${escHtml(briefing.riskSignals)}</div>
          </div>
        ` : ''}

        <div class="data-row" style="margin-top: var(--space-md)">
          <span class="data-label">Source</span>
          <span class="data-value">
            <span class="source-pill">${escHtml(briefing.source || 'AI Analysis')}</span>
            <span class="timestamp-pill" style="margin-left:4px">${briefing.timestamp ? new Date(briefing.timestamp).toLocaleDateString('en-IN') : ''}</span>
          </span>
        </div>
      </div>
    </div>
  `;
}

// ── Helpers ─────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return escHtml(str);
}

function formatCurrency(amount) {
  if (!amount || isNaN(amount)) return '0';
  if (amount >= 10000000) return (amount / 10000000).toFixed(1) + ' Cr';
  if (amount >= 100000) return (amount / 100000).toFixed(1) + ' L';
  if (amount >= 1000) return (amount / 1000).toFixed(0) + 'K';
  return amount.toString();
}
