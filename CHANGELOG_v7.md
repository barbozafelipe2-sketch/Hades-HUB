# HADES Private V7 — Ultimate Blend

## Goal
Create one coherent premium product from the strongest concepts across HADES V6.1, Nova Meta, React Artifact 2 and React Artifact 3 without replacing the hardened V6.1 engine.

## Presentation / UX
- Added isolated `public/v7.css` as the canonical V7 visual layer.
- Apple-like shell: quieter chrome, translucent mobile dock, restrained gold, intelligence blue, outcome-only green/red.
- Rebuilt Home around executive wealth hierarchy: value, P/L, goal, risk budget, performance, Digital Twin, Decision Queue, What Changed Today, World Model, next contribution and trace memory.
- Rebuilt Broker as a real-feeling paper-broker surface with market/category tiles, market pulse, asset/name search, watchlist, selected-market detail and data-trust states.
- Renamed Insight to **Decisions** and grouped Decision Center, CROWN Lab, Evolution Lab and Trace Lab.
- Settings moved out of the mobile primary navigation and into Profile/System controls.
- AI Mirror adds direct YOU vs HADES allocation comparison while preserving strict final-gate behavior.
- Performance emphasizes recorded Wallet vs HADES vs S&P, plus calibration and the Evolution learning loop.

## Broker engine
- Added persistent server-side paper order state and persistent watchlist state.
- Added Market, Limit, Stop and Stop-Limit paper orders.
- Added fractional quantity and dollar-entry ticket support.
- Market orders require fresh marks.
- BUY orders enforce tracked cash; SELL orders enforce tracked holdings.
- Open sell orders reserve holdings; open buy orders reserve estimated buying power.
- Pending orders evaluate only against fresh stored marks during market/Trace refresh.
- Order lifecycle includes OPEN, FILLED, CANCELLED and REJECTED states.
- Backup format upgraded to v4 to include paper orders + watchlist while retaining v2/v3 restore compatibility.

## Reliability / trust
- Preserved V6.1 OpenAI-only bounded model fallback and strict final judge.
- Preserved market global deadline propagation and price-truth separation.
- Market refresh now returns paper-order fill results without double-processing orders.
- Paper-order fill validation uses direct holdings/cash checks rather than warning-count heuristics.
- Infrastructure keys remain server-side; no client API-key entry surface was imported from reference prototypes.
- Every market and AI screen keeps paper/research/verified distinctions explicit.

## QA
- Added `qa_v7.mjs` for paper order semantics, watchlist persistence, V7 navigation/UI contracts and immutable V7 UI hashes.
- `npm test` includes V6.1 engine regressions plus V7 release regressions.
- Added V7 UI SHA-256 locks after final polish.

## Rollback
- Engine rollback: redeploy `HADES_PRIVATE_FINAL_v6.1.zip`.
- Presentation-only rollback: remove the `v7.css` link and revert V7 `app.js/index.html` presentation changes while keeping the V6.1 backend.
