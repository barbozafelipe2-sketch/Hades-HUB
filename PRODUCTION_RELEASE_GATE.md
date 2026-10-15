# KAIROS production release gate — 2026-10-14

Baseline: `2aac7f13a0b4f807fa2d88dbec5a661233157fab` on `main`.

## Verified external observations
- The connected Netlify project is `hades-os` (site ID `cb8da6dc-9f3d-4751-abcf-1e08c667805c`).
- Its published production deploy `6ab182518634bd59892f43a0` is a **drop deployment** with no GitHub commit reference; it is not proof that the October 14 code is running.
- GitHub's combined commit status query returned no status checks for the baseline.
- `netlify.toml` declares `npm run verify`, Node 24, `public` publish directory, and `netlify/functions`.
- The tenant paper-account migration exists at `netlify/database/migrations/20261014000100_tenant-paper-accounts/migration.sql`. Its existence does **not** prove execution in production.
- `README_SETUP.md` describes **Netlify Identity** for commercial authentication. Supabase Auth is not confirmed by that setup document; resolve this product/implementation discrepancy before onboarding customers.

## Mandatory release sequence
1. Confirm `hades-os` is linked to this GitHub repository, with `main` as the production branch. Keep the existing production deploy available for rollback.
2. Confirm database provisioning, migration mechanism, backups and rollback plan. Do not run the destructive database regression suite against production: `KAIROS_TEST_DATABASE_URL` must point to an isolated disposable database.
3. Produce an isolated Deploy Preview from the target commit; verify its database branch and artifact storage cannot write to production.
4. Run a clean `npm ci --ignore-scripts && npm run verify` using Node 24, and record the CI run URL and result.
5. Smoke-test email verification/login, owner and customer permissions, cross-tenant account/order/history isolation, paper fill reconciliation, quote freshness, historical evidence, Stripe Checkout trial/entitlements/webhook signatures, cancellation, export, and read-only access after expiry.
6. Resolve the authentication choice (Netlify Identity versus Supabase Auth) deliberately; do not silently mix identity systems or migrate customer accounts without a migration plan.
7. Inspect the owner-only `launch-readiness` endpoint. Keep signup/release flags disabled until legal, support, licensing, privacy and billing prerequisites are satisfied.
8. Only then promote the Git-backed deploy, verify production health and retain a tested rollback path.

## Status
**BLOCKED FOR PUBLIC RELEASE.** This file records a deployment checklist, not an assertion that production tests, database migrations, billing validation, or release approval have passed. No production configuration or data is changed by this documentation commit.

## Follow-up — 2026-10-15

The GitHub Actions run for `6656d713d38a5c55a81305604fbd227ac80421aa` completed successfully: https://github.com/barbozafelipe2-sketch/Hades-HUB/actions/runs/38698521986.
The published Netlify deploy remains `6ab182518634bd59892f43a0`. Public requests currently return HTTP 503 with `usage_exceeded`; account usage must be resolved before an online smoke test can pass. Commercial Stripe and primary-feed configuration were not present in the inspected project-variable list. No credential values were recorded or changed.

The follow-up implementation builds through `npm run build`, which runs verification and generates `public/release.json` with commit identity. Owner-only readiness also checks live database primary keys. Neither feature certifies a deployment until it is actually published and exercised. See [the completion report](RELEASE_COMPLETION_2026_10_15.md) for scope and remaining external dependencies. Public release remains blocked.
