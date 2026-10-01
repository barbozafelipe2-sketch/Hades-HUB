# KAIROS commercial hardening

## Hard Fix 1/3 — account isolation and transactional foundation

KAIROS is being prepared as a web/PWA paper-research product first. This stage creates the technical account/data boundary; it does not claim regulatory registration or legal clearance.

### Product positioning and retention evidence

The product is an **auditable decision journal with adversarial review and paper execution**. The Broker remains a paper-workspace feature; it is not the product promise. Public copy and the signed-in home screen lead with saved reviews, matured outcomes, and the Track Record state. Relative return versus SPY stays hidden as a completed result until the existing evidence thresholds are met.

The record now shows monthly paper returns relative to SPY beside each month's saved review and matured outcome counts, once the existing Track Record thresholds are met. It still does not record an explicit user response to each recommendation (followed, overridden, or no paper action), nor prove that an outcome was caused by following or ignoring a review. Do not infer adherence from a nearby trade. The remaining adherence feature should store the user's declared response as a tenant-scoped audit event and link a paper order when one exists. Monthly return remains descriptive co-occurring evidence; never label the difference as a causal “cost” of ignoring a review. Willingness to pay and the final price remain unvalidated until cost-per-review and retention are measured in Preview/beta.

Implemented in this stage:

- **Commercial multi-tenant account model** with `userId`, `tenantId`, role and tenant status.
- **Netlify Identity** is the only customer login. The legacy signed admin path is disabled by default; the owner migration bridge is available only when `KAIROS_LEGACY_AUTH_ENABLED=true` is explicitly set during migration.
- **Netlify Database/Postgres is authoritative for transactional/customer state**: auth mappings, tenant records, profile/settings, portfolio transactions/marks, paper orders/watchlist, decision index/records, mirrors, workflow limits and restore/recovery records.
- **Netlify Blobs remains for artifact/history workloads** such as dated Trace history, snapshots, background-job artifacts and operational traces.
- **Request-local tenant context uses AsyncLocalStorage** so overlapping warm Function requests cannot overwrite each other's tenant selection.
- **Postgres advisory locks** serialize commercial read-modify-write sections; the old Blob lock path remains only for explicit rollback compatibility.
- **Deploy Preview isolation is defense-in-depth**: Netlify Database uses an isolated preview database branch; KAIROS also namespaces every Database record by production vs deploy ID so a preview does not query production rows copied into its branch; artifact Blobs continue using deploy-scoped storage outside production.
- **Legacy migration is non-destructive**. Existing single-owner state is copied once into the bootstrap owner's commercial workspace. The legacy source is preserved until verification and the migration writes an explicit completion marker.
- **Public signup is closed by default** and requires Identity plus legal entity, Terms, Risk Disclosure, Privacy URLs, version identifiers, `KAIROS_ALLOW_SIGNUPS=true`, and the separate `KAIROS_PUBLIC_SIGNUP_READY=true` release switch.
- **Historical evidence remains point-in-time**: stored market values keep provider, observation time, exchange, delay class, license identifier and point-in-time status. AI output cannot create or overwrite prices, closes, returns, quantities or benchmarks.
- **Market feed readiness requires an explicit license identifier**: configure `KAIROS_LICENSED_MARKET_LICENSE_ID`; any Twelve Data or Finnhub fallback also needs its provider-specific license identifier. Without one, the quote/history is unavailable for persistence or paper fills.
- **Unconfirmed email signups do not activate a tenant**. The pre-confirmation record is recoverable; the customer/tenant records are provisioned only after Identity confirms the address.
- **Identity passwords are never stored in KAIROS**. Commercial user records contain Identity mapping and authorization metadata only.
- **Scheduled Trace jobs fan out by active tenant** rather than assuming one global owner.
- User-facing language states **paper simulation / research / decision support**, with no real order execution.

### Production migration behavior

On the first commercial production deploy, Database migrations create the KAIROS system and tenant state tables. The legacy owner bridge then copies eligible existing production state into the owner's tenant namespace and keeps the original source intact. A Deploy Preview never writes the production database/Blob namespace, and its application queries are additionally constrained to a deploy-specific Database namespace rather than the copied production namespace.

### Emergency rollback

`KAIROS_DATA_BACKEND=blobs` exists only as a compatibility escape hatch while the commercial migration is being proven. Public commercial operation should use the Postgres backend.

## Remaining before public paid launch

Hard Fix 1/3 through 3/3, the privacy/deletion lifecycle and public release controls are implemented in this branch. GitHub Actions verifies the repository checks; it does not validate live services or production configuration.

