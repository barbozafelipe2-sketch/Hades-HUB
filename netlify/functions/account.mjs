import { requireSession, updateCredentials, publicAuthState, clearSessionCookie } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { getProfile, saveProfile, getSettings, saveSettings } from '../lib/state.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { auditCommercialEvent } from '../lib/commercial-control.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req);
  if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method==='GET') return json({profile:await getProfile(),settings:await getSettings(),auth:await publicAuthState(session)});
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  const body=await readJSON(req);
  if(body.action==='saveProfile'){ const profile=await saveProfile(body.profile||{}); await auditCommercialEvent(session,'account.profile_updated',{requestId:context?.requestId,details:{action:'saveProfile'}}).catch(()=>{}); return json({ok:true,profile}); }
  if(body.action==='saveSettings'){ const settings=await saveSettings(body.settings||{}); await auditCommercialEvent(session,'account.settings_updated',{requestId:context?.requestId,details:{action:'saveSettings'}}).catch(()=>{}); return json({ok:true,settings}); }
  if(body.action==='updateCredentials'){
    try{
      const auth=await updateCredentials(session,body);
      await auditCommercialEvent(session,'account.credentials_updated',{requestId:context?.requestId,details:{action:'updateCredentials'}}).catch(()=>{});
      return json({ok:true,auth,reloginRequired:true},200,{'set-cookie':clearSessionCookie()});
    }catch(e){ return json({ok:false,error:e.message},400); }
  }
  return json({error:'UNKNOWN_ACTION'},400);
};
