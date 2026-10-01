import assert from 'node:assert/strict';
process.env.OPENAI_API_KEY='test-key';
process.env.SAURON_ADMIN_USER='admin';
process.env.SAURON_ADMIN_PASSWORD='admin123';
process.env.KAIROS_LEGACY_AUTH_ENABLED='true';
delete process.env.GEMINI_API_KEY; delete process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_CRITIC_MODEL;
const {createSessionToken}=await import('./netlify/lib/auth.mjs');
const {saveTransactions,saveMarks,getAIMirror,getWalletMirror}=await import('./netlify/lib/state.mjs');
const {getJSON}=await import('./netlify/lib/store.mjs');
const {normalizeTransaction}=await import('./netlify/lib/portfolio.mjs');
const aiMirror=(await import('./netlify/functions/ai-mirror.mjs')).default;
const walletMirror=(await import('./netlify/functions/wallet-mirror.mjs')).default;
const evolutionLab=(await import('./netlify/functions/evolution-lab.mjs')).default;
const token=await createSessionToken(); const cookie=`sauron_session=${token}`;
const originalFetch=globalThis.fetch;
const wrap=(obj,id)=>({output_text:JSON.stringify(obj),model:'gpt-test',id});
function fourCoreRows(candidate,prefix){return [
 wrap(candidate,`${prefix}1`),
 wrap({pass:true,severity:'low',findings:[],required_fixes:[]},`${prefix}2`),
 wrap({pass:true,severity:'low',findings:[],required_fixes:[]},`${prefix}3`),
 wrap({approved:true,blocking:false,confidence:'HIGH',reasons:['ok'],redo_instructions:[]},`${prefix}4`)
];}
function mockOpenAI(rows){const q=[...rows];globalThis.fetch=async()=>new Response(JSON.stringify(q.shift()),{status:200,headers:{'content-type':'application/json'}});}

mockOpenAI(fourCoreRows({budget:1000,currency:'USD',stance_summary:'Diversified test mirror',allocation:[{symbol:'QQQ',asset_class:'Equities',weight_pct:100,amount:1000,role:'Growth',outlook:'NEUTRAL',confidence:'MODERATE',why:['test'],risks:['test risk']}],scenario:{base:'base',bull:'bull',bear:'bear'},report:'test report',unknowns:[]},'a'));
const jobId='123e4567-e89b-42d3-a456-426614174001';
let req=new Request('https://local/.netlify/functions/ai-mirror',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({budget:1000,focus:'all',jobId})});
await aiMirror(req); // background handlers return void when invoked directly
let job=await getJSON(`jobs/ai-mirror/${jobId}`,null); let mirror=await getAIMirror();
assert.equal(job?.status,'COMPLETE'); assert.equal(job?.ok,true); assert.equal(mirror?.status,'APPROVED'); assert.equal(mirror?.gate?.final?.approved,true); assert.equal(mirror?.gate?.cores?.length,4);
let res,data;

await saveTransactions([normalizeTransaction({type:'OPENING_POSITION',date:'2026-09-01',symbol:'QQQ',quantity:2,unitPrice:100})]);
await saveMarks({QQQ:{price:120,source:'manual',asOf:'2026-09-11T12:00:00Z'}});
mockOpenAI(fourCoreRows({summary:'wallet test',portfolio_outlook:'NEUTRAL',risk_score:'MODERATE',holdings:[{symbol:'QQQ',action:'HOLD',outlook:'NEUTRAL',confidence:'MODERATE',prediction:'conditional test',why:['test'],risks:['risk']}],concentration_feedback:['test'],next_contribution:'test',portfolio_report:'wallet report',unknowns:[]},'w'));
const walletJobId='123e4567-e89b-42d3-a456-426614174002';
req=new Request('https://local/.netlify/functions/wallet-mirror',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({jobId:walletJobId})});
await walletMirror(req);
job=await getJSON(`jobs/wallet-mirror/${walletJobId}`,null); const wallet=await getWalletMirror();
assert.equal(job?.status,'COMPLETE'); assert.equal(job?.ok,true); assert.equal(wallet?.status,'APPROVED'); assert.equal(wallet?.holdings?.length,1); assert.equal(wallet?.gate?.cores?.length,4);

req=new Request('https://local/.netlify/functions/evolution-lab',{method:'GET',headers:{cookie}});
res=await evolutionLab(req); data=await res.json(); assert.equal(res.status,200); assert.ok(data.evolution.champion.policy);
globalThis.fetch=originalFetch;
console.log(JSON.stringify({ok:true,tests:['AI Mirror four-core guarded endpoint','Wallet Mirror four-core guarded endpoint','Evolution Lab status endpoint']},null,2));
