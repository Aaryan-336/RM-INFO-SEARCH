# DESIGN.md

# Design Philosophy

* Minimal
* Fast
* Information Dense
* Mobile Friendly
* RM First

No unnecessary animations.

No dashboards with 50 widgets.

Every component must answer:

"Will this help an RM before a meeting?"

---

# Color Palette

Background:

* White

Primary:

* Black

Accent:

* Deep Blue

Success:

* Green

Warning:

* Orange

---

# Layout

## Header

Logo
Search Bar
Profile Button

---

## Search Card

Inputs:

* Person Name
* Company Name

Button:

Generate Intelligence

---

## Results Page

### Section 1 — Contact Information

Display only:

* Mobile Number
* Email Address
* Confidence Score
* Source

---

### Section 2 — Person Overview

* Name
* Designation
* Experience
* Current Company

---

### Section 3 — Company Overview

* Industry
* CIN
* Incorporation Date
* Address
* Capital

---

### Section 4 — Director Network

Simple cards:

```text
Director Name
Current Companies
Industry
```

---

### Section 5 — Timeline

```text
2016 → Joined Company A
2019 → Joined Company B
2023 → Joined Current Company
```

---

### Section 6 — AI Brief

Maximum:

5 bullet points.

Example:

* Handles UHNI clients.
* Extensive wealth management experience.
* Strong exposure to financial products.
* Long tenure in private wealth.
* Potential discussion area: portfolio construction.

---

# Component Rules

Maximum card width:
800px

Maximum nesting depth:
2

Maximum clicks to any information:
2

---

# Mobile Layout

Search
↓

Contact Card
↓

Person Card
↓

Company Card
↓

Director Card
↓

AI Brief

Single column only.

No sidebars.

No tabs.

No hamburger menus.

---

# Loading Experience

```text
Finding company records...
Analyzing director network...
Searching public contact sources...
Generating RM intelligence...
```

Total target loading time:

< 30 seconds
