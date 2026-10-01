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
