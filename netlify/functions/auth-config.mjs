import { publicAuthState } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(req.method!=='GET') return json({error:'METHOD_NOT_ALLOWED'},405);
  const auth=await publicAuthState(null);
  return json({signupAllowed:auth.signupAllowed,billingReady:auth.billingReady,billingRequired:auth.billingRequired,legalEntity:auth.legalEntity,termsVersion:auth.termsVersion,riskDisclosureVersion:auth.riskDisclosureVersion,termsUrl:auth.termsUrl,riskDisclosureUrl:auth.riskDisclosureUrl,privacyUrl:auth.privacyUrl,mode:auth.mode});
};
