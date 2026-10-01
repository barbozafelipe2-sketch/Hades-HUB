import assert from 'node:assert/strict';
import { normalizeTransaction, isVerifiedPositionPrice } from '../netlify/lib/portfolio.mjs';
import { normalizePaperOrder } from '../netlify/lib/paper-orders.mjs';
import { readJSON } from '../netlify/lib/http.mjs';

assert.equal(isVerifiedPositionPrice({price:100,priceSource:'manual',staleMark:false,markAsOf:new Date().toISOString()}),false,'manual mark must not be verified');
assert.equal(isVerifiedPositionPrice({price:100,priceSource:'finnhub',staleMark:false,markAsOf:new Date().toISOString()}),true,'licensed fresh mark should verify');
assert.throws(()=>normalizeTransaction({type:'BUY',symbol:'SPY',quantity:1e10,unitPrice:10,date:new Date().toISOString().slice(0,10)}),/QUANTITY_OUT_OF_RANGE/);
assert.throws(()=>normalizeTransaction({type:'BUY',symbol:'SPY',quantity:10,unitPrice:1e10,date:new Date().toISOString().slice(0,10)}),/PRICE_OUT_OF_RANGE/);
assert.throws(()=>normalizePaperOrder({symbol:'SPY',side:'BUY',orderType:'LIMIT',quantity:1e10,limitPrice:10}),/QUANTITY_OUT_OF_RANGE/);
const huge='{"x":"'+ 'a'.repeat(200) +'"}';
await assert.rejects(()=>readJSON(new Request('https://example.test',{method:'POST',body:huge,headers:{'content-type':'application/json'}}),{maxBytes:64}),/REQUEST_BODY_TOO_LARGE/);
console.log('hard-fix-2 PASS');
