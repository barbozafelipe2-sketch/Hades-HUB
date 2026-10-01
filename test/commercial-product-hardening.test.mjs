import assert from 'node:assert/strict';
import { commercialReleaseGate } from '../netlify/lib/release-gate.mjs';
import { reserveAIUsage } from '../netlify/lib/database.mjs';
import { stripAIPricing } from '../netlify/lib/market-provider.mjs';
import { clearMarketTruthCache, quote, closes } from '../netlify/lib/market-truth.mjs';
import { configurePersistenceForRequest, configureTenantForRequest, setJSON, getJSON } from '../netlify/lib/store.mjs';
import { saveMarks, saveTransactions } from '../netlify/lib/state.mjs';
import { executeMarketPaperOrder } from '../netlify/lib/paper-orders.mjs';

process.env.KAIROS_DATABASE_QA_MEMORY='true';
process.env.KAIROS_DATA_BACKEND='blobs';
process.env.KAIROS_LICENSED_MARKET_BASE_URL='https://licensed.test';
process.env.KAIROS_LICENSED_MARKET_API_KEY='licensed-secret';
process.env.KAIROS_LICENSED_MARKET_LICENSE_ID='licensed-qa-account';
process.env.TWELVE_DATA_API_KEY='twelve-test-key';
process.env.TWELVE_DATA_LICENSE_ID='twelve-qa-account';
process.env.FINNHUB_API_KEY='finnhub-test-key';
process.env.FINNHUB_LICENSE_ID='finnhub-qa-account';
delete process.env.NETLIFY; delete process.env.SITE_ID;

