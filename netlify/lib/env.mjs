const ENV_ALIASES = {
  SAURON_ADMIN_USER: "KAIROS_ADMIN_USER",
  SAURON_ADMIN_PASSWORD: "KAIROS_ADMIN_PASSWORD",
  SAURON_SESSION_SECRET: "KAIROS_SESSION_SECRET",
  SAURON_MARKET_TIME_ZONE: "KAIROS_MARKET_TIME_ZONE",
  SAURON_CATCHUP_BATCH_SIZE: "KAIROS_CATCHUP_BATCH_SIZE",
  SAURON_TRACE_MAX_SCAN_DAYS: "KAIROS_TRACE_MAX_SCAN_DAYS",
  SAURON_MAX_REDO: "KAIROS_MAX_REDO",
  SAURON_ALLOW_EPHEMERAL_WRITES: "KAIROS_ALLOW_EPHEMERAL_WRITES",
  SAURON_ALLOW_EPHEMERAL_READS: "KAIROS_ALLOW_EPHEMERAL_READS",
  HADES_INTERNAL_SECRET: "KAIROS_INTERNAL_SECRET",
  HADES_CHAT_TOTAL_BUDGET_MS: "KAIROS_CHAT_TOTAL_BUDGET_MS",
  HADES_CHAT_AUDIT_BUDGET_MS: "KAIROS_CHAT_AUDIT_BUDGET_MS",
  HADES_CHAT_PROVIDER_TIMEOUT_MS: "KAIROS_CHAT_PROVIDER_TIMEOUT_MS",
  HADES_CHAT_MAX_QUESTION_CHARS: "KAIROS_CHAT_MAX_QUESTION_CHARS",
  HADES_CHAT_MAX_BODY_BYTES: "KAIROS_CHAT_MAX_BODY_BYTES",
  HADES_JSON_PROVIDER_TIMEOUT_MS: "KAIROS_JSON_PROVIDER_TIMEOUT_MS",
  HADES_PROVIDER_TIMEOUT_MS: "KAIROS_PROVIDER_TIMEOUT_MS",
  HADES_MARKET_REFRESH_WALL_MS: "KAIROS_MARKET_REFRESH_WALL_MS",
  HADES_SESSION_MAX_AGE_MS: "KAIROS_SESSION_MAX_AGE_MS",
  HADES_STORAGE_SCOPE: "KAIROS_STORAGE_SCOPE",
  HADES_EVOLUTION_TOTAL_BUDGET_MS: "KAIROS_EVOLUTION_TOTAL_BUDGET_MS",
  HADES_AI_MIRROR_TOTAL_BUDGET_MS: "KAIROS_AI_MIRROR_TOTAL_BUDGET_MS",
  HADES_WALLET_MIRROR_TOTAL_BUDGET_MS: "KAIROS_WALLET_MIRROR_TOTAL_BUDGET_MS",
  HADES_FOUR_CORE_TOTAL_BUDGET_MS: "KAIROS_FOUR_CORE_TOTAL_BUDGET_MS",
  HADES_TWELVE_QUOTE_CONCURRENCY: "KAIROS_TWELVE_QUOTE_CONCURRENCY",
  HADES_TWELVE_SERIES_CONCURRENCY: "KAIROS_TWELVE_SERIES_CONCURRENCY",
  HADES_TWELVE_BATCH_GAP_MS: "KAIROS_TWELVE_BATCH_GAP_MS",
  HADES_SERIES_MAX_SYMBOLS: "KAIROS_SERIES_MAX_SYMBOLS",
  HADES_OPENAI_FALLBACK_MODEL: "KAIROS_OPENAI_FALLBACK_MODEL"
};
const ENV_ALIAS_REVERSE = Object.fromEntries(Object.entries(ENV_ALIASES).map(([legacy, canonical]) => [canonical, legacy]));

function readEnv(key){
  try{
    const v = globalThis?.Netlify?.env?.get?.(key);
    if(v != null && String(v).trim() !== "") return String(v);
  }catch{}
  const v = process?.env?.[key];
  if(v != null && String(v).trim() !== "") return String(v);
  return "";
}

export function getEnv(key, fallback=""){
  const names = [ENV_ALIASES[key], ENV_ALIAS_REVERSE[key], key].filter(Boolean);
  const seen = new Set();
  for(const name of names){
    if(seen.has(name)) continue;
    seen.add(name);
    const v = readEnv(name);
    if(v) return v;
  }
  return fallback;
}


export function hasEnv(key){ return String(getEnv(key,'')).trim().length>0; }

export function cleanSecret(v){
  return String(v||'').trim().replace(/^['"]|['"]$/g,'').replace(/^Bearer\s+/i,'').trim();
}

export function aiGatewayDetected(){
  return hasEnv('NETLIFY_AI_GATEWAY_URL') ||
    /netlify/i.test(getEnv('OPENAI_BASE_URL')) ||
    /netlify/i.test(getEnv('ANTHROPIC_BASE_URL')) ||
    /netlify/i.test(getEnv('GOOGLE_GEMINI_BASE_URL'));
}

export function isNetlifyRuntime(){ return getEnv('NETLIFY')==='true' || !!getEnv('SITE_ID'); }
