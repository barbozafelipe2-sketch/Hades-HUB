import assert from 'node:assert/strict';
import { quote, closes, benchmark, clearMarketTruthCache } from '../netlify/lib/market-truth.mjs';
import { twelveQuote } from '../netlify/lib/twelve-data.mjs';
import { finnhubQuote } from '../netlify/lib/finnhub.mjs';

process.env.KAIROS_LICENSED_MARKET_BASE_URL='https://licensed.test';
process.env.KAIROS_LICENSED_MARKET_API_KEY='test';
process.env.KAIROS_LICENSED_MARKET_LICENSE_ID='test-license';
process.env.TWELVE_DATA_API_KEY='test';
process.env.FINNHUB_API_KEY='test';
const originalFetch=globalThis.fetch;
let payload={price:100};
try{
  globalThis.fetch=async input=>new Response(JSON.stringify(new URL(input).hostname==='licensed.test'?payload:{}));
  for(const asof of [undefined,'invalid']){
    payload={price:100,asof};clearMarketTruthCache();
    await assert.rejects(()=>quote('SPY'),/MARKET_DATA_UNAVAILABLE/);
  }
  payload={price:100,asof:'2026-10-01T16:00:00Z'};
  clearMarketTruthCache();
  assert.equal((await quote('SPY')).asof,payload.asof);
  for(const proof of [
    {},
    {point_in_time:true},
    {point_in_time:true,available_at:'invalid'},
    {point_in_time:true,available_at:'2026-10-02T00:00:00Z'},
    {point_in_time:true,available_at:'2026-09-30T00:00:00Z'},
    {point_in_time:true,available_at:'2026-10-01T16:01:00Z'}
  ]){
    const row={price:100,asof:'2026-10-01T16:00:00Z',...proof};
    const expected=proof.available_at==='2026-10-01T16:01:00Z';
    payload=[row];
    assert.equal((await closes('SPY','2026-10-01','2026-10-01'))[0].point_in_time,expected);
    payload=row;
    assert.equal((await benchmark('SPY',{from:'2026-10-01',to:'2026-10-01'})).point_in_time,expected);
  }
  for(const invalid of [undefined,0,'invalid']){
    globalThis.fetch=async()=>new Response(JSON.stringify({close:100,c:100,t:invalid,timestamp:invalid}));
    await assert.rejects(()=>twelveQuote('SPY'),/BAD_TIMESTAMP/);
    await assert.rejects(()=>finnhubQuote('SPY'),/BAD_TIMESTAMP/);
  }
  globalThis.fetch=async()=>new Response(JSON.stringify({close:100,c:100,t:1790870400,timestamp:1790870400}));
  assert.equal((await twelveQuote('SPY')).asOf,'2026-10-01T16:00:00.000Z');
  assert.equal((await finnhubQuote('SPY')).asOf,'2026-10-01T16:00:00.000Z');
  console.log('market-provenance: PASS');
}finally{globalThis.fetch=originalFetch;clearMarketTruthCache();}
