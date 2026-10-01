import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

process.env.SAURON_ALLOW_EPHEMERAL_WRITES='true';
process.env.NETLIFY='false';
globalThis.__SAURON_MEMORY_STORE__=new Map();
globalThis.__NETLIFY_BLOBS_TEST__=new Map();

const results=[];
const pass=(name)=>results.push({name,status:'PASS'});
const reset=()=>{
  globalThis.__SAURON_MEMORY_STORE__.clear();
  for(const store of globalThis.__NETLIFY_BLOBS_TEST__.values()) store.clear();
};

const {normalizePaperOrder,executeMarketPaperOrder,placePendingPaperOrder,processPendingPaperOrders,cancelPaperOrder}=await import('./netlify/lib/paper-orders.mjs');
const {saveTransactions,saveMarks,getTransactions,getPaperOrders,savePaperOrders,saveWatchlist,getWatchlist}=await import('./netlify/lib/state.mjs');
const {normalizeTransaction,derivePortfolio}=await import('./netlify/lib/portfolio.mjs');

// Paper broker validation is strict and supports brokerage-style order types without real execution.
{
  const o=normalizePaperOrder({symbol:'aapl',side:'buy',orderType:'stop limit',quantity:1.25,stopPrice:101,limitPrice:102});
  assert.equal(o.symbol,'AAPL'); assert.equal(o.side,'BUY'); assert.equal(o.orderType,'STOP_LIMIT');
  assert.equal(o.status,'OPEN');
  assert.throws(()=>normalizePaperOrder({symbol:'AAPL',side:'BUY',orderType:'LIMIT',quantity:1}),/LIMIT_PRICE_REQUIRED/);
  assert.throws(()=>normalizePaperOrder({symbol:'AAPL',side:'BUY',orderType:'MARKET',quantity:1}),/INVALID_ORDER_TYPE/);
  assert.throws(()=>normalizePaperOrder({symbol:'AAPL',side:'HOLD',orderType:'LIMIT',quantity:1,limitPrice:90}),/INVALID_ORDER_SIDE/);
  pass('Paper broker validates LIMIT / STOP / STOP_LIMIT tickets');
}

// Market BUY consumes tracked cash using a fresh mark; oversells and unfunded buys are rejected.
{
  reset();
  await saveTransactions([normalizeTransaction({type:'DEPOSIT',amount:1000,date:new Date().toISOString().slice(0,10),note:'test cash'})]);
  await saveMarks({AAPL:{price:100,asOf:new Date().toISOString(),source:'finnhub'}});
  const buy=await executeMarketPaperOrder({symbol:'AAPL',side:'BUY',quantity:2,fees:1});
  assert.equal(buy.order.status,'FILLED'); assert.equal(buy.order.fillPrice,100);
  let p=derivePortfolio(await getTransactions(),{AAPL:{price:100,asOf:new Date().toISOString(),source:'finnhub'}});
  assert.equal(p.positions[0].quantity,2); assert.ok(Math.abs(p.cash-799)<0.001);
  await assert.rejects(()=>executeMarketPaperOrder({symbol:'AAPL',side:'SELL',quantity:3}),/SELL_EXCEEDS_POSITION/);
  await assert.rejects(()=>executeMarketPaperOrder({symbol:'AAPL',side:'BUY',quantity:100}),/INSUFFICIENT_TRACKED_CASH/);
  pass('Market paper orders enforce holdings, cash and fresh price truth');
}

// LIMIT order remains open until a fresh stored mark crosses it, then becomes a ledger row.
{
  reset();
  await saveTransactions([normalizeTransaction({type:'DEPOSIT',amount:1000,date:new Date().toISOString().slice(0,10),note:'test cash'})]);
  await saveMarks({AAPL:{price:100,asOf:new Date().toISOString(),source:'finnhub'}});
  const order=await placePendingPaperOrder({symbol:'AAPL',side:'BUY',orderType:'LIMIT',quantity:1,limitPrice:95});
  assert.equal(order.status,'OPEN');
  let r=await processPendingPaperOrders(); assert.equal(r.fills.length,0);
  await saveMarks({AAPL:{price:94,asOf:new Date().toISOString(),source:'finnhub'}});
  r=await processPendingPaperOrders(); assert.equal(r.fills.length,1); assert.equal(r.fills[0].fillPrice,94);
  const saved=(await getPaperOrders()).find(x=>x.id===order.id); assert.equal(saved.status,'FILLED');
  assert.equal((await getTransactions()).filter(x=>x.type==='BUY').length,1);
  pass('Pending paper orders fill only when fresh stored marks trigger them');
}

// Stop-limit requires the stop trigger first and then the limit condition.
{
  reset();
  await saveTransactions([normalizeTransaction({type:'DEPOSIT',amount:3000,date:new Date().toISOString().slice(0,10),note:'test cash'})]);
  await saveMarks({AAPL:{price:100,asOf:new Date().toISOString(),source:'finnhub'}});
  const order=await placePendingPaperOrder({symbol:'AAPL',side:'BUY',orderType:'STOP_LIMIT',quantity:1,stopPrice:105,limitPrice:104});
  let r=await processPendingPaperOrders(); assert.equal(r.fills.length,0);
  await saveMarks({AAPL:{price:106,asOf:new Date().toISOString(),source:'finnhub'}});
  r=await processPendingPaperOrders(); assert.equal(r.fills.length,0);
  let mid=(await getPaperOrders()).find(x=>x.id===order.id); assert.equal(mid.triggered,true); assert.equal(mid.status,'OPEN');
  await saveMarks({AAPL:{price:103,asOf:new Date().toISOString(),source:'finnhub'}});
  r=await processPendingPaperOrders(); assert.equal(r.fills.length,1);
  const done=(await getPaperOrders()).find(x=>x.id===order.id); assert.equal(done.status,'FILLED');
  pass('STOP_LIMIT preserves trigger-then-limit semantics');
}

