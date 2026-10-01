import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { runEvolutionCycle } from '../lib/evolution.mjs';
import { getJSON, setJSON, pruneJSONCollection, configurePersistenceForRequest } from '../lib/store.mjs';
import { normalizeJobId, declaredBodyTooLarge } from '../lib/input.mjs';
import { getEnv } from '../lib/env.mjs';
import { beginOperationalTrace } from '../lib/ops-trace.mjs';
import { consumeWorkflowBudget } from '../lib/workflow-limit.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  if(declaredBodyTooLarge(req,8000)) return json({error:'PAYLOAD_TOO_LARGE'},413);
  const body=await readJSON(req);
  let job; try{ job=normalizeJobId(body?.jobId); }catch(e){ return json({error:String(e.message||e)},400); }
  const jobKey=`jobs/evolution/${job}`;
  const op=beginOperationalTrace(req,context,{functionName:'evolution-cycle',jobId:job});
  const prior=await getJSON(jobKey,null);
  if(prior?.status==='COMPLETE'){ await op.finish({status:'SKIPPED_IDEMPOTENT',jobId:job}); return; }
  if(prior?.status==='RUNNING' && Date.now()-Date.parse(prior.startedAt||0)<14*60*1000){ await op.finish({status:'SKIPPED_ALREADY_RUNNING',jobId:job}); return; }
  try{ await consumeWorkflowBudget('evolution-cycle',{limit:2,windowMs:1800000,jobId:job}); }
  catch(e){ try{await setJSON(jobKey,{id:job,status:'ERROR',error:'WORKFLOW_RATE_LIMITED',retryAfterMs:Number(e?.retryAfterMs)||null,finishedAt:new Date().toISOString()});}catch{} await op.finish({status:'RATE_LIMITED',error:e,jobId:job}); return; }
  await pruneJSONCollection('jobs/evolution/',{maxEntries:120}).catch(()=>{});
  const started=Date.now();
  const totalBudgetMs=Math.max(30000,Math.min(120000,Number(getEnv('HADES_EVOLUTION_TOTAL_BUDGET_MS','90000'))));
  await setJSON(jobKey,{id:job,status:'RUNNING',startedAt:new Date().toISOString(),idempotencyKey:job});
  try{
    const evolution=await runEvolutionCycle({allowPromote:false,totalBudgetMs,deadlineAt:Date.now()+totalBudgetMs});
    await setJSON(jobKey,{id:job,status:'COMPLETE',ok:true,cycleStatus:evolution?.cycleStatus||null,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started});
    await op.finish({status:'COMPLETE',jobId:job,resultStatus:evolution?.cycleStatus||null});
  }catch(e){
    try{await setJSON(jobKey,{id:job,status:'ERROR',error:String(e.message||e),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started});}catch{}
    await op.finish({status:'ERROR',error:e,jobId:job});
  }
};
export const config={background:true};