const originalFetch=globalThis.fetch;
let primaryCalls=0,twelveCalls=0;
try{
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==='licensed.test'){primaryCalls++;await new Promise(r=>setTimeout(r,10));return new Response(JSON.stringify({symbol:'MSFT',price:420,asof:'2026-10-01T15:00:00Z',exchange:'NASDAQ',delay_class:'real_time',license_id:'vendor-qa'}),{status:200});}
    if(u.hostname==='api.twelvedata.com'){
      twelveCalls++;
      if(u.pathname==='/quote') return new Response(JSON.stringify({close:'123.45',datetime:'2026-10-01 15:00:00',exchange:'NASDAQ'}),{status:200});
      if(u.pathname==='/time_series') return new Response(JSON.stringify({values:[{datetime:'2026-09-30',close:'120'},{datetime:'2026-10-01',close:'123.45'}]}),{status:200});
    }
    return new Response('{}',{status:503});
  };
  clearMarketTruthCache();
  const [a,b]=await Promise.all([quote('MSFT'),quote('msft')]);
  assert.equal(a.price,420); assert.equal(b.price,420); assert.equal(primaryCalls,1,'same-symbol refreshes deduplicate');
  assert.deepEqual([a.source,a.asof,a.exchange,a.delay_class,a.license_id,a.point_in_time],['licensed_market_feed','2026-10-01T15:00:00Z','NASDAQ','real_time','vendor-qa',false]);

  // A failed licensed primary falls back in fixed order and marks the provider as sticky for this symbol.
  clearMarketTruthCache(); primaryCalls=0;
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==='licensed.test'){primaryCalls++;return new Response('{}',{status:503});}
    if(u.hostname==='api.twelvedata.com'&&u.pathname==='/quote'){twelveCalls++;return new Response(JSON.stringify({close:'123.45',datetime:'2026-10-01 15:00:00',exchange:'NASDAQ'}),{status:200});}
    if(u.hostname==='api.twelvedata.com'&&u.pathname==='/time_series') return new Response(JSON.stringify({values:[{datetime:'2026-09-30',close:'120'},{datetime:'2026-10-01',close:'123.45'}]}),{status:200});
    return new Response('{}',{status:503});
  };
  const fallback=await quote('AAPL');
  assert.equal(fallback.source,'twelve_data'); assert.ok(fallback.license_id); assert.equal(fallback.point_in_time,false);
  const hist=await closes('AAPL','2026-09-30','2026-10-01');
  assert.equal(hist.length,2); assert.ok(hist.every(x=>x.point_in_time===true&&x.source==='twelve_data'));

  // A provider key without a configured license identifier cannot manufacture licensed provenance.
  delete process.env.TWELVE_DATA_LICENSE_ID;delete process.env.FINNHUB_LICENSE_ID;delete process.env.KAIROS_LICENSED_MARKET_LICENSE_ID;
  clearMarketTruthCache();
  globalThis.fetch=async input=>{const u=new URL(input);if(u.hostname==='licensed.test')return new Response('{}',{status:503});if(u.hostname==='api.twelvedata.com'&&u.pathname==='/quote')return new Response(JSON.stringify({close:'123.45',datetime:'2026-10-01 15:00:00'}),{status:200});if(u.hostname==='finnhub.io')return new Response(JSON.stringify({c:123.45,t:1790866800}),{status:200});return new Response('{}',{status:503});};
  await assert.rejects(()=>quote('NO_LICENSE_ID'),/MARKET_DATA_UNAVAILABLE/);
  assert.equal(commercialReleaseGate({identityConfigured:true,legalConfigured:true,billingConfigured:true}).licensedFeedConfigured,false);

  const aiPrice=stripAIPricing({benchmarks:{spy_price:500},instruments:[{symbol:'SPY',price:500} ]});
  assert.equal(aiPrice.benchmarks.spy_price,null); assert.equal(aiPrice.instruments[0].price,null,'AI-origin numbers are removed before market state is surfaced');

  process.env.KAIROS_TENANT_DAILY_USD='0.01';process.env.KAIROS_SITE_DAILY_USD='1';
  const first=await reserveAIUsage({tenantId:'tenant_cost_a',provider:'openai',model:'gpt-luna',feature:'coach',requestId:'req-cost-1',inputTokens:10,outputTokens:10,estimatedUsd:0.005});
  const replay=await reserveAIUsage({tenantId:'tenant_cost_a',provider:'openai',model:'gpt-luna',feature:'coach',requestId:'req-cost-1',inputTokens:10,outputTokens:10,estimatedUsd:0.005});
  const rejected=await reserveAIUsage({tenantId:'tenant_cost_a',provider:'openai',model:'gpt-terra',feature:'decision',requestId:'req-cost-2',inputTokens:10,outputTokens:10,estimatedUsd:0.01});
  assert.equal(first.ok,true); assert.equal(replay.idempotent,true); assert.equal(rejected.reason,'AI_DAILY_USD_CAP','no second provider call is allowed past the hard cap');

  configurePersistenceForRequest({});
  configureTenantForRequest({tenantId:'tenant_iso_alpha',userId:'user_a',role:'owner'});
  await setJSON('portfolio/isolation',{value:'alpha'});
  configureTenantForRequest({tenantId:'tenant_iso_beta',userId:'user_b',role:'owner'});
  assert.equal(await getJSON('portfolio/isolation',null),null,'tenants cannot read each other’s state');
  await setJSON('portfolio/isolation',{value:'beta'});
  assert.deepEqual(await getJSON('portfolio/isolation'),{value:'beta'});

  configureTenantForRequest({tenantId:'tenant_manual_mark',userId:'user_m',role:'owner'});
  await saveTransactions([{id:'deposit-manual',type:'DEPOSIT',date:'2026-10-01',amount:5000}]);
  await saveMarks({AAPL:{price:200,source:'manual',asOf:'2026-10-01T12:00:00Z'}});
  await assert.rejects(()=>executeMarketPaperOrder({symbol:'AAPL',side:'BUY',quantity:1}),/LICENSED_FRESH_MARK_REQUIRED/);

  delete process.env.KAIROS_LICENSED_MARKET_BASE_URL;delete process.env.KAIROS_LICENSED_MARKET_API_KEY;
  const locked=commercialReleaseGate({identityConfigured:true,legalConfigured:true,billingConfigured:true,signupRequested:false,publicSignupReady:false});
  assert.equal(locked.ready,false);assert.ok(locked.blockers.includes('preview_smoke_approved'));assert.ok(locked.blockers.includes('licensed_feed_ok'));
  process.env.KAIROS_REAL_MONEY_EXECUTION='false';process.env.KAIROS_PRODUCT_MODE='paper_research';process.env.KAIROS_PUBLIC_RELEASE_APPROVED='false';
  console.log('commercial-product-hardening: PASS');
}finally{globalThis.fetch=originalFetch;}
