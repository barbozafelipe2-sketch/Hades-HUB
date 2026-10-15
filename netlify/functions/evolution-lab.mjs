import { serializeTenantHandler } from '../lib/workspace-guard.mjs';
import { assertCommercialAccess, commercialErrorJSON } from '../lib/commercial-control.mjs';
import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { getEvolutionState,getDecisions,getSettings,saveEvolutionState } from '../lib/state.mjs';
import { DEFAULT_STRATEGY,normalizeStrategy,evaluateStrategy,diagnoseDecisions,runEvolutionCycle,discardChallenger,splitScoredHoldout,MATURITY_THRESHOLD } from '../lib/evolution.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
export default serializeTenantHandler(async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req);
  if(!session) return json({error:'UNAUTHORIZED'},401);
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
  try{await assertCommercialAccess(session);}catch(e){const ce=commercialErrorJSON(e);if(ce)return json(ce.body,ce.status);throw e;}
  const b=await readJSON(req);
  if(b.action==='cycle') return json({error:'EVOLUTION_CYCLE_ASYNC_REQUIRED',endpoint:'evolution-cycle'},409);
  if(b.action==='promote'){
    const evo=await getEvolutionState(); const c=evo?.challenger;
    if(!c?.better || c?.status!=='ELIGIBLE') return json({error:'NO_ELIGIBLE_CHALLENGER'},409);
    const split=splitScoredHoldout(await getDecisions());
    const baseline=evaluateStrategy(split.holdout,evo?.champion?.policy||DEFAULT_STRATEGY);
    const candidate=evaluateStrategy(split.holdout,c.policy);
    if(candidate.sample<MATURITY_THRESHOLD||candidate.eligible<Math.max(3,Math.floor(baseline.eligible*.45))||(candidate.score??-Infinity)-(baseline.score??-Infinity)<.03||(candidate.hitRate??0)<(baseline.hitRate??0))return json({error:'CHALLENGER_REVALIDATION_FAILED'},409);
    c.metrics={...candidate,holdout:candidate,maturedCount:split.maturedCount};
    const now=new Date().toISOString(); const next={...evo,champion:{version:`promoted-${Date.now()}`,name:c.name,policy:normalizeStrategy(c.policy),metrics:c.metrics,promotedAt:now,sourceChallenger:c.version},challenger:{...c,status:'PROMOTED'},history:[...(evo.history||[]).slice(-49),{at:now,event:'PROMOTED_MANUALLY',challenger:c.version}]};
    await saveEvolutionState(next); return json({ok:true,evolution:next});
  }
  if(b.action==='discard'){
    return json({ok:true,evolution:await discardChallenger()});
  }
  return json({error:'UNKNOWN_ACTION'},400);
});
