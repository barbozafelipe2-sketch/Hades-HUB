import { getEnv } from '../lib/env.mjs';
import { internalToken } from '../lib/internal.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { listActiveTenants } from '../lib/auth.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const base=getEnv('DEPLOY_PRIME_URL')||getEnv('DEPLOY_URL')||getEnv('URL');
  if(!base) throw new Error('NETLIFY_BASE_URL_MISSING');
  const tenants=await listActiveTenants();
  const failures=[];
  for(const tenant of tenants){
    const r=await fetch(`${base}/.netlify/functions/trace-daily-worker-background`,{
      method:'POST',headers:{'x-sauron-internal':internalToken(),'content-type':'application/json'},
      body:JSON.stringify({tenantId:tenant.id})
    });
    if(!r.ok && r.status!==202) failures.push(`${tenant.id}:${r.status}`);
  }
  if(failures.length) throw new Error(`TRACE_WORKER_TRIGGER_FAILED:${failures.join(',')}`);
};
