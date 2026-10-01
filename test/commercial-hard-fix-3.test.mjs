import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTrackRecord } from '../netlify/lib/track-record.mjs';

const snapshots=[
  {date:'2026-01-01',portfolioValue:10000,netExternalFlow:0,spyPrice:500,completeMarks:true,markIntegrity:'complete'},
  {date:'2026-01-02',portfolioValue:10100,netExternalFlow:0,spyPrice:502,completeMarks:true,markIntegrity:'complete'},
  {date:'2026-01-08',portfolioValue:10300,netExternalFlow:0,spyPrice:505,completeMarks:true,markIntegrity:'complete'}
];
const decisions=[
  {id:'d1',date:'2026-01-01',asset:'AAPL',referencePrice:100,final:{status:'ADD'},outcomes:[
    {checkpointDays:7,targetDate:'2026-01-08',asOf:'2026-01-08',returnSinceDecision:0.08,directionalCorrect:true,priceSource:'twelve_data',pointInTime:true,exactTradingDate:true},
    {checkpointDays:30,targetDate:'2026-01-31',asOf:'2026-01-31',returnSinceDecision:0.11,directionalCorrect:true,priceSource:'legacy',pointInTime:false}
  ]},
  {id:'d2',date:'2026-01-01',asset:'TSLA',referencePrice:200,final:{status:'REDUCE'},outcomes:[
    {checkpointDays:7,targetDate:'2026-01-08',asOf:'2026-01-08',returnSinceDecision:-0.05,directionalCorrect:true,priceSource:'finnhub',pointInTime:true,exactTradingDate:true}
  ]},
  {id:'d3',date:'2026-01-01',asset:'MSFT',referencePrice:300,final:{status:'HOLD'},outcomes:[]}
];

const a=buildTrackRecord({snapshots,decisions,generatedAt:'2026-02-01T00:00:00.000Z'});
const b=buildTrackRecord({snapshots,decisions,generatedAt:'2026-02-02T00:00:00.000Z'});
assert.equal(a.integrity.evidenceHash,b.integrity.evidenceHash,'generatedAt must not change evidence hash');
assert.match(a.integrity.evidenceHash,/^[0-9a-f]{64}$/);
assert.equal(a.evidenceState,'BUILDING');
assert.equal(a.period.snapshotCount,3);
assert.equal(a.decision.maturedActionableDecisions,2);
assert.equal(a.decision.noActionObservations,1);
assert.equal(a.decision.excludedNonPointInTimeOutcomes,1);
const seven=a.decision.checkpointStats.find(x=>x.days===7);
assert.equal(seven.observations,2);
assert.equal(seven.directionalHitRate,1);
assert.equal(seven.averageDirectionalReturn,0.065);
assert.equal(a.claims.paperOnly,true);
assert.equal(a.claims.predictive,false);
assert.equal(a.integrity.externallyAudited,false);
assert.match(a.integrity.attestation,/not an external audit/i);

const changed=structuredClone(snapshots); changed[2].portfolioValue=10400;
const c=buildTrackRecord({snapshots:changed,decisions,generatedAt:'2026-02-01T00:00:00.000Z'});
assert.notEqual(c.integrity.evidenceHash,a.integrity.evidenceHash,'evidence mutation must change hash');
const noSpy=structuredClone(snapshots); for(const row of noSpy) delete row.spyPrice;
const d=buildTrackRecord({snapshots:noSpy,decisions,generatedAt:'2026-02-01T00:00:00.000Z'});
assert.equal(d.performance.spyReturn,null);
assert.equal(d.performance.relativeToSpy,null,'missing SPY evidence must never be coerced to a 0% benchmark');

const endpoint=fs.readFileSync(new URL('../netlify/functions/track-record.mjs',import.meta.url),'utf8');
assert.match(endpoint,/requireSession/);
assert.match(endpoint,/buildTrackRecord/);
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert.match(app,/Track Record Ledger/);
assert.match(app,/not an external audit/i);
assert.match(app,/exportTrackRecordBtn/);
assert.match(app,/Paper relative to SPY/);
console.log('commercial-hard-fix-3: PASS');
