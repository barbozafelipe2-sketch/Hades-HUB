import crypto from 'node:crypto';
import { getEnv } from '../lib/env.mjs';
import { getTraceStatus, saveTraceStatus } from '../lib/state.mjs';
import { requireSession, activateTenantForInternal } from '../lib/auth.mjs';
import { validInternal, internalToken } from '../lib/internal.mjs';
import { readJSON } from '../lib/http.mjs';
import { withKeyLock, configurePersistenceForRequest, currentTenantContext } from '../lib/store.mjs';
import { missingTraceDates, runDailyTrace, marketDate } from '../lib/trace.mjs';
import { beginOperationalTrace } from '../lib/ops-trace.mjs';

const BATCH_SIZE=Math.max(1,Math.min(5,Number(getEnv('SAURON_CATCHUP_BATCH_SIZE',4))||4));
const ACTIVE_TTL_MS=20*60*1000;

async function authKind(req){ if(validInternal(req)) return 'internal'; return (await requireSession(req))?'session':null; }
async function triggerNext(runId,tenantId){
  const base=getEnv('DEPLOY_PRIME_URL')||getEnv('DEPLOY_URL')||getEnv('URL'); if(!base) return false;
  const r=await fetch(`${base}/.netlify/functions/trace-catchup-background`,{
    method:'POST',
    headers:{'x-sauron-internal':internalToken(),'content-type':'application/json'},
    body:JSON.stringify({continue:true,runId,tenantId})
  });
  return r.ok || r.status===202;
}
function active(status){
  const started=Date.parse(status?.catchupStartedAt||0);
  return status?.catchupRunning===true && Number.isFinite(started) && Date.now()-started<ACTIVE_TTL_MS;
}

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const kind=await authKind(req); if(!kind) return;
  const body=await readJSON(req,{maxBytes:2048}).catch(()=>({}));
  if(kind==='internal'){ if(!body?.tenantId) return; await activateTenantForInternal(body.tenantId); }
  const op=beginOperationalTrace(req,context,{functionName:'trace-catchup-background'});
  let runId=String(body?.runId||'').trim();

  const gate=await withKeyLock('trace-catchup-control',async()=>{
    const status=await getTraceStatus();
    if(kind==='internal'){
      if(!runId || runId!==status.catchupRunId || status.catchupRunning!==true) return {proceed:false,reason:'STALE_CHAIN'};
      return {proceed:true,status};
    }
    if(active(status)) return {proceed:false,reason:'ALREADY_RUNNING'};
    runId=crypto.randomUUID();
    const next={...status,catchupRunning:true,catchupRunId:runId,catchupStartedAt:new Date().toISOString(),catchupFinishedAt:null,lastError:null};
    await saveTraceStatus(next); return {proceed:true,status:next};
  });
  if(!gate.proceed){ await op.finish({status:'SKIPPED',mode:'catchup',resultStatus:gate.reason}); return; }

  const today=marketDate();
  const missing=await missingTraceDates(today,90);
  if(!missing.length){
    await saveTraceStatus({...await getTraceStatus(),catchupRunning:false,catchupFinishedAt:new Date().toISOString(),catchupRemaining:[],catchupBatch:[]});
    await op.finish({status:'COMPLETE',mode:'catchup',batchSize:0,remaining:0}); return;
  }
  const batch=missing.slice(0,BATCH_SIZE);
  await saveTraceStatus({...await getTraceStatus(),catchupRunning:true,catchupRunId:runId,catchupBatch:batch,catchupMissing:missing,lastError:null});
  try{
    for(const d of batch){
      const s=await getTraceStatus(); if(s.catchupRunId!==runId) throw new Error('TRACE_CATCHUP_SUPERSEDED');
      await runDailyTrace(d,'historical_reconstruction');
    }
    const remaining=await missingTraceDates(today,90);
    const now=await getTraceStatus();
    if(now.catchupRunId!==runId){ await op.finish({status:'SUPERSEDED',mode:'catchup',batchSize:batch.length,remaining:remaining.length}); return; }
    if(remaining.length){
      await saveTraceStatus({...now,catchupRunning:true,catchupBatch:[],catchupRemaining:remaining,lastCatchupBatchAt:new Date().toISOString()});
      const chained=await triggerNext(runId,currentTenantContext()?.tenantId||body?.tenantId||null);
      if(!chained) await saveTraceStatus({...await getTraceStatus(),catchupRunning:false,lastError:'TRACE_CATCHUP_CHAIN_TRIGGER_FAILED'});
      await op.finish({status:chained?'BATCH_COMPLETE':'ERROR',mode:'catchup',batchSize:batch.length,remaining:remaining.length});
    }else{
      await saveTraceStatus({...now,catchupRunning:false,catchupBatch:[],catchupFinishedAt:new Date().toISOString(),catchupRemaining:[],lastError:null});
      await op.finish({status:'COMPLETE',mode:'catchup',batchSize:batch.length,remaining:0});
    }
  }catch(e){
    const now=await getTraceStatus();
    if(now.catchupRunId===runId) await saveTraceStatus({...now,catchupRunning:false,catchupBatch:[],lastError:String(e.message||e)});
    await op.finish({status:'ERROR',error:e,mode:'catchup',batchSize:batch.length});
  }
};
export const config={background:true};
