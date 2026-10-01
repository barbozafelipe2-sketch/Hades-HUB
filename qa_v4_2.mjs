import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.OPENAI_API_KEY='test-openai-key';
process.env.SAURON_ADMIN_USER='admin';
process.env.SAURON_ADMIN_PASSWORD='admin123';
process.env.KAIROS_LEGACY_AUTH_ENABLED='true';
delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_AI_API_KEY; delete process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_CRITIC_MODEL;

const root=path.resolve('.');
const { verifyCredentials, createSessionToken } = await import('./netlify/lib/auth.mjs');
const { normalizeTransaction, derivePortfolio } = await import('./netlify/lib/portfolio.mjs');
const { setJSON } = await import('./netlify/lib/store.mjs');
const { buildUniverseView } = await import('./netlify/lib/market-universe.mjs');
const { evaluateStrategy, DEFAULT_STRATEGY, normalizeStrategy } = await import('./netlify/lib/evolution.mjs');
const { runGuardedJSONTask, runFourCoreGuardedJSONTask, publicGateMeta } = await import('./netlify/lib/ai-gate.mjs');
const { saveAIMirror, getAIMirrorHistory } = await import('./netlify/lib/state.mjs');
const { buildPerformanceMirror } = await import('./netlify/lib/mirror-performance.mjs');

const results=[]; const pass=(name,detail='')=>results.push({name,status:'PASS',detail});

assert.equal(await verifyCredentials('admin','admin123'),true); pass('Legacy owner bridge works for migration QA');
const token=await createSessionToken(); assert.ok(token.includes('.')); pass('Signed admin session token created');

const tx=[normalizeTransaction({type:'DEPOSIT',date:'2026-09-10',amount:10000}),normalizeTransaction({type:'BUY',date:'2026-09-10',symbol:'QQQ',quantity:10,unitPrice:500})];
const p=derivePortfolio(tx,{QQQ:{price:510,source:'manual',asOf:'2026-09-11T12:00:00Z'}},{asOf:'2026-09-11'});
assert.equal(p.positions.length,1); assert.equal(p.cash,5000); assert.ok(p.totalValue>10000); pass('Broker paper transaction flows into deterministic Wallet Mirror ledger');

await setJSON('portfolio/transactions',tx); await setJSON('portfolio/marks',{QQQ:{price:510,source:'manual',asOf:'2026-09-11T12:00:00Z'}});
const mk=(date,qqq,spy,b)=>({date,generated_at:`${date}T20:00:00Z`,regime:{name:'test',trend:'up',liquidity:'normal',volatility:'normal'},benchmarks:{spy_price:spy,gold_price:200,btc_price:b},instruments:[{symbol:'SPY',price:spy,as_of:`${date}T20:00:00Z`},{symbol:'QQQ',price:qqq,as_of:`${date}T20:00:00Z`},{symbol:'VNQ',price:90,as_of:`${date}T20:00:00Z`},{symbol:'TLT',price:95,as_of:`${date}T20:00:00Z`},{symbol:'VT',price:110,as_of:`${date}T20:00:00Z`},{symbol:'ETH',price:2500,as_of:`${date}T20:00:00Z`} ]});
for (const [date,qqq,spy,b] of [['2026-09-10',500,6000,58000],['2026-09-11',510,6060,59000],['2026-09-12',520,6120,60000]]) await setJSON(`trace/world-state/${date}`,mk(date,qqq,spy,b));
await setJSON('trace/world-state/latest',mk('2026-09-12',520,6120,60000));
const u=await buildUniverseView(); const q=u.find(x=>x.symbol==='QQQ'); assert.equal(q.series.length,3); assert.ok(q.periodReturn>0); pass('Broker market board builds real recorded curves');

await saveAIMirror({generatedAt:'2026-09-10T21:00:00Z',status:'APPROVED',focus:'all',budget:10000,allocation:[{symbol:'QQQ',weight_pct:50,amount:5000},{symbol:'SPY',weight_pct:50,amount:5000}],gate:{approved:true}});
const hist=await getAIMirrorHistory(); assert.equal(hist.length,1); pass('Approved AI Mirror is versioned into comparison history');

await setJSON('snapshots/2026-09-10',{date:'2026-09-10',portfolioValue:10000,netExternalFlow:10000,completeMarks:true,markIntegrity:'complete'});
await setJSON('snapshots/2026-09-11',{date:'2026-09-11',portfolioValue:10100,netExternalFlow:0,completeMarks:true,markIntegrity:'complete'});
await setJSON('snapshots/2026-09-12',{date:'2026-09-12',portfolioValue:10250,netExternalFlow:0,completeMarks:true,markIntegrity:'complete'});
const pm=await buildPerformanceMirror(); assert.equal(pm.user.ready,true); assert.equal(pm.ai.ready,true); assert.equal(pm.benchmark.ready,true); assert.ok(pm.user.series.length>=3); assert.ok(pm.ai.series.length>=3); pass('Performance Mirror compares YOU vs SAURON vs SPY from recorded data');

