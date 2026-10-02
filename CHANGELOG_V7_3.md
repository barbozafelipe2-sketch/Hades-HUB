# KAIROS V7.3 — Final hardening release

## Architecture
- Routine dashboard refresh is deterministic market-data first; expensive AI interpretation is opt-in.
- Wallet Mirror and Learning Lab moved to bounded background jobs.
- Decision Review preserves capability tier across provider fallback and enforces provider diversity when available.
- Role-specific output-token budgets added.

## Trust and financial integrity
- Decision conviction/freshness/source quality are system-derived from vendor timestamps, source authority, agreement and attack results.
- Manual marks cannot qualify as verified automatic-execution prices.
- Transaction history now rejects chronological oversells before persistence.
- Deterministic paper-fill IDs reconcile partial transaction/order writes back to FILLED without duplicate execution.
- SPY is the explicit Performance Mirror benchmark.

## Security and storage
- Password changes invalidate all older sessions through credential versioning.
- Production auth fails closed when credential storage is unavailable.
- Preview/branch deploys use deploy-scoped Netlify Blob storage; production remains site-scoped.
- Internal background chaining stays on the originating deploy URL.
- Expensive workflow budgets are persisted inside KAIROS; Netlify platform rate-limit rules were reduced to supported 60-second windows.

## Recovery and observability
- Historical Trace reconstruction and decision outcomes use point-in-time licensed closes.
- Trace catch-up is bounded, resumable and cursor/run-ID controlled.
- Operational traces retain request/job/provider timing metadata and are pruned after 30 days.
- Job histories are bounded.
- Backup restore is validate-first with a recovery snapshot and automatic rollback attempt.

## Release engineering
- Netlify Identity is isolated behind a KAIROS provider adapter so commercial auth flows can be unit-tested without a hosted Identity runtime; hosted Netlify execution cannot replace the official SDK adapter.
- Node 24 aligned across package, CI and Netlify.
- `package-lock.json` committed; `@netlify/blobs` pinned to 11.0.3.
- Release identity normalized to 7.3.0.
- Full regression adds Final Fix coverage for preview isolation, ledger oversells, fill reconciliation, backup consistency, rate-limit validity and SPY benchmark truth.

## Polish pass
- Corrected all user-facing V7.3 release identity labels.
- Clarified deterministic market-refresh and manual-mark language.
- Added keyboard/screen-reader semantics to drawers, status messages, loading buttons, chat, account navigation and runtime modals.
- Added Escape-to-close behavior for transient UI surfaces without changing the approved visual layout.

## KAIROS commercial rebrand
- Customer-facing product renamed from HADES to KAIROS.
- Official gold K/timing-dial mark adopted for login, navigation and PWA icons.
- Mythology-heavy customer labels were neutralized: CROWN → Decision Review, Evolution Lab → Learning Lab, Trace Lab → Decision History.
- Internal HADES_/SAURON_ compatibility identifiers remain unchanged to avoid needless state/secret migrations.
- Performance benchmark wording is consistently SPY.
## Commercial Hard Fix 1/3
- Added Netlify Identity 2.0 as the primary commercial authentication provider; legacy admin auth remains a controlled migration bridge only.
- Added request-scoped tenant isolation and system-vs-tenant Blob namespaces.
- Added one-time non-destructive migration of the private root ledger/Trace/decision state into the bootstrap owner tenant.
- Added tenant-aware daily Trace fan-out and tenant propagation for chained background catch-up work.
- Added fail-closed public signup gates requiring Identity, legal entity, Terms version, Risk Disclosure version, and an explicit release-ready flag.
- Commercial Identity users never store application password hashes in KAIROS state.
- Added commercial paper/research disclosures and Identity-aware security UI.

- Transactional/customer state now uses Netlify Database/Postgres; Blobs are retained for historical/artifact workloads.
- Database records are additionally namespaced by production vs deploy ID so Deploy Preview code cannot query copied production rows.
- Commercial email signup remains pending until Identity confirms the address; confirmation provisions the preallocated tenant/user IDs.
- GitHub CI now runs on both `main` and `kairos-commercial-hardening` during the staged commercial hardening sequence.
- GitHub CI no longer fakes a Netlify runtime for distributed Blob-lock tests; it verifies the conditional-write protocol structurally and leaves runtime execution to Deploy Preview.

