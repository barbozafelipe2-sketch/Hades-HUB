import assert from 'node:assert/strict';
Object.assign(process.env,{
  KAIROS_DATA_BACKEND:'postgres',
  KAIROS_DATABASE_QA_MEMORY:'true',
  KAIROS_INTERNAL_SECRET:'global-trace-stage-three-local-test-secret',
  KAIROS_GLOBAL_TRACE_COLLECTION_ENABLED:'false'
});
const store=await import('../netlify/lib/store.mjs');
const consent=await import('../netlify/lib/global-trace-consent.mjs');
const {collectConsentedGlobalTrace}=await import('../netlify/lib/global-trace-collection.mjs');
const {internalToken}=await import('../netlify/lib/internal.mjs');
const handler=(await import('../netlify/functions/global-trace-collect.mjs')).default;
store.configurePersistenceForRequest({});

const ids=Array.from({length:12},(_,i)=>'t_trace_collect_'+i);
await store.setSystemJSON('auth/tenants/index',[...ids,ids[0]]);
await store.setSystemJSON('auth/users/index',[]);
for(let i=0;i<ids.length;i++){
  const id=ids[i];
  await store.setSystemJSON('auth/tenants/'+id,{
    id,status:'active',plan:'trial',createdAt:'2026-10-01T00:00:00Z'
  });
  await store.runInTenantContext(id,async()=>{
    if(i!==10)await consent.setGlobalTraceConsent(true);
    const count=i===11?2:5;
    const keys=Array.from({length:count},(_,j)=>'trace_decision_'+j);
    await store.setJSON('decisions/index',keys);
    for(let j=0;j<count;j++){
      await store.setJSON('decisions/'+keys[j],{
        id:keys[j],final:{status:'ADD'},
        outcomes:[{pointInTime:true,checkpointDays:7,returnSinceDecision:0.1,directionalCorrect:i%2===0}]
      });
    }
  });
}
assert.equal(store.currentTenantContext(),null,'collection setup must not leak tenant context');
const first=await collectConsentedGlobalTrace();
assert.equal(first.status,'AGGREGATED');
assert.equal(first.metrics.decision_calibration.tenantCount,10,'no double-counted, opted-out or sparse tenants');
assert.equal(first.metrics.decision_calibration.mean,0.5);
assert.equal(first.storage,'ephemeral');
assert.equal(first.globalSharingActive,false);
assert(!JSON.stringify(first).includes(ids[0]),'no tenant IDs in aggregate');

await store.runInTenantContext(ids[0],async()=>{
  const before=await consent.globalTraceConsent();
  await consent.setGlobalTraceConsent(false);
  const after=await consent.globalTraceConsent();
  assert.notEqual(before.revision,after.revision,'revocation must invalidate in-flight snapshot');
  assert.equal(await store.getJSON('draft/global-trace/metrics',null),null);
});
const afterOptOut=await collectConsentedGlobalTrace();
assert.equal(afterOptOut.status,'INSUFFICIENT_CONSENTED_COHORT');
assert.deepEqual(afterOptOut.metrics,{});
await store.runInTenantContext(ids[0],()=>consent.setGlobalTraceConsent(true));
assert.equal((await collectConsentedGlobalTrace()).status,'AGGREGATED');
assert.equal(await store.getSystemJSON('global-trace/aggregate',null),null,'no global aggregate persistence');

const url='https://example.test/.netlify/functions/global-trace-collect';
const call=(method,headers={})=>handler(new Request(url,{method,headers}),{});
assert.equal((await call('GET')).status,405);
assert.equal((await call('POST')).status,403,'public request must never collect tenants');
const headers={'x-sauron-internal':internalToken()};
assert.equal((await call('POST',headers)).status,409,'explicit feature gate defaults disabled');
process.env.KAIROS_GLOBAL_TRACE_COLLECTION_ENABLED='true';
const result=await call('POST',headers);
assert.equal(result.status,200,'trusted system request may run gated collection');
assert.equal((await result.json()).metrics.decision_calibration.tenantCount,10);
assert.equal(store.currentTenantContext(),null,'internal collection must not leave a tenant active');
console.log('global-trace-collection: PASS (consent, deletion, cohort, system-only, isolation, gate)');
