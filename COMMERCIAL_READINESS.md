# KAIROS commercial hardening

## Hard Fix 1/3 — account isolation and transactional foundation

KAIROS is being prepared as a web/PWA paper-research product first. This stage creates the technical account/data boundary; it does not claim regulatory registration or legal clearance.

Implemented in this stage:

- **Commercial multi-tenant account model** with `userId`, `tenantId`, role and tenant status.
- **Netlify Identity** is the primary commercial identity provider. The legacy signed admin path remains only as an owner-migration bridge and can be disabled after the owner account is linked.
- **Netlify Database/Postgres is authoritative for transactional/customer state**: auth mappings, tenant records, profile/settings, portfolio transactions/marks, paper orders/watchlist, decision index/records, mirrors, workflow limits and restore/recovery records.
- **Netlify Blobs remains for artifact/history workloads** such as dated Trace history, snapshots, background-job artifacts and operational traces.
- **Request-local tenant context uses AsyncLocalStorage** so overlapping warm Function requests cannot overwrite each other's tenant selection.
- **Postgres advisory locks** serialize commercial read-modify-write sections; the old Blob lock path remains only for explicit rollback compatibility.
- **Deploy Preview isolation is defense-in-depth**: Netlify Database uses an isolated preview database branch; KAIROS also namespaces every Database record by production vs deploy ID so a preview does not query production rows copied into its branch; artifact Blobs continue using deploy-scoped storage outside production.
- **Legacy migration is non-destructive**. Existing single-owner state is copied once into the bootstrap owner's commercial workspace. The legacy source is preserved until verification and the migration writes an explicit completion marker.
- **Public signup is closed by default** and requires Identity plus legal entity, Terms, Risk Disclosure, Privacy URLs, version identifiers, `KAIROS_ALLOW_SIGNUPS=true`, and the separate `KAIROS_PUBLIC_SIGNUP_READY=true` release switch.
- **Unconfirmed email signups do not activate a tenant**. The pre-confirmation record is recoverable; the customer/tenant records are provisioned only after Identity confirms the address.
- **Identity passwords are never stored in KAIROS**. Commercial user records contain Identity mapping and authorization metadata only.
- **Scheduled Trace jobs fan out by active tenant** rather than assuming one global owner.
- User-facing language states **paper simulation / research / decision support**, with no real order execution.

### Production migration behavior

On the first commercial production deploy, Database migrations create the KAIROS system and tenant state tables. The legacy owner bridge then copies eligible existing production state into the owner's tenant namespace and keeps the original source intact. A Deploy Preview never writes the production database/Blob namespace, and its application queries are additionally constrained to a deploy-specific Database namespace rather than the copied production namespace.

### Emergency rollback

`KAIROS_DATA_BACKEND=blobs` exists only as a compatibility escape hatch while the commercial migration is being proven. Public commercial operation should use the Postgres backend.

## Still required before public paid launch

**Hard Fix 2/3:** billing/entitlements, usage-cost budgets, tenant admin/audit, support/recovery and operational/SLA controls.

**Hard Fix 3/3:** compliance/product-mode boundaries, auditable paper track record vs SPY, marketing substantiation, onboarding/landing/PWA release gate, production legal review checklist and launch controls.

Technical wording and architecture do not by themselves determine investment-adviser or broker-dealer obligations. U.S. launch positioning and any paid securities analysis should be reviewed by qualified securities counsel before public sale.
