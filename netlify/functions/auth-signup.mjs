import { createCommercialAccount, publicAuthState, createSessionToken, sessionCookie } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { declaredBodyTooLarge } from '../lib/input.mjs';
import { configurePersistenceForRequest, configureTenantForRequest } from '../lib/store.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  if(declaredBodyTooLarge(req,12000)) return json({error:'PAYLOAD_TOO_LARGE'},413);
  const body=await readJSON(req);
  try{
    const created=await createCommercialAccount(req,{
      email:body.email,password:String(body.password||''),fullName:body.fullName,
      acceptedTermsVersion:body.acceptedTermsVersion,
      acceptedRiskDisclosure:body.acceptedRiskDisclosure===true
    });
    if(created.emailVerified){
      configureTenantForRequest(created.principal);
      const token=await createSessionToken(created.principal);
      return json({ok:true,verificationRequired:false,auth:await publicAuthState(created.principal)},201,{'set-cookie':sessionCookie(token)});
    }
    return json({ok:true,verificationRequired:true,email:created.principal.email},202);
  }catch(e){
    const code=String(e?.message||e),rawStatus=Number(e?.status||0);
    const forbidden=rawStatus===403||['SIGNUPS_DISABLED','COMMERCIAL_LEGAL_CONFIG_REQUIRED','PUBLIC_SIGNUP_NOT_RELEASED','IDENTITY_NOT_CONFIGURED'].includes(code);
    const conflict=code==='ACCOUNT_EXISTS'||rawStatus===409;
    return json({ok:false,error:forbidden&&rawStatus===403?'AUTH_ORIGIN_REJECTED':code},forbidden?403:conflict?409:400);
  }
};
export const config={path:'/.netlify/functions/auth-signup',rateLimit:{windowLimit:5,windowSize:60,aggregateBy:['ip']}};
