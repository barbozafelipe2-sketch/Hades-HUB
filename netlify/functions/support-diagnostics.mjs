import { requireSession, requireRole, commercialReleaseState } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { configurePersistenceForRequest, persistenceStatus } from '../lib/store.mjs';
import { commercialStatus } from '../lib/commercial-control.mjs';
import { providerStatus } from '../lib/providers.mjs';
import { stripeBillingConfig } from '../lib/stripe-billing.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req); if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='GET') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ requireRole(session,['owner']); }catch{return json({error:'FORBIDDEN'},403);}
  const commercial=await commercialStatus(session);
  const providers=providerStatus();
  return json({
    generatedAt:new Date().toISOString(),
    requestId:context?.requestId||req.headers.get('x-nf-request-id')||null,
    release:'7.3.0-commercial-hardening',
    tenant:{id:session.tenantId,role:session.role},
    commercial,
    persistence:persistenceStatus(),
    billingCapabilities:stripeBillingConfig(),
    releaseGate:commercialReleaseState(),
    providerReadiness:{
      aiGateway:providers?.aiGateway?.configured===true,
      openai:providers?.openai?.configured===true,
      anthropic:providers?.anthropic?.configured===true,
      gemini:providers?.gemini?.configured===true,
      marketConfigured:providers?.market?.configured===true,
    },
    note:'Sanitized support diagnostics only. No passwords, provider keys, prompts, portfolio positions, or raw customer financial data are included.'
  });
};
