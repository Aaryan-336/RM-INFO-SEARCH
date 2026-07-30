# RM Intelligence Platform — 360° Prospect Dossier & Contact Engine

An enterprise-grade, AI-powered **Relationship Manager (RM) Intelligence Platform** designed for HNI/UHNI client research, corporate verification, multi-layer contact discovery, compliance screening, and real estate asset mapping.

Built with **Node.js (ES Modules)**, **Express**, **LangGraph-inspired pipeline orchestrators**, **Bright Data APIs**, **Tesseract OCR**, and **Groq (Llama 3.3 70B) / Google Gemini AI**.

---

## 🌟 Key Features & Platform Highlights

- **360° Prospect Dossier Pipeline**: 9-stage parallel and sequential fan-out orchestrator streaming real-time execution progress via Server-Sent Events (SSE).
- **5-Layer Hybrid Contact Discovery Engine**: Multi-tiered discovery combining MCA director filings, Bright Data web extraction, enrichment provider cascades, DNS MX email verifiers, and AI contact attribution.
- **Apify LinkedIn Profile Scraper Engine**: High-fidelity LinkedIn profile scraping via Apify's `harvestapi/linkedin-profile-scraper` actor with fuzzy name validation, dynamic confidence scoring, related profiles network signals, and 1-hour in-memory TTL caching.
- **MCA & Corporate Intelligence**: Automatic Ministry of Corporate Affairs (MCA) DIN/CIN lookup, director network resolution, and Zaubacorp/Tofler registry scraping.
- **Real Estate & Property Intelligence**: Maharashtra IGR registry search for high-value property asset discovery, valuation, and transaction history.
- **AI Briefing & Executive Summary**: Generates structured 360° executive dossiers using Llama 3.3 70B (via Groq) or Google Gemini.
- **Compliance & Risk Screening**: Automated AML, PEP (Politically Exposed Persons), sanction checks, and corporate filing status checks.
- **Two-Dimensional Confidence & Attribution Framework**: Mathematical confidence scoring combining Source Trust Weight × Attribution Proximity.

---

## 🏗️ System Architecture & Workflow

