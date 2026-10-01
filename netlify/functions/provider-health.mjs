import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import {
  providerConfigured,
  gatewayConfigured,
  resolveModelForProvider,
  providerChainForRole,
  callTextOnProvider,
  documentedFallbackChains,
  providerCredentialMode
} from '../lib/llm.mjs';
import { twelveHealth } from '../lib/twelve-data.mjs';
import { finnhubHealth } from '../lib/finnhub.mjs';
import { securityStatus } from '../lib/security-status.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { consumeWorkflowBudget } from '../lib/workflow-limit.mjs';

const PING='Reply with exactly the two characters: OK';

function isAuthFailure(msg){
  return /MISSING|REJECTED|401|403|invalid.?api.?key|authentication|permission.?denied/i.test(String(msg||''));
}
function baseResult(provider,{configured=false,authOk=false,requestOk=false,model=null,latencyMs=0,lastError=null}={}){
  return {
    provider,
    keyDetected:!!configured, // compatibility: Gateway-injected credentials count as detected
    credentialSource:providerCredentialMode(provider),
    gatewayRouted:configured&&providerCredentialMode(provider)==='netlify_gateway',
    requestOk:!!requestOk,
    authOk:!!authOk,
    model:model||null,
    latencyMs:Number(latencyMs)||0,
    lastError:lastError||null
  };
}

async function pingProvider(provider){
  const t0=Date.now();
  const configured=providerConfigured(provider);
  const model=resolveModelForProvider(provider,'chat');
  if(!configured) return baseResult(provider,{configured:false,model,lastError:`${provider.toUpperCase()}_PROVIDER_NOT_CONFIGURED`});
  try{
    const r=await callTextOnProvider(provider,{role:'chat',prompt:PING,reasoning:'low',web:false,timeoutMs:7000});
    return baseResult(provider,{configured:true,requestOk:true,authOk:true,model:r.model||model,latencyMs:Date.now()-t0});
  }catch(e){
    const msg=String(e?.message||e);
    return baseResult(provider,{configured:true,requestOk:false,authOk:!isAuthFailure(msg),model,latencyMs:Date.now()-t0,lastError:msg.slice(0,300)});
  }
}

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='GET' && req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ await consumeWorkflowBudget('provider-health',{limit:6,windowMs:10*60*1000}); }
  catch(e){ return json({error:'WORKFLOW_RATE_LIMITED',retryAfterMs:Number(e?.retryAfterMs)||null},429); }
  const body=req.method==='POST'?await readJSON(req):{};
  const url=new URL(req.url);
  const resilienceTest=body.failoverTest===true || body.resilienceTest===true || url.searchParams.get('failoverTest')==='true' || url.searchParams.get('resilienceTest')==='true';

  const [openai,anthropic,gemini,twelve,finnhub]=await Promise.all([
    pingProvider('openai'),pingProvider('anthropic'),pingProvider('gemini'),twelveHealth(),finnhubHealth()
  ]);
  const providers={openai,anthropic,gemini,twelve,finnhub};
  const aiProviders=[openai,anthropic,gemini];
  const summary={
    gatewayDetected:gatewayConfigured(),
    aiConfigured:aiProviders.filter(p=>p.keyDetected).length,
    aiVerified:aiProviders.filter(p=>p.requestOk===true).length,
    marketConfigured:[twelve,finnhub].filter(p=>p.keyDetected).length,
    marketVerified:[twelve,finnhub].filter(p=>p.requestOk===true).length,
    failed:Object.values(providers).filter(p=>p.keyDetected && p.requestOk!==true).length
  };
  const security=securityStatus();
  const resilience=resilienceTest?{
    ok:aiProviders.filter(p=>p.requestOk===true).length>=2,
    mode:'NETLIFY_AI_GATEWAY_MULTI_PROVIDER',
    verifiedProviders:aiProviders.filter(p=>p.requestOk===true).map(p=>p.provider),
    failedProviders:aiProviders.filter(p=>p.keyDetected&&p.requestOk!==true).map(p=>({provider:p.provider,error:p.lastError})),
    independentProviderCount:aiProviders.filter(p=>p.requestOk===true).length
  }:null;

  return json({
    ok:true,
    at:new Date().toISOString(),
    gateway:{
      detected:gatewayConfigured(),
      mode:'NETLIFY_AI_GATEWAY',
      manualLlmKeysRequired:false,
      providerModes:Object.fromEntries(aiProviders.map(p=>[p.provider,p.credentialSource]))
    },
    providers,
    summary:{...summary,securityPass:security.pass},
    security,
    resilience,
    failover:resilience,
    chains:documentedFallbackChains(),
    activeChains:{
      chat:providerChainForRole('chat'),deep:providerChainForRole('deep'),critic:providerChainForRole('critic'),risk:providerChainForRole('risk'),final_gate:providerChainForRole('final_gate')
    },
    note:'KAIROS V7.3 uses Netlify AI Gateway for LLM credentials/routing. Dashboard prices and charts remain sourced from Twelve Data/Finnhub. Decision Attack intentionally uses multiple model families before the final Decision Review gate.'
  });
};
export const config={path:'/.netlify/functions/provider-health'};
