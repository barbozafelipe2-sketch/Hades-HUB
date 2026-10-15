import { serializeTenantHandler } from '../lib/workspace-guard.mjs';
import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { buildPaperWalletFromAllocation, formatBuildSummaryText } from '../lib/portfolio-build.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { assertCommercialAccess, commercialErrorJSON } from '../lib/commercial-control.mjs';
import { preparePaperBuild,confirmPaperBuild } from '../lib/paper-build-review.mjs';

export default serializeTenantHandler(async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req); if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ await assertCommercialAccess(session); }catch(e){ const ce=commercialErrorJSON(e); if(ce)return json(ce.body,ce.status); throw e; }
  const body=await readJSON(req);
  const action=String(body.action||'buildFromMirror');
  try{
    if(action==='previewBuild')return json(await preparePaperBuild(session,{budget:body.budget,focus:body.focus||'all',source:'ai-mirror'}));
    if(action==='confirmBuild')return json(await confirmPaperBuild(session,body.planId));
    if(action==='buildFromMirror' || action==='buildFromBudget'){
      if(body.dryRun!==true)return json({error:'PAPER_BUILD_REVIEW_REQUIRED'},409);
      const result=await buildPaperWalletFromAllocation({
        budget:body.budget,
        focus:body.focus||'all',
        source:body.source||(action==='buildFromBudget'?'budget':'ai-mirror'),
        allocation:body.allocation,
        dryRun:body.dryRun===true
      });
      return json({
        ok:true,
        ...result,
        message:formatBuildSummaryText(result)
      });
    }
    return json({error:'UNKNOWN_ACTION'},400);
  }catch(e){
    const msg=String(e.message||e);
    const status=/PAPER_BUILD_|LICENSED_FRESH_MARK_REQUIRED/.test(msg)?409:/BUDGET_REQUIRED|AI_MIRROR_REQUIRED|ALLOCATION_|UNKNOWN_INVESTMENT|NO_BUYS/.test(msg)?400:500;
    return json({ok:false,error:msg,message:msg},status);
  }
});
