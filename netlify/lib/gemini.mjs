import { getEnv, cleanSecret } from './env.mjs';

function extractText(resp){
  const parts=[];
  for(const c of resp?.candidates||[]){
    for(const p of c?.content?.parts||[]){ if(typeof p?.text==='string') parts.push(p.text); }
  }
  return parts.join('\n').trim();
}

export function geminiConfigured(){
  return !!cleanSecret(getEnv('GEMINI_API_KEY'));
}

export async function callGemini({input,model='gemini-2.5-pro',timeoutMs=12000,jsonMode=false,maxTokens=2200}={}){
  const key=cleanSecret(getEnv('GEMINI_API_KEY'));
  if(!key) throw new Error('GEMINI_API_KEY_MISSING');
  const base=String(getEnv('GOOGLE_GEMINI_BASE_URL','https://generativelanguage.googleapis.com')).replace(/\/$/,'');
  const body={
    contents:[{role:'user',parts:[{text:String(input||'')}]}],
    generationConfig:{maxOutputTokens:Math.max(256,Math.min(6000,Number(maxTokens)||2200))}
  };
  if(jsonMode) body.generationConfig.responseMimeType='application/json';
  let r,txt;
  try{
    const signal=AbortSignal.timeout(Math.max(2500,Math.min(55000,Number(timeoutMs)||12000)));
    r=await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body),signal
    });
    txt=await r.text();
  }catch(e){
    if(e?.name==='AbortError'||/aborted|timeout|TimeoutError/i.test(String(e?.message||e))) throw new Error('GEMINI_TIMEOUT');
    throw e;
  }
  if(!r.ok){
    if(r.status===401||r.status===403) throw new Error('GEMINI_AUTH_REJECTED');
    if(r.status===404 || /model.*not.*found|invalid.*model/i.test(txt||'')) throw new Error(`GEMINI_MODEL_NOT_FOUND:${model}`);
    if(r.status===429) throw new Error(`GEMINI_429:${String(txt||'').slice(0,220)}`);
    if(r.status>=500) throw new Error(`GEMINI_${r.status}:${String(txt||'').slice(0,260)}`);
    throw new Error(`GEMINI_${r.status}:${String(txt||'').slice(0,400)}`);
  }
  const resp=JSON.parse(txt);
  return {id:resp?.responseId||null,model,text:extractText(resp),citations:[],raw:resp};
}
