import { getDecisions,getEvolutionState,saveEvolutionState } from './state.mjs';
import { runGuardedJSONTask, publicGateMeta } from './ai-gate.mjs';

export const DEFAULT_STRATEGY={
  minConfidence:'LOW',
  blockLowSourceQuality:false,
  requireAllAttacksPass:true,
  maxSingleAssetPctForAdd:40,
  preferAbstainWhenUnknowns:3,
  description:'Baseline Decision Review: audited evidence, user suitability, and conservative abstention when evidence is insufficient.'
};
export const MATURITY_THRESHOLD=8;
const CONF={LOW:1,MODERATE:2,HIGH:3};

export function normalizeStrategy(s={}){
  return {
    minConfidence:['LOW','MODERATE','HIGH'].includes(s.minConfidence)?s.minConfidence:'LOW',
    blockLowSourceQuality:s.blockLowSourceQuality===true,
    requireAllAttacksPass:s.requireAllAttacksPass!==false,
    maxSingleAssetPctForAdd:Math.max(5,Math.min(90,Number(s.maxSingleAssetPctForAdd||40))),
    preferAbstainWhenUnknowns:Math.max(0,Math.min(10,Math.round(Number(s.preferAbstainWhenUnknowns??3)))),
    description:String(s.description||DEFAULT_STRATEGY.description).slice(0,800)
  };
}
function latestScoredOutcome(d){
  const rows=(d?.outcomes||[]).filter(o=>typeof o?.directionalCorrect==='boolean').sort((a,b)=>Number(a.checkpointDays||0)-Number(b.checkpointDays||0));
  return rows.at(-1)||null;
}
function decisionTime(d){
  const t=Date.parse(d?.createdAt||d?.date||0);
  return Number.isFinite(t)?t:0;
}
function unknownCount(d){
  let n=0; for(const c of Object.values(d?.specialists||{})) n+=Array.isArray(c?.unknowns)?c.unknowns.length:0; return n;
}
function sourceQuality(d){ return String(d?.specialists?.core2?.source_quality||'unknown').toLowerCase(); }
function attacksPass(d){ return Object.values(d?.attacks||{}).every(a=>a?.pass===true); }
function positionAllocationPct(d){
  const p=d?.evidenceSnapshot?.position; if(!p) return null;
  const raw=Number(p.allocation ?? p.allocationPct ?? p.weight); if(!Number.isFinite(raw)) return null;
  return raw<=1?raw*100:raw;
}
export function strategyAllows(d,strategy){
  const s=normalizeStrategy(strategy);
  const action=String(d?.final?.status||'');
  if(!['ADD','REDUCE'].includes(action)) return false;
  if(d?.final?.audit_status!=='PASS') return false;
  if(s.requireAllAttacksPass && !attacksPass(d)) return false;
  if((CONF[String(d?.final?.confidence||'LOW')]||1)<CONF[s.minConfidence]) return false;
  if(s.blockLowSourceQuality && sourceQuality(d)==='low') return false;
  if(unknownCount(d)>s.preferAbstainWhenUnknowns) return false;
  const alloc=positionAllocationPct(d); if(action==='ADD' && alloc!=null && alloc>s.maxSingleAssetPctForAdd) return false;
  return true;
}
export function evaluateStrategy(decisions,strategy){
  const scored=decisions.map(d=>({d,o:latestScoredOutcome(d)})).filter(x=>x.o && ['ADD','REDUCE'].includes(String(x.d?.final?.status||'')));
  if(!scored.length) return {sample:0,eligible:0,correct:0,hitRate:null,coverage:0,score:null};
  const eligible=scored.filter(x=>strategyAllows(x.d,strategy));
  const correct=eligible.filter(x=>x.o.directionalCorrect===true).length;
  const hitRate=eligible.length?correct/eligible.length:0;
  const coverage=eligible.length/scored.length;
  const score=hitRate-(1-coverage)*0.15;
  return {sample:scored.length,eligible:eligible.length,correct,hitRate,coverage,score};
}
/** Time-ordered scored ADD/REDUCE decisions: earlier = holdout, recent = inspire (≈70/30). */
export function splitScoredHoldout(decisions,{inspireShare=0.3}={}){
  const scored=decisions
    .map(d=>({d,o:latestScoredOutcome(d)}))
    .filter(x=>x.o && ['ADD','REDUCE'].includes(String(x.d?.final?.status||'')))
    .sort((a,b)=>decisionTime(a.d)-decisionTime(b.d));
  const n=scored.length;
  if(n===0) return {all:[],inspire:[],holdout:[],maturedCount:0,inspireCount:0,holdoutCount:0};
  let inspireN=Math.max(1,Math.round(n*inspireShare));
  if(inspireN>=n) inspireN=Math.max(1,n-1); // keep at least one holdout when n>=2
  if(n===1) inspireN=1; // tiny sample: inspire only; holdout empty until more data
  const cut=n-inspireN;
  const holdout=scored.slice(0,Math.max(0,cut)).map(x=>x.d);
  const inspire=scored.slice(Math.max(0,cut)).map(x=>x.d);
  return {all:scored.map(x=>x.d),inspire,holdout,maturedCount:n,inspireCount:inspire.length,holdoutCount:holdout.length};
}
export function diagnoseDecisions(decisions){
  const rows=decisions.map(d=>({d,o:latestScoredOutcome(d)})).filter(x=>x.o && ['ADD','REDUCE'].includes(String(x.d?.final?.status||'')));
  const misses=rows.filter(x=>!x.o.directionalCorrect);
  return {
    sample:rows.length,misses:misses.length,hitRate:rows.length?(rows.length-misses.length)/rows.length:null,
    lowConfidenceMisses:misses.filter(x=>String(x.d?.final?.confidence||'LOW')==='LOW').length,
    lowSourceQualityMisses:misses.filter(x=>sourceQuality(x.d)==='low').length,
    highUnknownMisses:misses.filter(x=>unknownCount(x.d)>=3).length,
    concentratedAddMisses:misses.filter(x=>String(x.d?.final?.status)==='ADD' && Number(positionAllocationPct(x.d)||0)>40).length,
    recentMisses:misses.slice(-8).map(x=>({asset:x.d.asset,date:x.d.date,confidence:x.d.final?.confidence,sourceQuality:sourceQuality(x.d),unknowns:unknownCount(x.d),outcome:x.o.returnSinceDecision}))
  };
}
function validateChallenger(data){
  const findings=[]; const p=data?.policy;
  if(!p||typeof p!=='object') findings.push('policy_missing');
  const n=normalizeStrategy(p||{});
  if(!['LOW','MODERATE','HIGH'].includes(n.minConfidence)) findings.push('confidence_invalid');
  if(!String(data?.hypothesis||'').trim()) findings.push('hypothesis_missing');
  return {pass:findings.length===0,findings,normalized:n};
}

