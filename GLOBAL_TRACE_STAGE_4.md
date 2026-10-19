# Global Trace — stage 4/5: evidence-gated Learning Lab

## Independent tenant-only evaluation

- Earliest 70% of eligible matured decisions are training-only. The later 30% is reserved for independent validation.
- At least eight unique timestamped training decisions and eight unique later holdout decisions are required. The default split needs 27 outcomes for its first eligible cohort.
- Baseline and challenger use identical held-out decisions. Challenger needs at least six eligible decisions, 65% of baseline coverage, no hit-rate regression and 0.03 absolute score improvement.
- All comparisons are deterministic, and the prompt never receives holdout outcomes.
- A SHA-256 freshness fingerprint of both policies and local train/holdout evidence must match when the tenant owner clicks Promote. Older unversioned candidates are rejected.
- Explicit allowPromote in an automated cycle is rejected. Promotion always requires owner role and a fresh server-side review.
- This does not establish investment alpha, causal strategy improvement, or production accuracy.

## Privacy-preserving Global Trace reference

The existing internal-only global-trace-collect route, behind its disabled-by-default feature flag, now appends learningLabReference. It uses the aggregated mean decision calibration only with ten or more consented tenants. It is reference-only, not a challenger comparison: mayPromotePolicy and mayTrainModel are always false. No aggregate, per-tenant data or model weights are persisted or passed into Learning Lab prompts.

## Stage 5 remaining

Owner-facing consent controls, deletion UX, end-to-end privacy and manual-promotion workflows, operational safety audit and release governance. No Netlify deployment or feature activation occurs in stage 4.