Before public launch, complete:
- Qualified counsel review, including securities/regulatory positioning and launch copy.
- Privacy review of retention, deletion, exports and the final customer-facing policy.
- Written market-data license approval for the intended products, history and display use.
- A live Git-backed Deploy Preview smoke test for login, two isolated tenants, Stripe test events, licensed market data, AI Gateway, paper orders, backup/restore and deletion. Netlify must apply migrations to the preview database; production signup remains closed.
- Set and verify the preview-smoke release flag only after that test passes; do not set public release approval until all legal and runtime gates are complete.
- The final branch audit and polish before any merge to `main`.

Technical wording and architecture do not by themselves determine investment-adviser or broker-dealer obligations. U.S. launch positioning and any paid securities analysis should be reviewed by qualified securities counsel before public sale.

## Hard Fix 2/3 — billing, entitlements, cost controls and support operations

Implemented in this stage:

- **Stripe-hosted subscription checkout and customer portal**. KAIROS creates Checkout/Portal sessions server-side; no Stripe secret or recurring price identifier is exposed in browser code.
- **Signed Stripe webhook authority** with timestamp tolerance, HMAC-SHA256 verification, event replay protection, stale-event rejection and active-subscription conflict protection. Unsigned billing payloads never change entitlement state.
- **Internal entitlement state per tenant**. Stripe reports billing events; KAIROS decides application access from its own tenant-scoped record. The existing owner/private workspace remains unlimited and does not require Stripe.
- **Read-only survival after subscription loss**. Existing workspace state can still be read/exported, while paper mutations, licensed market refreshes and paid AI workflows fail closed when a trial/subscription is inactive.
- **Monthly AI-unit budgets per tenant** with configurable plan limits and per-feature weights. AI units are relative cost controls, not tokens, dollars or promises of a fixed model-call count.
- **Idempotent usage accounting** in Postgres. Replaying the same request/job id does not consume a second unit charge. Rate-limit rejection happens before AI-unit consumption on long jobs.
- **Relational audit events** for authentication, account updates, billing state changes, paper ledger/orders and backup restore outcomes. The audit payload uses an allowlist and excludes passwords, provider keys, raw prompts and portfolio contents.
- **Owner-only Audit Log and Support Diagnostics endpoints**. Support diagnostics expose release/readiness/persistence/billing-state booleans without raw financial positions or infrastructure secrets.
- **Public signup now requires billing readiness by default**, in addition to the legal/Identity release gates. Private beta deployments can explicitly set `KAIROS_REQUIRE_BILLING_FOR_SIGNUP=false`.

### Stripe production configuration

Create a recurring Stripe Price for the commercial KAIROS plan, then configure these server-only values in Netlify:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `KAIROS_STRIPE_PRO_PRICE_ID`
- `KAIROS_APP_URL` (the canonical HTTPS web/PWA origin)
- `KAIROS_REQUIRE_BILLING_FOR_SIGNUP=true`

Configure Stripe to POST webhooks to:

`/.netlify/functions/billing-webhook`

KAIROS consumes these event families:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

The webhook secret is mandatory. Never configure a browser/client to update KAIROS subscription state directly.

### Cost-control defaults

Default internal budgets are conservative release guardrails and can be changed without code:

- trial: `KAIROS_TRIAL_DAYS=14`, `KAIROS_TRIAL_AI_UNITS=120`
- pro: `KAIROS_PRO_AI_UNITS=1200`
- per-feature unit weights can be overridden through `KAIROS_AI_UNITS_*` environment variables documented in `.env.example`.

These are **operational cost units**, not customer-visible token balances and not a guarantee of a particular number of AI calls. Provider pricing/model routing can change independently.

For each actual model request, KAIROS records provider, model, estimated input/output tokens, estimated USD, feature, tenant and request id. `KAIROS_TENANT_DAILY_USD` and `KAIROS_SITE_DAILY_USD` are hard stop limits. When a limit is reached the affected feature returns its deterministic degraded response; it must not retry through a more expensive model. An estimate is a release-control estimate, not a provider invoice.

### Model routing and multi-agent cost

Decision Review already runs three specialist analyses and three independent attacks in parallel. Those six worker roles now default to the fast models exposed through Netlify AI Gateway (Luna, Haiku and Flash) and have a smaller 1,100-token response budget. A provider hop happens only after a request error. The provisional synthesis remains a deeper call, and the existing cross-provider critic/judge final gate is unchanged. The tenant/site USD caps, usage ledger and deterministic degradation still apply to every call. This should lower worker cost; actual savings and decision quality still need a measured Preview benchmark before launch.

This implementation uses the configured first-party Netlify Gateway provider SDKs and existing metered calls; it does not add an OpenRouter dependency or claim OpenRouter supervision of the worker calls. Before changing the provider path, benchmark total USD per completed task, latency, unsupported claims, source coverage, numeric-field violations and disagreement resolution on a fixed, versioned evaluation set. Check provider retention and routing eligibility as part of that review. Keep market numbers and evidence selection outside model authority.

### Historical macro and geopolitical Trace context

