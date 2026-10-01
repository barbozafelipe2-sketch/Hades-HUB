import { requireSession, requireRole } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { commercialStatus } from '../lib/commercial-control.mjs';
export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req); if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='GET') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ requireRole(session,['owner']); }catch{return json({error:'FORBIDDEN'},403);}
  try{ const status=await commercialStatus(session,{includeAudit:true}); return json({audit:status.audit||[]}); }
  catch(e){ return json({error:String(e?.message||e)},500); }
};
