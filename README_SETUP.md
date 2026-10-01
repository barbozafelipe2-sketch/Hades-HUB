# KAIROS Decision Journal V7.3 — hardened Netlify AI Gateway edition

KAIROS is a private market-advisor and paper-broker simulator. V7.3 preserves the V7 product/UI, Broker, Wallet Mirror, AI Mirror, Decision Review, Decision History, Learning Lab and performance engine while hardening AI routing, financial-state integrity, historical evaluation, preview isolation, backup recovery and release reproducibility.

## Deploy path

1. Push this repository to GitHub.
2. Connect that repository to the existing legacy `hades-os` Netlify project. Keep the current live deploy available as rollback until the Git-backed build is proven.
3. Build command: `npm run verify`. Publish directory: `public`. Functions directory: `netlify/functions`. These are declared in `netlify.toml`.
4. Netlify AI Gateway is the LLM access layer. Enable the supported OpenAI / Anthropic / Gemini provider paths for the project.
5. Deploy a Preview first. Transactional/customer state uses an isolated Netlify Database preview branch, while artifact/history Blobs use deploy-scoped storage. Preview writes therefore do not mutate production customer state or production artifacts.
6. Run **Settings → System Health → Run live diagnostics**, then smoke-test login, Broker, market refresh, Coach, AI Mirror, Wallet Mirror, Decision Review, Learning Lab and backup export/restore inside the Preview.
7. Only after the GitHub CI gate and Preview pass should production environment credentials be migrated/rotated and the Git-backed deploy promoted.

## Brand compatibility note

KAIROS is the customer-facing product name. Existing internal environment-variable prefixes `HADES_*` and `SAURON_*`, function routes, and persisted storage keys remain unchanged in V7.3 to preserve deployment/session/state compatibility. They can be migrated later with a versioned data/config migration.


## Commercial identity / tenant isolation

Hosted commercial deployments default to `KAIROS_DATA_BACKEND=postgres`. Keep that value for production. `blobs` is an emergency compatibility rollback only. Database migrations live under `netlify/database/migrations/` and are applied by Netlify during deploy.

KAIROS V7.3 commercial hardening uses `@netlify/identity` for customer authentication. Enable Netlify Identity on the project before testing commercial accounts. The original single-admin credential path remains only as a migration bridge for the owner and can be disabled with `KAIROS_LEGACY_AUTH_ENABLED=false` after the owner Identity account is linked and verified.

Transactional/customer state is authoritative in Netlify Database/Postgres and every tenant query carries `tenant_id`. Artifact/history data in Blobs is namespaced under `tenants/<tenantId>/...`. Production tenant data access fails closed without tenant context. Existing private root state is copied once into the bootstrap owner workspace; the legacy source is not deleted by the migration.

Public signup is intentionally double-gated. It stays closed unless all legal/version fields are configured and both `KAIROS_ALLOW_SIGNUPS=true` and `KAIROS_PUBLIC_SIGNUP_READY=true` are present. This release gate is not a substitute for legal review.

## Required server-only configuration

KAIROS V7.3 does **not** require manually managed OpenAI, Anthropic, Gemini or OpenRouter credentials once Netlify AI Gateway is active. Never commit provider keys or security secrets.

- `SAURON_ADMIN_PASSWORD`: strong private admin password.
- `SAURON_SESSION_SECRET`: random high-entropy session-signing secret (64+ characters recommended).
- `HADES_INTERNAL_SECRET`: separate random secret for internal/background workers.
- `TWELVE_DATA_API_KEY` and/or `FINNHUB_API_KEY`: licensed market-price/history providers. Keep them secret and Functions-only.

Optional timeout/body-size tuning is documented in `.env.example`.

## Storage isolation

- Netlify Database/Postgres is authoritative for transactional customer state. Production uses the main database; Deploy Previews use isolated database branches.
- Blobs are reserved for Trace/snapshots/jobs/operational artifacts. Production artifacts use the site-scoped store; Preview/branch artifacts use deploy-scoped storage selected from Function `context.deploy` metadata.
- Postgres advisory locks protect commercial read-modify-write operations. The Blob lock path remains only for explicit compatibility rollback.
- `HADES_STORAGE_SCOPE=site|deploy` exists only as an explicit emergency/testing override; normal Netlify execution should rely on `context.deploy`.
- Internal background chaining prefers `DEPLOY_PRIME_URL`, then `DEPLOY_URL`, then the production `URL`, keeping a preview recovery chain on its originating deploy.

## Intelligence policy

