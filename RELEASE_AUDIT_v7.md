# HADES Private V7 — Release Audit

Release: **7.0.0 ULTIMATE**  
Baseline: HADES V6.1 hardened OpenAI-only engine  
Presentation: executive Home + Apple-like shell + professional paper Broker + Wallet / AI Mirror / Decisions / Performance / Labs

## Release verdict

**PASS for private paper-advisor deployment**, subject to live provider/account validation after Netlify deployment.

V7 remains a **paper / simulated brokerage experience**. It does not send real securities orders and it does not claim regulated broker execution.

## What was hardened

- V6.1 OpenAI-only bounded fallback retained; no live Anthropic/Gemini/OpenRouter runtime path.
- Strict final judge retained: `approved:false` cannot be softened into release.
- OpenAI Responses use `store:false`.
- Market refresh deadline propagates through quote/provider calls.
- Internal worker authorization is independent of the OpenAI key.
- Session lifetime remains bounded.
- Market price truth remains separate from AI interpretation.
- Persistent paper Market / Limit / Stop / Stop-Limit order state added.
- Market paper orders require fresh marks.
- BUY orders enforce tracked buying power; SELL orders enforce tracked holdings.
- Pending SELL orders reserve shares; pending BUY orders reserve estimated buying power.
- STOP_LIMIT requires stop trigger before limit fill condition.
- Pending orders are evaluated during market/Trace refresh and cannot double-fill.
- Trace Lab records Evolution Lab failures instead of silently swallowing them.
- Watchlist and paper-order state are included in backup v4.
- No infrastructure/API-key entry surfaces are exposed to the browser.

## Product / UX audit

- Home: executive value, risk, goal, Digital Twin, Decision Queue, What Changed Today, World Model, contribution and trace memory.
- Broker: strong market/category selection, asset/name search, watchlist, market pulse, detailed selected asset, CROWN context, order ticket and order book.
- Wallet Mirror: user paper holdings / cash / P&L / transactions.
- AI Mirror: same user, same capital, same constraints; audited HADES allocation and YOU vs HADES comparison.
- Decisions: Decision Center + CROWN Lab + Evolution Lab + Trace Lab.
- Performance: recorded Wallet vs HADES vs benchmark plus calibration loop.
- Profile/Settings: configuration is separated from primary mobile navigation.
- Mobile navigation is a six-destination translucent dock; desktop uses a persistent private-OS sidebar.

## QA executed

`npm test` includes and passed:

1. OpenAI router/model isolation + bounded fallback checks.
2. Portfolio/accounting/performance regression suite.
3. V4.2 hardening regression suite.
4. V4.2 integration/UI-contract suite updated for V7 navigation.
5. Endpoint suite for AI Mirror, Wallet Mirror and Evolution Lab.
6. V6.1 engine regression suite.
7. V7 paper-broker / watchlist / state / UI-lock suite.

V7-specific assertions include:

- LIMIT / STOP / STOP_LIMIT normalization and validation.
- Fresh-mark Market order execution.
- Cash and holdings enforcement.
- STOP_LIMIT trigger-then-limit behavior.
- Open SELL reservation protection.
- Persistent cancellation lifecycle.
- Watchlist normalization.
- Paper-order + watchlist backup/state persistence.
- No client API-key forms.
- Immutable SHA-256 release locks for `index.html`, `app.js`, `v7.css`, HADES mark and manifest.

All JavaScript/MJS source is syntax-checked before packaging.

## Live-deployment checks still required

Offline QA cannot prove third-party account state. After deployment run Provider Health and verify:

- OpenAI key, model access, billing/quota and live response latency.
- Twelve Data key / quota / quote-history behavior.
- Finnhub key / quota / quote-history behavior.
- Netlify Blobs persistence in the deployed site.
- Netlify function/background-function runtime under real network conditions.

## Smoke test

1. Sign in.
2. Complete / review Profile & Digital Twin.
3. Open Broker and select a market category.
4. Search by company name and symbol.
5. Refresh market data.
6. Place a small paper Market BUY.
7. Place and cancel a LIMIT order.
8. Open Wallet Mirror and confirm ledger state.
9. Run CROWN on an asset.
10. Build Whole Portfolio in AI Mirror.
11. Confirm final-gate outcome and YOU vs HADES allocation.
12. Open Decisions → Trace Lab and Evolution Lab.
13. Open Performance and verify recorded comparison/calibration.
14. Export a backup and verify paper orders/watchlist are included.

## Rollback

- Full rollback: redeploy `HADES_PRIVATE_FINAL_v6.1.zip`.
- V7 presentation rollback: revert the V7 `index.html/app.js` presentation changes and remove `v7.css`; V6.1 backend semantics remain independently recoverable.
