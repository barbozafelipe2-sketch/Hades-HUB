# KAIROS

KAIROS is a web-first paper-broker and decision-intelligence system built around verified market data, explicit uncertainty, paper execution, point-in-time evaluation, and auditable decision history.

**Current release:** V7.3 commercial hardening in progress.

- No real securities orders are executed.
- Market prices and historical returns come from licensed market-data providers, not LLM-generated values.
- AI is used for research/explanation and adversarial decision review; system conviction is derived deterministically from evidence quality, freshness and review results.
- Commercial customer state uses multi-tenant Netlify Identity + Netlify Database/Postgres; artifact/history workloads remain in tenant-scoped Netlify Blobs.
- Stripe-hosted billing, tenant entitlements, idempotent monthly AI-cost budgets, sanitized audit events and owner support diagnostics are included in Hard Fix 2/3.

See `README_SETUP.md` for deployment and `COMMERCIAL_READINESS.md` for the staged commercial hardening plan.
