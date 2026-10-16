import {serializeTenantHandler} from '../lib/workspace-guard.mjs';
import {requireSession,requireRole} from '../lib/auth.mjs';
import {configurePersistenceForRequest} from '../lib/store.mjs';
import {json,readJSON} from '../lib/http.mjs';
import {verifyIdentityRequestOrigin} from '../lib/identity-provider.mjs';
import {globalTraceConsent,setGlobalTraceConsent,refreshPrivateTraceMetrics} from '../lib/global-trace-consent.mjs';

export default serializeTenantHandler(async(req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req);
  if(!session)return json({error:'UNAUTHORIZED'},401);
  if(req.method==='GET')return json({ok:true,consent:await globalTraceConsent(),globalSharingActive:false});
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  try{requireRole(session,['owner']);}catch{return json({error:'FORBIDDEN'},403);}
  if(session.authProvider==='netlify_identity'){
    try{verifyIdentityRequestOrigin(req);}catch{return json({error:'ORIGIN_REJECTED'},403);}
  }
  let body;
  try{body=await readJSON(req,{maxBytes:1024});}
  catch{return json({error:'INVALID_REQUEST'},400);}
  if(body?.action==='setConsent' && typeof body.enabled==='boolean'){
    const consent=await setGlobalTraceConsent(body.enabled);
    return json({ok:true,consent,globalSharingActive:false});
  }
  if(body?.action==='refreshPrivate'){
    const result=await refreshPrivateTraceMetrics();
    return json({ok:true,...result,globalSharingActive:false});
  }
  return json({error:'UNKNOWN_ACTION'},400);
});
