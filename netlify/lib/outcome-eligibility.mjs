// Shared evidence policy for calibration, track record, and strategy evaluation.
export function eligibleOutcome(o,{minDays=7}={}){
  return o?.pointInTime===true && Number(o.checkpointDays??o.daysSinceDecision)>=minDays
    && o.returnSinceDecision!=null && o.returnSinceDecision!==''
    && Number.isFinite(Number(o.returnSinceDecision)) && typeof o.directionalCorrect==='boolean';
}
export function latestEligibleOutcome(outcomes=[]){
  return outcomes.filter(o=>eligibleOutcome(o)).sort((a,b)=>Number(a.checkpointDays??a.daysSinceDecision)-Number(b.checkpointDays??b.daysSinceDecision)).at(-1)||null;
}
