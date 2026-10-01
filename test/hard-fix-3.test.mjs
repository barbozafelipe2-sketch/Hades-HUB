import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setJSON, getJSON, withKeyLock } from '../netlify/lib/store.mjs';
import { scoreDecisionOutcomes, missingTraceDates } from '../netlify/lib/trace.mjs';
import { beginOperationalTrace } from '../netlify/lib/ops-trace.mjs';

process.env.TWELVE_DATA_API_KEY='qa-historical-key';
delete process.env.FINNHUB_API_KEY;

// Historical checkpoint prices must come from the checkpoint date, not a current mark.
globalThis.fetch=async (input)=>{
  const u=new URL(String(input));
  if(!u.pathname.endsWith('/time_series')) throw new Error(`UNEXPECTED_FETCH:${u}`);
  const target=String(u.searchParams.get('end_date')||'2026-06-08').slice(0,10);
  const day=Number(target.slice(-2));
  const px=target==='2026-06-02'?102:target==='2026-06-08'?110:100+day;
  const prior=new Date(`${target}T00:00:00Z`); prior.setUTCDate(prior.getUTCDate()-1);
  return new Response(JSON.stringify({values:[
    {datetime:prior.toISOString().slice(0,10),close:String(px-1)},
    {datetime:target,close:String(px)}
  ]}),{status:200,headers:{'content-type':'application/json'}});
};
await setJSON('decisions/index',['hf3-decision']);
await setJSON('decisions/hf3-decision',{
  id:'hf3-decision',date:'2026-06-01',asset:'SPY',referencePrice:100,
  final:{status:'ADD'},outcomes:[]
});
const scored=await scoreDecisionOutcomes('2026-06-08');
assert.equal(scored.failures.length,0);
const decision=await getJSON('decisions/hf3-decision');
const d1=decision.outcomes.find(x=>x.checkpointDays===1);
const d7=decision.outcomes.find(x=>x.checkpointDays===7);
assert.equal(d1.targetDate,'2026-06-02');
assert.equal(d1.priceAsOf,'2026-06-02T23:59:59Z');
assert.ok(Math.abs(d1.returnSinceDecision-0.02)<1e-12);
assert.equal(d7.targetDate,'2026-06-08');
assert.ok(Math.abs(d7.returnSinceDecision-0.10)<1e-12);
assert.equal(d7.pointInTime,true);
assert.equal(d7.priceSource,'twelve_data');

// Gap scan must continue past a fully populated first window.
await setJSON('trace/status',{traceStartDate:'2026-01-01',catchupRunning:false});
let day=new Date('2026-01-02T00:00:00Z');
for(let i=0;i<90;i++){
  await setJSON(`traces/${day.toISOString().slice(0,10)}`,{ok:true});
  day.setUTCDate(day.getUTCDate()+1);
}
const gaps=await missingTraceDates('2026-05-15',3);
assert.equal(gaps.length,3);
assert.ok(gaps[0]>='2026-04-02',`gap scanner stopped too early: ${gaps[0]}`);

// Local lock must serialize competing read-modify-write sections.
const order=[];
await Promise.all([
  withKeyLock('hf3-lock',async()=>{order.push('a1');await new Promise(r=>setTimeout(r,20));order.push('a2');}),
  withKeyLock('hf3-lock',async()=>{order.push('b1');order.push('b2');})
]);
assert.deepEqual(order,['a1','a2','b1','b2']);

// Explicit Blob rollback mode must still serialize through conditional writes.
process.env.KAIROS_DATA_BACKEND='blobs';
process.env.NETLIFY='true';
const distributed=[];
await Promise.all([
  withKeyLock('hf3-dist',async()=>{distributed.push('a1');await new Promise(r=>setTimeout(r,20));distributed.push('a2');}),
  withKeyLock('hf3-dist',async()=>{distributed.push('b1');distributed.push('b2');})
]);
assert.deepEqual(distributed,['a1','a2','b1','b2']);
delete process.env.NETLIFY;
delete process.env.KAIROS_DATA_BACKEND;

// Operational trace must preserve platform request ID and never store prompt payloads.
const req=new Request('https://example.test/.netlify/functions/market-refresh',{method:'POST'});
const op=beginOperationalTrace(req,{requestId:'req-hf3-123'},{functionName:'qa',jobId:'job-hf3'});
await op.finish({status:'COMPLETE',provider:'openai',model:'test-model'});
const opRow=await getJSON(`ops/${new Date().toISOString().slice(0,10)}/req-hf3-123`);
assert.equal(opRow.requestId,'req-hf3-123');
assert.equal(opRow.function,'qa');
assert.equal(opRow.details.provider,'openai');
assert.equal('prompt' in opRow.details,false);

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const loadState=app.slice(app.indexOf('async function loadState'),app.indexOf('function applyDisplayMode'));
assert.equal(loadState.includes("api('market-refresh'"),false,'startup must not trigger market refresh');
assert.ok(loadState.includes('Startup is read-only'));

const ci=fs.readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
assert.match(ci,/node-version:\s*24/);
assert.match(ci,/npm ci --ignore-scripts/);
const toml=fs.readFileSync(new URL('../netlify.toml',import.meta.url),'utf8');
assert.match(toml,/NODE_VERSION = "24"/);
assert.equal(toml.includes('Cache-Control = "no-store"'),false,'static global no-store must be removed');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const lock=JSON.parse(fs.readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
assert.equal(pkg.engines.node,'24.x');
assert.equal(lock.packages['node_modules/@netlify/blobs'].version,'11.0.3');
assert.equal(lock.packages[''].dependencies['@netlify/blobs'],'11.0.3');

const catchup=fs.readFileSync(new URL('../netlify/functions/trace-catchup-background.mjs',import.meta.url),'utf8');
assert.match(catchup,/BATCH_SIZE/);
assert.match(catchup,/catchupRunId/);
assert.match(catchup,/triggerNext\(runId,/);
const trace=fs.readFileSync(new URL('../netlify/lib/trace.mjs',import.meta.url),'utf8');
assert.match(trace,/historicalClose\(/);
assert.match(trace,/pointInTime:true/);
assert.match(trace,/No current quotes, news, AI prices/);
assert.match(trace,/const newestDate=/,'historical catch-up must not move lastSuccessfulDate backwards');
console.log('hard-fix-3 PASS');
