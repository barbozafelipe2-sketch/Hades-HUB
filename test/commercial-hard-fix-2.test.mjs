import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

process.env.KAIROS_DATA_BACKEND='postgres';
process.env.KAIROS_DATABASE_QA_MEMORY='true';
process.env.KAIROS_TRIAL_DAYS='14';
process.env.KAIROS_TRIAL_AI_UNITS='5';
process.env.KAIROS_PRO_AI_UNITS='20';
process.env.STRIPE_WEBHOOK_SECRET='qa_webhook_secret_kairos_hf2';

delete process.env.NETLIFY; delete process.env.SITE_ID;
const store=await import('../netlify/lib/store.mjs');
const commercial=await import('../netlify/lib/commercial-control.mjs');
const auth=await import('../netlify/lib/auth.mjs');
const stripe=await import('../netlify/lib/stripe-billing.mjs');
const db=await import('../netlify/lib/database.mjs');
const webhook=(await import('../netlify/functions/billing-webhook.mjs')).default;

store.configurePersistenceForRequest({});
const activeTrial={id:'tenant_trial_active',name:'Trial',status:'active',plan:'trial',ownerUserId:'u_trial',createdAt:new Date().toISOString()};
const expiredTrial={id:'tenant_trial_expired',name:'Expired',status:'active',plan:'trial',ownerUserId:'u_expired',createdAt:new Date(Date.now()-20*86400000).toISOString()};
const privateTenant={id:'tenant_private',name:'Private',status:'active',plan:'private',ownerUserId:'u_private',createdAt:new Date().toISOString()};
const proTenant={id:'tenant_pro',name:'Pro',status:'active',plan:'pro',ownerUserId:'u_pro',createdAt:new Date(Date.now()-40*86400000).toISOString()};
for(const t of [activeTrial,expiredTrial,privateTenant,proTenant]) await store.setSystemJSON(`auth/tenants/${t.id}`,t);

const trialSession={tenantId:activeTrial.id,userId:'u_trial',role:'owner',email:'trial@example.com'};
store.configureTenantForRequest(trialSession);
let status=await commercial.commercialStatus(trialSession);
assert.equal(status.access.allowed,true);
assert.equal(status.access.status,'trialing');
assert.equal(status.usage.limit,5);
let usage=await commercial.assertCommercialAccess(trialSession,{feature:'coach-deep',consumeUnits:true,idempotencyKey:'request-1'});
assert.equal(usage.usageEvent.used,4);
const replay=await commercial.assertCommercialAccess(trialSession,{feature:'coach-deep',consumeUnits:true,idempotencyKey:'request-1'});
assert.equal(replay.usageEvent.idempotent,true);
assert.equal(replay.usageEvent.used,4,'idempotent replay must not consume again');
await assert.rejects(()=>commercial.assertCommercialAccess(trialSession,{feature:'coach-deep',consumeUnits:true,idempotencyKey:'request-2'}),e=>e?.code==='USAGE_BUDGET_EXCEEDED'&&e?.httpStatus===429);

store.configurePersistenceForRequest({}); store.configureTenantForRequest({tenantId:expiredTrial.id,userId:'u_expired',role:'owner'});
await assert.rejects(()=>commercial.assertCommercialAccess({tenantId:expiredTrial.id,userId:'u_expired',role:'owner'}),e=>e?.code==='TRIAL_EXPIRED'&&e?.httpStatus===402);

// Expired trial must be rejected before provider-health can make any live AI probes.
await store.setSystemJSON('auth/users/u_expired',{id:'u_expired',tenantId:expiredTrial.id,username:'expired-owner',email:'expired@example.com',role:'owner',status:'active',credentialVersion:1});
const expiredToken=await auth.createSessionToken({userId:'u_expired',tenantId:expiredTrial.id,role:'owner',credentialVersion:1});
const providerHealth=(await import('../netlify/functions/provider-health.mjs')).default;
store.configurePersistenceForRequest({});
const healthResponse=await providerHealth(new Request('https://local/.netlify/functions/provider-health',{headers:{cookie:`kairos_session=${encodeURIComponent(expiredToken)}`}}),{requestId:'req-expired-provider-health'});
assert.equal(healthResponse.status,402);
assert.equal((await healthResponse.json()).error,'TRIAL_EXPIRED');

