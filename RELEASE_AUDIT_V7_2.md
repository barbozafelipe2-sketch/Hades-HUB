# HADES Private V7.2 — staged hardening report (through Hard Fix 3/3)

Release: `7.2.0-hardening`

## Stage 1 — Hard Audit 1/3: architecture, AI routing, jobs

Result: architecture retained with corrections. The shared LLM router is the right seam for migration; background Decision Attack/AI Mirror paths exist. The main cost defect was deep Coach using an audit pattern too expensive for routine scalability. Provider-health semantics also needed to distinguish per-provider Gateway routing from a merely detected global Gateway environment.

## Stage 2 — Hard Audit 2/3: auth, inputs, storage, financial integrity

Result: contained hardening gaps found. Job IDs, symbols and request sizes required stricter server-side boundaries. Expensive externally reachable functions needed platform rate controls. Market truth needed an explicit invariant that AI context cannot become price/chart truth.

## Stage 3 — Hard Audit 3/3: deploy, CI, headers, observability

Result: source release locking existed, but runtime/recovery flaws remained: historical catch-up used current data, gap scanning could stop too early, startup could launch heavy refresh work, CI/runtime Node versions differed, and there was no lockfile or request-level operational trace.

## Stage 4 — Hard Fix 1/3: intelligence and Gateway

- Routine Coach: Luna.
- Deep Coach: Terra + one cheap independent verifier.
- Heavy multi-model council reserved for AI Mirror / Decision Attack.
- Provider Health now exposes provider-specific credential mode and only marks a provider Gateway-routed when its own credential/base path is Netlify Gateway-routed.

## Stage 5 — Hard Fix 2/3: boundaries and abuse controls

- UUID-only job IDs.
- Strict symbol normalization.
- Request/body/question limits.
- Positive manual marks.
- Code-based Netlify rate limits on high-value endpoints.

## Stage 6 — Hard Fix 3/3: point-in-time recovery and release reproducibility

- Historical Trace and decision outcomes now use licensed point-in-time closes instead of current marks.
- Trace gap discovery scans the full bounded range; recovery is chunked and chained with a persisted run ID.
- Historical catch-up never overwrites the latest current world state or moves `lastSuccessfulDate` backward.
- Added request-ID operational traces to the high-value AI/market/recovery functions without storing prompts/secrets.
- Implemented the missing cross-instance state lock with Netlify Blob conditional writes and applied it to portfolio/order/index read-modify-write paths.
- Removed automatic heavy market refresh from app startup.
- Node 24 is aligned across `.nvmrc`, package engines, GitHub CI and Netlify. CI uses `npm ci`.
- `package-lock.json` now captures the exact `@netlify/blobs` 11.0.3 closure and validates with `npm ls --package-lock-only --all`.
- Static deploy assets no longer inherit global `no-store`; dynamic JSON APIs still set `no-store`.

## Stage 7 — Full Audit — PENDING

The new post-fix Full Audit is the next stage in the locked sequence. Hard Fix 3 itself has passed the full existing regression chain plus the new point-in-time/concurrency/release tests, but that does not replace the separate Full Audit stage.

Testing note: the isolated environment could not resolve npmjs.org. For local regression only, a temporary in-memory compatibility shim for `@netlify/blobs` was used and is removed before packaging. The real dependency remains exactly `@netlify/blobs` 11.0.3. The lockfile dependency closure validates locally, but the first connected GitHub/Netlify run must still prove a real Node 24 `npm ci`.

## Stage 8 — Final Fix — PENDING

Reserved for defects found by the post-fix Full Audit.

## Stage 9 — Polish — PENDING

Reserved for the final conservative polish after Full Audit and Final Fix.

## Rollback

The live Netlify production deploy is intentionally untouched. Keep it as rollback until the final Git-connected Deploy Preview passes real Gateway, Blobs and market-data smoke tests. No destructive state migration is introduced by Hard Fix 3.
