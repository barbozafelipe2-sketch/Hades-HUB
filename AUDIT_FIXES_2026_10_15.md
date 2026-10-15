# Audit corrections — 2026-10-15

This release corrects the reproduced financial, persistence, and interface defects from the Hades audit. The application remains a paper simulation.

## Changes

- H01/H04/M17/M18: deletion purges both logical and namespaced relational data; legacy migration reads actual tenant Blobs, retries empty v1 markers through a versioned import, and preserves original sources. New migration makes tenant-owned ledger identifiers composite. Replacing active marks is transactional, including empty/older restores.
- H02/H03/H08: refresh preserves execution provenance. Paper orders and allocation builds share the same licensed, fresh, non-manual mark policy. Historical closes cannot supply allocation fills. Future timestamps fail validation.
- H05/H07/M24: chat builds are previews and never execute trades; negated/instructional questions do not trigger build intent. Ledger/profile currency is USD until real FX accounting exists. Market confidence remains qualitative; invented percentages were removed.
- H06/M19/M20: billing updates serialize per tenant before checking event ordering; logout revokes the app token. Restores, crypto mark mutations, evolution changes, and daily workers enforce commercial access. Exports remain available. Existing app tokens without a session identifier require sign-in again.
- H09/M15/M26: scoring uses the licensed historical authority when configured. Evolution and server calibration share outcome eligibility (verified point-in-time evidence, finite return, at least seven days). The UI consumes server calibration. Training precedes the holdout, holdout metrics are withheld from the proposal prompt, and manual promotion re-evaluates eligibility.
- H10/M14/M16: comparison uses common recorded dates and rebases on the common window. AI intervals require full allocation quote coverage; same-day later allocations cannot influence earlier intervals. Missing values stay unknown. Charts retain series colors without a wallet curve and position dated points on a common time axis, with accessible descriptions.
- H11/M27: tenant handlers serialize restores against in-flight jobs/readers. Restore keeps a server recovery snapshot and durable active pointer; the next guarded request rolls back an interrupted restore before proceeding. Recovery failure blocks guarded operations with HTTP 503. Imported marks, outcomes, mirror approvals, snapshots, and strategy eligibility cannot certify themselves. Malformed timestamps are rejected.
- M12/M13/M21/M22/M23/M25/L29/L30: response enums accept the UI action and canonicalize legacy `adapted`; journal CTAs navigate correctly; controls have labels/keyboard handling; dialogs trap and restore focus; profile edits survive risk/display changes; sign-out remains visible on mobile; crypto fallback IDs agree with featured assets. Empty traces do not report ACTIVE. Readiness performs isolated persistence round trips and a primary-only market probe; Provider Health includes the primary feed.
- L28: small CSS text rules were raised to 11 px, key explanatory text to 12 px, focus indicators and minimum target dimensions added. Full modularization of the old renderer and consolidation of the four CSS layers remain maintenance work; this release does not claim that architectural cleanup is complete.

## Verification and limits

`npm run verify` includes new behavioral regression tests. PostgreSQL integration exercises the existing-data migration, repeated IDs across tenants, actual Blob-to-ledger migration, active mark replacement, and namespaced privacy deletion. Regression tests cover refresh-to-fill, unverified execution rejection, billing event races, token revocation, imported evidence quarantine, expired restore denial, concurrent workspace operations, and interrupted restore recovery.

Chromium checks cover all seven screens on desktop and mobile, navigation, form labels, keyboard focus, dirty profile fields, missing-value displays, chart identity, and mobile sign-out. Test providers are mocked; no live Stripe subscription, Identity account, or licensed feed was changed.

The new migration must be applied by the Netlify deployment migration workflow before the updated functions serve traffic. Validation uses disposable local PostgreSQL, not the hosted production database. Postgres and Blobs do not share an ACID transaction: workspace coordination plus durable recovery provides application-level consistency for the guarded application handlers. Direct external database/Blob writers are outside that coordination.
