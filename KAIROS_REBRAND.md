# KAIROS rebrand — V7.3

KAIROS is the customer-facing identity for the hardened decision-intelligence system previously branded HADES.

## Surface naming
- HADES → KAIROS
- CROWN → Decision Review
- Evolution Lab → Learning Lab
- Trace Lab → Decision History

## Preserved compatibility
The V7.3 rebrand intentionally does not rename legacy `HADES_*` / `SAURON_*` environment variables, internal storage keys, API routes, or historical release documents. Renaming those would require a migration and creates no customer-facing value.

## Positioning
**An auditable decision journal with adversarial review and paper execution.**

KAIROS sells a reviewable process and its recorded evidence. Paper execution demonstrates that process; it is not a promise of returns or autonomous investment advice.

## Official mark
The official customer-facing mark is the supplied gold K inside a timing dial on black. The exact artwork is preserved for the UI/PWA; derived sizes are generated only for delivery performance and platform icon requirements.

## Environment aliases (main, 2026-10-07)
Canonical operator names are `KAIROS_*`. Legacy `HADES_*` / `SAURON_*` environment variables still resolve, and they win only when the canonical name is unset. Error codes keep the legacy names (`SAURON_SESSION_SECRET_MISSING`, `HADES_INTERNAL_SECRET_WEAK_OR_PLACEHOLDER`) so existing diagnostics stay stable. Do not delete the legacy Netlify values until the owner migration is verified in production. Internal storage keys, API routes, and historical release documents stay on their current names.
