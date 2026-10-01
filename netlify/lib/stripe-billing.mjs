import crypto from 'node:crypto';
import { getEnv, isNetlifyRuntime } from './env.mjs';

function secret(){ return String(getEnv('STRIPE_SECRET_KEY')||'').trim(); }
function webhookSecret(){ return String(getEnv('STRIPE_WEBHOOK_SECRET')||'').trim(); }
function priceId(){ return String(getEnv('KAIROS_STRIPE_PRO_PRICE_ID')||'').trim(); }
function appUrl(){ return String(getEnv('KAIROS_APP_URL')||getEnv('URL')||'').trim().replace(/\/+$/,''); }
function validAppUrl(v){ try{ const u=new URL(v); return isNetlifyRuntime()?u.protocol==='https:':['http:','https:'].includes(u.protocol); }catch{return false;} }

export function stripeBillingConfig(){
  const s=secret(),w=webhookSecret(),p=priceId(),a=appUrl();
  return {configured:!!(s&&w&&/^price_[A-Za-z0-9]+$/.test(p)&&validAppUrl(a)),checkoutConfigured:!!(s&&/^price_[A-Za-z0-9]+$/.test(p)&&validAppUrl(a)),webhookConfigured:!!(s&&w),priceConfigured:/^price_[A-Za-z0-9]+$/.test(p),appUrlConfigured:validAppUrl(a)};
}

async function stripePost(path,params){
  const key=secret(); if(!key) throw new Error('STRIPE_NOT_CONFIGURED');
  const body=new URLSearchParams();
  for(const [k,v] of Object.entries(params||{})) if(v!==undefined&&v!==null) body.set(k,String(v));
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const res=await fetch(`https://api.stripe.com/v1/${path}`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/x-www-form-urlencoded'},body,signal:controller.signal});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(`STRIPE_API_${res.status}:${String(data?.error?.code||data?.error?.message||'request_failed').slice(0,180)}`);
    return data;
  }finally{ clearTimeout(timer); }
}

export async function createStripeCheckout({tenantId,email,customerId=null}={}){
  const cfg=stripeBillingConfig(); if(!cfg.checkoutConfigured) throw new Error('STRIPE_CHECKOUT_NOT_CONFIGURED');
  const base=appUrl(); const params={
    mode:'subscription',
    'line_items[0][price]':priceId(),
    'line_items[0][quantity]':'1',
    client_reference_id:tenantId,
    'metadata[tenant_id]':tenantId,
    'metadata[product]':'kairos_pro',
    'subscription_data[metadata][tenant_id]':tenantId,
    success_url:`${base}/?billing=success`,
    cancel_url:`${base}/?billing=cancel`,
    allow_promotion_codes:'true'
  };
  if(customerId) params.customer=customerId;
  else if(email) params.customer_email=email;
  return await stripePost('checkout/sessions',params);
}

export async function createStripePortal({customerId}={}){
  const cfg=stripeBillingConfig(); if(!cfg.checkoutConfigured || !customerId) throw new Error('STRIPE_PORTAL_NOT_CONFIGURED');
  return await stripePost('billing_portal/sessions',{customer:customerId,return_url:`${appUrl()}/?billing=portal-return`});
}


export async function cancelStripeSubscription({subscriptionId}={}){
  const id=String(subscriptionId||'').trim(); if(!/^sub_[A-Za-z0-9]+$/.test(id)) throw new Error('STRIPE_SUBSCRIPTION_ID_INVALID');
  const key=secret(); if(!key) throw new Error('STRIPE_NOT_CONFIGURED');
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const res=await fetch('https://api.stripe.com/v1/subscriptions/'+encodeURIComponent(id),{method:'DELETE',headers:{authorization:'Bearer '+key},signal:controller.signal});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error('STRIPE_CANCEL_'+res.status+':'+String(data?.error?.code||data?.error?.message||'request_failed').slice(0,180));
    return data;
  }finally{ clearTimeout(timer); }
}

function timingSafeHex(a,b){
  if(!/^[0-9a-f]+$/i.test(a)||!a||!b) return false;
  const A=Buffer.from(a,'hex'),B=Buffer.from(b,'hex'); return A.length===B.length&&crypto.timingSafeEqual(A,B);
}
export function verifyStripeWebhook(rawBody,signatureHeader,{toleranceSeconds=300}={}){
  const key=webhookSecret(); if(!key) throw new Error('STRIPE_WEBHOOK_NOT_CONFIGURED');
  const parts=String(signatureHeader||'').split(',').map(v=>v.trim());
  const timestamp=Number(parts.find(p=>p.startsWith('t='))?.slice(2));
  const signatures=parts.filter(p=>p.startsWith('v1=')).map(p=>p.slice(3));
  if(!Number.isFinite(timestamp)||!signatures.length) throw new Error('STRIPE_SIGNATURE_INVALID');
  if(Math.abs(Date.now()/1000-timestamp)>Math.max(60,Number(toleranceSeconds)||300)) throw new Error('STRIPE_SIGNATURE_EXPIRED');
  const expected=crypto.createHmac('sha256',key).update(`${timestamp}.${rawBody}`).digest('hex');
  if(!signatures.some(sig=>timingSafeHex(expected,sig))) throw new Error('STRIPE_SIGNATURE_INVALID');
  let event; try{event=JSON.parse(rawBody);}catch{throw new Error('STRIPE_EVENT_INVALID_JSON');}
  if(!event?.id||!event?.type||!event?.data?.object) throw new Error('STRIPE_EVENT_INVALID');
  return event;
}
