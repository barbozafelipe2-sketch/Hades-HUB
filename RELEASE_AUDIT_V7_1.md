# HADES Private V7.1 — Release Audit

Release: `7.1.0-gateway`

## Scope

V7.1 preserves the V7 UI, paper broker, Wallet Mirror, AI Mirror, Decision Center, Trace Lab, Evolution Lab, Blobs persistence contracts, and market-data flow while replacing the LLM architecture with Netlify AI Gateway multi-provider routing.

## Verification completed

- Syntax check across all `public`, `netlify`, and `test` JavaScript / MJS files: PASS.
- `test/router-v2.test.mjs`: PASS.
- `qa_portfolio_test.mjs`: PASS.
- `qa_hardening_v4_2.mjs`: PASS.
- `qa_v4_2.mjs`: PASS.
- `qa_endpoints_v4_2.mjs`: PASS.
- `qa_v6_1.mjs`: PASS.
- `qa_v7.mjs`: PASS.
- Client-source secret scan: PASS; no embedded provider credentials found.
- UI SHA-256 release locks regenerated for the intentional V7.1 health/copy/cache-bust changes.

The execution sandbox could not reach npm registry to install `@netlify/blobs`; a temporary local test shim implementing the small `getStore()` surface used by this project was used only to execute regression tests, then removed. The real dependency remains pinned as `@netlify/blobs: 11.0.3` in `package.json` and is expected to be installed by GitHub/Netlify during build.

## Intelligence architecture

- Coach fast: GPT-5.6 Luna first.
- Coach deep: GPT-5.6 Terra first.
- Independent critique: Anthropic-first.
- Scenario / macro / risk: Gemini-first.
- Final CROWN: GPT-5.6 Sol first, with bounded provider fallback.
- Model-not-found errors can fall back within a provider; auth/credit/rate/timeout errors move to another provider.
- Decision conviction is deterministic system output, not model self-confidence.

## Market-data integrity

- Twelve Data / Finnhub remain the only chart/price authority.
- AI-only market fallback is context-only and has its price fields stripped.
- Asset evidence has model-proposed price overwritten by the authoritative frozen world-state price or `null`.
- ADD/REDUCE decisions remain blocked without a verified fresh reference price.

## Security hardening

- Production no longer silently creates the legacy default admin password when `SAURON_ADMIN_PASSWORD` is absent.
- Production session signing requires `SAURON_SESSION_SECRET`.
- Internal workers use `HADES_INTERNAL_SECRET` / session secret, never an AI provider key.
- Provider Health now reports weak/placeholder auth-secret findings without exposing secret values.
- Netlify environment access is centralized through the server-only environment helper.

## Required deploy smoke tests

1. Login and session persistence.
2. Settings → Run live diagnostics; Gateway detected, OpenAI/Anthropic/Gemini verified as available, market provider verified.
3. Simple Coach request routes to Luna tier.
4. Deep Coach request routes to deep tier and returns verified answer.
5. Market refresh populates licensed quote/history data; no LLM-generated price points.
6. AI Mirror completes background job and final gate.
7. Decision Attack completes background job; attacks + final CROWN stored; conviction is system-derived.
8. Paper BUY/SELL and pending LIMIT/STOP/STOP_LIMIT orders remain deterministic.
9. Trace job and persistence survive a page refresh.

## Rollback

Do not overwrite the existing production deploy until this commit passes a Netlify Deploy Preview. If preview validation fails, keep/re-promote the prior production deploy. V7.1 introduces no destructive database migration.
