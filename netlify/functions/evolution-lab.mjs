import { serializeTenantHandler } from '../lib/workspace-guard.mjs';
import { assertCommercialAccess, commercialErrorJSON } from '../lib/commercial-control.mjs';
import { requireSession,requireRole } from '../lib/auth.mjs';
import {verifyIdentityRequestOrigin} from '../lib/identity-provider.mjs';
import {independentHoldoutReadiness,assessIndependentChallenger,localEvidenceFingerprint,MIN_TOTAL_OUTCOMES,VALIDATION_VERSION} from '../lib/learning-evidence.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { getEvolutionState,getDecisions,getSettings,saveEvolutionState } from '../lib/state.mjs';
import { DEFAULT_STRATEGY,normalizeStrategy,evaluateStrategy,diagnoseDecisions,runEvolutionCycle,discardChallenger,splitScoredHoldout } from '../lib/evolution.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
export default serializeTenantHandler(async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req);
  if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method==='GET'){
    const [evo,decisions,settings]=await Promise.all([getEvolutionState(),getDecisions(),getSettings()]);
    const champion=normalizeStrategy(evo?.champion?.policy||DEFAULT_STRATEGY);
    const split=splitScoredHoldout(decisions);
    const readiness=independentHoldoutReadiness(split);
    const holdoutSet=split.holdout;
    const inspireSet=split.inspire;
    const holdoutMetrics=evaluateStrategy(holdoutSet,champion);
    const inspireMetrics=evaluateStrategy(inspireSet,champion);
    return json({ok:true,evolution:{
      ...evo,
      champion:{...(evo.champion||{}),policy:champion,metrics:{...holdoutMetrics,inspire:inspireMetrics,holdout:holdoutMetrics,maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount}},
      diagnosis:diagnoseDecisions(inspireSet),
      split:{maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount,threshold:MIN_TOTAL_OUTCOMES,minimumForEvaluation:MIN_TOTAL_OUTCOMES},
      validation:readiness,
      live:readiness.ready
    },settings:{evolutionAutoRun:true,evolutionAlwaysOn:true,evolutionAutoPromote:false}});
  }
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{requireRole(session,['owner']);}catch{return json({error:'FORBIDDEN'},403);}
  if(session.authProvider==='netlify_identity'){
    try{verifyIdentityRequestOrigin(req);}catch{return json({error:'ORIGIN_REJECTED'},403);}
  }
  try{await assertCommercialAccess(session);}catch(e){const ce=commercialErrorJSON(e);if(ce)return json(ce.body,ce.status);throw e;}
  const b=await readJSON(req);
  if(b.action==='cycle') return json({error:'EVOLUTION_CYCLE_ASYNC_REQUIRED',endpoint:'evolution-cycle'},409);
  if(b.action==='promote'){
    const evo=await getEvolutionState(); const c=evo?.challenger;
    if(!c?.better || c?.status!=='ELIGIBLE') return json({error:'NO_ELIGIBLE_CHALLENGER'},409);
    if(c.validationVersion!==VALIDATION_VERSION||!c.validationFingerprint)
      return json({error:'CHALLENGER_VALIDATION_REQUIRED'},409);
    const split=splitScoredHoldout(await getDecisions());
    const championPolicy=normalizeStrategy(evo?.champion?.policy||DEFAULT_STRATEGY);
    const challengerPolicy=normalizeStrategy(c.policy);
    if(localEvidenceFingerprint(split,championPolicy,challengerPolicy)!==c.validationFingerprint)
      return json({error:'CHALLENGER_EVIDENCE_CHANGED'},409);
    const review=assessIndependentChallenger({split,championPolicy,challengerPolicy,evaluateStrategy});
    if(!review.better)return json({error:'CHALLENGER_REVALIDATION_FAILED',blockers:review.blockers},409);
    c.metrics={...review.challenger,holdout:review.challenger,maturedCount:split.maturedCount};
    const now=new Date().toISOString(); const next={...evo,champion:{version:`promoted-${Date.now()}`,name:c.name,policy:normalizeStrategy(c.policy),metrics:c.metrics,promotedAt:now,sourceChallenger:c.version},challenger:{...c,status:'PROMOTED'},history:[...(evo.history||[]).slice(-49),{at:now,event:'PROMOTED_MANUALLY',challenger:c.version}]};
    await saveEvolutionState(next); return json({ok:true,evolution:next});
  }
  if(b.action==='discard'){
    return json({ok:true,evolution:await discardChallenger()});
  }
  return json({error:'UNKNOWN_ACTION'},400);
});
