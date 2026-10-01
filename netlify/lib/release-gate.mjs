import { getEnv } from './env.mjs';
import { licensedMarketConfigured } from './market-truth.mjs';
import { stripeBillingConfig } from './stripe-billing.mjs';

function flag(name,fallback='false'){ return String(getEnv(name,fallback)).trim().toLowerCase()==='true'; }
function validEmail(value){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim()); }
function validHttps(value){ try{ return new URL(String(value||'')).protocol==='https:'; }catch{return false;} }
function reviewedAt(value){
  const ms=Date.parse(String(value||'')); if(!Number.isFinite(ms)) return null;
  if(ms>Date.now()+5*60*1000) return null;
  return new Date(ms).toISOString();
}

export function commercialReleaseGate({
  identityConfigured=false,
  legalConfigured=false,
  billingConfigured=false,
  signupRequested=false,
  publicSignupReady=false,
  billingRequired=true
}={}){
  const productMode=String(getEnv('KAIROS_PRODUCT_MODE','paper_research')).trim().toLowerCase();
  const realMoneyExecution=flag('KAIROS_REAL_MONEY_EXECUTION','false');
  const publicReleaseApproved=flag('KAIROS_PUBLIC_RELEASE_APPROVED','false');
  const previewSmokeApproved=flag('KAIROS_PREVIEW_SMOKE_APPROVED','false');
  const legalReviewVersion=String(getEnv('KAIROS_LEGAL_REVIEW_VERSION')||'').trim().slice(0,120);
  const legalReviewedAt=reviewedAt(getEnv('KAIROS_LEGAL_REVIEWED_AT'));
  const supportEmail=String(getEnv('KAIROS_SUPPORT_EMAIL')||'').trim().toLowerCase();
  const appUrl=String(getEnv('KAIROS_APP_URL')||'').trim();
  const legacyAuthOff=String(getEnv('KAIROS_LEGACY_AUTH_ENABLED','false')).trim().toLowerCase()==='false';
  const dailyUsdCapsSet=Number(getEnv('KAIROS_TENANT_DAILY_USD'))>0&&Number(getEnv('KAIROS_SITE_DAILY_USD'))>0;
  const stripeWebhookOk=stripeBillingConfig().webhookConfigured===true;

  const checks=[
    {id:'identity_configured',ok:identityConfigured===true},
    {id:'legal_documents_configured',ok:legalConfigured===true},
    {id:'billing_configured',ok:billingRequired!==true||billingConfigured===true},
    {id:'licensed_feed_ok',ok:licensedMarketConfigured()},
    {id:'legacy_auth_off',ok:legacyAuthOff},
    {id:'stripe_webhook_ok',ok:stripeWebhookOk},
    {id:'daily_usd_cap_set',ok:dailyUsdCapsSet},
    {id:'canonical_https_app_url',ok:validHttps(appUrl)},
    {id:'support_email_configured',ok:validEmail(supportEmail)},
    {id:'legal_review_versioned',ok:!!legalReviewVersion},
    {id:'legal_review_timestamped',ok:!!legalReviewedAt},
    {id:'product_mode_paper_research',ok:productMode==='paper_research'},
    {id:'real_money_execution_disabled',ok:realMoneyExecution===false},
    {id:'preview_smoke_approved',ok:previewSmokeApproved===true},
    {id:'public_release_approved',ok:publicReleaseApproved===true},
    {id:'signup_explicitly_requested',ok:signupRequested===true},
    {id:'public_signup_ready',ok:publicSignupReady===true}
  ];
  const blockers=checks.filter(x=>!x.ok).map(x=>x.id);
  return {
    ready:blockers.length===0,
    productMode,
    realMoneyExecution,
    publicReleaseApproved,
    previewSmokeApproved,
    legalReviewVersion:legalReviewVersion||null,
    legalReviewedAt,
    supportEmailConfigured:validEmail(supportEmail),
    appUrlConfigured:validHttps(appUrl),
    licensedFeedConfigured:licensedMarketConfigured(),
    legacyAuthOff,
    stripeWebhookOk,
    dailyUsdCapsSet,
    identityConfigured:identityConfigured===true,
    legalConfigured:legalConfigured===true,
    billingRequired:billingRequired===true,
    billingConfigured:billingConfigured===true,
    checks,
    blockers,
    claimsPolicy:{
      paperOnly:true,
      predictiveClaimsAllowed:false,
      guaranteedReturnClaimsAllowed:false,
      realOrderExecutionAllowed:false
    }
  };
}