```
                        ┌──────────────────────────────────────────────┐
                        │           RM Intelligence Frontend           │
                        └──────────────────────┬───────────────────────┘
                                               │
                                      SSE Stream Progress
                                               │
                        ┌──────────────────────▼───────────────────────┐
                        │      Express API & Router (/api/*)           │
                        └──────┬───────────────────────────────┬───────┘
                               │                               │
            ┌──────────────────▼──────────┐         ┌──────────▼─────────────────┐
            │   9-Stage 360° Pipeline     │         │   5-Layer Contact Engine   │
            │   (runPipeline)             │         │ (runAffluenseContactEngine)│
            └──────────────────┬──────────┘         └──────────┬─────────────────┘
                               │                               │
 ┌─────────────────────────────┼───────────────────────────────┼─────────────────────────────┐
 │                             │    CORE ENGINES & MODULES     │                             │
 │                             ▼                               ▼                             │
 │   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
 │   │Identity Res.     │  │MCA Intelligence  │  │Public Search     │  │Bright Data       │   │
 │   │(identity.js)     │  │(mca.js)          │  │(publicSearch.js) │  │(brightdata.js /  │   │
 │   │                  │  │                  │  │                  │  │ linkedinBD.js)   │   │
 │   └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
 │   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
 │   │OCR Engine        │  │Enrichment Cascade│  │Validation Engine │  │Compliance Check  │   │
 │   │(ocr.js)          │  │(enrichment.js)   │  │(validation.js)   │  │(compliance.js)   │   │
 │   └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
 │   ┌──────────────────┐  ┌──────────────────┐                                              │
 │   │AI Briefing       │  │IGR Property      │                                              │
 │   │(briefing.js)     │  │(igrScraper.js)   │                                              │
 │   └──────────────────┘  └──────────────────┘                                              │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Detailed Engine Breakdown

### 1. 9-Stage 360° Prospect Dossier Pipeline (`src/engine/orchestrator.js`)
Runs a comprehensive pipeline to construct a 360-degree dossier for any target executive or HNI:
1. **Stage 1: Identity Resolution (`identity.js`)**
   - Normalizes names, strips honorifics (`Mr`, `Dr`, `Shri`, etc.) and suffixes.
   - Generates HNI query variants (promoter, family office, director, DIN).
   - Generates official company domain candidates (`.com`, `.in`, `.co.in`) and core word variations.
2. **Stage 2: MCA Intelligence (`mca.js`)**
   - Queries MCA, Zaubacorp, Tofler, and OpenCorporates registries.
   - Resolves Official Company Name, CIN, DINs, Directors, Authorized Capital, and Director official email disclosures.
3. **Stage 3: Public Search & Web Intelligence (`publicSearch.js`)**
   - Multi-engine search cascade (DuckDuckGo, Bing, Google stealth fallback).
   - Discovers LinkedIn profile URLs, company news, and executive press mentions.
4. **Stage 4: OCR Processing (`ocr.js`)**
   - Scans PDFs and image documents found during public search using **Tesseract.js**.
   - Extracts embedded contact numbers, registration IDs, and addresses.
5. **Stage 5: Contact Enrichment (`enrichment.js`)**
   - Priority cascade across 6 data providers: Bright Data → Apollo → Apify → Hunter.io → RocketReach → People Data Labs (PDL).
6. **Stage 6: Multi-Dimensional Validation (`validation.js`)**
   - Parses phone numbers with `libphonenumber-js`.
   - Validates email syntax, domain MX records, and deduplicates contacts based on source confidence.
7. **Stage 7: Compliance & Risk Screening (`compliance.js`)**
   - Evaluates director status, regulatory defaults, strike-off history, PEP risks, and AML flags.
8. **Stage 8: AI Briefing Generator (`briefing.js`)**
   - Synthesizes findings using Llama 3.3 70B (via Groq API) or Google Gemini into an executive summary, wealth indicators, key risks, and talk tracks.
9. **Stage 9: Real Estate Intelligence (`igrScraper.js` / `igrPropertySearch.js`)**
   - Searches Maharashtra IGR property registration records for target person/company land and residential holdings.

---

### 2. 5-Layer Hybrid Contact Discovery Engine (`src/engine/affluenseContactEngine.js`)
Dedicated engine specialized in extracting high-deliverability phone numbers and verified email addresses:
- **Layer 1: MCA & Director DIN Registries**: Pulls official emails filed with Ministry of Corporate Affairs disclosures.
- **Layer 2: Bright Data Web & Document Deep Scraper**: Deep scans profile text, posts, and bio links for contact numbers and email patterns.
- **Layer 3: Multi-Provider Enrichment Cascade**: Queries Apollo, Hunter, RocketReach, PDL, and Apify in sequence until sufficient contact coverage is achieved.
- **Layer 4: Real-Time DNS MX & Name-Based Email Verifier**: Generates pattern candidates (`first.last@company.com`, `first@company.com`) and validates live DNS MX records.
- **Layer 5: AI Contact Attribution**: Runs Llama 3.3 / Gemini to evaluate whether extracted contacts belong specifically to the target person vs. general company support desks.

### 3. Apify LinkedIn Profile Scraper Engine (`src/engine/linkedinApify.js`)
Direct actor scraper for LinkedIn profiles powered by Apify (`harvestapi/linkedin-profile-scraper`):
- **Endpoint**: Apify Actor REST API (`run-sync-get-dataset-items`).
- **Scraper Modes**: Defaults to no-email mode (`$4 per 1k`); optionally enables email search mode (`$10 per 1k`) via `ENABLE_APIFY_EMAIL_SEARCH=true`.
- **Fuzzy Name Validation**: Computes Jaccard token overlap and Levenshtein similarity between returned name and searched name. If match ratio < 0.60, marks `nameMismatch: true` and applies a confidence penalty ($\le 0.25$).
- **Dynamic Confidence Scoring**: Calculates confidence from name match quality + record completeness (`full_name`, `headline`, `current_company`, `location`, `experience`, `education`, `skills`).
- **Related Profiles Signal**: Maps `moreProfiles[]` to surface lightweight network and mutual connection signals in the executive dossier.
- **In-Memory TTL Cache**: Caches profile responses for 1 hour (3600s) keyed by `linkedinUrl` to avoid duplicate Apify API calls.

---

### 4. Confidence & Attribution Scoring Framework (`src/utils/confidence.js`)
Every piece of intelligence carries a mathematical confidence score:

$$\text{Final Confidence} = \text{Source Confidence} \times \text{Attribution Score}$$

#### Source Weights:
- **MCA Regulatory Filings**: `0.99`
- **Director DIN Filings**: `0.98`
- **Company Official Website**: `0.98`
- **Bright Data LinkedIn API**: `0.95`
- **Apollo / RocketReach**: `0.88` - `0.90`
- **People Data Labs (PDL)**: `0.85`
- **Public Directory Search**: `0.70`

#### Attribution Proximity:
- **AI Attributed / Direct Name Match**: `1.00`
- **Direct Name Match in Email**: `0.95`
- **Proximate Text (< 200 chars from name)**: `0.80`
- **Same Page Mention**: `0.50`
- **Unattributed Company Desk**: `0.30`

---

## 📡 API Reference

### 1. `POST /api/intelligence`
Starts the 9-stage 360° prospect dossier pipeline. Streams real-time SSE progress events.

**Request Body:**
```json
{
  "personName": "Bhavesh Vyas",
  "companyName": "ASK Wealth Advisors",
  "linkedinUrl": "https://www.linkedin.com/in/bhavesh-vyas-123456/"
}
```

**SSE Output Events:**
- `{ "stage": "Identity Resolution", "status": "running", "message": "..." }`
- `{ "stage": "MCA Intelligence", "status": "success", "message": "..." }`
- `{ "type": "result", "data": { ...full dossier JSON... } }`
- `{ "type": "done" }`

---

### 2. `POST /api/affluense-contact`
Runs the dedicated 5-Layer Contact Discovery Engine.

**Request Body:**
```json
{
  "personName": "Bhavesh Vyas",
  "companyName": "ASK Wealth Advisors",
  "linkedinUrl": "",
  "country": "IN"
}
```

---

### 3. `GET /api/health`
Returns configuration status for all external APIs and free-tier engines.

---

## ⚙️ Environment Configuration (`.env`)

Create a `.env` file in the root directory:

```env
# Primary AI Engine (Groq - Llama 3.3 70B)
GROQ_API_KEY=your_groq_api_key

