# docs/VALIDATION_ENGINE.md

# Purpose

Ensure every piece of information displayed to an RM is validated, scored, and traceable.

---

## Phone Validation

Checks:

* Valid country code
* Valid number format
* Duplicate removal
* Source reliability
* Cross-source matching

Confidence Scores:

Official company website → 0.98

Official company PDF → 0.95

Apollo → 0.90

RocketReach → 0.88

Public directory → 0.70

Unknown website → 0.40

---

## Email Validation

Checks:

* Valid email syntax
* Domain exists
* MX records exist
* Domain belongs to company
* Cross-source validation

Examples:

[john.doe@company.com](mailto:john.doe@company.com) → Valid

[john.doe@gmail.com](mailto:john.doe@gmail.com) → Lower confidence unless publicly disclosed for business use

---

## Identity Validation

Inputs:

* Person Name
* Company Name

Checks:

* Name similarity
* Company similarity
* Role similarity
* Location similarity
* Multiple source agreement

---

## Confidence Rules

0.95 - 1.00 → Verified

0.85 - 0.94 → High Confidence

0.70 - 0.84 → Medium Confidence

Below 0.70 → Hidden by default

---

## Source Weighting

MCA Data → Highest Trust

Official Company Website → Highest Trust

Official Company Documents → High Trust

Approved Enrichment Provider → High Trust

Single Public Source → Medium Trust

Unknown Source → Low Trust

---

## Final Validation Pipeline

Collect Data
↓
Normalize
↓
Deduplicate
↓
Cross Verify
↓
Assign Confidence
↓
Compliance Check
↓
Display Result
