import { json, readText } from '../lib/http.mjs';
import { configurePersistenceForRequest, configureTenantForRequest, getSystemJSON, setSystemJSON, withSystemKeyLock } from '../lib/store.mjs';
import { verifyStripeWebhook } from '../lib/stripe-billing.mjs';
import { resolveBillingTenant, applyBillingUpdate } from '../lib/commercial-control.mjs';

function isoFromEpoch(v){ const n=Number(v); return Number.isFinite(n)&&n>0?new Date(n*1000).toISOString():null; }
function tenantHint(obj){ return obj?.metadata?.tenant_id||obj?.metadata?.tenantId||obj?.client_reference_id||null; }
function ids(obj){ const customerId=typeof obj?.customer==='string'?obj.customer:(obj?.customer?.id||null); let subscriptionId=typeof obj?.subscription==='string'?obj.subscription:(obj?.subscription?.id||null); if(!subscriptionId && String(obj?.id||'').startsWith('sub_')) subscriptionId=String(obj.id); return {customerId,subscriptionId}; }

async function processEvent(event,context){
  const object=event.data.object||{}; const type=String(event.type||''); const got=ids(object);
  let tenantId=await resolveBillingTenant({tenantId:tenantHint(object),...got});
  if(type.startsWith('customer.subscription.')){
    const subId=String(object.id||''); tenantId=await resolveBillingTenant({tenantId:tenantHint(object),customerId:got.customerId,subscriptionId:subId});
    if(!tenantId) throw new Error('STRIPE_TENANT_UNRESOLVED');
    configureTenantForRequest({tenantId,userId:'stripe',role:'system'});
    return await applyBillingUpdate(tenantId,{customerId:got.customerId,subscriptionId:subId,subscriptionStatus:String(object.status||'unknown'),currentPeriodEnd:isoFromEpoch(object.current_period_end),cancelAtPeriodEnd:object.cancel_at_period_end===true,canceledAt:isoFromEpoch(object.canceled_at),lastStripeEventId:event.id,stripeEventCreated:Number(event.created)||0},{eventType:`billing.${type}`,requestId:context?.requestId});
  }
  if(type==='checkout.session.completed'){
    tenantId=await resolveBillingTenant({tenantId:tenantHint(object),customerId:got.customerId,subscriptionId:got.subscriptionId});
    if(!tenantId) throw new Error('STRIPE_TENANT_UNRESOLVED');
    configureTenantForRequest({tenantId,userId:'stripe',role:'system'});
    return await applyBillingUpdate(tenantId,{customerId:got.customerId,subscriptionId:got.subscriptionId,subscriptionStatus:object.subscription_status||'pending',checkoutCompletedAt:new Date().toISOString(),lastStripeEventId:event.id,stripeEventCreated:Number(event.created)||0},{eventType:'billing.checkout_completed',requestId:context?.requestId});
  }
  if(type==='invoice.payment_failed'||type==='invoice.paid'){
    tenantId=await resolveBillingTenant({customerId:got.customerId,subscriptionId:got.subscriptionId});
    if(!tenantId) return {ignored:true,reason:'tenant_unresolved'};
    configureTenantForRequest({tenantId,userId:'stripe',role:'system'});
    return await applyBillingUpdate(tenantId,{customerId:got.customerId,subscriptionId:got.subscriptionId,lastInvoiceStatus:type==='invoice.paid'?'paid':'payment_failed',lastInvoiceAt:new Date().toISOString(),lastStripeEventId:event.id,stripeEventCreated:Number(event.created)||0},{eventType:`billing.${type}`,requestId:context?.requestId});
  }
  return {ignored:true,reason:'event_not_used'};
}

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  let raw; try{ raw=await readText(req,{maxBytes:512000}); }catch(e){ return json({error:String(e?.message||e)},413); }
  let event; try{ event=verifyStripeWebhook(raw,req.headers.get('stripe-signature')); }catch(e){ return json({error:String(e?.message||e)},400); }
  try{
    return await withSystemKeyLock(`stripe-event:${event.id}`,async()=>{
      const key=`billing/webhooks/${event.id}`; const prior=await getSystemJSON(key,null);
      if(prior?.status==='complete') return json({ok:true,idempotent:true});
      await setSystemJSON(key,{status:'processing',type:event.type,receivedAt:new Date().toISOString(),requestId:context?.requestId||null});
      try{ const result=await processEvent(event,context); await setSystemJSON(key,{status:'complete',type:event.type,receivedAt:prior?.receivedAt||new Date().toISOString(),completedAt:new Date().toISOString(),ignored:result?.ignored===true}); return json({ok:true}); }
      catch(e){ await setSystemJSON(key,{status:'failed',type:event.type,failedAt:new Date().toISOString(),error:String(e?.message||e).slice(0,180)}); throw e; }
    });
  }catch(e){ return json({ok:false,error:String(e?.message||e)},500); }
};
export const config={path:'/.netlify/functions/billing-webhook'};
