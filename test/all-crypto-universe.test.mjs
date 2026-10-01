import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.TWELVE_DATA_API_KEY='test_crypto_catalog_key';
process.env.SAURON_ALLOW_EPHEMERAL_READS='true';
process.env.SAURON_ALLOW_EPHEMERAL_WRITES='true';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url)=>{
  const u=new URL(String(url));
  if(u.pathname.endsWith('/cryptocurrencies')){
    return new Response(JSON.stringify({status:'ok',data:[
      {symbol:'BTC/USD',currency_base:'Bitcoin',currency_quote:'US Dollar',available_exchanges:['Coinbase']},
      {symbol:'ETH/USD',currency_base:'Ethereum',currency_quote:'US Dollar',available_exchanges:['Coinbase']},
      {symbol:'SOL/USD',currency_base:'Solana',currency_quote:'US Dollar',available_exchanges:['Coinbase']},
      {symbol:'DOGE/USD',currency_base:'Dogecoin',currency_quote:'US Dollar',available_exchanges:['Kraken']},
      {symbol:'ETH/BTC',currency_base:'Ethereum',currency_quote:'Bitcoin',available_exchanges:['Binance']}
    ]}),{status:200,headers:{'content-type':'application/json'}});
  }
  throw new Error(`UNEXPECTED_FETCH:${u.pathname}`);
};

const twelve=await import('../netlify/lib/twelve-data.mjs');
const finnhub=await import('../netlify/lib/finnhub.mjs');
const cryptoCatalog=await import('../netlify/lib/crypto-catalog.mjs');

assert.equal(twelve.twelveSymbol('SOL-USD'),'SOL/USD');
assert.equal(twelve.twelveSymbol('DOGE-USD'),'DOGE/USD');
assert.equal(twelve.twelveSymbol('BTC'),'BTC/USD');
assert.equal(twelve.twelveIsCryptoSymbol('XRP-USD'),true);
assert.equal(finnhub.finnhubSymbol('SOL-USD'),'BINANCE:SOLUSDT');
assert.equal(finnhub.finnhubSymbol('BTC'),'BINANCE:BTCUSDT');
assert.equal(finnhub.finnhubIsCryptoSymbol('ADA-USD'),true);

const sol=await cryptoCatalog.searchCryptoCatalog({q:'sol',limit:20});
assert.equal(sol.total,1);
assert.equal(sol.assets[0].symbol,'SOL-USD');
assert.equal(sol.assets[0].label,'Solana');
const all=await cryptoCatalog.searchCryptoCatalog({q:'',limit:20});
assert.equal(all.total,4,'non-USD pairs must not leak into the USD paper broker');
assert.deepEqual(all.assets.map(x=>x.symbol),['BTC','DOGE-USD','ETH','SOL-USD']);
assert.equal((await cryptoCatalog.findCryptoAsset('DOGE-USD')).label,'Dogecoin');

globalThis.fetch=originalFetch;

const catalog=fs.readFileSync(new URL('../netlify/lib/crypto-catalog.mjs',import.meta.url),'utf8');
const endpoint=fs.readFileSync(new URL('../netlify/functions/market-universe.mjs',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const decision=fs.readFileSync(new URL('../netlify/functions/decision-run.mjs',import.meta.url),'utf8');
const trace=fs.readFileSync(new URL('../netlify/lib/trace.mjs',import.meta.url),'utf8');

assert.ok(catalog.includes('vendor.match(/^([A-Z0-9]{1,18})\\/USD$/)'));
assert.match(catalog,/MAX_CATALOG_ROWS=10000/);
assert.match(endpoint,/category==='crypto'/);
assert.match(endpoint,/resolveCrypto/);
assert.match(app,/Load more crypto/);
assert.match(app,/supported USD pairs/);
assert.match(app,/loadCryptoCatalog/);
assert.match(decision,/symbolMissing/);
assert.match(trace,/extraSymbols/);
console.log('all-crypto-universe: PASS');