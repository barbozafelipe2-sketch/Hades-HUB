/**
 * Stage 2/5 — per-tenant consent and server-derived evidence.
 * Records are tenant-scoped draft/* state (Postgres in hosted deployments).
 * This does not publish or pool cross-tenant information.
 */
import {getJSON,setJSON,deleteKey,withKeyLock} from './store.mjs';
import {getDecisions} from './state.mjs';
import {latestEligibleOutcome} from './outcome-eligibility.mjs';

const CONSENT_KEY='draft/global-trace/consent';
const METRIC_KEY='draft/global-trace/metrics';
export const GLOBAL_TRACE_CONSENT_VERSION=1;

export async function globalTraceConsent(){
  const record=await getJSON(CONSENT_KEY,null);
  return {enabled:record?.status==='opted_in' && record?.version===GLOBAL_TRACE_CONSENT_VERSION,
    version:GLOBAL_TRACE_CONSENT_VERSION, updatedAt:record?.updatedAt||null};
}
export async function setGlobalTraceConsent(enabled){
  if(typeof enabled!=='boolean')throw new Error('GLOBAL_TRACE_CONSENT_INVALID');
  return withKeyLock('global-trace-consent',async()=>{
    const updatedAt=new Date().toISOString();
    // Revoke first; never leave old private metrics available after an opt-out.
    if(!enabled)await deleteKey(METRIC_KEY);
    await setJSON(CONSENT_KEY,{status:enabled?'opted_in':'opted_out',version:GLOBAL_TRACE_CONSENT_VERSION,updatedAt});
    return {enabled,version:GLOBAL_TRACE_CONSENT_VERSION,updatedAt};
  });
}
export function derivePrivateTraceMetrics(decisions){
  if(!Array.isArray(decisions))throw new Error('GLOBAL_TRACE_INVALID_DECISIONS');
  const eligible=decisions.map(d=>latestEligibleOutcome(d?.outcomes||[]))
    .filter((o,i)=>o && ['ADD','REDUCE'].includes(String(decisions[i]?.final?.status||'')));
  // Explicit eligibility includes point-in-time check and maturity requirements.
  if(!eligible.length)return {sample:0,metrics:{}};
  const count=eligible.length;
  return {sample:count,metrics:{decision_calibration:eligible.filter(o=>o.directionalCorrect===true).length/count}};
}
export async function refreshPrivateTraceMetrics(){
  return withKeyLock('global-trace-consent',async()=>{
    const consent=await globalTraceConsent();
    if(!consent.enabled){
      await deleteKey(METRIC_KEY);
      return {status:'OPTED_OUT',sample:0,metrics:{}};
    }
    const derived=derivePrivateTraceMetrics(await getDecisions());
    // Private only; no API for system-wide collection has been added.
    await setJSON(METRIC_KEY,{version:1,createdAt:new Date().toISOString(),...derived});
    return {status:'PRIVATE_ONLY',...derived};
  });
}
