import { validInternal } from '../lib/internal.mjs';
import { runDailyTrace, marketDate } from '../lib/trace.mjs';
import { beginOperationalTrace } from '../lib/ops-trace.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { activateTenantForInternal } from '../lib/auth.mjs';
import { readJSON } from '../lib/http.mjs';
export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!validInternal(req)) return;
  const body=await readJSON(req,{maxBytes:2048}).catch(()=>({}));
  if(!body?.tenantId) throw new Error('TENANT_ID_REQUIRED');
  await activateTenantForInternal(body.tenantId);
  const op=beginOperationalTrace(req,context,{functionName:'trace-daily-worker-background'});
  const date=marketDate();
  try{ await runDailyTrace(date,'current'); await op.finish({status:'COMPLETE',mode:'current'}); }
  catch(e){ await op.finish({status:'ERROR',error:e,mode:'current'}); throw e; }
};
export const config={background:true};
