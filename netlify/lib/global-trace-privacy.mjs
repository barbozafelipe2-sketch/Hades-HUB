/**
 * Global Trace Lab — privacy boundary (stage 1/5).
 * Pure, server-only aggregation. This module does NOT read tenants, collect data,
 * schedule jobs or enable sharing. Caller must verify server-side opt-in first.
 */
const METRICS = Object.freeze({
  evidence_pass_rate: { min: 0, max: 1 },
  decision_calibration: { min: 0, max: 1 },
  provider_error_rate: { min: 0, max: 1 },
  evaluation_latency_ms: { min: 0, max: 120000 },
  analysis_cost_usd: { min: 0, max: 100 }
});
const MIN_DISTINCT_TENANTS = 10;
const MAX_OBSERVATIONS = 10000;
const TENANT_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/;

export function globalTraceMetrics() { return Object.keys(METRICS); }

/**
 * Input rows must come from authenticated, tenant-scoped server storage.
 * Consent must be a durable server-side record, not a browser-provided flag.
 * Never persist the returned tenant buckets in global/public storage.
 */
export function aggregateConsentedTrace(rows, { minTenants = MIN_DISTINCT_TENANTS } = {}) {
  if (!Array.isArray(rows) || rows.length > MAX_OBSERVATIONS) throw new Error('GLOBAL_TRACE_INVALID_BATCH');
  // Caller cannot lower the minimum cohort size.
  if (!Number.isInteger(minTenants) || minTenants < MIN_DISTINCT_TENANTS) throw new Error('GLOBAL_TRACE_MIN_COHORT');
  const buckets = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    // Explicit opt-in, checked by the authenticated server-side ingestion layer.
    if (row.consent !== 'opted_in') continue;
    if (typeof row.tenantId !== 'string' || !TENANT_ID.test(row.tenantId)) continue;
    const name = row.metric;
    if (!Object.prototype.hasOwnProperty.call(METRICS, name)) continue;
    const value = row.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const { min, max } = METRICS[name];
    if (value < min || value > max) continue;
    if (!buckets.has(name)) buckets.set(name, new Map());
    const byTenant = buckets.get(name);
    if (!byTenant.has(row.tenantId)) byTenant.set(row.tenantId, []);
    // Bound one tenant's influence; repeated events do not create new users.
    const entries = byTenant.get(row.tenantId);
    if (entries.length < 100) entries.push(value);
  }
  const metrics = {};
  for (const [name, byTenant] of buckets) {
    if (byTenant.size < minTenants) continue;
    const tenantMeans = [...byTenant.values()].map(values =>
      values.reduce((sum, value) => sum + value, 0) / values.length
    );
    const mean = tenantMeans.reduce((sum, value) => sum + value, 0) / tenantMeans.length;
    // No tenant IDs, individual records or small-cohort groupings in output.
    metrics[name] = { mean: Number(mean.toFixed(6)), tenantCount: byTenant.size };
  }
  return {
    version: 1,
    status: Object.keys(metrics).length ? 'AGGREGATED' : 'INSUFFICIENT_CONSENTED_COHORT',
    minimumTenantCount: minTenants,
    metrics
  };
}
