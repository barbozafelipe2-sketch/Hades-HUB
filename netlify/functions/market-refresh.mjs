import { getEnv } from '../lib/env.mjs';
import { requireSession } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { refreshWorldState, saveDailySnapshot, marketDate } from '../lib/trace.mjs';
import { ensureResearchSeries } from '../lib/market-research-series.mjs';
import { beginOperationalTrace } from '../lib/ops-trace.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { consumeWorkflowBudget } from '../lib/workflow-limit.mjs';

/** Global wall so multi-symbol refresh cannot run past Netlify ~60s kill. */
const WALL_MS=Math.max(30000,Math.min(55000,Number(getEnv('HADES_MARKET_REFRESH_WALL_MS',48000))));

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ await consumeWorkflowBudget('market-refresh',{limit:12,windowMs:10*60*1000}); }
  catch(e){ return json({error:'WORKFLOW_RATE_LIMITED',retryAfterMs:Number(e?.retryAfterMs)||null},429); }
  const deadlineAt=Date.now()+WALL_MS;
  const op=beginOperationalTrace(req,context,{functionName:'market-refresh'});
  try{
    const date=marketDate();
    const ws=await refreshWorldState(date,{deadlineAt});
    if(Date.now()>=deadlineAt){
      await op.finish({status:'PARTIAL',partial:true,marketProvider:ws?._meta?.market_source||null});
      return json({ok:true,worldState:ws,snapshot:null,researchSeries:null,researchError:'MARKET_REFRESH_WALL',wallMs:WALL_MS,partial:true});
    }
    const snapshot=await saveDailySnapshot(date,ws);
    const orderProcessing=ws?._meta?.paper_order_processing||{fills:[],error:null};
    let researchSeries=null;
    let researchError=null;
    try{
      if(Date.now()>=deadlineAt) throw new Error('MARKET_REFRESH_WALL');
      researchSeries=await ensureResearchSeries({force:true,deadlineAt});
    }catch(e){
      researchError=String(e.message||e).slice(0,240);
    }
    await op.finish({status:researchError?'PARTIAL':'COMPLETE',partial:!!researchError,marketProvider:ws?._meta?.market_source||null,readySymbols:researchSeries?.meta?.readySymbols??null});
    return json({
      ok:true,
      worldState:ws,
      snapshot,
      researchSeries:researchSeries?{
        asOf:researchSeries.asOf,
        provider:researchSeries.provider,
        model:researchSeries.model,
        grade:researchSeries.grade,
        readySymbols:researchSeries.meta?.readySymbols??null,
        generatedAt:researchSeries.generatedAt
      }:null,
      researchError,
      wallMs:WALL_MS,
      orderProcessing,
      partial:!!researchError
    });
  }catch(e){ const msg=String(e.message||e); await op.finish({status:'ERROR',error:e}); return /MARKET_REFRESH_WALL/i.test(msg)?json({ok:false,error:'MARKET_REFRESH_WALL',wallMs:WALL_MS},504):json({ok:false,error:msg},500); }
};

