import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { getEvolutionState,getDecisions,getSettings,saveEvolutionState } from '../lib/state.mjs';
import { DEFAULT_STRATEGY,normalizeStrategy,evaluateStrategy,diagnoseDecisions,runEvolutionCycle,discardChallenger,splitScoredHoldout,MATURITY_THRESHOLD } from '../lib/evolution.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method==='GET'){
    const [evo,decisions,settings]=await Promise.all([getEvolutionState(),getDecisions(),getSettings()]);
    const champion=normalizeStrategy(evo?.champion?.policy||DEFAULT_STRATEGY);
    const split=splitScoredHoldout(decisions);
    const holdoutSet=split.holdout.length?split.holdout:split.all;
    const inspireSet=split.inspire.length?split.inspire:split.all;
    const holdoutMetrics=evaluateStrategy(holdoutSet,champion);
    const inspireMetrics=evaluateStrategy(inspireSet,champion);
    return json({ok:true,evolution:{
      ...evo,
      champion:{...(evo.champion||{}),policy:champion,metrics:{...holdoutMetrics,inspire:inspireMetrics,holdout:holdoutMetrics,maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount}},
      diagnosis:diagnoseDecisions(inspireSet),
      split:{maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount,threshold:MATURITY_THRESHOLD},
      live:split.maturedCount>=MATURITY_THRESHOLD
    },settings:{evolutionAutoRun:true,evolutionAlwaysOn:true,evolutionAutoPromote:false}});
  }
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  const b=await readJSON(req);
  if(b.action==='cycle') return json({error:'EVOLUTION_CYCLE_ASYNC_REQUIRED',endpoint:'evolution-cycle'},409);
  if(b.action==='promote'){
    const evo=await getEvolutionState(); const c=evo?.challenger;
    if(!c?.better || c?.status!=='ELIGIBLE') return json({error:'NO_ELIGIBLE_CHALLENGER'},409);
    const now=new Date().toISOString(); const next={...evo,champion:{version:`promoted-${Date.now()}`,name:c.name,policy:normalizeStrategy(c.policy),metrics:c.metrics,promotedAt:now,sourceChallenger:c.version},challenger:{...c,status:'PROMOTED'},history:[...(evo.history||[]).slice(-49),{at:now,event:'PROMOTED_MANUALLY',challenger:c.version}]};
    await saveEvolutionState(next); return json({ok:true,evolution:next});
  }
  if(b.action==='discard'){
    return json({ok:true,evolution:await discardChallenger()});
  }
  return json({error:'UNKNOWN_ACTION'},400);
};
