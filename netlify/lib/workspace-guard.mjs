import { configurePersistenceForRequest, configureTenantForRequest, withKeyLock } from './store.mjs';
import { requireSession } from './auth.mjs';
import { json } from './http.mjs';
import { validInternal } from './internal.mjs';

// Serialize restores (including rollback) against in-flight tenant jobs.
export function serializeTenantHandler(handler){
  return async (req,context)=>{
    configurePersistenceForRequest(context);
    let tenantId=null;
    if(validInternal(req)){
      tenantId=(await req.clone().json().catch(()=>null))?.tenantId;
      if(tenantId)configureTenantForRequest({tenantId,userId:'system',role:'system'});
    }else tenantId=(await requireSession(req))?.tenantId;
    if(!tenantId)return handler(req,context);
    return withKeyLock('workspace-mutation',async()=>{
      try{const {recoverInterruptedRestore}=await import('../functions/backup.mjs');await recoverInterruptedRestore(tenantId);}
      catch{return json({error:'WORKSPACE_RECOVERY_REQUIRED'},503);}
      return handler(req,context);
    },{ttlMs:20*60*1000,waitMs:10000});
  };
}
