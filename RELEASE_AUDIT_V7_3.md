# KAIROS Private V7.3 — Final Fix release audit

Release: `7.3.0`

## Final Fix scope
1. Production/Preview Blob isolation using Function deploy context.
2. Same-deploy internal Trace chaining.
3. Idempotent paper-fill reconciliation after partial writes.
4. Chronological transaction-ledger validation.
5. Validated/recoverable backup restore.
6. Supported Netlify platform rate limits plus persistent KAIROS workflow cost budgets.
7. SPY benchmark normalization.
8. Release/version normalization.
9. AI Mirror history serialization plus bounded job/ops retention.

## Verification status
- Router/model policy tests: PASS.
- V7.2 hardening tests: PASS.
- Hard Fix 1/2/3 tests: PASS.
- Final Fix regression tests: PASS.
- Portfolio/accounting/performance tests: PASS.
- Paper Broker/order tests: PASS.
- Decision Review hard-stop tests: PASS.
- V7 presentation/UI lock tests: PASS after intentional 7.3 release/benchmark text update.

The isolated repair environment cannot be treated as proof of a real npm registry installation. A temporary `@netlify/blobs` compatibility shim was used only for local logic QA and is excluded from the release. GitHub CI must perform the authoritative `npm ci --ignore-scripts && npm run verify` on Node 24 before promotion.

## Deployment gate
Do not promote directly from the local ZIP. The intended release chain is:

`Hades-HUB/main → GitHub CI → Netlify Deploy Preview → live diagnostics/smoke tests → production credential migration → production promotion`.

## Polish pass
The release-polish pass is intentionally non-architectural: visual hierarchy and approved layout are unchanged. User-facing version labels, manual-price trust language, market-refresh language, accessibility semantics, keyboard dismissal and release-facing documentation were normalized before the final Git handoff.

## Commercial Hard Fix 2/3 verification

Hard Fix 2/3 adds paid-web operational controls without changing the paper-only execution boundary:

- Stripe Checkout/Portal sessions are server-created.
- Stripe subscription state is accepted only through a verified raw-body webhook signature; duplicate and older events cannot roll entitlement state backward.
- Trial/pro/private entitlements fail closed on paid mutations while preserving workspace read/export access.
- Monthly per-tenant AI-unit consumption is transactional/idempotent in Postgres and rate-limit guards run before paid-unit consumption on background AI jobs.
- Authentication, billing, paper mutations, account changes and backup restore outcomes emit allowlisted relational audit events.
- Owner support diagnostics are sanitized and exclude secrets, raw prompts and position-level financial data.
- Public signup requires billing readiness by default in addition to the Hard Fix 1 Identity/legal gates.

Local full regression passed with temporary QA-only Netlify adapters. Those adapters are not shipping files. The authoritative hosted gate remains GitHub Actions on Node 24 with a real `npm ci --ignore-scripts && npm run verify`, followed by Netlify Deploy Preview integration before production promotion.
