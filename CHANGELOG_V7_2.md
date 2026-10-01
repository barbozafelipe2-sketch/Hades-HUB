# HADES V7.2 hardened Gateway changelog

## Intelligence / cost

- Routine Coach stays on GPT-5.6 Luna with bounded provider fallback.
- Deep Coach uses GPT-5.6 Terra plus one cheap independent verifier; it no longer invokes the full expensive audit council for ordinary deep questions.
- Added `coach_verify` routing: Gemini 2.5 Flash → Claude Haiku 4.5 → Luna fallback.
- AI Mirror and Decision Attack retain the intentionally heavier multi-provider / final-gate architecture.
- Provider diagnostics distinguish provider-specific Netlify Gateway credentials from manual/local overrides.

## Trust / financial data

- AI-derived price fields are stripped from fallback world-state data before they can become chart/reference-price truth.
- Actionable paper orders and decision evidence require verified stored/licensed market marks where price truth is required.
- System conviction remains deterministic and is not sourced from model self-confidence.

## Security / boundaries

- Strict UUID validation for background job IDs.
- Strict security-oriented symbol normalization/validation shared across endpoints/state.
- Chat and job request body/question bounds.
- Positive-value validation for manual marks.
- Production auth/session configuration fails closed instead of silently using development defaults.
- Netlify code-based rate limits on login, Coach and provider diagnostics.
- CSP, HSTS, cross-origin and legacy plug-in hardening headers added.

## Release engineering

- Added full-tree JavaScript syntax gate.
- Added V7.2 hardening tests.
- Netlify and GitHub CI now use the same `npm run verify` gate.
- SHA-256 source manifest and immutable UI release hashes regenerated after the final polish.
- No destructive persistence/database migration.

## Hard Fix 2/3 — security and financial-state integrity
- Production auth now fails closed when credential persistence is unavailable; no fallback resurrection after stored credentials exist.
- Session tokens carry a credential version; password/username updates invalidate all older sessions.
- Netlify Blobs failures use a bounded recovery probe and production reads no longer silently fabricate empty/default state from ephemeral memory.
- Paper fills use deterministic `paper-fill:<orderId>` transaction IDs so retries reconcile instead of duplicating trades.
- Automatic paper execution accepts only fresh licensed market marks; manual marks remain display/simulation inputs, not verified execution prices.
- Transaction/order numeric ceilings prevent overflow/Infinity state corruption.
- JSON parsing enforces streamed byte limits rather than trusting Content-Length.
- Backup restore validates transactions, marks, IDs/counts and portfolio reconstruction before state replacement.
- Expensive AI/market/background workflows receive Netlify rate-limit policies.


## Hard Fix 3/3 — point-in-time recovery, concurrency and reproducible release
- Historical Trace catch-up now reconstructs from licensed daily closes at the requested historical date. Current quotes/news/AI context are never relabeled as old data.
- Decision outcome checkpoints use licensed point-in-time closes at D+1/D+7/D+30/D+90/D+365 and persist the actual trading date/source.
- Historical reconstruction cannot move `lastSuccessfulDate` backwards after a newer daily trace already exists.
- Gap detection scans the full bounded trace range instead of stopping after a filled first window.
- Catch-up runs in small chained background batches with a persisted `catchupRunId`; stale/retried chains self-cancel.
- Added operational execution traces keyed by Netlify request ID for Coach, market refresh, Decision Attack, AI/Wallet Mirror, Evolution and Trace workers; prompt/secret content is excluded.
- Added working read-modify-write serialization using Netlify Blob conditional writes in production and in-process locks locally. Portfolio writes/builds, paper orders, watchlist toggles and the decision index use those locks.
- Startup is read-only and no longer launches Market Refresh merely because chart history is thin.
- GitHub CI, Netlify build environment, `.nvmrc` and package engines now target Node 24. CI uses `npm ci`.
- Added `package-lock.json` for the exact `@netlify/blobs` 11.0.3 dependency closure; `npm ls --package-lock-only --all` validates it.
- Removed the global static `Cache-Control: no-store`; authenticated JSON APIs remain `no-store`, while Netlify can safely cache/invalidate static deploy assets.
- Added `hard-fix-3` regression coverage for point-in-time outcome pricing, late-gap detection, local/distributed locking, operational request IDs, startup behavior, Node parity, lockfile and cache policy.
