import crypto from 'node:crypto';
import { setJSON, pruneDatedPrefix } from './store.mjs';

function clean(v,max=180){ return v==null?null:String(v).replace(/[\u0000-\u001F\u007F]/g,'').slice(0,max); }
function safeDetails(input={}){
  const allowed=['jobId','asset','provider','model','statusCode','partial','marketProvider','readySymbols','cacheHit','fallbackUsed','resultStatus','batchSize','remaining','mode','route'];
  const out={}; for(const k of allowed) if(input[k]!==undefined) out[k]=typeof input[k]==='string'?clean(input[k]):input[k];
  return out;
}
export function beginOperationalTrace(req,context,{functionName,jobId=null}={}){
  const started=Date.now();
  const requestId=clean(context?.requestId||req?.headers?.get?.('x-nf-request-id')||crypto.randomUUID(),160);
  const fn=clean(functionName||'unknown',100);
  return {
    requestId,started,
    async finish({status='OK',error=null,...details}={}){
      const ended=Date.now(); const date=new Date(started).toISOString().slice(0,10);
      const row={requestId,function:fn,jobId:clean(jobId||details.jobId,160),startedAt:new Date(started).toISOString(),endedAt:new Date(ended).toISOString(),durationMs:ended-started,status:clean(status,40),errorClass:error?clean(error?.name||'Error',80):null,error:error?clean(error?.message||error,240):null,details:safeDetails(details)};
      try{ await setJSON(`ops/${date}/${requestId}`,row); await pruneDatedPrefix('ops/',{keepDays:30}).catch(()=>{}); }catch{}
      return row;
    }
  };
}
