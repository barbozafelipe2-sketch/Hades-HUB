import { getEnv, cleanSecret } from './env.mjs';

function extractText(resp){
  return (resp?.content||[]).map(x=>typeof x?.text==='string'?x.text:'').filter(Boolean).join('\n').trim();
}

export function anthropicConfigured(){
  return !!cleanSecret(getEnv('ANTHROPIC_API_KEY'));
}

export async function callAnthropic({input,model='claude-sonnet-5',timeoutMs=12000,maxTokens=2200}={}){
  const key=cleanSecret(getEnv('ANTHROPIC_API_KEY'));
  if(!key) throw new Error('ANTHROPIC_API_KEY_MISSING');
  const base=String(getEnv('ANTHROPIC_BASE_URL','https://api.anthropic.com')).replace(/\/$/,'');
  const body={
    model,
    max_tokens:Math.max(256,Math.min(6000,Number(maxTokens)||2200)),
    messages:[{role:'user',content:String(input||'')}]
  };
  let r,txt;
  try{
    const signal=AbortSignal.timeout(Math.max(2500,Math.min(55000,Number(timeoutMs)||12000)));
    r=await fetch(`${base}/v1/messages`,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
      body:JSON.stringify(body),signal
    });
    txt=await r.text();
  }catch(e){
    if(e?.name==='AbortError'||/aborted|timeout|TimeoutError/i.test(String(e?.message||e))) throw new Error('ANTHROPIC_TIMEOUT');
    throw e;
  }
  if(!r.ok){
    if(r.status===401||r.status===403) throw new Error('ANTHROPIC_AUTH_REJECTED');
    if(r.status===404 || /model.*not.*found|invalid.*model/i.test(txt||'')) throw new Error(`ANTHROPIC_MODEL_NOT_FOUND:${model}`);
    if(r.status===429) throw new Error(`ANTHROPIC_429:${String(txt||'').slice(0,220)}`);
    if(r.status>=500) throw new Error(`ANTHROPIC_${r.status}:${String(txt||'').slice(0,260)}`);
    throw new Error(`ANTHROPIC_${r.status}:${String(txt||'').slice(0,400)}`);
  }
  const resp=JSON.parse(txt);
  return {id:resp?.id||null,model:resp?.model||model,text:extractText(resp),citations:[],raw:resp};
}
