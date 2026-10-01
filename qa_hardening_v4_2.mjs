import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
process.env.OPENAI_API_KEY='test-openai-key';
delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_AI_API_KEY;
delete process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_CRITIC_MODEL;
delete process.env.MARKET_DATA_PROVIDER; delete process.env.MARKET_DATA_API_KEY; delete process.env.MARKET_DATA_BASE_URL; delete process.env.TWELVE_DATA_API_KEY; delete process.env.FINNHUB_API_KEY;
const {runGuardedJSONTask}=await import('./netlify/lib/ai-gate.mjs');
const {providerStatus}=await import('./netlify/lib/providers.mjs');
const results=[]; const pass=n=>results.push({name:n,status:'PASS'});
const originalFetch=globalThis.fetch;

// A structurally invalid candidate is rejected before critic/final, saving credits.
let preCalls=0;
const preRows=[
 {output_text:JSON.stringify({bad:true}),model:'gpt-test',id:'p1'},
 {output_text:JSON.stringify({bad:true}),model:'gpt-test',id:'p2'}
];
globalThis.fetch=async()=>{preCalls++; return new Response(JSON.stringify(preRows.shift()),{status:200,headers:{'content-type':'application/json'}})};
const pre=await runGuardedJSONTask({task:'invalid twice',prompt:'return JSON',validate:d=>({pass:d?.ok===true,findings:['ok_missing']})});
assert.equal(pre.approved,false); assert.equal(preCalls,2); assert.equal(pre.preGateRejected,true); pass('Deterministic pre-gate prevents critic/final calls on malformed candidates');

// Valid structure but final gate rejects twice: gen/critic/judge x2 = exactly 6 calls, then hard stop.
const rows=[
 {output_text:JSON.stringify({ok:true}),model:'gpt-test',id:'1'},
 {output_text:JSON.stringify({pass:true,severity:'low',findings:[],required_fixes:[]}),model:'gpt-test',id:'2'},
 {output_text:JSON.stringify({approved:false,confidence:'HIGH',reasons:['bad thesis'],redo_instructions:['rebuild thesis']}),model:'gpt-final',id:'3'},
 {output_text:JSON.stringify({ok:true}),model:'gpt-test',id:'4'},
 {output_text:JSON.stringify({pass:true,severity:'low',findings:[],required_fixes:[]}),model:'gpt-test',id:'5'},
 {output_text:JSON.stringify({approved:false,confidence:'HIGH',reasons:['still bad'],redo_instructions:[]}),model:'gpt-final',id:'6'}
];
let calls=0;
globalThis.fetch=async()=>{calls++; return new Response(JSON.stringify(rows.shift()),{status:200,headers:{'content-type':'application/json'}})};
const rejected=await runGuardedJSONTask({task:'reject twice',prompt:'return JSON',validate:d=>({pass:d?.ok===true,findings:[]})});
assert.equal(rejected.approved,false); assert.equal(rejected.attempt,1); assert.equal(calls,6); pass('Second final-gate rejection hard-stops after exactly one rebuild');
globalThis.fetch=originalFetch;

let ps=providerStatus();
assert.equal(ps.market.configured,false); assert.equal(ps.supabase.implemented,false); pass('Incomplete licensed-feed credentials cannot report configured and Supabase cannot report active customer system');
process.env.MARKET_DATA_PROVIDER='vendor'; process.env.MARKET_DATA_API_KEY='key'; delete process.env.MARKET_DATA_BASE_URL;
ps=providerStatus(); assert.equal(ps.market.configured,false); pass('Licensed feed readiness requires complete credentials');
process.env.MARKET_DATA_BASE_URL='https://feed.example.test';
ps=providerStatus(); assert.equal(ps.market.configured,true); assert.equal(ps.market.verified,false); assert.equal(ps.market.dataClass,'licensed_feed_configured_unverified'); pass('Market credentials never masquerade as a verified feed before a successful licensed world-state');
delete process.env.MARKET_DATA_PROVIDER; delete process.env.MARKET_DATA_API_KEY; delete process.env.MARKET_DATA_BASE_URL; delete process.env.TWELVE_DATA_API_KEY; delete process.env.FINNHUB_API_KEY;
process.env.FINNHUB_API_KEY='test-finnhub-only';
ps=providerStatus(); assert.equal(ps.market.configured,true); assert.ok(ps.market.provider==='finnhub'||String(ps.market.provider||'').includes('finnhub')); pass('FINNHUB alone configures licensed market feed');
delete process.env.FINNHUB_API_KEY;

const ui=fs.readFileSync('./reference-ui/Sauron-ui-approved-source.html');
const expectedUiSha='c3c02ef607f8e86af93abecd2fec567928d96f9591d750e8eb0092fb8df32bc3';
assert.equal(crypto.createHash('sha256').update(ui).digest('hex'),expectedUiSha); pass('Approved reference UI source matches immutable SHA-256 lock');

const app=fs.readFileSync('./public/app.js','utf8'), index=fs.readFileSync('./public/index.html','utf8');
for(const symbol of ['QQQ','SPY','BTC','ETH','VNQ','GLD','TLT','VT','AAPL','KO','MSFT','NVDA']) assert.ok(fs.readFileSync('./netlify/lib/market-universe.mjs','utf8').includes(symbol));
assert.ok(app.includes('WALLET MIRROR')&&app.includes('AI MIRROR')&&app.includes('DECISION JOURNAL · TRACK RECORD')); pass('Locked paper workspace + decision-journal architecture is present');
assert.ok(!index.includes('data-section="markets"')); pass('Disconnected Markets page removed from navigation');
const universeSrc=fs.readFileSync('./netlify/lib/market-universe.mjs','utf8');
const perfSrc=fs.readFileSync('./netlify/lib/mirror-performance.mjs','utf8');
assert.ok(!universeSrc.includes("symbol==='GLD') return Number(ws?.benchmarks?.gold_price)"));
assert.ok(!universeSrc.includes("symbol==='SPY') return Number(ws?.benchmarks?.sp500_level)"));
assert.ok(!perfSrc.includes("if(symbol==='GLD') return finite(ws?.benchmarks?.gold_price)"));
assert.ok(!perfSrc.includes("if(symbol==='SPY') return finite(ws?.benchmarks?.sp500_level)"));
pass('ETF curves never substitute S&P index levels or gold spot quotes for SPY/GLD prices');
assert.ok(!/admin123/.test(index+app)); pass('Default admin password is absent from browser source');
console.log(JSON.stringify({ok:true,results},null,2));
