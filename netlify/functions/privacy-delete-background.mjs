import { readJSON } from '../lib/http.mjs';
import { validInternal } from '../lib/internal.mjs';
import { configurePersistenceForRequest,setSystemJSON,getSystemJSON } from '../lib/store.mjs';
import { executeWorkspaceDeletion } from '../lib/data-lifecycle.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!validInternal(req)) return;
  const body=await readJSON(req,{maxBytes:2048}).catch(()=>({}));
  const jobId=String(body?.jobId||''),tenantId=String(body?.tenantId||'');
  if(!/^[0-9a-f-]{36}$/i.test(jobId)||!/^t_[a-z0-9]+$/i.test(tenantId)) return;
  const key='privacy/deletions/'+jobId;
  try{
    const prior=await getSystemJSON(key,null); if(!prior||prior.tenantId!==tenantId) return;
    await setSystemJSON(key,{...prior,status:'RUNNING',startedAt:new Date().toISOString()});
    await executeWorkspaceDeletion({tenantId,jobId});
  }catch(e){
    const prior=await getSystemJSON(key,null).catch(()=>null);
    if(prior) await setSystemJSON(key,{...prior,status:'FAILED',failedAt:new Date().toISOString(),error:String(e?.message||e).slice(0,180)}).catch(()=>{});
  }
};
export const config={background:true};