const decisions=[
 {final:{status:'ADD',audit_status:'PASS',confidence:'HIGH'},specialists:{core2:{source_quality:'high',unknowns:[]}},attacks:{a:{pass:true}},evidenceSnapshot:{position:{allocation:.2}},outcomes:[{checkpointDays:30,directionalCorrect:true}]},
 {final:{status:'ADD',audit_status:'PASS',confidence:'LOW'},specialists:{core2:{source_quality:'low',unknowns:['a','b','c','d']}},attacks:{a:{pass:true}},evidenceSnapshot:{position:{allocation:.55}},outcomes:[{checkpointDays:30,directionalCorrect:false}]}
];
const permissive=normalizeStrategy({...DEFAULT_STRATEGY,preferAbstainWhenUnknowns:10,maxSingleAssetPctForAdd:90});
const base=evaluateStrategy(decisions,permissive); const conservative=evaluateStrategy(decisions,normalizeStrategy({...DEFAULT_STRATEGY,minConfidence:'HIGH',blockLowSourceQuality:true,preferAbstainWhenUnknowns:2,maxSingleAssetPctForAdd:35}));
assert.ok(conservative.score>base.score); pass('Evolution champion/challenger keeps only a better tested policy');

const queue=[
 {output_text:JSON.stringify({value:'bad'}),model:'gpt-test',id:'1'},
 {output_text:JSON.stringify({ok:true}),model:'gpt-test',id:'2'},
 {output_text:JSON.stringify({pass:true,severity:'low',findings:[],required_fixes:[]}),model:'gpt-test',id:'3'},
 {output_text:JSON.stringify({approved:true,confidence:'HIGH',reasons:['passes'],redo_instructions:[]}),model:'gpt-final',id:'4'},
];
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>new Response(JSON.stringify(queue.shift()),{status:200,headers:{'content-type':'application/json'}});
const gated=await runGuardedJSONTask({task:'guarded task',prompt:'return JSON',validate:d=>({pass:d?.ok===true,findings:d?.ok===true?[]:['ok_missing']})});
assert.equal(gated.approved,true); assert.equal(gated.attempt,1); pass('Final CROWN gate rejects, rebuilds once, rechecks, then approves');
globalThis.fetch=originalFetch;

const fourQueue=[
 {output_text:JSON.stringify({ok:true}),model:'gpt-primary',id:'c1'},
 {output_text:JSON.stringify({pass:true,severity:'low',findings:[],required_fixes:[]}),model:'gpt-devil',id:'c2'},
 {output_text:JSON.stringify({pass:true,severity:'low',findings:[],required_fixes:[]}),model:'gpt-risk',id:'c3'},
 {output_text:JSON.stringify({approved:true,blocking:false,confidence:'HIGH',reasons:['passes'],redo_instructions:[]}),model:'gpt-final',id:'final'},
];
globalThis.fetch=async()=>new Response(JSON.stringify(fourQueue.shift()),{status:200,headers:{'content-type':'application/json'}});
const four=await runFourCoreGuardedJSONTask({task:'wallet mirror test',prompt:'return JSON',validate:d=>({pass:d?.ok===true,findings:[]})});
assert.equal(four.approved,true); assert.equal(four.cores.length,4); assert.ok(four.cores.every(c=>c.pass===true)); assert.equal(publicGateMeta(four).final.approved,true); pass('Wallet/AI four-core chain passes analyst, devil, risk, deterministic checks, and strict final CROWN judge');
globalThis.fetch=originalFetch;

const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'); const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
for(const label of ['Broker','AI Mirror','Wallet Mirror','Performance','Decisions']) assert.ok(index.includes(label),`missing nav label ${label}`);
for(const label of ['Decision Review','Learning Lab','Decision History']) assert.ok((index+app).includes(label),`missing commercial label ${label}`);
assert.ok(!index.includes('data-section="markets"')); pass('Markets is collapsed into Broker; V7 navigation architecture present');
assert.ok(app.includes('KAIROS BROKER · PAPER EXECUTION') && app.includes('Paper execution only.') && app.includes('Same person. Same capital. KAIROS makes the choices.')); pass('Professional paper Broker and AI Mirror semantics are explicit');
assert.ok(!/admin123|OPENAI_API_KEY\s*=|SUPABASE_SERVICE_ROLE_KEY\s*=|OPENROUTER_API_KEY\s*=|GEMINI_API_KEY\s*=/.test([app,index].join('\n'))); pass('No server secrets or default admin password exposed in browser source');

console.log(JSON.stringify({ok:true,results},null,2));