// One configured provider consumes one unit; an exhausted budget prevents the next live probe.
await store.setSystemJSON('auth/users/u_trial',{id:'u_trial',tenantId:activeTrial.id,username:'trial-owner',email:'trial@example.com',role:'owner',status:'active',credentialVersion:1});
const activeToken=await auth.createSessionToken({userId:'u_trial',tenantId:activeTrial.id,role:'owner',credentialVersion:1});
process.env.OPENAI_API_KEY='qa-openai-key';
process.env.OPENAI_BASE_URL='https://mock-openai.local';
delete process.env.HADES_OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
const originalFetch=globalThis.fetch;
let providerCalls=0;
globalThis.fetch=async()=>{providerCalls++;return new Response(JSON.stringify({id:'resp_qa',model:'gpt-5.6-luna',output_text:'OK'}),{status:200,headers:{'content-type':'application/json'}});};
try{
  store.configurePersistenceForRequest({});
  const activeHealth=await providerHealth(new Request('https://local/.netlify/functions/provider-health',{headers:{cookie:`kairos_session=${encodeURIComponent(activeToken)}`}}),{requestId:'req-active-provider-health'});
  assert.equal(activeHealth.status,200);
  assert.equal(providerCalls,1,'only the configured OpenAI provider should be probed');
  store.configurePersistenceForRequest({});
  store.configureTenantForRequest({tenantId:activeTrial.id,userId:'u_trial',role:'owner'});
  assert.equal((await commercial.commercialStatus({tenantId:activeTrial.id,userId:'u_trial',role:'owner'})).usage.used,5,'provider health must consume one AI unit');
  const exhaustedHealth=await providerHealth(new Request('https://local/.netlify/functions/provider-health',{headers:{cookie:`kairos_session=${encodeURIComponent(activeToken)}`}}),{requestId:'req-exhausted-provider-health'});
  assert.equal(exhaustedHealth.status,429);
  assert.equal((await exhaustedHealth.json()).error,'USAGE_BUDGET_EXCEEDED');
  assert.equal(providerCalls,1,'budget rejection must happen before another provider probe');
}finally{
  globalThis.fetch=originalFetch;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
}

store.configurePersistenceForRequest({}); store.configureTenantForRequest({tenantId:privateTenant.id,userId:'u_private',role:'owner'});
const privateAccess=await commercial.assertCommercialAccess({tenantId:privateTenant.id,userId:'u_private',role:'owner'},{feature:'learning-lab',consumeUnits:true,idempotencyKey:'private-1'});
assert.equal(privateAccess.usage.unlimited,true);
assert.equal(privateAccess.usageEvent.unlimited,true);

store.configurePersistenceForRequest({}); store.configureTenantForRequest({tenantId:proTenant.id,userId:'u_pro',role:'owner'});
await commercial.saveBillingState({provider:'stripe',plan:'pro',customerId:'cus_webhook_1',subscriptionId:'sub_webhook_1',subscriptionStatus:'active',currentPeriodEnd:new Date(Date.now()+30*86400000).toISOString()});
const proStatus=await commercial.commercialStatus({tenantId:proTenant.id,userId:'u_pro',role:'owner'});
assert.equal(proStatus.access.allowed,true);
assert.equal(proStatus.usage.limit,20);

const beforeUnsigned=await commercial.getBillingState();
const unsignedBody=JSON.stringify({id:'evt_unsigned',type:'customer.subscription.updated',created:Math.floor(Date.now()/1000),data:{object:{id:'sub_webhook_1',customer:'cus_webhook_1',status:'canceled',metadata:{tenant_id:proTenant.id}}}});
const unsignedResponse=await webhook(new Request('https://local/.netlify/functions/billing-webhook',{method:'POST',headers:{'content-type':'application/json'},body:unsignedBody}),{requestId:'req-unsigned'});
store.configurePersistenceForRequest({}); store.configureTenantForRequest({tenantId:proTenant.id,userId:'u_pro',role:'owner'});
assert.equal(unsignedResponse.status,400);assert.deepEqual(await commercial.getBillingState(),beforeUnsigned,'unsigned Stripe webhook cannot change the entitlement');

const ts=Math.floor(Date.now()/1000);
const raw=JSON.stringify({id:'evt_kairos_hf2_1',type:'customer.subscription.updated',created:ts,data:{object:{id:'sub_webhook_1',customer:'cus_webhook_1',status:'active',current_period_end:Math.floor(Date.now()/1000)+86400,metadata:{tenant_id:proTenant.id}}}});
const sig=crypto.createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(`${ts}.${raw}`).digest('hex');
const parsed=stripe.verifyStripeWebhook(raw,`t=${ts},v1=${sig}`);
assert.equal(parsed.id,'evt_kairos_hf2_1');
assert.throws(()=>stripe.verifyStripeWebhook(raw,`t=${ts},v1=${'0'.repeat(64)}`),/STRIPE_SIGNATURE_INVALID/);

