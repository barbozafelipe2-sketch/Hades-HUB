import assert from 'node:assert/strict';
import { aggregateConsentedTrace, globalTraceMetrics } from '../netlify/lib/global-trace-privacy.mjs';

assert(globalTraceMetrics().includes('evidence_pass_rate'));
const row = (tenantId, value, consent='opted_in', metric='evidence_pass_rate') =>
  ({ tenantId, value, consent, metric });
const nine = Array.from({ length:9 }, (_,i)=>row('tenant_'+i, i/10));
assert.equal(aggregateConsentedTrace(nine).status,'INSUFFICIENT_CONSENTED_COHORT');
assert.deepEqual(aggregateConsentedTrace(nine).metrics,{});
assert.equal(aggregateConsentedTrace([...nine,row('tenant_0',1)]).status,'INSUFFICIENT_CONSENTED_COHORT',
  'duplicate contributions cannot manufacture additional tenants');
const ten = [...nine,row('tenant_9',0.9)];
const output = aggregateConsentedTrace(ten);
assert.equal(output.status,'AGGREGATED');
assert.equal(output.metrics.evidence_pass_rate.tenantCount,10);
assert.equal(output.metrics.evidence_pass_rate.mean,0.45);
assert(!JSON.stringify(output).includes('tenant_0'),'tenant IDs must not leave aggregation');
assert.equal(aggregateConsentedTrace([...nine,row('tenant_9',0.9,'opted_out')]).status,'INSUFFICIENT_CONSENTED_COHORT');
assert.equal(aggregateConsentedTrace([...nine,row('tenant_9',0.9,'unset')]).status,'INSUFFICIENT_CONSENTED_COHORT');
assert.equal(aggregateConsentedTrace([...nine,row('tenant_9',0.9,'opted_in','unknown_metric')]).status,'INSUFFICIENT_CONSENTED_COHORT');
assert.equal(aggregateConsentedTrace([...nine,row('tenant_9',Infinity)]).status,'INSUFFICIENT_CONSENTED_COHORT');
assert.throws(()=>aggregateConsentedTrace(ten,{minTenants:1}),/GLOBAL_TRACE_MIN_COHORT/);
assert.throws(()=>aggregateConsentedTrace(new Array(10001)),/GLOBAL_TRACE_INVALID_BATCH/);
assert.equal(aggregateConsentedTrace([...ten,row('tenant_0',1)]).metrics.evidence_pass_rate.tenantCount,10);
console.log('global-trace-privacy: PASS');
