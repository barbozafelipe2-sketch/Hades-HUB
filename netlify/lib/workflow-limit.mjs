import { getJSON, setJSON, withKeyLock } from './store.mjs';

export class WorkflowRateLimitError extends Error {
  constructor(name,retryAfterMs){
    super(`WORKFLOW_RATE_LIMITED:${name}`);
    this.name='WorkflowRateLimitError';
    this.retryAfterMs=Math.max(0,Number(retryAfterMs)||0);
  }
}

/**
 * Application-level cost guard for expensive authenticated workflows.
 * Unlike Netlify edge rate limits this can use windows >180s and is keyed to the
 * single-user workflow, not client IP. Replays of the same jobId do not consume
 * a second slot.
 */
export async function consumeWorkflowBudget(name,{limit=3,windowMs=10*60*1000,jobId=null}={}){
  const safe=String(name||'workflow').replace(/[^a-z0-9._-]/gi,'_').slice(0,80);
  const cap=Math.max(1,Math.min(100,Number(limit)||1));
  const span=Math.max(1000,Math.min(24*60*60*1000,Number(windowMs)||600000));
  const key=`limits/workflows/${safe}`;
  return await withKeyLock(`workflow-limit-${safe}`,async()=>{
    const now=Date.now();
    const state=await getJSON(key,{events:[]});
    const events=(Array.isArray(state?.events)?state.events:[])
      .filter(e=>Number.isFinite(Number(e?.at)) && now-Number(e.at)<span)
      .slice(-cap*4);
    if(jobId && events.some(e=>e.jobId===jobId)) return {ok:true,idempotent:true,remaining:Math.max(0,cap-events.length)};
    if(events.length>=cap){
      const retryAfterMs=Math.max(1000,span-(now-Number(events[0].at)));
      throw new WorkflowRateLimitError(safe,retryAfterMs);
    }
    events.push({at:now,jobId:jobId||null});
    await setJSON(key,{name:safe,windowMs:span,limit:cap,events,updatedAt:new Date(now).toISOString()});
    return {ok:true,idempotent:false,remaining:Math.max(0,cap-events.length)};
  });
}