# Fallback AI Engine (Google Gemini)
GEMINI_API_KEY=your_gemini_api_key

# Apify LinkedIn Profile Scraper
APIFY_API_TOKEN=your_apify_token
APIFY_LINKEDIN_ACTOR_ID=harvestapi/linkedin-profile-scraper
ENABLE_APIFY_EMAIL_SEARCH=false

# Bright Data API Config (MCA / Zaubacorp / Web Unlocker)
BRIGHTDATA_API_KEY=your_brightdata_api_key

# Contact Enrichment Provider Keys (Optional / Fallback)
APOLLO_API_KEY=your_apollo_key
HUNTER_API_KEY=your_hunter_key
ROCKETREACH_API_KEY=your_rocketreach_key
PDL_API_KEY=your_pdl_key

# Server Port
PORT=3000
```

---

## 💻 Getting Started

### Prerequisites
- Node.js v18+ (with ES Modules support)
- npm or yarn

### Installation
```bash
# Clone the repository
git clone https://github.com/your-org/RM-INFO-SEARCH.git
cd RM-INFO-SEARCH

# Install dependencies
npm install
```

### Running the Application

#### Development Mode (Auto-reload):
```bash
npm run dev
```

#### Production Mode:
```bash
npm start
```

Access the UI dashboard at: `http://localhost:3000`

---

## 🖥️ User Interface Overview

The platform features a responsive dark-themed dashboard:
- **Search View**: Dual-mode input for 360° Dossier Pipeline or Dedicated Contact Engine.
- **Real-Time Progress Panel**: Live SSE execution feed showing current stage, elapsed duration, and status logs.
- **360° Dossier View**:
  - Executive Profile Summary & AI Briefing.
  - Verified Contacts with Confidence Badges (`Verified`, `High`, `Medium`).
  - Company Registration Details (CIN, DINs, MCA Directors).
  - Career History & LinkedIn Profile Data.
  - Real Estate & Property Holdings.
  - Compliance Risk Check Badges.
