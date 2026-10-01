import assert from 'node:assert/strict';
import { derivePortfolio, normalizeTransaction, netExternalFlowForDate, performanceFromSnapshots } from './netlify/lib/portfolio.mjs';

const tx=[
 {id:'1',type:'DEPOSIT',date:'2026-09-01',createdAt:'2026-09-01T00:00:00Z',amount:10000},
 {id:'2',type:'BUY',date:'2026-09-02',createdAt:'2026-09-02T00:00:00Z',symbol:'AAPL',quantity:10,unitPrice:100,fees:0,taxes:0},
];
let p=derivePortfolio(tx,{AAPL:{price:110,source:'manual',asOf:'2026-09-03'}});
assert.equal(p.cash,9000); assert.equal(p.positions[0].quantity,10); assert.equal(p.positions[0].costBasis,1000); assert.equal(p.positions[0].unrealizedPnL,100); assert.equal(p.totalValue,10100);
tx.push({id:'3',type:'SELL',date:'2026-09-04',createdAt:'2026-09-04T00:00:00Z',symbol:'AAPL',quantity:5,unitPrice:120,fees:0,taxes:0});
p=derivePortfolio(tx,{AAPL:{price:110,source:'manual',asOf:'2026-09-04'}});
assert.equal(p.cash,9600); assert.equal(p.positions[0].quantity,5); assert.equal(p.realizedPnL,100); assert.equal(p.unrealizedPnL,50); assert.equal(p.totalValue,10150);
const opening=[
 {id:'op1',type:'OPENING_POSITION',date:'2026-09-02',createdAt:'2026-09-02T00:00:00Z',symbol:'BTC',quantity:1,unitPrice:50000},
 {id:'future1',type:'DEPOSIT',date:'2999-01-01',createdAt:'2999-01-01T00:00:00Z',amount:999999}
];
p=derivePortfolio(opening,{BTC:{price:51000,source:'manual',asOf:new Date().toISOString()}});
assert.equal(p.positions[0].symbol,'BTC');
assert.equal(p.cash,0);
assert.equal(p.externalFlows,50000);
assert.equal(p.totalValue,51000);
assert.ok(p.warnings.some(w=>w.includes('future1')));
assert.equal(netExternalFlowForDate(opening,'2026-09-02'),50000);
assert.throws(()=>normalizeTransaction({type:'DEPOSIT',date:'2026-02-31',amount:1}),/INVALID_TRANSACTION_DATE/);
assert.throws(()=>normalizeTransaction({type:'DEPOSIT',date:'2999-01-01',amount:1}),/FUTURE_TRANSACTION_REJECTED/);
const perf=performanceFromSnapshots([
 {date:'2026-09-01',portfolioValue:10000,netExternalFlow:10000,sp500Level:5000},
 {date:'2026-09-02',portfolioValue:10100,netExternalFlow:0,sp500Level:5050},
 {date:'2026-09-03',portfolioValue:11200,netExternalFlow:1000,sp500Level:5100},
]);
assert.equal(perf.ready,true); assert.ok(Math.abs(perf.totalReturn-0.02)<1e-9); assert.ok(Math.abs(perf.benchmarkReturn-0.02)<1e-9);
const blocked=performanceFromSnapshots([
 {date:'2026-09-01',portfolioValue:10000,netExternalFlow:0,completeMarks:true},
 {date:'2026-09-02',portfolioValue:10100,netExternalFlow:0,completeMarks:false}
]);
assert.equal(blocked.ready,false);
console.log('portfolio/accounting/performance tests PASS');
