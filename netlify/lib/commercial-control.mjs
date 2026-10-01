import crypto from 'node:crypto';
import { getEnv } from './env.mjs';
import { getJSON, setJSON, getSystemJSON, setSystemJSON, currentTenantContext } from './store.mjs';
import { consumeUsageEvent, getUsageSummary, appendAuditEvent, listAuditEvents } from './database.mjs';

const BILLING_KEY='commercial/billing';
const ACTIVE_SUBSCRIPTION_STATUSES=new Set(['active','trialing']);

function intEnv(name,fallback,min=1,max=100000000){
  const n=Number(getEnv(name,String(fallback))); return Math.max(min,Math.min(max,Number.isFinite(n)?Math.trunc(n):fallback));
}
function featureEnvName(feature){ return `KAIROS_AI_UNITS_${String(feature).toUpperCase().replace(/[^A-Z0-9]+/g,'_')}`; }
const DEFAULT_UNITS=Object.freeze({
  'coach-fast':1,
  'coach-deep':4,
  'decision-review':12,
  'ai-mirror':10,
  'wallet-mirror':8,
  'learning-lab':16,
});
function periodNow(){ return new Date().toISOString().slice(0,7); }
function tenantSystemKey(tenantId){ return `auth/tenants/${String(tenantId)}`; }
function cleanSuffix(v){ const s=String(v||''); return s?s.slice(-8):null; }

export class CommercialAccessError extends Error{
  constructor(code,{httpStatus=402,details={}}={}){ super(code); this.name='CommercialAccessError'; this.code=code; this.httpStatus=httpStatus; this.details=details; }
}

export function featureUnits(feature){
  const safe=String(feature||'').toLowerCase();
  const fallback=DEFAULT_UNITS[safe]||1;
  return intEnv(featureEnvName(safe),fallback,1,10000);
}
export function trialDays(){ return intEnv('KAIROS_TRIAL_DAYS',14,1,90); }
function planLimit(plan){
  const p=String(plan||'trial').toLowerCase();
  if(p==='private') return null;
  if(p==='pro') return intEnv('KAIROS_PRO_AI_UNITS',1200,1,10000000);
  return intEnv('KAIROS_TRIAL_AI_UNITS',120,1,10000000);
}

export async function tenantRecord(tenantId){
  if(!tenantId) return null;
  return await getSystemJSON(tenantSystemKey(tenantId),null);
}
export async function getBillingState(){
  return await getJSON(BILLING_KEY,null);
}
export async function saveBillingState(next){
  const value={...next,updatedAt:new Date().toISOString()};
  await setJSON(BILLING_KEY,value); return value;
}

function trialAccess(tenant){
  const created=Date.parse(tenant?.createdAt||0); const days=trialDays();
  const end=Number.isFinite(created)?created+days*86400000:0;
  return {trialEndsAt:end?new Date(end).toISOString():null,trialActive:!!end&&Date.now()<end};
}
function billingAccess(tenant,billing){
  const plan=String(billing?.plan||tenant?.plan||'trial').toLowerCase();
  if(plan==='private') return {plan,status:'active',access:true,reason:'PRIVATE_OWNER',currentPeriodEnd:null};
  const stripeStatus=String(billing?.subscriptionStatus||billing?.status||'').toLowerCase();
  if(ACTIVE_SUBSCRIPTION_STATUSES.has(stripeStatus)) return {plan:'pro',status:stripeStatus,access:true,reason:'SUBSCRIPTION_ACTIVE',currentPeriodEnd:billing?.currentPeriodEnd||null};
  if(stripeStatus==='canceled' && Date.parse(billing?.currentPeriodEnd||0)>Date.now()) return {plan:'pro',status:'canceled_period_active',access:true,reason:'PAID_THROUGH_PERIOD',currentPeriodEnd:billing.currentPeriodEnd};
  if(plan==='trial'){
    const t=trialAccess(tenant);
    if(t.trialActive) return {plan:'trial',status:'trialing',access:true,reason:'TRIAL_ACTIVE',currentPeriodEnd:t.trialEndsAt};
    return {plan:'trial',status:'expired',access:false,reason:'TRIAL_EXPIRED',currentPeriodEnd:t.trialEndsAt};
  }
  return {plan,status:stripeStatus||'inactive',access:false,reason:'SUBSCRIPTION_REQUIRED',currentPeriodEnd:billing?.currentPeriodEnd||null};
}

export async function commercialStatus(session,{includeAudit=false}={}){
  const tenantId=session?.tenantId||currentTenantContext()?.tenantId;
  const tenant=await tenantRecord(tenantId);
  if(!tenant) throw new CommercialAccessError('TENANT_NOT_FOUND',{httpStatus:403});
  const billing=await getBillingState();
  const access=billingAccess(tenant,billing);
  const limit=planLimit(access.plan);
  const usage=await getUsageSummary(tenantId,periodNow(),limit);
  const result={
    tenant:{id:tenant.id,name:tenant.name,plan:access.plan},
    access:{allowed:access.access,status:access.status,reason:access.reason,currentPeriodEnd:access.currentPeriodEnd},
    usage,
    billing:{configured:billing?.provider==='stripe',provider:billing?.provider||null,subscriptionStatus:billing?.subscriptionStatus||null,customerLinked:!!billing?.customerId,subscriptionLinked:!!billing?.subscriptionId,cancelAtPeriodEnd:billing?.cancelAtPeriodEnd===true,lastInvoiceStatus:billing?.lastInvoiceStatus||null},
  };
  if(includeAudit && session?.role==='owner') result.audit=await listAuditEvents(tenantId,{limit:50});
  return result;
}

