import { loginPrincipal, createSessionToken, sessionCookie, publicAuthState } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { declaredBodyTooLarge } from '../lib/input.mjs';
import { configurePersistenceForRequest, configureTenantForRequest } from '../lib/store.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  if(declaredBodyTooLarge(req,8192)) return json({error:'PAYLOAD_TOO_LARGE'},413);
  const body=await readJSON(req);
  const identifier=String(body.email||body.username||body.identifier||'').trim();
  try{
    const principal=await loginPrincipal(req,identifier,String(body.password||''));
    if(!principal) return json({ok:false,error:'INVALID_CREDENTIALS'},401);
    configureTenantForRequest(principal);
    const token=await createSessionToken(principal);
    return json({ok:true,auth:await publicAuthState(principal)},200,{'set-cookie':sessionCookie(token)});
  }catch(e){
    const code=String(e?.message||e),rawStatus=Number(e?.status||0);
    if(code==='IDENTITY_UNAVAILABLE') return json({ok:false,error:code},503);
    if(rawStatus===403) return json({ok:false,error:'AUTH_ORIGIN_REJECTED'},403);
    const status=/TENANT_NOT_PROVISIONED|FORBIDDEN/.test(code)?403:401;
    return json({ok:false,error:code==='TENANT_NOT_PROVISIONED'?code:'INVALID_CREDENTIALS'},status);
  }
};
export const config={
  path:'/.netlify/functions/auth-login',
  rateLimit:{windowLimit:8,windowSize:60,aggregateBy:['ip']}
};