// Open SELL orders reserve holdings so two orders cannot promise the same shares.
{
  reset();
  const d=new Date().toISOString().slice(0,10);
  await saveTransactions([
    normalizeTransaction({type:'DEPOSIT',amount:1000,date:d,note:'cash'}),
    normalizeTransaction({type:'BUY',symbol:'AAPL',quantity:5,unitPrice:100,fees:0,date:d,note:'position'})
  ]);
  await saveMarks({AAPL:{price:100,asOf:new Date().toISOString(),source:'finnhub'}});
  await placePendingPaperOrder({symbol:'AAPL',side:'SELL',orderType:'LIMIT',quantity:4,limitPrice:120});
  await assert.rejects(()=>placePendingPaperOrder({symbol:'AAPL',side:'SELL',orderType:'LIMIT',quantity:2,limitPrice:125}),/INSUFFICIENT_HOLDINGS_FOR_ORDER/);
  pass('Open SELL orders reserve holdings and prevent double-selling');
}

// Open orders can be cancelled and cannot be cancelled twice.
{
  reset();
  await saveTransactions([normalizeTransaction({type:'DEPOSIT',amount:1000,date:new Date().toISOString().slice(0,10),note:'test cash'})]);
  await saveMarks({AAPL:{price:100,asOf:new Date().toISOString(),source:'finnhub'}});
  const o=await placePendingPaperOrder({symbol:'AAPL',side:'BUY',orderType:'LIMIT',quantity:.1,limitPrice:80});
  const c=await cancelPaperOrder(o.id); assert.equal(c.status,'CANCELLED');
  await assert.rejects(()=>cancelPaperOrder(o.id),/ORDER_NOT_OPEN/);
  pass('Open order cancellation is persistent and state-safe');
}

// Watchlist is normalized and deduplicated.
{
  reset();
  await saveWatchlist(['aapl','AAPL','btc','']);
  assert.deepEqual(await getWatchlist(),['AAPL','BTC']);
  pass('Watchlist persistence normalizes and deduplicates symbols');
}

// The shipped UI exposes the intended professional broker / lab architecture and keeps infrastructure secrets server-side.
{
  const app=fs.readFileSync('./public/app.js','utf8');
  const html=fs.readFileSync('./public/index.html','utf8');
  const css=fs.readFileSync('./public/v7.css','utf8');
  assert.match(html,/V7\.3 · DECISION INTELLIGENCE/);
  assert.match(html,/\/v7\.css\?v=7\.3\.0/);
  assert.match(app,/KAIROS BROKER · PAPER EXECUTION/);
  assert.match(app,/Market \/ Limit \/ Stop orders/);
  assert.match(app,/MARKET PULSE/);
  assert.match(app,/renderMarketCollections/);
  assert.match(app,/DECISION CENTER/);
  assert.match(app,/Learning Lab/);
  assert.match(app,/Decision History/);
  assert.match(app,/YOU vs KAIROS/);
  assert.match(css,/v7-market-collections/);
  assert.match(css,/mkt-stack\.v7-market-grid/);
  assert.match(css,/grid-template-columns:repeat\(6,1fr\)/);
  assert.doesNotMatch(app,/AlphaVantage|NewsAPI|Enter .* API key|SAVE KEYS/i);
  assert.doesNotMatch(html,/OPENAI_API_KEY\s*=|FINNHUB_API_KEY\s*=|TWELVE_DATA_API_KEY\s*=/);
  pass('V7 UI includes premium Broker, Mirrors, Decision Center and Labs without client key-entry surfaces');
}

// V7 state / backup contracts include the new broker state.
{
  const stateFn=fs.readFileSync('./netlify/functions/state.mjs','utf8');
  const backup=fs.readFileSync('./netlify/functions/backup.mjs','utf8');
  const refresh=fs.readFileSync('./netlify/lib/trace.mjs','utf8');
  assert.match(stateFn,/paperOrders,watchlist/);
  assert.match(backup,/version:5/);
  assert.match(backup,/getPaperOrders/);
  assert.match(backup,/getWatchlist/);
  assert.match(refresh,/paper_order_processing/);
  assert.doesNotMatch(refresh,/catch\s*\{\s*\}/);
  pass('V7 persists paper orders/watchlist and reports order processing instead of silently swallowing it');
}

// Immutable V7 release presentation lock.
{
  const locks=JSON.parse(fs.readFileSync('./qa_v7_ui_hashes.json','utf8'));
  for(const [file,expected] of Object.entries(locks)){
    const got=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(got,expected,`V7 UI lock mismatch: ${file}`);
  }
  pass('V7 shipped UI matches immutable SHA-256 release locks');
}

console.log(JSON.stringify({ok:true,results},null,2));
