# MCA Search Reliability Architecture

Companion to `02_ARCHITECTURE.md` — this drills into just the search path, since that's
where "it randomly fails" actually shows up in practice.

## Tiered lookup

```
RM search request
       │
       ▼
  Cache lookup (30-day TTL) ──hit──> Return dossier
       │ miss
       ▼
  Provider API (Probe42/Karza/Tofler) ──found──> cache write + Return dossier
       │ not found (or director/DIN data specifically missing)
       ▼
  MCA bulk dataset (data.gov.in) ──company confirmed──> cache CIN + continue
       │ company also not found                  │
       ▼                                          ▼
  Manual review flag                    still no director/DIN data
  (surfaced to RM in-app)  <───────────────────────┘
```

**Tier 3 is company-only, not a full fallback.** data.gov.in's bulk dataset has no
director/DIN fields (see `03_DATA_SOURCES.md`), so it can only ever confirm a company
exists and hand back its CIN — it cannot resolve a directorship graph. In practice this
means: if Tier 2 misses on *company* data, Tier 3 can still resolve it. If Tier 2 misses
specifically on *director* data (company found, but director list incomplete/absent),
Tier 3 has nothing to offer and the request goes straight to manual review.

Never call mca.gov.in's live V3 search pages directly in this path — CAPTCHA and session
expiry make it structurally unreliable as an automated tier. It's fine as a manual
fallback link shown to the RM at the bottom tier (the V3 portal does have live director/
signatory tabs, free to view), just not as automated code.

## Retry logic per tier
Failure at any tier is not one thing — treat these three cases differently:

| Response | Action |
|---|---|
| 404 / empty result | Not a failure — fall through to the next tier immediately, no retry |
| 429 rate limit | Exponential backoff (1s, 2s, 4s), retry same tier up to 3x |
| 5xx / timeout | Retry same tier 2-3x with backoff, then fall through and log loudly |

Conflating a 404 with a timeout is the most common cause of a lookup looking like it
"randomly failed" — a real "not found" gets silently retried and wastes time, or a real
outage gets treated as "not found" and silently returns nothing.

## Matching strategy
- First search on a new name resolves to a **CIN/DIN**, not just a name string
- Once resolved, cache the CIN/DIN against the input name+company pair
- All later lookups for that same entity are direct key lookups (CIN/DIN), not fuzzy
  name search — this is what actually makes lookups reliable over time
- Validate CIN format (21-char structured string) before calling any API — catches typos
  before they waste a call or return a confusing empty result

## Disambiguation
When a name+company resolves to more than one plausible person (common with popular
names), don't auto-pick the first result. Surface all candidates with distinguishing
detail (other directorships, DIN, registered address) and let the RM confirm. Director-
level disambiguation can only happen where director data actually exists — the Provider
API tier, or the manual V3 portal lookup — since the bulk dataset tier has no director
fields to disambiguate against.

## Logging
Track every miss with its reason (not_found / rate_limited / ambiguous_match /
provider_outage) as separate counters. After a few weeks of real usage this tells you
which failure mode actually dominates — whether you need a second provider as backup,
better disambiguation UI, or just more aggressive cache warming — rather than guessing.