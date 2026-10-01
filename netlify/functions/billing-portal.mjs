import { requireSession, requireRole } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { getBillingState, auditCommercialEvent } from '../lib/commercial-control.mjs';
import { createStripePortal } from '../lib/stripe-billing.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req); if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ requireRole(session,['owner']); }catch{return json({error:'FORBIDDEN'},403);}
  try{
    const billing=await getBillingState(); if(!billing?.customerId) return json({error:'STRIPE_CUSTOMER_NOT_LINKED'},409);
    const portal=await createStripePortal({customerId:billing.customerId});
    if(!portal?.url||!/^https:\/\/billing\.stripe\.com\//.test(String(portal.url))) throw new Error('STRIPE_PORTAL_URL_INVALID');
    await auditCommercialEvent(session,'billing.portal_created',{requestId:context?.requestId,details:{provider:'stripe'}});
    return json({ok:true,url:portal.url});
  }catch(e){ const m=String(e?.message||e); return json({ok:false,error:m},/NOT_CONFIGURED/.test(m)?503:502); }
};
