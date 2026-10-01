import { confirmCommercialEmail, createSessionToken, sessionCookie, publicAuthState } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { declaredBodyTooLarge } from '../lib/input.mjs';
import { configurePersistenceForRequest, configureTenantForRequest } from '../lib/store.mjs';
import { auditCommercialEvent } from '../lib/commercial-control.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  if(declaredBodyTooLarge(req,8192)) return json({error:'PAYLOAD_TOO_LARGE'},413);
  let body; try{ body=await readJSON(req,{maxBytes:8192}); }catch(e){ return json({error:String(e?.message||e)},400); }
  try{
    const principal=await confirmCommercialEmail(req,body?.token);
    configureTenantForRequest(principal);
    const token=await createSessionToken(principal);
    await auditCommercialEvent(principal,'auth.email_confirmed',{requestId:context?.requestId,details:{source:'netlify_identity'}}).catch(()=>{});
    return json({ok:true,auth:await publicAuthState(principal)},200,{'set-cookie':sessionCookie(token)});
  }catch(e){
    const code=String(e?.message||e),status=Number(e?.status||0);
    if(status===403) return json({ok:false,error:'AUTH_ORIGIN_REJECTED'},403);
    if(/IDENTITY_NOT_CONFIGURED/.test(code)) return json({ok:false,error:code},503);
    return json({ok:false,error:/token|confirm/i.test(code)?'CONFIRMATION_FAILED':code},400);
  }
};
export const config={path:'/.netlify/functions/auth-confirm'};
