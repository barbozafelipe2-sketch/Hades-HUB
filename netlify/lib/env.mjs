export function getEnv(key, fallback=''){
  try{
    const v=globalThis?.Netlify?.env?.get?.(key);
    if(v!=null && String(v).trim()!=='') return String(v);
  }catch{}
  const v=process?.env?.[key];
  if(v!=null && String(v).trim()!=='') return String(v);
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
