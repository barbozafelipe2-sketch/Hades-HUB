import assert from 'node:assert/strict';
Object.assign(process.env,{KAIROS_DATA_BACKEND:'postgres',KAIROS_DATABASE_QA_MEMORY:'true'});
const store=await import('../netlify/lib/store.mjs');
const state=await import('../netlify/lib/state.mjs');
const lab=await import('../netlify/lib/global-trace-consent.mjs');
store.configurePersistenceForRequest({});
store.configureTenantForRequest({tenantId:'trace_customer_a',userId:'owner_a',role:'owner'});
assert.equal((await lab.globalTraceConsent()).enabled,false,'opt-in must default off');
assert.equal((await lab.refreshPrivateTraceMetrics()).status,'OPTED_OUT');
await lab.setGlobalTraceConsent(true);
assert.equal((await lab.globalTraceConsent()).enabled,true);
const decisions=[
 {final:{status:'ADD'},outcomes:[{pointInTime:true,checkpointDays:7,returnSinceDecision:0.1,directionalCorrect:true}]},
 {final:{status:'REDUCE'},outcomes:[{pointInTime:true,checkpointDays:7,returnSinceDecision:-0.1,directionalCorrect:false}]},
 {final:{status:'ADD'},outcomes:[{pointInTime:false,checkpointDays:7,returnSinceDecision:0.5,directionalCorrect:true}]}
];
assert.deepEqual(lab.derivePrivateTraceMetrics(decisions),{sample:2,metrics:{decision_calibration:0.5}});
assert.equal((await lab.refreshPrivateTraceMetrics()).status,'PRIVATE_ONLY');
store.configureTenantForRequest({tenantId:'trace_customer_b',userId:'owner_b',role:'owner'});
assert.equal((await lab.globalTraceConsent()).enabled,false,'separate tenant cannot inherit consent');
assert.equal(await store.getJSON('draft/global-trace/metrics',null),null);
store.configureTenantForRequest({tenantId:'trace_customer_a',userId:'owner_a',role:'owner'});
await lab.setGlobalTraceConsent(false);
assert.equal((await lab.globalTraceConsent()).enabled,false);
assert.equal(await store.getJSON('draft/global-trace/metrics',null),null,'opt-out removes metrics');
await assert.rejects(()=>lab.setGlobalTraceConsent('true'),/GLOBAL_TRACE_CONSENT_INVALID/);
console.log('global-trace-consent: PASS');
