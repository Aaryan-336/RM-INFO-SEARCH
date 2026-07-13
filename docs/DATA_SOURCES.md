# Data Sources

## Company & director data (replaces raw MCA scraping)
MCA's own portal (mca.gov.in) is CAPTCHA-gated, session-walled, and most detail views/document
downloads are paid per-transaction through their gateway. Don't scrape it — it will break
constantly and breaches their terms. Instead use a licensed re-seller that already has a
data agreement with MCA:

| Provider | What it gives you | Notes |
|---|---|---|
| **Probe42** | CIN/DIN lookup, financials, director network, filing history | API-first, built for fintech due diligence |
| **Karza (Perfios)** | KYC bureau + MCA data + PAN/GST verification | Strong for KYC-linked lookups |
| **Signzy** | KYC + corporate data APIs | Common in wealth/broking onboarding |
| **Tofler / ZaubaCorp** | Company & director data, cheaper/lighter | Good for quick lookups, less real-time |
| **data.gov.in company master data** | Bulk company-level dump: CIN, name, status, class, category, authorized/paid-up capital, registration date, RoC, registered address | Free, no CAPTCHA, batch download — but **company-level only, no directors/DIN** |

Pick a provider based on budget — Tofler is cheapest to start, Probe42/Karza are more
production-grade if this becomes a real ASK internal tool.

### The director/DIN gap
data.gov.in's bulk dataset does not include directorship data at all — its fields stop at
company master info. Director names, DINs, and the directorship graph only exist in two
places:
1. **Licensed provider API** (Probe42/Karza/Tofler) — they've built compliant access to
   this data at scale. This is what powers Tier 2 of the search architecture.
2. **MCA V3 portal, live, CAPTCHA-gated** — free to view (fee only applies to downloading
   filed documents), with dedicated tabs for directors, charges, and signatory details.
   This is not automatable and stays a manual fallback (Tier 4), not a pipeline stage.

So the free bulk dataset can confirm a company exists and hand you its CIN, but it cannot
resolve "who are this person's other directorships" — that always routes through the
licensed provider or a manual portal lookup.

## Professional background
- **LinkedIn**: only via official channels you're licensed for (Sales Navigator export,
  or LinkedIn's official API if ASK has a partnership). Scraping LinkedIn profiles violates
  their ToS and is the single most litigated scraping case in this space (hiQ v. LinkedIn
  going the *opposite* way of what people assume — LinkedIn has won enforcement since).
- **Company "About/Team" pages**: fine to scrape, it's the company's own published info.

## Market/press signals
- Exchange filings (BSE/NSE) if the company is listed — same crawler pattern you already
  built for the Financial Result Tracker project
- News: NewsAPI, or targeted `web_search` at request time rather than a standing crawler

## What's deliberately absent from this list
Personal mobile number lookup and personal net worth estimation services. The "OSINT people
search" tools that do this (Truecaller reverse lookup at scale, data-broker aggregators,
"skip tracing" APIs) exist, but wiring them into an internal tool to build profiles on people
who haven't consented is where this stops being due diligence and starts being surveillance —
independent of who's asking. If ASK's actual need is "verify a lead's phone number," the clean
version is: capture it via a form/KYC step where the person provides it themselves, or pull it
from your own CRM records if the person is already a client.