export async function assertCommercialAccess(session,{feature='app',consumeUnits=false,idempotencyKey=null,units=null}={}){
  const status=await commercialStatus(session);
  if(!status.access.allowed){
    const code=status.access.reason==='TRIAL_EXPIRED'?'TRIAL_EXPIRED':'SUBSCRIPTION_REQUIRED';
    throw new CommercialAccessError(code,{httpStatus:402,details:{status:status.access.status,currentPeriodEnd:status.access.currentPeriodEnd}});
  }
  if(!consumeUnits) return {...status,usageEvent:null};
  const amount=units==null?featureUnits(feature):Math.max(1,Math.trunc(Number(units)||1));
  const key=String(idempotencyKey||crypto.randomUUID()).slice(0,220);
  const used=await consumeUsageEvent({tenantId:session.tenantId,period:periodNow(),feature,units:amount,limit:status.usage.limit,idempotencyKey:key});
  if(!used.ok) throw new CommercialAccessError('USAGE_BUDGET_EXCEEDED',{httpStatus:429,details:{period:used.period,used:used.used,limit:used.limit,remaining:used.remaining}});
  return {...status,usageEvent:used};
}

export function commercialErrorJSON(error){
  if(!(error instanceof CommercialAccessError)) return null;
  return {status:error.httpStatus||402,body:{error:error.code,...(error.details||{})}};
}

export async function auditCommercialEvent(session,eventType,{requestId=null,details={}}={}){
  return await appendAuditEvent({tenantId:session?.tenantId||null,userId:session?.userId||null,eventType,requestId,details:{role:session?.role||null,...details}});
}

export async function applyBillingUpdate(tenantId,update,{eventType='billing.updated',requestId=null}={}){
  const tenant=await tenantRecord(tenantId); if(!tenant) throw new Error('BILLING_TENANT_NOT_FOUND');
  const current=await getJSON(BILLING_KEY,null);
  const incomingCreated=Number(update?.stripeEventCreated||0), currentCreated=Number(current?.stripeEventCreated||0);
  if(incomingCreated && currentCreated && incomingCreated<currentCreated){
    await appendAuditEvent({tenantId,userId:null,eventType:'billing.stale_event_ignored',requestId,details:{plan:'pro',billingStatus:current?.subscriptionStatus||null}});
    return current;
  }
  const sanitized={...update};
  const currentSub=String(current?.subscriptionId||''), incomingSub=String(sanitized?.subscriptionId||'');
  const currentStatus=String(current?.subscriptionStatus||'').toLowerCase(), incomingStatus=String(sanitized?.subscriptionStatus||'').toLowerCase();
  if(currentSub && incomingSub && currentSub!==incomingSub && ACTIVE_SUBSCRIPTION_STATUSES.has(currentStatus)){
    await appendAuditEvent({tenantId,userId:null,eventType:'billing.subscription_conflict_ignored',requestId,details:{plan:'pro',billingStatus:currentStatus,subscriptionStatus:incomingStatus,subscriptionIdSuffix:cleanSuffix(incomingSub)}});
    return current;
  }
  if(incomingStatus==='pending' && ACTIVE_SUBSCRIPTION_STATUSES.has(currentStatus)) delete sanitized.subscriptionStatus;
  const next=await saveBillingState({provider:'stripe',plan:'pro',...(current||{}),...sanitized});
  if(update?.customerId) await setSystemJSON(`billing/customer/${String(update.customerId)}`,tenantId);
  if(update?.subscriptionId) await setSystemJSON(`billing/subscription/${String(update.subscriptionId)}`,tenantId);
  await appendAuditEvent({tenantId,userId:null,eventType,requestId,details:{plan:'pro',billingStatus:next.subscriptionStatus||next.status||null,subscriptionStatus:next.subscriptionStatus||null,customerIdSuffix:cleanSuffix(next.customerId),subscriptionIdSuffix:cleanSuffix(next.subscriptionId)}});
  return next;
}

export async function resolveBillingTenant({tenantId=null,customerId=null,subscriptionId=null}={}){
  if(tenantId){ const t=await tenantRecord(tenantId); if(t) return t.id; }
  if(subscriptionId){ const mapped=await getSystemJSON(`billing/subscription/${String(subscriptionId)}`,null); if(mapped) return mapped; }
  if(customerId){ const mapped=await getSystemJSON(`billing/customer/${String(customerId)}`,null); if(mapped) return mapped; }
  return null;
}
