import { documentedFallbackChains, anyAIConfigured, modelRegistry, providerConfigured, gatewayConfigured } from './llm.mjs';
import { getEnv, hasEnv } from './env.mjs';
import { licensedMarketConfigured } from './market-truth.mjs';

export function providerStatus(){
  const supabase=hasEnv('SUPABASE_URL')&&hasEnv('SUPABASE_ANON_KEY');
  const twelve=hasEnv('TWELVE_DATA_API_KEY');
  const finnhub=hasEnv('FINNHUB_API_KEY');
  const genericMarket=hasEnv('MARKET_DATA_API_KEY')&&hasEnv('MARKET_DATA_BASE_URL')&&hasEnv('MARKET_DATA_PROVIDER');
  const licensedPrimary=licensedMarketConfigured();
  const marketConfigured=licensedPrimary||twelve||finnhub||genericMarket;
  const aiOk=anyAIConfigured();
  const gateway=gatewayConfigured();
  const chains=documentedFallbackChains();
  const reg=modelRegistry();
  let marketProvider=null;
  if(licensedPrimary) marketProvider='licensed_market_feed';
  else if(twelve&&finnhub) marketProvider='twelve_data+finnhub_sticky';
  else if(twelve) marketProvider='twelve_data';
  else if(finnhub) marketProvider='finnhub';
  else if(genericMarket) marketProvider=getEnv('MARKET_DATA_PROVIDER');
  return {
    aiGateway:{configured:gateway,role:'credential_and_routing_layer',manualProviderKeysRequired:false},
    openai:{configured:providerConfigured('openai'),verified:false,role:'coach_lead_deep_crown',models:reg.openai},
    anthropic:{configured:providerConfigured('anthropic'),verified:false,role:'independent_critic_and_risk_review',models:reg.anthropic},
    gemini:{configured:providerConfigured('gemini'),verified:false,role:'scenario_macro_and_risk_review',models:reg.gemini},
    supabase:{configured:supabase,serviceRoleConfigured:hasEnv('SUPABASE_SERVICE_ROLE_KEY'),implemented:false,role:'reserved_customer_auth_database_password_recovery'},
    market:{
      configured:marketConfigured,primaryConfigured:licensedPrimary,verified:false,provider:marketProvider,
      twelve,finnhub,shard:null,
      role:'licensed_market_feed_ohlc_only',fallback:null,
      dataClass:marketConfigured?'licensed_feed_configured_unverified':'unavailable',
      note:'The owner licensed API is primary. Twelve Data, then Finnhub, are sticky per-symbol fallbacks. LLMs never manufacture market numbers.'
    },
    finalGate:{
      configured:aiOk,preferred:'openai',chain:chains.final_gate,researchChain:chains.research,criticChain:chains.critic,riskChain:chains.risk,chatChain:chains.chat,
      maxRedo:Math.min(1,Math.max(0,Number(getEnv('SAURON_MAX_REDO','1')))),
      role:'cross_provider_crown_with_deterministic_pre_gate',fourCore:['CORE_1_ANALYST','CORE_2_DEVIL','CORE_3_RISK','CORE_4_JUDGE']
    },
    fallbackChains:chains,
    aiNote:chains.note,
    mode:marketConfigured&&aiOk?'FULL_MARKET_STACK':aiOk?'AI_ONLY':'LIMITED_NO_AI'
  };
}