- Final-fix preview isolation coverage now validates deploy/site routing without performing Netlify Blob I/O inside GitHub Actions; real Blob isolation remains a Deploy Preview integration gate.


## Commercial Hard Fix 2/3
- Added server-side Stripe Checkout and Billing Portal session creation; no Stripe secret is exposed to the client.
- Added raw-body Stripe webhook verification, timestamp tolerance, replay protection, stale-event rejection and active-subscription conflict protection.
- Added tenant-scoped trial/pro/private entitlements. Expired/unpaid tenants retain read/export access while paid mutations and AI workflows fail closed.
- Added Postgres-backed monthly AI-unit accounting with per-plan limits, per-feature weights and request/job idempotency.
- Added relational, allowlisted audit events for authentication, billing, account changes, paper activity and backup restore outcomes.
- Added owner-only commercial status, audit-log and sanitized support-diagnostics endpoints.
- Public signup now requires Stripe billing readiness by default in addition to Identity/legal release gates; private beta can explicitly opt out.
- Provider live diagnostics now require valid commercial access and consume one AI unit per configured LLM provider before any probe runs.

## Dynamic crypto universe
- Broker crypto discovery is provider-driven instead of limited to BTC/ETH.
- Search and pagination cover every USD crypto pair returned by the licensed provider catalog (bounded at 10,000 normalized pairs per cache snapshot).
- Dynamic crypto symbols use canonical BASE-USD identifiers and resolve licensed quote/history on demand for Broker, paper execution and Decision Review.
- Non-USD pairs are intentionally excluded from the paper-broker catalog to keep pricing/accounting currency coherent.

## Commercial Hard Fix 3/3 — track record evidence
- Added an append-only, tenant-scoped Decision Review response ledger for followed / overrode / no paper action, with optional same-symbol paper-order linkage and idempotent requests.
- Added explicit UI copy that these are self-reported behavior records and do not prove causality.
- Added an additive migration and database checks for tenant FK isolation and duplicate response replay.
- Added deterministic Track Record Ledger built only from recorded paper snapshots and point-in-time decision outcomes.
- Added SPY-relative paper return, data coverage, checkpoint scorecards at 1/7/30/90/365 days, and explicit exclusion of non-point-in-time outcomes.
- Added SHA-256 evidence hashing and authenticated JSON export. The product explicitly states that this is an integrity check, not an external audit or third-party attestation.
- Added claims guardrails: paper-only, descriptive, non-predictive wording; no alpha or future-return claim is generated from the ledger.

## Commercial Hard Fix 4/5 — privacy lifecycle
- Added owner-only workspace deletion with exact confirmation phrase and immediate access lock.
- Deletion runs as an internal authenticated background job so long tenant purges cannot be cut off by a browser request timeout.
- Active Stripe subscriptions are cancelled before customer data purge; cancellation failure stops the purge.
- Tenant state, Blobs, usage rows, audit rows, login/billing mappings and Netlify Identity users are removed; only an anonymous deletion receipt remains.
- The original private owner workspace is protected from self-service deletion unless an explicit server-side override is enabled.
- Added Data & Privacy controls for workspace backup, Track Record export and deletion.

## Commercial Hard Fix 5/5 — public release gate
- Added fail-closed Commercial Release Gate for public signup.
- Public launch requires versioned/timestamped legal review, Terms/Risk/Privacy configuration, canonical HTTPS URL, support contact, Identity, billing when required, approved Preview smoke test, and explicit public-release approval.
- Product mode is locked to paper_research for this release and real-money execution must remain disabled.
- Added owner-only launch-readiness diagnostics combining release configuration, Postgres persistence, AI Gateway, licensed market feed, security and billing readiness.
- Added CI commercial-copy guardrails against guaranteed-return, beat-the-market, get-rich, risk-free-profit and similar promises.
- Replaced wealth-promise-flavored public copy with descriptive paper-research language.
