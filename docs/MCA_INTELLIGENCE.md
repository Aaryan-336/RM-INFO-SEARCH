# MCA_INTELLIGENCE.md

# Objective

Given a:

* Person Name
* Company Name

extract all useful corporate intelligence from MCA and transform it into RM-friendly insights.

---

# Input

```json
{
  "person_name": "Bhavesh Vyas",
  "company_name": "ASK Wealth Advisors"
}
```

---

# Output

## Company Intelligence

* Company Name
* CIN
* Company Status
* Company Type
* Incorporation Date
* Registered Address
* Paid Up Capital
* Authorized Capital
* Industry Classification
* ROC Jurisdiction

---

## Director Intelligence

For every director:

* Name
* DIN
* Appointment Date
* Designation
* Director Status
* Director Since

---

## Directorship Intelligence

For each director:

* Active Directorships
* Past Directorships
* Number of Companies Managed
* Company Categories
* Industries Involved In

---

## Filing Intelligence

Extract:

* Annual Returns
* Financial Statements
* Charges
* Significant Events
* Auditor Changes
* Share Capital Changes

---

## OCR Intelligence

Supported Documents:

* Scanned PDFs
* Image PDFs
* Handwritten Documents
* Annual Reports
* Attachments

Extract:

* Names
* Addresses
* Shareholding Information
* Financial Metrics
* Director Mentions
* Contact Details if publicly disclosed

---

# MCA Processing Pipeline

```text
Company Name
    ↓
Company Resolution
    ↓
Fetch CIN
    ↓
Fetch Company Master Data
    ↓
Fetch Directors
    ↓
Fetch Directorship Network
    ↓
Download Filings
    ↓
OCR + Entity Extraction
    ↓
Knowledge Graph
```

---

# Confidence Rules

Company Data → 99%

Director Data → 98%

DIN Mapping → 98%

OCR Extraction → 80-95%

Contact Information → Source Dependent

---

# Final RM Output

## Company Snapshot

## Director Network

## Corporate Relationships

## Filing Summary

## Key Insights

## Risk Signals

## Suggested RM Talking Points
