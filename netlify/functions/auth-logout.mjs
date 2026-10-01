import { clearSessionCookie, logoutIdentitySession, requireSession } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { auditCommercialEvent } from '../lib/commercial-control.mjs';
export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  const session=await requireSession(req);
  if(session) await auditCommercialEvent(session,'auth.logout',{requestId:context?.requestId}).catch(()=>{});
  try{ await logoutIdentitySession(req); }catch(e){ if(Number(e?.status||0)===403) return json({ok:false,error:'AUTH_ORIGIN_REJECTED'},403); throw e; }
  return json({ok:true},200,{'set-cookie':clearSessionCookie()});
};
