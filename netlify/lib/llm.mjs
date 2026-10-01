import { callOpenAI, parseJSONText, normalizedOpenAIKey } from './openai.mjs';
import { callAnthropic, anthropicConfigured } from './anthropic.mjs';
import { callGemini, geminiConfigured } from './gemini.mjs';
import { getEnv, cleanSecret, aiGatewayDetected } from './env.mjs';

const clean=(v)=>String(v||'').trim().replace(/^['"]|['"]$/g,'').trim();
const PROVIDER_FETCH_TIMEOUT_MS=Math.max(7000,Math.min(55000,Number(getEnv('HADES_PROVIDER_TIMEOUT_MS','18000'))));
export const CHAT_PROVIDER_TIMEOUT_MS=Math.max(5000,Math.min(12000,Number(getEnv('HADES_CHAT_PROVIDER_TIMEOUT_MS','8000'))));
export const JSON_PROVIDER_TIMEOUT_MS=Math.max(6000,Math.min(16000,Number(getEnv('HADES_JSON_PROVIDER_TIMEOUT_MS','10000'))));

export const OPENAI_DEFAULT_MODEL='gpt-5.6-luna';
export const OPENAI_DEEP_MODEL='gpt-5.6-terra';
export const OPENAI_FINAL_MODEL='gpt-5.6-sol';
export const ANTHROPIC_FAST_MODEL='claude-haiku-4-5';
export const ANTHROPIC_REASONING_MODEL='claude-sonnet-5';
export const GEMINI_FAST_MODEL='gemini-2.5-flash';
export const GEMINI_REASONING_MODEL='gemini-2.5-pro';

/**
 * KAIROS V7.3 hardened Gateway policy.
 * Cheap explanations start with Luna. Deep work escalates to Terra.
 * Critique/risk roles intentionally start on a different provider so the final
 * CROWN decision is not a same-model echo chamber. All provider credentials are
 * expected to be injected by Netlify AI Gateway in production.
 */
export const ROLE_PROVIDER_CHAINS=Object.freeze({
  chat:Object.freeze(['openai','gemini','anthropic']),
  coach:Object.freeze(['openai','gemini','anthropic']),
  coach_verify:Object.freeze(['gemini','anthropic','openai']),
  deep:Object.freeze(['openai','anthropic','gemini']),
  primary:Object.freeze(['openai','anthropic','gemini']),
  generate:Object.freeze(['openai','anthropic','gemini']),
  research:Object.freeze(['openai','gemini','anthropic']),
  evidence:Object.freeze(['openai','anthropic','gemini']),
  market_research:Object.freeze(['openai','gemini','anthropic']),
  critic:Object.freeze(['anthropic','gemini','openai']),
  risk:Object.freeze(['gemini','anthropic','openai']),
  scenario:Object.freeze(['gemini','anthropic','openai']),
  suitability:Object.freeze(['anthropic','openai','gemini']),
  decision_financial:Object.freeze(['openai','anthropic','gemini']),
  decision_macro:Object.freeze(['gemini','openai','anthropic']),
  decision_causal:Object.freeze(['anthropic','gemini','openai']),
  decision_evidence_attack:Object.freeze(['anthropic','openai','gemini']),
  decision_scenario_attack:Object.freeze(['gemini','anthropic','openai']),
  decision_portfolio_attack:Object.freeze(['anthropic','gemini','openai']),
  crown:Object.freeze(['openai','anthropic','gemini']),
  adjudicator:Object.freeze(['openai','anthropic','gemini']),
  final_gate:Object.freeze(['openai','anthropic','gemini'])
});
export const VALID_AI_ROLES=Object.freeze(Object.keys(ROLE_PROVIDER_CHAINS));

const MODEL_POLICY=Object.freeze({
  openai:Object.freeze({
    chat:OPENAI_DEFAULT_MODEL,coach:OPENAI_DEFAULT_MODEL,coach_verify:OPENAI_DEFAULT_MODEL,
    deep:OPENAI_DEEP_MODEL,primary:OPENAI_DEEP_MODEL,generate:OPENAI_DEEP_MODEL,
    research:OPENAI_DEEP_MODEL,evidence:OPENAI_DEEP_MODEL,market_research:OPENAI_DEEP_MODEL,
    critic:OPENAI_DEEP_MODEL,risk:OPENAI_DEEP_MODEL,scenario:OPENAI_DEEP_MODEL,suitability:OPENAI_DEEP_MODEL,
    decision_financial:OPENAI_DEEP_MODEL,decision_macro:OPENAI_DEEP_MODEL,decision_causal:OPENAI_DEEP_MODEL,
    decision_evidence_attack:OPENAI_DEEP_MODEL,decision_scenario_attack:OPENAI_DEEP_MODEL,decision_portfolio_attack:OPENAI_DEEP_MODEL,
    crown:OPENAI_FINAL_MODEL,adjudicator:OPENAI_FINAL_MODEL,final_gate:OPENAI_FINAL_MODEL,
    default:OPENAI_DEEP_MODEL
  }),
  anthropic:Object.freeze({
    chat:ANTHROPIC_FAST_MODEL,coach:ANTHROPIC_FAST_MODEL,coach_verify:ANTHROPIC_FAST_MODEL,
    deep:ANTHROPIC_REASONING_MODEL,primary:ANTHROPIC_REASONING_MODEL,generate:ANTHROPIC_REASONING_MODEL,
    research:ANTHROPIC_REASONING_MODEL,evidence:ANTHROPIC_REASONING_MODEL,market_research:ANTHROPIC_REASONING_MODEL,
    critic:ANTHROPIC_REASONING_MODEL,risk:ANTHROPIC_REASONING_MODEL,scenario:ANTHROPIC_REASONING_MODEL,suitability:ANTHROPIC_REASONING_MODEL,
    decision_financial:ANTHROPIC_REASONING_MODEL,decision_macro:ANTHROPIC_REASONING_MODEL,decision_causal:ANTHROPIC_REASONING_MODEL,
    decision_evidence_attack:ANTHROPIC_REASONING_MODEL,decision_scenario_attack:ANTHROPIC_REASONING_MODEL,decision_portfolio_attack:ANTHROPIC_REASONING_MODEL,
    crown:ANTHROPIC_REASONING_MODEL,adjudicator:ANTHROPIC_REASONING_MODEL,final_gate:ANTHROPIC_REASONING_MODEL,
    default:ANTHROPIC_REASONING_MODEL
  }),
  gemini:Object.freeze({
    chat:GEMINI_FAST_MODEL,coach:GEMINI_FAST_MODEL,coach_verify:GEMINI_FAST_MODEL,
    deep:GEMINI_REASONING_MODEL,primary:GEMINI_REASONING_MODEL,generate:GEMINI_REASONING_MODEL,
    research:GEMINI_REASONING_MODEL,evidence:GEMINI_REASONING_MODEL,market_research:GEMINI_FAST_MODEL,
    critic:GEMINI_REASONING_MODEL,risk:GEMINI_REASONING_MODEL,scenario:GEMINI_REASONING_MODEL,suitability:GEMINI_REASONING_MODEL,
    decision_financial:GEMINI_REASONING_MODEL,decision_macro:GEMINI_REASONING_MODEL,decision_causal:GEMINI_REASONING_MODEL,
    decision_evidence_attack:GEMINI_REASONING_MODEL,decision_scenario_attack:GEMINI_REASONING_MODEL,decision_portfolio_attack:GEMINI_REASONING_MODEL,
    crown:GEMINI_REASONING_MODEL,adjudicator:GEMINI_REASONING_MODEL,final_gate:GEMINI_REASONING_MODEL,
    default:GEMINI_REASONING_MODEL
  })
});

function envOverride(provider,role){
  const p=String(provider||'').toUpperCase();
  const r=String(role||'primary').toUpperCase().replace(/[^A-Z0-9]+/g,'_');
  return clean(getEnv(`HADES_${p}_${r}_MODEL`)) || clean(getEnv(`HADES_${p}_MODEL`));
}


export function outputTokenBudget(role='primary'){
  const r=String(role||'primary');
  if(r==='chat'||r==='coach'||r==='coach_verify') return 900;
  if(r==='market_research') return 1100;
  if(r==='deep'||r==='research'||r==='evidence') return 1800;
  if(r==='crown'||r==='adjudicator'||r==='final_gate') return 2600;
  if(r.startsWith('decision_')) return 1700;
  return 1800;
}

export function providerTimeoutMs(role='primary',override){
  if(Number.isFinite(Number(override)) && Number(override)>0) return Math.max(2500,Math.min(55000,Number(override)));
  const r=String(role||'');
  if(r==='chat'||r==='coach') return CHAT_PROVIDER_TIMEOUT_MS;
  if(r==='deep'||r==='research'||r==='market_research') return Math.max(JSON_PROVIDER_TIMEOUT_MS,12000);
  return JSON_PROVIDER_TIMEOUT_MS||PROVIDER_FETCH_TIMEOUT_MS;
}

export function openAIKey(){ return normalizedOpenAIKey(); }
export function providerConfigured(provider){
  const p=String(provider||'').toLowerCase();
  if(p==='openai') return !!openAIKey();
  if(p==='anthropic') return anthropicConfigured();
  if(p==='gemini') return geminiConfigured();
  return false;
}
export function anyAIConfigured(){ return ['openai','anthropic','gemini'].some(providerConfigured); }
export function gatewayConfigured(){ return aiGatewayDetected(); }

export function providerCredentialMode(provider){
  const p=String(provider||'').toLowerCase();
  const baseKey={openai:'OPENAI_BASE_URL',anthropic:'ANTHROPIC_BASE_URL',gemini:'GOOGLE_GEMINI_BASE_URL'}[p];
  const keyName={openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',gemini:'GEMINI_API_KEY'}[p];
  if(!baseKey||!keyName) return 'unsupported';
  const base=clean(getEnv(baseKey));
  const hasKey=!!cleanSecret(getEnv(keyName));
  if(hasKey && /netlify/i.test(base)) return 'netlify_gateway';
  if(hasKey) return 'manual_or_local';
  if(aiGatewayDetected()) return 'gateway_detected_credentials_missing';
  return 'missing';
}

export function modelBelongsToProvider(model,provider){
  const m=clean(model); const p=String(provider||'').toLowerCase();
  if(!m) return false;
  if(p==='openai') return /^(gpt-|o\d|chat-latest|chatgpt-)/i.test(m) && !m.includes('/');
  if(p==='anthropic') return /^claude-/i.test(m);
  if(p==='gemini') return /^gemini-/i.test(m);
  return false;
}

export function modelRegistry(){
  const out={};
  for(const provider of ['openai','anthropic','gemini']){
    out[provider]={...MODEL_POLICY[provider]};
    for(const role of VALID_AI_ROLES){
      const o=envOverride(provider,role);
      if(o && modelBelongsToProvider(o,provider)) out[provider][role]=o;
    }
  }
  return out;
}

export function resolveModelForProvider(provider,role='primary',override){
  const p=String(provider||'').toLowerCase();
  const reg=modelRegistry()[p];
  if(!reg) return undefined;
  if(override && modelBelongsToProvider(override,p)) return clean(override);
  return reg[String(role||'primary')]||reg.default;
}

/** Compatibility helper retained for old diagnostics/tests. */
export function openAIModelCandidates(preferred){
  const list=[];
  const push=(m)=>{ const x=clean(m); if(x && modelBelongsToProvider(x,'openai') && !list.includes(x)) list.push(x); };
  push(preferred);
  push(clean(getEnv('HADES_OPENAI_FALLBACK_MODEL')));
  push(OPENAI_DEEP_MODEL);
  push(OPENAI_DEFAULT_MODEL);
  push('gpt-5.4-mini');
  return list;
}

export function modelCandidatesForProvider(provider,role='primary',preferred){
  const p=String(provider||'').toLowerCase();
  const r=String(role||'primary');
  const list=[];
  const push=(m)=>{ const x=clean(m); if(x && modelBelongsToProvider(x,p) && !list.includes(x)) list.push(x); };
  push(preferred);
  push(resolveModelForProvider(p,r));
  // CROWN/final adjudication preserves capability tier. If the provider's premium
  // model is unavailable, fail over to another provider instead of silently
  // downgrading Sol -> Terra/Luna or Sonnet -> Haiku / Pro -> Flash.
  if(['crown','adjudicator','final_gate'].includes(r)) return list;
  if(p==='openai'){
    for(const m of openAIModelCandidates(resolveModelForProvider(p,r))) push(m);
  }else if(p==='anthropic'){
    push(ANTHROPIC_REASONING_MODEL); push(ANTHROPIC_FAST_MODEL);
  }else if(p==='gemini'){
    push(GEMINI_REASONING_MODEL); push(GEMINI_FAST_MODEL);
  }
  return list;
}

export function preferredChainForRole(role='primary'){
  return [...(ROLE_PROVIDER_CHAINS[String(role||'primary')]||ROLE_PROVIDER_CHAINS.primary)];
}
export function providerChainForRole(role='primary'){
  return preferredChainForRole(role).filter(providerConfigured);
}

function retryable(err){
  const m=String(err?.message||err||'');
  return /MISSING|REJECTED|AUTH|401|403|429|5\d\d|TIMEOUT|MODEL_NOT_FOUND|MODEL_JSON_PARSE_FAILED|rate.?limit|temporar|overload|credit|billing|quota|payment/i.test(m);
}
function boundedDeadline(timeoutMs,deadlineAt){
  const local=Date.now()+Math.max(2500,Number(timeoutMs)||JSON_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(deadlineAt)?Math.min(Number(deadlineAt),local):local;
}
function deadlineError(role='primary'){
  return role==='chat'||role==='coach'||role==='deep'?'CHAT_TIMEOUT':'AI_MIRROR_TIMEOUT';
}
function remaining(deadline){ return Math.max(0,Number(deadline)-Date.now()); }
function hopMs(deadline,base,leftProviders){
  const left=remaining(deadline);
  if(left<1200) return 0;
  const fair=Math.floor((left-600)/Math.max(1,leftProviders));
  return Math.max(1200,Math.min(base,fair));
}

async function callProviderText(provider,{prompt,role,model,reasoning,web,timeoutMs}){
  const candidates=modelCandidatesForProvider(provider,role,model);
  const modelAttempts=[];
  let lastErr=null;
  for(const chosen of candidates){
    try{
      if(provider==='openai'){
        const r=await callOpenAI({input:prompt,model:chosen,reasoning,web,jsonMode:false,timeoutMs,maxOutputTokens:outputTokenBudget(role)});
        return {...r,provider:'openai',modelAttempts};
      }
      // Non-OpenAI fallbacks do not receive an external web-search tool in this app.
      // They must reason only from the frozen/contextual evidence in the prompt.
      const safePrompt=web
        ? `${prompt}\n\nFALLBACK RULE: live web retrieval is unavailable on this provider call. Do not invent current facts. Use only the supplied KAIROS context/evidence and clearly state when freshness cannot be verified.`
        : prompt;
      if(provider==='anthropic') return {...await callAnthropic({input:safePrompt,model:chosen,timeoutMs,maxTokens:outputTokenBudget(role)}),provider:'anthropic',modelAttempts};
      if(provider==='gemini') return {...await callGemini({input:safePrompt,model:chosen,timeoutMs,jsonMode:false,maxTokens:outputTokenBudget(role)}),provider:'gemini',modelAttempts};
      throw new Error(`UNKNOWN_PROVIDER:${provider}`);
    }catch(e){
      lastErr=e;
      const msg=String(e?.message||e);
      modelAttempts.push({provider,model:chosen,error:msg.slice(0,260)});
      // Only model-availability errors should downgrade inside the same provider.
      // Rate limits, auth, credits and timeouts immediately move to another provider.
      if(!/MODEL_NOT_FOUND/i.test(msg)) throw e;
    }
  }
  throw lastErr||new Error(`${String(provider).toUpperCase()}_NO_MODEL_AVAILABLE`);
}


export async function callTextOnProvider(provider,{role='chat',prompt,reasoning='low',web=false,model,timeoutMs}={}){
  if(!providerConfigured(provider)) throw new Error(`${String(provider||'').toUpperCase()}_PROVIDER_NOT_CONFIGURED`);
  const r=await callProviderText(String(provider).toLowerCase(),{prompt,role,model,reasoning,web,timeoutMs:providerTimeoutMs(role,timeoutMs)});
  return {text:r.text,model:r.model||resolveModelForProvider(provider,role,model),provider:String(provider).toLowerCase(),responseId:r.id||null,citations:r.citations||[],modelAttempts:r.modelAttempts||[]};
}

async function callProviderJSON(provider,{prompt,role,model,reasoning,web,timeoutMs}){
  const candidates=modelCandidatesForProvider(provider,role,model);
  const modelAttempts=[];
  let lastErr=null;
  for(const chosen of candidates){
    try{
      let r;
      if(provider==='openai') r={...await callOpenAI({input:prompt,model:chosen,reasoning,web,jsonMode:web!==true,timeoutMs,maxOutputTokens:outputTokenBudget(role)}),provider:'openai'};
      else if(provider==='anthropic') r={...await callAnthropic({input:web?`${prompt}\n\nFALLBACK RULE: no live web tool is available on this provider call; do not invent current facts.`:prompt,model:chosen,timeoutMs,maxTokens:outputTokenBudget(role)}),provider:'anthropic'};
      else if(provider==='gemini') r={...await callGemini({input:web?`${prompt}\n\nFALLBACK RULE: no live web tool is available on this provider call; do not invent current facts.`:prompt,model:chosen,timeoutMs,jsonMode:true,maxTokens:outputTokenBudget(role)}),provider:'gemini'};
      else throw new Error(`UNKNOWN_PROVIDER:${provider}`);
      return {...r,data:parseJSONText(r.text),modelAttempts};
    }catch(e){
      lastErr=e;
      const msg=String(e?.message||e);
      modelAttempts.push({provider,model:chosen,error:msg.slice(0,260)});
      if(!/MODEL_NOT_FOUND/i.test(msg)) throw e;
    }
  }
  throw lastErr||new Error(`${String(provider).toUpperCase()}_NO_MODEL_AVAILABLE`);
}


export async function callJSONOnProvider(provider,{role='primary',prompt,reasoning='medium',web=false,model,timeoutMs}={}){
  if(!providerConfigured(provider)) throw new Error(`${String(provider||'').toUpperCase()}_PROVIDER_NOT_CONFIGURED`);
  const r=await callProviderJSON(String(provider).toLowerCase(),{prompt,role,model,reasoning,web,timeoutMs:providerTimeoutMs(role,timeoutMs)});
  return {data:r.data,text:r.text,model:r.model||resolveModelForProvider(provider,role,model),provider:String(provider).toLowerCase(),responseId:r.id||null,citations:r.citations||[],modelAttempts:r.modelAttempts||[]};
}

export async function callTextWithFailover({role='chat',prompt,reasoning='low',web=false,model,timeoutMs,deadlineAt}={}){
  const chain=providerChainForRole(role);
  if(!chain.length) throw new Error('NO_AI_PROVIDER_CONFIGURED');
  const base=providerTimeoutMs(role,timeoutMs);
  const deadline=boundedDeadline(base*Math.max(1,chain.length),deadlineAt);
  const errors=[];
  let lastErr=null;
  for(let i=0;i<chain.length;i++){
    const provider=chain[i];
    const ms=hopMs(deadline,base,chain.length-i);
    if(!ms) break;
    try{
      const r=await callProviderText(provider,{prompt,role,model,reasoning,web,timeoutMs:ms});
      return {text:r.text,model:r.model||resolveModelForProvider(provider,role,model),provider,responseId:r.id||null,citations:r.citations||[],errors,providerAttempts:errors,modelAttempts:r.modelAttempts||[]};
    }catch(e){
      lastErr=e; const msg=String(e?.message||e);
      errors.push({provider,model:resolveModelForProvider(provider,role,model),error:msg.slice(0,260)});
      if(!retryable(e)) throw e;
    }
  }
  if(Number.isFinite(deadlineAt) && Date.now()>=Number(deadlineAt)) throw new Error(deadlineError(role));
  throw lastErr||new Error(`ALL_PROVIDERS_FAILED:${errors.map(x=>`${x.provider}:${x.error}`).join(' | ').slice(0,900)}`);
}

export async function callJSONWithFailover({role='primary',prompt,model,reasoning='medium',web=false,timeoutMs,deadlineAt}={}){
  const chain=providerChainForRole(role);
  if(!chain.length) throw new Error('NO_AI_PROVIDER_CONFIGURED');
  const base=providerTimeoutMs(role,timeoutMs);
  const deadline=boundedDeadline(base*Math.max(1,chain.length),deadlineAt);
  const failoverErrors=[];
  let lastErr=null;
  for(let i=0;i<chain.length;i++){
    const provider=chain[i];
    const ms=hopMs(deadline,base,chain.length-i);
    if(!ms) break;
    try{
      const r=await callProviderJSON(provider,{prompt,role,model,reasoning:role==='crown'||role==='adjudicator'||role==='final_gate'?'high':reasoning,web,timeoutMs:ms});
      return {data:r.data,text:r.text,model:r.model||resolveModelForProvider(provider,role,model),provider,responseId:r.id||null,citations:r.citations||[],failoverErrors,providerAttempts:failoverErrors,modelAttempts:r.modelAttempts||[]};
    }catch(e){
      lastErr=e; const msg=String(e?.message||e);
      failoverErrors.push({provider,model:resolveModelForProvider(provider,role,model),error:msg.slice(0,260)});
      if(!retryable(e)) throw e;
    }
  }
  if(Number.isFinite(deadlineAt) && Date.now()>=Number(deadlineAt)) throw new Error(deadlineError(role));
  throw lastErr||new Error(`ALL_PROVIDERS_FAILED:${failoverErrors.map(x=>`${x.provider}:${x.error}`).join(' | ').slice(0,900)}`);
}

export function documentedFallbackChains(){
  return {
    final_gate:[...ROLE_PROVIDER_CHAINS.final_gate],critic:[...ROLE_PROVIDER_CHAINS.critic],risk:[...ROLE_PROVIDER_CHAINS.risk],
    research:[...ROLE_PROVIDER_CHAINS.research],evidence:[...ROLE_PROVIDER_CHAINS.evidence],primary:[...ROLE_PROVIDER_CHAINS.primary],
    chat:[...ROLE_PROVIDER_CHAINS.chat],coach_verify:[...ROLE_PROVIDER_CHAINS.coach_verify],deep:[...ROLE_PROVIDER_CHAINS.deep],market_research:[...ROLE_PROVIDER_CHAINS.market_research],
    decision_financial:[...ROLE_PROVIDER_CHAINS.decision_financial],decision_macro:[...ROLE_PROVIDER_CHAINS.decision_macro],decision_causal:[...ROLE_PROVIDER_CHAINS.decision_causal],
    note:'KAIROS V7.3 uses Netlify AI Gateway. Cheap chat starts on GPT-5.6 Luna; deep analysis uses GPT-5.6 Terra; critics/risk intentionally cross Anthropic/Gemini; final Decision Review uses GPT-5.6 Sol. Market prices/charts remain deterministic from licensed market feeds.'
  };
}