store.configurePersistenceForRequest({});
let response=await webhook(new Request('https://local/.netlify/functions/billing-webhook',{method:'POST',headers:{'stripe-signature':`t=${ts},v1=${sig}`,'content-type':'application/json'},body:raw}),{requestId:'req-webhook-1'});
assert.equal(response.status,200);
assert.equal((await response.json()).ok,true);
store.configurePersistenceForRequest({}); store.configureTenantForRequest({tenantId:proTenant.id,userId:'u_pro',role:'owner'});
const billed=await commercial.getBillingState();
assert.equal(billed.subscriptionId,'sub_webhook_1');
assert.equal(billed.subscriptionStatus,'active');
assert.equal(await store.getSystemJSON('billing/customer/cus_webhook_1',null),proTenant.id);

// Replay of the exact signed event is idempotent and must not create a second state transition.
store.configurePersistenceForRequest({});
response=await webhook(new Request('https://local/.netlify/functions/billing-webhook',{method:'POST',headers:{'stripe-signature':`t=${ts},v1=${sig}`,'content-type':'application/json'},body:raw}),{requestId:'req-webhook-2'});
const replayBody=await response.json(); assert.equal(replayBody.idempotent,true);


// Stripe can deliver events out of order. An older Checkout event must not downgrade an active subscription to pending.
const olderRaw=JSON.stringify({id:'evt_kairos_hf2_old',type:'checkout.session.completed',created:ts-30,data:{object:{id:'cs_old',customer:'cus_webhook_1',subscription:'sub_webhook_1',client_reference_id:proTenant.id,metadata:{tenant_id:proTenant.id}}}});
const olderSig=crypto.createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(`${ts}.${olderRaw}`).digest('hex');
store.configurePersistenceForRequest({});
response=await webhook(new Request('https://local/.netlify/functions/billing-webhook',{method:'POST',headers:{'stripe-signature':`t=${ts},v1=${olderSig}`,'content-type':'application/json'},body:olderRaw}),{requestId:'req-webhook-old'});
assert.equal(response.status,200);
store.configurePersistenceForRequest({}); store.configureTenantForRequest({tenantId:proTenant.id,userId:'u_pro',role:'owner'});
assert.equal((await commercial.getBillingState()).subscriptionStatus,'active','older Stripe event must not downgrade current billing state');

const audit=await db.listAuditEvents(proTenant.id,{limit:20});
assert.ok(audit.some(x=>x.eventType==='billing.customer.subscription.updated'));
assert.ok(audit.every(x=>x.tenantId===proTenant.id));

const migration=fs.readFileSync(new URL('../netlify/database/migrations/20261001000200_kairos-commercial-controls/migration.sql',import.meta.url),'utf8');
assert.ok(migration.includes('kairos_audit_events'));
assert.ok(migration.includes('kairos_usage_events'));
assert.ok(migration.includes('UNIQUE (tenant_id, period, idempotency_key)'));
const stripeSrc=fs.readFileSync(new URL('../netlify/lib/stripe-billing.mjs',import.meta.url),'utf8');
assert.ok(stripeSrc.includes("crypto.createHmac('sha256'"));
assert.ok(stripeSrc.includes('STRIPE_WEBHOOK_SECRET'));
assert.ok(stripeSrc.includes("mode:'subscription'"));
const appSrc=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert.ok(appSrc.includes('SUBSCRIPTION & USAGE'));
assert.ok(appSrc.includes("api('billing-checkout'"));
assert.ok(appSrc.includes("api('billing-portal'"));
const supportSrc=fs.readFileSync(new URL('../netlify/functions/support-diagnostics.mjs',import.meta.url),'utf8');
assert.ok(supportSrc.includes('Sanitized support diagnostics only'));
const authSrc=fs.readFileSync(new URL('../netlify/lib/auth.mjs',import.meta.url),'utf8');
assert.ok(authSrc.includes('COMMERCIAL_BILLING_CONFIG_REQUIRED'));
assert.ok(authSrc.includes("KAIROS_REQUIRE_BILLING_FOR_SIGNUP','true'"));
const decisionSrc=fs.readFileSync(new URL('../netlify/functions/decision-run.mjs',import.meta.url),'utf8');
assert.ok(decisionSrc.includes("feature:'decision-review'"));
const chatSrc=fs.readFileSync(new URL('../netlify/functions/ai-chat.mjs',import.meta.url),'utf8');
assert.ok(chatSrc.includes("feature:coach.tier==='deep'?'coach-deep':'coach-fast'"));
console.log(JSON.stringify({ok:true,tests:['trial entitlement','trial expiry','expired trial blocks provider health','provider diagnostics charge configured AI units','budget rejects before provider probe','private owner unlimited','monthly usage budget','idempotent usage replay','active Stripe entitlement','signed webhook','invalid signature rejection','webhook replay idempotency','out-of-order Stripe event protection','tenant audit log','UI billing surface']},null,2));
