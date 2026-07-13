# ARCHITECTURE.md

# System Flow

User Input
↓
Identity Resolution Engine
↓
Public Intelligence Collection
↓
Contact Enrichment Fallback
↓
OCR Processing
↓
Knowledge Graph Creation
↓
AI Report Generation

---

## Identity Resolution

Input:

* Name
* Company Name

Output:

* Canonical Person Record

Example:

Bhavesh Vyas
Bhavesh K Vyas
B Vyas

→ Single Person Entity

---

## Contact Pipeline

Step 1:
Search public company sources.

Step 2:
Search public documents.

Step 3:
Search public business directories.

Step 4:
If no result:
Trigger Apollo.

Step 5:
If still no result:
Trigger FullEnrich.

Step 6:
Merge results and calculate confidence score.

---

## Phone Verification Logic

If source == company website:
confidence = 0.98

If source == Apollo:
confidence = 0.90

If same number appears in multiple sources:
confidence += 0.05

If confidence < 0.70:
do not show to RM.

---

## OCR Pipeline

Document
↓
OCR
↓
Layout Detection
↓
Entity Extraction
↓
Knowledge Graph

Supported:

* PDF
* Image
* Scanned PDF
* Handwritten PDF

---

## Database Schema

Person

* id
* name
* company
* designation
* linkedin
* summary

Contact

* person_id
* phone
* email
* confidence
* source

Company

* cin
* name
* address
* industry

Director

* company_id
* director_name
* din

Relationship

* source
* target
* type

---

## APIs

POST /profile/search

GET /profile/{id}

GET /company/{cin}

GET /directorships/{din}

POST /contact/enrich

POST /ocr/process

POST /report/generate

---

## Recommended Stack

Frontend:

* NextJS

Backend:

* FastAPI

Scraping:

* Playwright
* BeautifulSoup

OCR:

* PaddleOCR
* Surya OCR

Database:

* PostgreSQL

Graph:

* Neo4j

Caching:

* Redis

AI:

* GPT
* Claude
* Gemini

Deployment:

* Docker
* Railway
* Render
