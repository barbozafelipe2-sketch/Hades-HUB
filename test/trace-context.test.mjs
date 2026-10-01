import assert from 'node:assert/strict';
import {getHistoricalTraceContext,resetTraceContextCacheForTests,TRACE_FACTOR_CATALOG} from '../netlify/lib/trace-context.mjs';

const vars=['KAIROS_TRACE_CONTEXT_BASE_URL','KAIROS_TRACE_CONTEXT_API_KEY','KAIROS_TRACE_CONTEXT_LICENSE_ID'];
const old=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
const nativeFetch=globalThis.fetch;
try{
  for(const key of vars) delete process.env[key];
  resetTraceContextCacheForTests();
  const closed=await getHistoricalTraceContext('2024-01-31');
  assert.equal(closed.status,'UNAVAILABLE');
  assert.deepEqual(closed.factors,[]);
  assert.ok(TRACE_FACTOR_CATALOG.length>=20,'catalog covers multiple macro and geopolitical domains');

  process.env.KAIROS_TRACE_CONTEXT_BASE_URL='https://context.example/api';
  process.env.KAIROS_TRACE_CONTEXT_API_KEY='server-only-test-key';
  process.env.KAIROS_TRACE_CONTEXT_LICENSE_ID='commercial-test-license';
  let calls=0; let capturedUrl; let capturedHeaders;
  globalThis.fetch=async (url,options)=>{
    calls++; capturedUrl=String(url); capturedHeaders=options.headers;
    return {ok:true,status:200,json:async()=>({as_of:'2024-01-31',factors:[
      {factor_code:'policy_rates',value:5.25,unit:'%',period:'2024-01',observed_at:'2024-01-31T00:00:00Z',published_at:'2024-01-31T14:00:00Z',available_at:'2024-01-31T14:00:01Z',source:'Licensed macro feed',source_url:'https://context.example/rates',license_id:'commercial-test-license',point_in_time:true,revision_id:'initial'},
      {factor_code:'inflation',value:3.1,unit:'%',period:'2024-01',observed_at:'2024-01-31T00:00:00Z',published_at:'2024-02-13T13:30:00Z',available_at:'2024-02-13T13:30:00Z',source:'Licensed macro feed',source_url:'https://context.example/cpi',license_id:'commercial-test-license',point_in_time:true},
      {factor_code:'financial_stress',value:9,observed_at:'2024-01-31T00:00:00Z',published_at:'2024-01-31T14:00:00Z',available_at:'2024-01-31T14:00:00Z',source:'Licensed macro feed',source_url:'https://context.example/stress',license_id:'wrong-license',point_in_time:true}
    ],events:[
      {event_id:'event-1',title:'Recorded policy announcement',summary:'A sourced announcement.',category:'monetary_policy',regions:['US'],occurred_at:'2024-01-31T12:00:00Z',published_at:'2024-01-31T12:05:00Z',available_at:'2024-01-31T12:05:00Z',source:'Licensed event feed',source_url:'https://context.example/event/1',license_id:'commercial-test-license',point_in_time:true},
      {title:'Later report',category:'geopolitics',occurred_at:'2024-01-31T12:00:00Z',published_at:'2024-02-01T00:00:00Z',available_at:'2024-02-01T00:00:00Z',source:'Licensed event feed',source_url:'https://context.example/event/2',license_id:'commercial-test-license',point_in_time:true}
    ]})};
  };
  resetTraceContextCacheForTests();
  const [a,b]=await Promise.all([getHistoricalTraceContext('2024-01-31'),getHistoricalTraceContext('2024-01-31')]);
  assert.equal(calls,1,'same-date refreshes share one in-flight source request');
  assert.equal(a.status,'AVAILABLE');
  assert.equal(a.factors.length,1,'released-after-date and wrong-license rows are excluded');
  assert.equal(a.events.length,1,'later-published events are excluded');
  assert.equal(a.factors[0].point_in_time,true);
  assert.equal(a.rejected_rows,3);
  assert.equal(a,b);
  assert.match(capturedUrl,/as_of=2024-01-31/);
  assert.equal(capturedHeaders['x-api-key'],'server-only-test-key');

  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({as_of:'2024-01-31',factors:[
    {factor_code:'inflation',value:2.5,unit:'%',period:'2024-01',observed_at:'2024-01-31T00:00:00Z',published_at:'2024-01-31T12:00:00Z',available_at:'2024-01-31T12:00:00Z',source:'Licensed feed',source_url:'http://not-tls.example/data',license_id:'commercial-test-license',point_in_time:true}
  ]})});
  resetTraceContextCacheForTests();
  const bad=await getHistoricalTraceContext('2024-01-31');
  assert.equal(bad.status,'UNAVAILABLE','non-HTTPS source links are rejected');
  assert.deepEqual(bad.factors,[]);
  console.log('trace-context: PASS (catalog, licensing, provenance, look-ahead guard, fail-closed, dedupe)');
}finally{
  globalThis.fetch=nativeFetch;
  resetTraceContextCacheForTests();
  for(const key of vars){ if(old[key]==null) delete process.env[key]; else process.env[key]=old[key]; }
}
