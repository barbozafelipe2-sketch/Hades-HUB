import crypto from 'node:crypto';
import { licensedMarketHealth } from '../lib/market-truth.mjs';
import { getJSON,setJSON,deleteKey } from '../lib/store.mjs';
import { requireSession,requireRole,commercialReleaseState } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { configurePersistenceForRequest,persistenceStatus } from '../lib/store.mjs';
import { providerStatus } from '../lib/providers.mjs';
import { securityStatus } from '../lib/security-status.mjs';
import { stripeBillingConfig } from '../lib/stripe-billing.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req); if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='GET') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ requireRole(session,['owner']); }catch{ return json({error:'FORBIDDEN'},403); }
  const release=commercialReleaseState();
  const persistence=persistenceStatus(),providers=providerStatus(),security=securityStatus(),billing=stripeBillingConfig();
  const probeId=crypto.randomUUID();let persistenceVerified=false;
  const probeKeys=['draft/readiness-'+probeId,'diagnostics/readiness-'+probeId];
  try{for(const key of probeKeys){await setJSON(key,{probeId});if((await getJSON(key,null))?.probeId!==probeId)throw new Error('PERSISTENCE_PROBE_FAILED');}persistenceVerified=true;}catch{}finally{for(const key of probeKeys)await deleteKey(key).catch(()=>{});}
  const marketHealth=await licensedMarketHealth();
  const checks=[
    {id:'persistence_roundtrip_verified',ok:persistenceVerified},
    {id:'licensed_market_runtime_verified',ok:marketHealth.requestOk===true},
    {id:'release_configuration',ok:release.ready===true},
    {id:'postgres_transactional_store',ok:persistence.transactionalProvider==='netlify_database'},
    {id:'persistent_artifact_store',ok:persistence.persistent===true},
    {id:'ai_gateway_configured',ok:providers?.aiGateway?.configured===true},
    {id:'licensed_market_feed_configured',ok:providers?.market?.primaryConfigured===true},
    {id:'legacy_auth_off',ok:release.legacyAuthOff===true},
    {id:'stripe_webhook_ok',ok:billing.webhookConfigured===true},
    {id:'daily_usd_cap_set',ok:release.dailyUsdCapsSet===true},
    {id:'preview_smoke_flag',ok:release.previewSmokeApproved===true},
    {id:'security_configuration',ok:security.pass===true},
    {id:'billing_runtime',ok:release.billingRequired!==true||billing.configured===true}
  ];
  const blockers=[...release.blockers,...checks.filter(x=>!x.ok).map(x=>x.id)];
  return json({
    ready:blockers.length===0,
    release,
    runtime:{persistence,aiGateway:providers?.aiGateway?.configured===true,marketConfigured:providers?.market?.configured===true,licensedFeedOk:marketHealth.requestOk===true,persistenceVerified,legacyAuthOff:release.legacyAuthOff===true,stripeWebhookOk:billing.webhookConfigured===true,dailyUsdCapSet:release.dailyUsdCapsSet===true,previewSmoke:release.previewSmokeApproved===true,securityPass:security.pass===true,billingConfigured:billing.configured===true},
    checks,
    blockers:[...new Set(blockers)],
    note:'Technical release gate only. A green result does not replace securities, privacy, tax, data-licensing, or other professional review required for the intended launch.'
  });
};
