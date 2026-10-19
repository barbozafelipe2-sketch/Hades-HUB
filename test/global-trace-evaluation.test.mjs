import assert from 'node:assert/strict';
import {splitScoredHoldout,evaluateStrategy,runEvolutionCycle,DEFAULT_STRATEGY} from '../netlify/lib/evolution.mjs';
import {independentHoldoutReadiness,assessIndependentChallenger,localEvidenceFingerprint,
  assessCollectiveLearningReference,MIN_TOTAL_OUTCOMES,VALIDATION_VERSION} from '../netlify/lib/learning-evidence.mjs';
const decisions=Array.from({length:27},(_,i)=>({
  id:'decision_'+i,createdAt:new Date(Date.UTC(2026,0,i+1)).toISOString(),
  final:{status:'ADD',audit_status:'PASS',confidence:'MODERATE'},
  specialists:{core2:{source_quality:i%4===3?'low':'high'}},attacks:{critic:{pass:true}},
  outcomes:[{pointInTime:true,checkpointDays:7,returnSinceDecision:i%4===3?-.05:.07,directionalCorrect:i%4!==3}]
}));
const split=splitScoredHoldout(decisions);
assert.equal(split.inspireCount,19);
assert.equal(split.holdoutCount,8);
assert.equal(MIN_TOTAL_OUTCOMES,27);
assert.equal(independentHoldoutReadiness(split).ready,true);
const challenger={...DEFAULT_STRATEGY,blockLowSourceQuality:true};
const evaluate=policy=>assessIndependentChallenger({split,championPolicy:DEFAULT_STRATEGY,challengerPolicy:policy,evaluateStrategy});
assert.equal(evaluate(challenger).better,true,'quality screen should improve held-out results');
assert.equal(evaluate({...DEFAULT_STRATEGY,minConfidence:'HIGH'}).better,false);
assert.equal(evaluate(DEFAULT_STRATEGY).better,false);
const hash=localEvidenceFingerprint(split,DEFAULT_STRATEGY,challenger);
assert.match(hash,/^[a-f0-9]{64}$/);
assert.equal(hash,localEvidenceFingerprint(split,DEFAULT_STRATEGY,challenger));
assert.equal(VALIDATION_VERSION,4);
const changed=structuredClone(split);
changed.holdout[0].outcomes[0].directionalCorrect=!changed.holdout[0].outcomes[0].directionalCorrect;
assert.notEqual(hash,localEvidenceFingerprint(changed,DEFAULT_STRATEGY,challenger));
assert.equal(independentHoldoutReadiness(splitScoredHoldout(decisions.slice(0,25))).ready,false);
const overlap=structuredClone(split);overlap.holdout[0].createdAt=overlap.inspire[0].createdAt;
assert.equal(independentHoldoutReadiness(overlap).ready,false);
const duplicate=structuredClone(split);duplicate.holdout[0].id=duplicate.inspire[0].id;
assert.equal(independentHoldoutReadiness(duplicate).ready,false);
const agg={version:1,status:'AGGREGATED',metrics:{decision_calibration:{tenantCount:10,mean:.75}}};
const ref=assessCollectiveLearningReference(agg);
assert.equal(ref.status,'REFERENCE_AVAILABLE');
assert.equal(ref.mayPromotePolicy,false);
assert.equal(ref.mayTrainModel,false);
assert.equal(ref.strategyComparisonAvailable,false);
assert.equal(assessCollectiveLearningReference({...agg,metrics:{decision_calibration:{tenantCount:9,mean:.8}}}).status,'INSUFFICIENT_CONSENTED_EVIDENCE');
assert.equal(assessCollectiveLearningReference({...agg,metrics:{decision_calibration:{tenantCount:10,mean:Infinity}}}).status,'INSUFFICIENT_CONSENTED_EVIDENCE');
await assert.rejects(()=>runEvolutionCycle({allowPromote:true}),/EVOLUTION_AUTOPROMOTE_FORBIDDEN/);
console.log('global-trace-evaluation: PASS (independent 70/30 split, no regressions, fingerprints, private aggregate)');
