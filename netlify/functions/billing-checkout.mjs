import { requireSession, requireRole } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { commercialStatus, auditCommercialEvent, getBillingState } from '../lib/commercial-control.mjs';
import { createStripeCheckout } from '../lib/stripe-billing.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req); if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ requireRole(session,['owner']); }catch{return json({error:'FORBIDDEN'},403);}
  try{
    const status=await commercialStatus(session);
    if(status.tenant.plan==='private') return json({error:'PRIVATE_PLAN_BILLING_NOT_REQUIRED'},409);
    const checkout=await createStripeCheckout({tenantId:session.tenantId,email:session.email||null,customerId:status.billing.customerLinked?(await getBillingState())?.customerId:null});
    if(!checkout?.url||!/^https:\/\/checkout\.stripe\.com\//.test(String(checkout.url))) throw new Error('STRIPE_CHECKOUT_URL_INVALID');
    await auditCommercialEvent(session,'billing.checkout_created',{requestId:context?.requestId,details:{plan:'pro',provider:'stripe'}});
    return json({ok:true,url:checkout.url});
  }catch(e){
    const m=String(e?.message||e); return json({ok:false,error:m},/NOT_CONFIGURED/.test(m)?503:502);
  }
};