- **Coach routine:** GPT-5.6 Luna first; bounded provider fallback only when needed.
- **Coach deep:** GPT-5.6 Terra first, followed by one cheap independent verifier.
- **AI Mirror:** multi-provider candidate, criticism, scenario/risk attack and final adjudication.
- **Decision Review:** multi-specialist analysis + adversarial attacks + a separate final gate; long work runs as background jobs.
- **Charts / prices / returns:** deterministic licensed market data only. LLMs may explain verified data but cannot manufacture price series or actionable reference prices.
- **System conviction:** computed by KAIROS from data freshness, source quality, agreement, unknowns and attack/final-gate results—not from model self-confidence.
- **Historical Trace:** catch-up uses licensed point-in-time daily closes and never substitutes current quotes for historical dates. Decision outcome checkpoints use the corresponding historical date.
- **Benchmark:** Performance Mirror uses **SPY** as the explicit recorded benchmark. Legacy `sp500_level` fields are read only for backward compatibility with older stored snapshots.
- **Long workflow cost controls:** supported Netlify edge limits protect the highest-value entry points; longer cost windows are enforced inside KAIROS with persistent, job-idempotent workflow budgets.

## Financial-state integrity

- Transaction history is replay-validated before persistence. A SELL cannot survive if earlier edits/restores remove the position it depended on.
- Paper fills use deterministic `paper-fill:<orderId>` transaction IDs. If the transaction succeeds but the order write fails, retry reconciliation restores the order to `FILLED` before re-checking current cash, holdings or quotes.
- User-entered/manual marks are display/simulation data, not verified automatic-execution prices.
- Backup restore follows **validate → recovery snapshot → replace collections → commit**, with an automatic rollback attempt on partial failure.

## Verification

The repository pins Node 24 and `@netlify/blobs` 11.0.3 and includes `package-lock.json`. The repository does not ship `node_modules`.

```bash
npm ci --ignore-scripts
npm run verify
```

`npm run verify` performs syntax checks, the complete regression suite and SHA-256 source-integrity verification. GitHub CI and Netlify both target Node 24.

The isolated repair environment could not complete a clean registry-backed `npm ci`, so local logic QA used a temporary in-memory compatibility shim for `@netlify/blobs`. That shim is removed from the shipping package. The first GitHub CI build is therefore the authoritative real-package installation gate.

For Netlify-local behavior use `netlify dev`.

## Production safety / rollback

Do **not** delete or rotate the current live LLM/session/admin environment before the Git-backed Preview is healthy; the existing drop deployment may still depend on those variables. Once the V7.3 Preview passes, migrate the production environment deliberately, redeploy, smoke-test, and only then retire the old drop deployment.


## Commercial billing and usage controls (Hard Fix 2/3)

KAIROS uses Stripe-hosted Checkout/Customer Portal rather than collecting payment-card fields itself. Before opening public signup, configure a recurring Stripe Price and the server-only variables in `.env.example`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `KAIROS_STRIPE_PRO_PRICE_ID`, and `KAIROS_APP_URL`.

Point the Stripe webhook at `/.netlify/functions/billing-webhook` and enable Checkout completion, subscription create/update/delete, invoice paid and invoice payment-failed events. Subscription state changes are accepted only after Stripe signature verification. The browser cannot grant itself an entitlement.

By default `KAIROS_REQUIRE_BILLING_FOR_SIGNUP=true`; therefore the public account button remains closed until Identity, legal URLs/versions, the explicit launch flag, and Stripe billing configuration are all ready. Set it to `false` only for a deliberate private beta.

AI cost controls use monthly internal units (`KAIROS_TRIAL_AI_UNITS`, `KAIROS_PRO_AI_UNITS`) plus per-feature weights. They are operational guardrails, not money/tokens. The migrated private owner plan is unlimited. Existing tenant data remains readable/exportable if access expires, but paper mutations, market refresh and AI workflows are blocked until entitlement is active again.

Owner support surfaces are `commercial-status`, `audit-log`, and `support-diagnostics`. They are authenticated/owner-scoped and intentionally omit passwords, provider secrets, raw prompts and position-level financial data from the support diagnostic bundle.

## Final commercial release gate

Public signup remains closed unless the existing Identity/legal/billing requirements **and** all final release controls are satisfied:

- `KAIROS_PRODUCT_MODE=paper_research`
- `KAIROS_REAL_MONEY_EXECUTION=false`
- `KAIROS_PUBLIC_RELEASE_APPROVED=true`
- `KAIROS_PREVIEW_SMOKE_APPROVED=true`
- `KAIROS_LEGAL_REVIEW_VERSION=<version>`
- `KAIROS_LEGAL_REVIEWED_AT=<ISO timestamp>`
- `KAIROS_SUPPORT_EMAIL=<support inbox>`
- canonical `KAIROS_APP_URL` must be HTTPS

Leave the approval flags false while configuring or testing. The owner-only `launch-readiness` endpoint shows non-secret blockers. `npm run verify` also runs the commercial-copy claims scan.

These technical controls do not constitute legal clearance. The intended service, public claims, privacy/retention policy, market-data licensing, tax/billing posture and any securities-law implications still require the appropriate professional review before launch.
