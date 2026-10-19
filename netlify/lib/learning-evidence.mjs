import crypto from 'node:crypto';

// Stage 4: both evaluation cohorts are tenant-local. Aggregate context is
// observational only; it cannot promote strategies or train a global model.
export const MIN_TRAIN_OUTCOMES=8;
export const MIN_HOLDOUT_OUTCOMES=8;
export const MIN_TOTAL_OUTCOMES=27;
export const VALIDATION_VERSION=4;
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':
  v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const time=d=>{const n=Date.parse(d?.createdAt||d?.date||'');return Number.isFinite(n)?n:null;};
export function independentHoldoutReadiness(split){
  const train=Array.isArray(split?.inspire)?split.inspire:[];
  const holdout=Array.isArray(split?.holdout)?split.holdout:[];
  const blockers=[];
  if(train.length<MIN_TRAIN_OUTCOMES)blockers.push('TRAIN_SAMPLE_TOO_SMALL');
  if(holdout.length<MIN_HOLDOUT_OUTCOMES)blockers.push('HOLDOUT_SAMPLE_TOO_SMALL');
  const all=[...train,...holdout];
  const ids=all.map(d=>typeof d?.id==='string'?d.id:'');
  if(ids.some(x=>!x)||new Set(ids).size!==ids.length)blockers.push('DUPLICATE_OR_MISSING_DECISION');
  const trainTimes=train.map(time),holdoutTimes=holdout.map(time);
  if([...trainTimes,...holdoutTimes].some(t=>t===null))blockers.push('DECISION_TIME_MISSING');
  else if(trainTimes.length&&holdoutTimes.length&&Math.max(...trainTimes)>=Math.min(...holdoutTimes))
    blockers.push('HOLDOUT_NOT_CHRONOLOGICALLY_INDEPENDENT');
  return {ready:blockers.length===0,blockers,trainingCount:train.length,holdoutCount:holdout.length,
    requiredTraining:MIN_TRAIN_OUTCOMES,requiredHoldout:MIN_HOLDOUT_OUTCOMES,
    minimumMatured:MIN_TOTAL_OUTCOMES,splitMethod:'chronological_70_30'};
}
export function localEvidenceFingerprint(split,championPolicy,challengerPolicy){
  return crypto.createHash('sha256').update(stable({version:VALIDATION_VERSION,training:split.inspire,
    holdout:split.holdout,championPolicy,challengerPolicy})).digest('hex');
}
export function assessIndependentChallenger({split,championPolicy,challengerPolicy,evaluateStrategy}){
  if(typeof evaluateStrategy!=='function')throw Error('EVALUATOR_REQUIRED');
  const readiness=independentHoldoutReadiness(split);
  const champion=evaluateStrategy(split.holdout,championPolicy);
  const challenger=evaluateStrategy(split.holdout,challengerPolicy);
  const improvement=Number.isFinite(champion.score)&&Number.isFinite(challenger.score)
    ?challenger.score-champion.score:null;
  const blockers=[...readiness.blockers];
  if(champion.eligible<MIN_HOLDOUT_OUTCOMES)blockers.push('CHAMPION_COVERAGE_INSUFFICIENT');
  if(challenger.eligible<Math.max(6,Math.ceil(champion.eligible*0.65)))
    blockers.push('CHALLENGER_COVERAGE_INSUFFICIENT');
  if(!Number.isFinite(champion.score)||!Number.isFinite(challenger.score))
    blockers.push('UNSCORABLE_HOLDOUT');
  if(improvement===null||improvement<0.03-1e-12)blockers.push('NO_MEASURED_IMPROVEMENT');
  if(challenger.hitRate===null||champion.hitRate===null||challenger.hitRate<champion.hitRate)
    blockers.push('HIT_RATE_REGRESSION');
  if(stable(championPolicy)===stable(challengerPolicy))blockers.push('UNCHANGED_POLICY');
  return {better:blockers.length===0,blockers,improvement,champion,challenger,
    readiness,validationVersion:VALIDATION_VERSION};
}
export function assessCollectiveLearningReference(aggregate){
  const m=aggregate?.metrics?.decision_calibration;
  const valid=aggregate?.version===1&&aggregate?.status==='AGGREGATED'&&
    Number.isInteger(m?.tenantCount)&&m.tenantCount>=10&&
    typeof m.mean==='number'&&Number.isFinite(m.mean)&&m.mean>=0&&m.mean<=1;
  return {stage:4,role:'OBSERVATIONAL_REFERENCE_ONLY',
    status:valid?'REFERENCE_AVAILABLE':'INSUFFICIENT_CONSENTED_EVIDENCE',
    participantCount:valid?m.tenantCount:null,calibrationMean:valid?m.mean:null,
    strategyComparisonAvailable:false,mayPromotePolicy:false,mayTrainModel:false,
    requiresTenantHoldout:true};
}