Trace snapshots can include a wider context record covering policy rates/yields, inflation, labor, growth, demand, credit, FX, energy and other commodities, trade/supply chains, shipping, conflict, sanctions/export controls, elections, fiscal/regulatory policy, public health and climate/disaster disruption. This is a factor catalog, not a claim that each factor is available or predictive.

The source is deliberately owner-plugged because economic series and news/event feeds have different commercial display and historical-vintage rights. Configure server-only `KAIROS_TRACE_CONTEXT_BASE_URL`, `KAIROS_TRACE_CONTEXT_API_KEY` and `KAIROS_TRACE_CONTEXT_LICENSE_ID`. KAIROS requests `GET {base-url}/trace-context?as_of=YYYY-MM-DD`. The JSON response contract is:

```json
{
  "as_of": "2024-01-31",
  "factors": [{
    "factor_code": "inflation", "value": 3.1, "unit": "%", "period": "2024-01",
    "observed_at": "2024-01-31T00:00:00Z", "published_at": "2024-02-13T13:30:00Z",
    "available_at": "2024-02-13T13:30:00Z", "source": "Licensed provider",
    "source_url": "https://provider.example/series/1", "license_id": "commercial-license-id",
    "point_in_time": true, "revision_id": "v1"
  }],
  "events": []
}
```

The example row would be rejected for a January 31 trace because it was released in February. Each accepted observation requires a catalogued factor code, finite source value, HTTPS source URL, exact configured license id, `point_in_time: true`, and observed/published/available timestamps no later than the end-of-day UTC cutoff. Invalid or later rows are excluded; absent configuration, timeout, license mismatch or no valid rows displays `UNAVAILABLE`. KAIROS stores this evidence in the date's existing trace snapshot and never asks an LLM to supply a factor value, publication date, price or causal link. The current configured license, rights to retain/display the feed, and source quality remain human gates.

### Remaining before public paid launch

The Hard Fix 3/3 implementation and privacy/release controls are included below. Live runtime testing and external reviews listed above remain release gates.

## Hard Fix 3/3 — auditable paper evidence

Implemented in this stage:

- Deterministic Track Record Ledger from stored snapshots and point-in-time decision outcome checkpoints.
- Paper portfolio return compared with recorded SPY over the same evidence window; the UI calls the difference relative return, never alpha.
- Decision scorecards at 1/7/30/90/365 days with non-point-in-time observations excluded.
- SHA-256 evidence export for change detection. This is intentionally labeled as not an external audit or third-party attestation.
- Evidence remains BUILDING until at least 30 complete snapshots and 10 matured actionable decisions exist; this label is descriptive and not a statistical validation claim.

Still required before public paid launch: deletion/privacy lifecycle, legal/claims review, onboarding/landing release gates, production smoke tests and final launch controls.

## Hard Fix 4/5 — privacy and deletion lifecycle

- Customer workspace deletion is owner-only, explicit and asynchronous.
- Stripe cancellation precedes purge so a deleted customer is not silently left on an active renewal.
- Financial state, historical artifacts, usage/audit rows, account mappings and the Netlify Identity user are included in the technical deletion path.
- The purge leaves only a random deletion receipt with counts/timestamp and no tenant/user/email identifiers.
- The original private owner workspace remains protected from accidental self-service deletion.

This implements the technical lifecycle. Final privacy-policy wording, statutory retention requirements and jurisdiction-specific obligations still require legal review before public launch.

## Hard Fix 5/5 — public release controls

- Public signup is now gated by explicit release approval and a separate Deploy Preview smoke-test approval.
- Required launch metadata includes legal-review version/timestamp, support email and canonical HTTPS app origin.
- The release mode is paper research only; real-money execution must remain disabled.
- Owner-only Launch Readiness reports static release blockers plus runtime persistence, AI Gateway, licensed market-feed, security and billing configuration.
- CI scans public product copy for a bounded set of prohibited performance promises.
- Pre-login copy states that paper results are descriptive rather than predictive.

A green technical gate means the configured technical prerequisites are present. It does not determine whether KAIROS is legally permitted to offer a particular service or claim in a jurisdiction. Keep public release approval false until qualified counsel and relevant business/data-provider reviews are complete.

## Explicit human release gates

- Securities/regulatory counsel approves the product scope, jurisdiction and claims.
- Privacy counsel or the designated privacy owner approves notices, retention, deletion and export behavior.
- The market-data provider confirms the required commercial license and display/history rights in writing.
- An operator runs and records the live Deploy Preview smoke test, including the preview-only database migrations and the cases listed above.
- The final audit reviews the exact tested commit before any merge to `main`.

Until those are complete, keep signup closed, `KAIROS_PREVIEW_SMOKE_APPROVED=false`, `KAIROS_PUBLIC_RELEASE_APPROVED=false`, `KAIROS_PRODUCT_MODE=paper_research` and `KAIROS_REAL_MONEY_EXECUTION=false`.
