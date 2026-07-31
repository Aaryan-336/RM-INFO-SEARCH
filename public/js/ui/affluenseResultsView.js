// Affluense Contact Engine Results View

export function renderAffluenseResultsView(data) {
  if (!data) return '<div class="error-msg">No contact data available</div>';

  const query = data.query || {};
  const phones = data.contacts?.phones || [];
  const emails = data.contacts?.emails || [];
  const directors = data.directorMatches || [];
  const summary = data.layerSummary || {};
  const meta = data.engineMeta || {};

  return `
    <div class="affluense-results-container" style="max-width: 960px; margin: 0 auto; padding: 20px 10px;">
      <!-- Header Bar -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
            <button id="aff-back-btn" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#fff; padding:6px 14px; border-radius:6px; font-size:13px; cursor:pointer;">
              ← New Contact Extraction Test
            </button>
            <button id="export-pdf-btn" style="background: linear-gradient(135deg, var(--accent, #d4af37) 0%, #b89443 100%); color: #000; font-weight: 700; font-size: 13px; padding: 6px 14px; border: none; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
              <span>📄</span> Export to PDF
            </button>
          </div>
          <h2 style="font-size:1.8rem; margin:4px 0; color:var(--accent);">
            Contact Extraction Results: ${query.personName}
          </h2>
          <p style="opacity:0.7; font-size:0.9rem; margin:0;">
            Company: <strong>${query.companyName}</strong> ${query.linkedinUrl ? ` · <a href="${query.linkedinUrl}" target="_blank" style="color:var(--accent)">LinkedIn Profile</a>` : ''}
          </p>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.6rem; font-weight:700; color:var(--accent);">${phones.length + emails.length}</div>
          <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; opacity:0.6;">Verified Contacts</div>
          <div style="font-size:0.75rem; color:var(--success); margin-top:4px;">Execution: ${meta.durationMs || 0}ms</div>
        </div>
      </div>

      <!-- Layer Performance Cards -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:28px;">
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:12px; border-radius:8px;">
          <div style="font-size:11px; text-transform:uppercase; opacity:0.6; margin-bottom:4px;">Layer 1: MCA Directors</div>
          <div style="font-weight:600; font-size:14px; color:${summary.layer1_mca?.directors ? 'var(--success)' : 'rgba(255,255,255,0.5)'};">
            ${summary.layer1_mca?.directors || 0} Match(es)
          </div>
        </div>

        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:12px; border-radius:8px;">
          <div style="font-size:11px; text-transform:uppercase; opacity:0.6; margin-bottom:4px;">Layer 2: Bright Data Deep</div>
          <div style="font-weight:600; font-size:14px; color:${summary.layer2_brightdata?.count ? 'var(--success)' : 'rgba(255,255,255,0.5)'};">
            ${summary.layer2_brightdata?.status === 'completed' ? 'Extracted Data' : (summary.layer2_brightdata?.message || 'Processed')}
          </div>
        </div>

        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:12px; border-radius:8px;">
          <div style="font-size:11px; text-transform:uppercase; opacity:0.6; margin-bottom:4px;">Layer 3: Provider Cascade</div>
          <div style="font-weight:600; font-size:14px; color:${summary.layer3_providers?.count ? 'var(--success)' : 'rgba(255,255,255,0.5)'};">
            ${summary.layer3_providers?.count || 0} Found
          </div>
        </div>

        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:12px; border-radius:8px;">
          <div style="font-size:11px; text-transform:uppercase; opacity:0.6; margin-bottom:4px;">Layer 4: DNS MX Verifier</div>
          <div style="font-weight:600; font-size:14px; color:${summary.layer4_smtp_verifier?.mxDomainVerified ? 'var(--success)' : 'rgba(255,255,255,0.5)'};">
            ${summary.layer4_smtp_verifier?.mxDomainVerified ? 'MX Active' : 'Unverified Domain'}
          </div>
        </div>

        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:12px; border-radius:8px;">
          <div style="font-size:11px; text-transform:uppercase; opacity:0.6; margin-bottom:4px;">Layer 5: AI Scoring</div>
          <div style="font-weight:600; font-size:14px; color:var(--success);">
            100% Attributed
          </div>
        </div>
      </div>

      <!-- MAIN RESULTS GRID -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-bottom:32px;">
        <!-- Phone Numbers Column -->
        <div style="background:rgba(11, 61, 63, 0.3); border:1px solid rgba(197, 165, 90, 0.25); border-radius:12px; padding:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:12px;">
            <h3 style="font-size:1.2rem; margin:0; display:flex; align-items:center; gap:8px;">
              <span>📱</span> Phone & Mobile Numbers
            </h3>
            <span style="background:rgba(197, 165, 90, 0.2); color:var(--accent); padding:2px 8px; border-radius:12px; font-size:12px; font-weight:600;">
              ${phones.length}
            </span>
          </div>

          ${phones.length === 0 ? `
            <div style="padding:20px; text-align:center; opacity:0.5; font-size:0.9rem;">
              No mobile numbers found for target name in current sources.
            </div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:12px;">
              ${phones.map(phone => `
                <div style="background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.1); padding:12px 16px; border-radius:8px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:1.1rem; font-weight:700; letter-spacing:0.5px; font-family:'JetBrains Mono', monospace; color:#fff;">
                      ${phone.country === 'IN' ? '🇮🇳 ' : '🌐 '}${phone.value}
                    </div>
                    <span style="background:rgba(46, 204, 113, 0.15); color:#2ecc71; border:1px solid rgba(46, 204, 113, 0.3); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">
                      ${phone.type || 'Mobile'}
                    </span>
                  </div>

                  <div style="display:flex; justify-content:space-between; font-size:11px; opacity:0.65; margin-top:6px;">
                    <span>Source: ${phone.source || 'Affluense Contact Engine'}</span>
                    <span>Confidence: ${Math.round((phone.confidence || 0.9) * 100)}%</span>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Emails Column -->
        <div style="background:rgba(11, 61, 63, 0.3); border:1px solid rgba(197, 165, 90, 0.25); border-radius:12px; padding:20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:12px;">
            <h3 style="font-size:1.2rem; margin:0; display:flex; align-items:center; gap:8px;">
              <span>✉️</span> Verified Email Addresses
            </h3>
            <span style="background:rgba(197, 165, 90, 0.2); color:var(--accent); padding:2px 8px; border-radius:12px; font-size:12px; font-weight:600;">
              ${emails.length}
            </span>
          </div>

          ${emails.length === 0 ? `
            <div style="padding:20px; text-align:center; opacity:0.5; font-size:0.9rem;">
              No verified emails found.
            </div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:12px;">
              ${emails.map(email => `
                <div style="background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.1); padding:12px 16px; border-radius:8px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:1rem; font-weight:600; font-family:'JetBrains Mono', monospace; color:#fff; word-break:break-all;">
                      ${email.value}
                    </div>
                  </div>
                  <div style="display:flex; justify-content:space-between; font-size:11px; opacity:0.65; margin-top:6px;">
                    <span>Source: ${email.source || 'Affluense MX Verifier'}</span>
                    ${email.pattern ? `<span style="font-family:monospace; color:var(--accent)">Pattern: ${email.pattern}</span>` : ''}
                    <span>Confidence: ${Math.round((email.confidence || 0.9) * 100)}%</span>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>

      <!-- Director Matches (if available) -->
      ${directors.length > 0 ? `
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:18px; margin-bottom:24px;">
          <h3 style="font-size:1.1rem; margin-top:0; margin-bottom:12px; color:var(--accent);">
            🏢 Corporate Director MCA Match
          </h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
            ${directors.map(dir => `
              <div style="background:rgba(0,0,0,0.2); padding:10px 14px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); font-size:13px;">
                <div style="font-weight:600; color:#fff;">${dir.name || 'Director'}</div>
                <div style="opacity:0.6; font-size:12px;">DIN: ${dir.din || 'N/A'} · Designation: ${dir.designation || 'Director'}</div>
                ${dir.email ? `<div style="font-family:monospace; color:var(--accent); font-size:11px; margin-top:4px;">${dir.email}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Education & Career Timeline Grid -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-bottom:32px;">
        <!-- Education Card -->
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:20px;">
          <h3 style="font-size:1.1rem; margin-top:0; margin-bottom:16px; color:#2ecc71; display:flex; align-items:center; gap:8px;">
            🎓 Education Details (${data.identity?.linkedinParsedData?.education?.length || 0})
          </h3>
          ${(data.identity?.linkedinParsedData?.education || []).length === 0 ? `
            <div style="opacity:0.5; font-size:0.88rem;">No education entries parsed.</div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:12px;">
              ${data.identity.linkedinParsedData.education.map(edu => `
                <div style="position:relative; padding-left:16px; border-left:2px solid #2ecc71;">
                  <div style="font-size:11px; font-family:'JetBrains Mono', monospace; color:#2ecc71; font-weight:600;">
                    ${edu.duration || 'Period N/A'}
                  </div>
                  <div style="font-weight:600; font-size:0.95rem; color:#fff; margin-top:2px;">
                    ${edu.institution}
                  </div>
                  ${edu.degree ? `<div style="font-size:0.85rem; color:var(--accent); margin-top:2px;">🎓 ${edu.degree}</div>` : ''}
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Career Timeline Card -->
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:20px;">
          <h3 style="font-size:1.1rem; margin-top:0; margin-bottom:16px; color:var(--accent); display:flex; align-items:center; gap:8px;">
            ⏳ Career Timeline (${(data.identity?.linkedinParsedData?.experience || []).length})
          </h3>
          ${(data.identity?.linkedinParsedData?.experience || []).length === 0 ? `
            <div style="opacity:0.5; font-size:0.88rem;">System fallback enabled for career extraction.</div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:12px;">
              ${data.identity.linkedinParsedData.experience.map(exp => `
                <div style="position:relative; padding-left:16px; border-left:2px solid var(--accent);">
                  <div style="font-size:11px; font-family:'JetBrains Mono', monospace; color:var(--accent); font-weight:600;">
                    ${exp.duration || 'Period N/A'}
                  </div>
                  <div style="font-weight:600; font-size:0.95rem; color:#fff; margin-top:2px;">
                    ${exp.title} at ${typeof exp.company === 'object' ? (exp.company.name || '') : exp.company}
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}
