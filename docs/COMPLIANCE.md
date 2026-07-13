# docs/COMPLIANCE.md

# Purpose

Ensure the RM Intelligence Platform only collects, stores, and displays information that is legally obtained, relevant to business use cases, and properly attributable to a source.

---

## Allowed Data Sources

### Corporate Sources

* MCA records
* Company websites
* Leadership pages
* Investor relations pages
* Annual reports
* Press releases
* Public conference brochures
* Public corporate filings

### Enrichment Providers

* Apollo
* FullEnrich
* RocketReach
* People Data Labs

### Public Professional Sources

* Publicly available professional profiles
* Public interviews
* Public media mentions

---

## Prohibited Sources

The platform must never:

* Access private accounts.
* Circumvent authentication systems.
* Use leaked databases.
* Use breached datasets.
* Purchase illicit data dumps.
* Bypass access controls or CAPTCHAs where prohibited.
* Store passwords or credentials.
* Generate or guess contact information and present it as factual.

---

## Data Display Rules

Every displayed field must contain:

* Value
* Source
* Confidence Score
* Collection Timestamp

Example:

Phone Number
Source: Apollo
Confidence: 0.92
Collected: 2026-07-10

---

## Data Retention Policy

* Maintain source attribution for every field.
* Support record refreshes.
* Support deletion requests.
* Maintain lookup audit logs.
* Remove stale information after configurable expiry periods.

---

## Contact Information Rules

Business contact details may be displayed only when:

* Publicly published by the company.
* Publicly published by the individual for professional purposes.
* Returned by an approved enrichment provider.

If confidence is below 0.70:

* Do not display to RMs by default.

---

## Compliance Principles

* Data minimization
* Source transparency
* Auditability
* Explainability
* Business purpose limitation
* Confidence-based disclosure
