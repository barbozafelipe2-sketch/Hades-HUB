# KAIROS V7.3 — Netlify AI Gateway migration

## Safe order

1. Keep the existing production deploy untouched as rollback.
2. Push V7.3 to GitHub and let Netlify create a Deploy Preview.
3. Confirm Netlify AI features are enabled.
4. Run **Settings → System Health → Run live diagnostics**. Confirm provider diagnostics identify actual `netlify_gateway` credential paths rather than only a global Gateway signal.
5. Smoke-test Coach routine, Coach deep, AI Mirror, Decision Attack, market refresh, price history/charts and paper orders.
6. Remove manually configured `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `OPENROUTER_API_KEY` only after the preview proves Gateway routing.
7. Redeploy the preview because environment changes apply to a new deploy/runtime.
8. Re-run Provider Health and confirm the expected providers report `credentialSource: netlify_gateway`.
9. Promote the tested Git commit to production.

## Keep server-only

`TWELVE_DATA_API_KEY`, `FINNHUB_API_KEY`, `SAURON_ADMIN_PASSWORD`, `SAURON_SESSION_SECRET`, and `HADES_INTERNAL_SECRET` remain server-side. Rotate any credential previously stored as a non-secret and save the replacement as a secret with the narrowest useful scope.

## Rollback

If V7.3 fails preview smoke tests, keep/re-promote the previous production deploy and restore any variables it requires. V7.3 introduces no destructive database/state migration, so rollback is code/config only.
