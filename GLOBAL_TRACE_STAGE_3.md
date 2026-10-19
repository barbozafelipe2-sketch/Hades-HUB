# Global Trace — stage 3/5 (internal collection)

This stage completes the collection boundary; it does not activate global learning or public sharing.

- Tenant owners explicitly opt in through the existing global-trace consent handler.
- Each internal collection recomputes eligible, point-in-time decision metrics inside the tenant workspace.
- At least five eligible, mature decisions are required **per contributing tenant**.
- At least ten **distinct consented tenants** must contribute to a metric before an aggregate is returned.
- An internal-only, HMAC-protected POST to /.netlify/functions/global-trace-collect triggers a collection.
- Collection is disabled by default; enable KAIROS_GLOBAL_TRACE_COLLECTION_ENABLED=true only for authorized validation.
- The handler never accepts caller-supplied tenant lists, metrics, flags or aggregation thresholds.
- Contribution candidates are rechecked against the live consent revision before computing a result.
- Opt-out deletes private cached metrics. Later runs never use opted-out contributions.
- No raw individual records, cross-tenant candidate rows or aggregated results are written to global storage.
- Only trusted internal callers can see aggregate means; no public or user-facing read endpoint was added.
- Scans fail closed when more than 250 active tenant index entries exist, rather than silently sampling.
- A previously observed aggregate cannot be retroactively erased from a trusted caller's memory; there is no persisted aggregate in Kairos to invalidate.
- No scheduled collection is activated by this stage.

Stage 4 must add a bounded, consent-aware evaluation pipeline with privacy review before any global feedback is used to train, calibrate, or promote policies. Stage 5 remains UI and end-to-end operational governance.
