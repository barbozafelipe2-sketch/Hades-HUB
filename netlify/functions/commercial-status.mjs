import { requireSession } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { commercialStatus } from '../lib/commercial-control.mjs';
import { stripeBillingConfig } from '../lib/stripe-billing.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req); if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='GET') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{
    const status=await commercialStatus(session,{includeAudit:session.role==='owner'});
    return json({...status,billingCapabilities:{...stripeBillingConfig(),canCheckout:session.role==='owner'&&stripeBillingConfig().checkoutConfigured,canOpenPortal:session.role==='owner'&&status.billing.customerLinked&&stripeBillingConfig().checkoutConfigured}});
  }catch(e){ return json({error:String(e?.message||e)},500); }
};
