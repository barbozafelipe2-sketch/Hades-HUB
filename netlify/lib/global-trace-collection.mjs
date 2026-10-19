/**
 * Global Trace stage 3/5: explicit-consent, internal-only ephemeral collection.
 * No individual rows or cross-tenant snapshots are stored in global state.
 */
import {listActiveTenants} from './auth.mjs';
import {runInTenantContext,currentTenantContext} from './store.mjs';
import {globalTraceConsent,refreshPrivateTraceMetrics} from './global-trace-consent.mjs';
import {aggregateConsentedTrace,globalTraceMetrics} from './global-trace-privacy.mjs';

const MAX_TENANTS_PER_SCAN=250;
const MIN_ELIGIBLE_DECISIONS=5;

/**
 * Recompute tenant-private metrics, then aggregate only the currently consented
 * evidence. The result is visible solely to the authenticated internal caller.
 * Fail closed rather than return partial numbers if a tenant cannot be read.
 */
export async function collectConsentedGlobalTrace(){
  const requester=currentTenantContext();
  if(requester && requester.role!=='system') throw new Error('GLOBAL_TRACE_INTERNAL_ONLY');
  const tenants=await listActiveTenants();
  if(!Array.isArray(tenants) || tenants.length>MAX_TENANTS_PER_SCAN)
    throw new Error('GLOBAL_TRACE_BATCH_LIMIT');
  const staged=[];
  const seen=new Set();
  const allowed=new Set(globalTraceMetrics());
  for(const tenant of tenants){
    const id=String(tenant?.id||'');
    if(!id || seen.has(id) || tenant?.status!=='active')continue;
    seen.add(id);
    const proposal=await runInTenantContext(id,async()=>{
      const before=await globalTraceConsent();
      if(!before.enabled)return null;
      const refreshed=await refreshPrivateTraceMetrics();
      const after=await globalTraceConsent();
      if(!after.enabled || before.revision!==after.revision ||
         refreshed.status!=='PRIVATE_ONLY' || refreshed.sample<MIN_ELIGIBLE_DECISIONS)return null;
      const metrics=Object.entries(refreshed.metrics||{}).filter(([name,value])=>
        allowed.has(name) && typeof value==='number' && Number.isFinite(value));
      return metrics.length?{tenantId:id,revision:after.revision,metrics}:null;
    });
    if(proposal)staged.push(proposal);
  }

  // Opt-outs and re-consents that occurred during a long scan must not use an
  // earlier snapshot. No aggregate is cached, so the next run also excludes them.
  const rows=[];
  for(const item of staged){
    const stillConsented=await runInTenantContext(item.tenantId,async()=>{
      const consent=await globalTraceConsent();
      return consent.enabled && consent.revision===item.revision;
    });
    if(!stillConsented)continue;
    for(const [metric,value] of item.metrics)
      rows.push({tenantId:item.tenantId,metric,value,consent:'opted_in'});
  }
  const result=aggregateConsentedTrace(rows);
  return {...result,stage:3,storage:'ephemeral',globalSharingActive:false};
}
