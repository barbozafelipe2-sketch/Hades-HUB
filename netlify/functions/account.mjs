import { requireSession, updateCredentials, publicAuthState, clearSessionCookie } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { getProfile, saveProfile, getSettings, saveSettings } from '../lib/state.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req);
  if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method==='GET') return json({profile:await getProfile(),settings:await getSettings(),auth:await publicAuthState(session)});
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  const body=await readJSON(req);
  if(body.action==='saveProfile') return json({ok:true,profile:await saveProfile(body.profile||{})});
  if(body.action==='saveSettings') return json({ok:true,settings:await saveSettings(body.settings||{})});
  if(body.action==='updateCredentials'){
    try{
      const auth=await updateCredentials(session,body);
      return json({ok:true,auth,reloginRequired:true},200,{'set-cookie':clearSessionCookie()});
    }catch(e){ return json({ok:false,error:e.message},400); }
  }
  return json({error:'UNKNOWN_ACTION'},400);
};
