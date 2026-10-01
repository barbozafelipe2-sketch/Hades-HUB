import crypto from 'node:crypto';
import { performanceFromSnapshots, OUTCOME_CHECKPOINT_DAYS } from './portfolio.mjs';

const NO_ACTION_STATUSES=new Set(['NO_ACTION','HOLD','WATCH','ABSTAIN']);
const ACTIONABLE_STATUSES=new Set(['ADD','REDUCE']);

function finite(v){ if(v===null||v===undefined||v==='') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function isoDate(v){ const s=String(v||'').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null; }
function round(v,d=8){ const n=finite(v); return n==null?null:Number(n.toFixed(d)); }
function stable(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  const keys=Object.keys(value).sort();
  return '{'+keys.map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
function hashEvidence(value){ return crypto.createHash('sha256').update(stable(value)).digest('hex'); }

function snapshotEvidence(snapshots=[]){
  return [...snapshots].filter(Boolean).map(s=>({
    date:isoDate(s.date),
    portfolioValue:round(s.portfolioValue),
    netExternalFlow:round(s.netExternalFlow||0),
    spyPrice:round(s.spyPrice ?? s.sp500Level),
    completeMarks:s.completeMarks!==false,
    markIntegrity:String(s.markIntegrity||'unknown'),
    reconstruction:s.reconstruction||null
  })).filter(s=>s.date).sort((a,b)=>a.date.localeCompare(b.date));
}
function outcomeEvidence(decisions=[]){
  return [...decisions].filter(Boolean).map(d=>{
    const status=String(d?.final?.status||'').toUpperCase();
    const outcomes=(Array.isArray(d.outcomes)?d.outcomes:[]).map(o=>({
      checkpointDays:Number(o.checkpointDays ?? o.daysSinceDecision),
      targetDate:isoDate(o.targetDate),
      asOf:isoDate(o.asOf),
      returnSinceDecision:round(o.returnSinceDecision),
      directionalCorrect:o.directionalCorrect===true,
      priceSource:String(o.priceSource||'').slice(0,80),
      pointInTime:o.pointInTime===true,
      exactTradingDate:o.exactTradingDate===true
    })).filter(o=>OUTCOME_CHECKPOINT_DAYS.includes(o.checkpointDays));
    return {
      id:String(d.id||'').slice(0,120),
      date:isoDate(d.date||d.createdAt),
      asset:String(d.asset||'').toUpperCase().slice(0,40),
      status,
      referencePrice:round(d.referencePrice),
      outcomes
    };
  }).filter(d=>d.id&&d.date&&d.asset).sort((a,b)=>(a.date+'|'+a.id).localeCompare(b.date+'|'+b.id));
}

function decisionMetrics(rows=[]){
  const checkpointStats=OUTCOME_CHECKPOINT_DAYS.map(days=>{
    const obs=[];
    for(const d of rows){
      if(!ACTIONABLE_STATUSES.has(d.status)) continue;
      for(const o of d.outcomes){
        if(o.checkpointDays!==days || o.pointInTime!==true || o.returnSinceDecision==null) continue;
        obs.push({decisionId:d.id,correct:o.directionalCorrect===true,signedReturn:d.status==='ADD'?o.returnSinceDecision:-o.returnSinceDecision});
      }
    }
    const correct=obs.filter(x=>x.correct).length;
    return {days,observations:obs.length,correct,directionalHitRate:obs.length?round(correct/obs.length):null,averageDirectionalReturn:obs.length?round(obs.reduce((s,x)=>s+x.signedReturn,0)/obs.length):null};
  });
  const allOutcomes=rows.flatMap(d=>d.outcomes.map(o=>({status:d.status,...o})));
  const pointInTime=allOutcomes.filter(o=>o.pointInTime===true&&o.returnSinceDecision!=null);
  const maturedIds=new Set();
  for(const d of rows){
    if(ACTIONABLE_STATUSES.has(d.status) && d.outcomes.some(o=>o.pointInTime===true&&o.returnSinceDecision!=null&&o.checkpointDays>=7)) maturedIds.add(d.id);
  }
  return {
    totalDecisions:rows.length,
    actionableDecisions:rows.filter(d=>ACTIONABLE_STATUSES.has(d.status)).length,
    noActionObservations:rows.filter(d=>NO_ACTION_STATUSES.has(d.status)).length,
    maturedActionableDecisions:maturedIds.size,
    scoredPointInTimeOutcomes:pointInTime.length,
    excludedNonPointInTimeOutcomes:allOutcomes.length-pointInTime.length,
    checkpointStats
  };
}

function monthlyEvidence(snapshots=[],decisions=[],recorded=false){
  const byMonth=new Map();
  for(const row of snapshots){ if(!row.date) continue; const month=row.date.slice(0,7); if(!byMonth.has(month))byMonth.set(month,[]); byMonth.get(month).push(row); }
  const decisionsByMonth=new Map();
  for(const d of decisions){ const month=d.date?.slice(0,7); if(!month)continue; if(!decisionsByMonth.has(month))decisionsByMonth.set(month,[]); decisionsByMonth.get(month).push(d); }
  return [...byMonth.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([month,rows])=>{
    const perf=performanceFromSnapshots(rows);
    const monthlyDecisions=decisionsByMonth.get(month)||[];
    const completeSnapshotCount=rows.filter(x=>x.completeMarks&&x.markIntegrity!=='stale_or_incomplete').length;
    const valid=recorded&&perf.ready&&completeSnapshotCount===rows.length&&perf.benchmarkReturn!=null;
    return {month,startDate:rows[0]?.date||null,endDate:rows.at(-1)?.date||null,snapshotCount:rows.length,completeSnapshotCount,
      decisionCount:monthlyDecisions.length,actionableDecisions:monthlyDecisions.filter(d=>ACTIONABLE_STATUSES.has(d.status)).length,
      maturedActionableDecisions:monthlyDecisions.filter(d=>ACTIONABLE_STATUSES.has(d.status)&&d.outcomes.some(o=>o.pointInTime&&o.returnSinceDecision!=null&&o.checkpointDays>=7)).length,
      status:valid?'RECORDED':'BUILDING',paperReturn:valid?round(perf.totalReturn):null,spyReturn:valid?round(perf.benchmarkReturn):null,
      relativeToSpy:valid?round(perf.totalReturn-perf.benchmarkReturn):null};
  });
}

export function buildTrackRecord({snapshots=[],decisions=[],generatedAt=new Date().toISOString()}={}){
  const snapshotRows=snapshotEvidence(snapshots);
  const decisionRows=outcomeEvidence(decisions);
  const perf=performanceFromSnapshots(snapshots);
  const decision=decisionMetrics(decisionRows);
  const completeSnapshots=snapshotRows.filter(s=>s.completeMarks&&s.markIntegrity!=='stale_or_incomplete');
  const spyRows=snapshotRows.filter(s=>s.spyPrice!=null&&s.spyPrice>0);
  const startDate=snapshotRows[0]?.date||null, endDate=snapshotRows.at(-1)?.date||null;
  const evidence={version:1,snapshots:snapshotRows,decisions:decisionRows};
  const evidenceHash=hashEvidence(evidence);
  const snapshotCoverage=snapshotRows.length?completeSnapshots.length/snapshotRows.length:0;
  const spyCoverage=snapshotRows.length?spyRows.length/snapshotRows.length:0;
  const pointInTimeOutcomeRate=(decision.scoredPointInTimeOutcomes+decision.excludedNonPointInTimeOutcomes)
    ? decision.scoredPointInTimeOutcomes/(decision.scoredPointInTimeOutcomes+decision.excludedNonPointInTimeOutcomes):0;
  const recorded=completeSnapshots.length>=30 && decision.maturedActionableDecisions>=10;
  const monthly=monthlyEvidence(snapshotRows,decisionRows,recorded);
  return {
    schemaVersion:1,
    methodologyVersion:'kairos-track-record-v1',
    generatedAt,
    evidenceState:recorded?'RECORDED':'BUILDING',
    period:{startDate,endDate,snapshotCount:snapshotRows.length,completeSnapshotCount:completeSnapshots.length},
    performance:{
      ready:perf.ready===true,
      paperPortfolioReturn:perf.ready?round(perf.totalReturn):null,
      spyReturn:perf.ready?round(perf.benchmarkReturn):null,
      relativeToSpy:perf.ready&&finite(perf.benchmarkReturn)!=null?round(perf.totalReturn-perf.benchmarkReturn):null,
      maxDrawdown:perf.ready?round(perf.maxDrawdown):null,
      annualizedVolatility:perf.ready?round(perf.annualizedVol):null,
      riskAdjusted:perf.ready?round(perf.riskAdjusted):null,
      method:'time_weighted_return_from_recorded_snapshots'
    },
    decision,
    monthly,
    coverage:{snapshotCoverage:round(snapshotCoverage),spyCoverage:round(spyCoverage),pointInTimeOutcomeRate:round(pointInTimeOutcomeRate)},
    integrity:{algorithm:'sha256',evidenceHash,externallyAudited:false,attestation:'Integrity hash detects evidence changes in this export; it is not an external audit or third-party attestation.'},
    claims:{
      paperOnly:true,predictive:false,externallyAudited:false,
      statement:'Historical paper results and directional scorecards are descriptive only. They do not establish future performance, investment advice, or market edge.'
    },
    evidence
  };
}
