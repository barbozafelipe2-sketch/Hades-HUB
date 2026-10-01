import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { buildPaperWalletFromAllocation, formatBuildSummaryText } from '../lib/portfolio-build.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  const body=await readJSON(req);
  const action=String(body.action||'buildFromMirror');
  try{
    if(action==='buildFromMirror' || action==='buildFromBudget'){
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
    const status=/BUDGET_REQUIRED|AI_MIRROR_REQUIRED|ALLOCATION_|UNKNOWN_INVESTMENT|NO_BUYS/.test(msg)?400:500;
    return json({ok:false,error:msg,message:msg},status);
  }
};