export async function runEvolutionCycle({allowPromote=false,totalBudgetMs=90000,deadlineAt}={}){
  const decisions=await getDecisions(); let evo=await getEvolutionState();
  const championPolicy=normalizeStrategy(evo?.champion?.policy||DEFAULT_STRATEGY);
  const split=splitScoredHoldout(decisions);
  // Diagnosis + proposal inspiration: recent inspire slice (falls back to all if tiny).
  const inspireSet=split.inspire.length?split.inspire:split.all;
  const holdoutSet=split.holdout.length?split.holdout:split.all;
  const diagnosis=diagnoseDecisions(inspireSet);
  const championInspire=evaluateStrategy(inspireSet,championPolicy);
  const championHoldout=evaluateStrategy(holdoutSet,championPolicy);
  const championMetrics={...championHoldout,inspire:championInspire,holdout:championHoldout,maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount};
  const now=new Date().toISOString();
  if(split.maturedCount<MATURITY_THRESHOLD){
    evo={...evo,champion:{...(evo.champion||{}),policy:championPolicy,metrics:championMetrics},challenger:null,lastCycleAt:now,lastObservationAt:now,diagnosis,split:{maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount,threshold:MATURITY_THRESHOLD},history:[...(evo.history||[]).slice(-49),{at:now,event:'OBSERVED',reason:'INSUFFICIENT_SCORED_OUTCOMES',sample:split.maturedCount,threshold:MATURITY_THRESHOLD}]};
    await saveEvolutionState(evo); return {...evo,cycleStatus:'INSUFFICIENT_DATA'};
  }
  const task='Propose one conservative challenger policy for KAIROS Decision Review based on measured decision outcomes. The challenger may only modify the supplied bounded policy fields. It must not add new capabilities, bypass audits, or loosen evidence requirements without justification.';
  const prompt=`${task}\nReturn ONLY JSON:{"name":"...","hypothesis":"...","policy":{"minConfidence":"LOW|MODERATE|HIGH","blockLowSourceQuality":true|false,"requireAllAttacksPass":true,"maxSingleAssetPctForAdd":number,"preferAbstainWhenUnknowns":integer,"description":"..."},"expected_tradeoff":"..."}.\nCURRENT_CHAMPION:${JSON.stringify(championPolicy)}\nCHAMPION_HOLDOUT_METRICS:${JSON.stringify(championHoldout)}\nCHAMPION_INSPIRE_METRICS:${JSON.stringify(championInspire)}\nDIAGNOSIS_FROM_RECENT_INSPIRE_SLICE:${JSON.stringify(diagnosis)}\nNOTE: Promote eligibility is judged on the earlier HOLDOUT slice, not the inspire set.`;
  const result=await runGuardedJSONTask({task,prompt,role:'learning_lab',criteria:'Challenger is conservative, bounded to policy fields, never disables attack checks, and is justified by measured failures.',validate:validateChallenger,totalBudgetMs,deadlineAt,maxRedo:1,timeoutTag:'EVOLUTION_TIMEOUT'});
  const gate=publicGateMeta(result);
  if(!result?.approved){
    evo={...evo,champion:{...(evo.champion||{}),policy:championPolicy,metrics:championMetrics},challenger:{status:'REJECTED_BY_FINAL_GATE',gate},lastCycleAt:now,lastObservationAt:now,diagnosis,split:{maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount,threshold:MATURITY_THRESHOLD},history:[...(evo.history||[]).slice(-49),{at:now,event:'CHALLENGER_REJECTED',gate}]};
    await saveEvolutionState(evo); return {...evo,cycleStatus:'CHALLENGER_REJECTED'};
  }
  const proposed=normalizeStrategy(result.generated.data.policy); proposed.requireAllAttacksPass=true;
  const challengerInspire=evaluateStrategy(inspireSet,proposed);
  const challengerHoldout=evaluateStrategy(holdoutSet,proposed);
  const challengerMetrics={...challengerHoldout,inspire:challengerInspire,holdout:challengerHoldout,maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount};
  // Eligibility MUST win on holdout (not only inspire).
  const improvement=(challengerHoldout.score??-Infinity)-(championHoldout.score??-Infinity);
  const better=challengerHoldout.sample>=MATURITY_THRESHOLD
    && challengerHoldout.eligible>=Math.max(3,Math.floor(championHoldout.eligible*0.45))
    && improvement>=0.03
    && (challengerHoldout.hitRate??0)>=(championHoldout.hitRate??0);
  const challenger={
    version:`candidate-${Date.now()}`,
    name:String(result.generated.data.name||'Challenger').slice(0,100),
    hypothesis:String(result.generated.data.hypothesis||'').slice(0,1000),
    policy:proposed,
    metrics:challengerMetrics,
    championMetrics,
    improvement,
    better,
    gate,
    status:better?'ELIGIBLE':'FAILED_BENCHMARK',
    holdoutImprovement:improvement,
    holdoutHitRate:challengerHoldout.hitRate,
    championHoldoutHitRate:championHoldout.hitRate
  };
  let promoted=false;
  if(better && allowPromote){
    evo.champion={version:`${Number(String(evo?.champion?.version||'1.0').split('.')[0])||1}.${Date.now()}`,name:challenger.name,policy:proposed,metrics:challengerMetrics,promotedAt:now,sourceChallenger:challenger.version};
    challenger.status='PROMOTED'; promoted=true;
  } else {
    evo.champion={...(evo.champion||{}),policy:championPolicy,metrics:championMetrics};
  }
  evo={...evo,challenger,lastCycleAt:now,lastObservationAt:now,diagnosis,split:{maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount,threshold:MATURITY_THRESHOLD},history:[...(evo.history||[]).slice(-49),{at:now,event:promoted?'PROMOTED':better?'CHALLENGER_READY':'CHALLENGER_FAILED',improvement,champion:championHoldout,challenger:challengerHoldout,holdout:true}]};
  await saveEvolutionState(evo); return {...evo,cycleStatus:promoted?'PROMOTED':better?'READY_FOR_PROMOTION':'NO_IMPROVEMENT'};
}

export async function discardChallenger(){
  const evo=await getEvolutionState();
  if(!evo?.challenger) return evo;
  const now=new Date().toISOString();
  const next={...evo,challenger:{...evo.challenger,status:'DISCARDED'},history:[...(evo.history||[]).slice(-49),{at:now,event:'CHALLENGER_DISCARDED',challenger:evo.challenger.version}]};
  await saveEvolutionState(next); return next;
}

export async function maybeAutoEvolution(){
  // Evolution Lab is ALWAYS ON — runs after daily Trace without login or settings toggle.
  // Promotion stays human-gated (never silent auto-promote).
  const evo=await getEvolutionState();
  if(evo?.lastCycleAt && Date.now()-Date.parse(evo.lastCycleAt)<20*3600*1000) return null; // ~daily with Trace
  return await runEvolutionCycle({allowPromote:false});
}
