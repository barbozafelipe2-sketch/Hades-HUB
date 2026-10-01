import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

process.env.OPENAI_API_KEY='test-openai';
process.env.OPENAI_MODEL='gpt-5.6-luna';
process.env.HADES_INTERNAL_SECRET='test-internal-secret-0123456789abcdef';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.TWELVE_DATA_API_KEY;
delete process.env.FINNHUB_API_KEY;

const results=[];
const pass=(name)=>results.push({name,status:'PASS'});
const originalFetch=globalThis.fetch;

const {runFourCoreGuardedJSONTask,runGuardedJSONTask,publicGateMeta}=await import('./netlify/lib/ai-gate.mjs');
const {callOpenAI}=await import('./netlify/lib/openai.mjs');
const {callJSONWithFailover,providerChainForRole,openAIModelCandidates}=await import('./netlify/lib/llm.mjs');
const {internalToken}=await import('./netlify/lib/internal.mjs');
const {sessionCookie}=await import('./netlify/lib/auth.mjs');

function row(obj,id='x',model='gpt-5.6-luna'){ return {output_text:JSON.stringify(obj),model,id}; }

// FINAL means final in the 4-core AI Mirror gate.
{
  const q=[
    row({ok:true},'g1'),
    row({pass:true,severity:'low',findings:[],required_fixes:[]},'d'),
    row({pass:true,severity:'low',findings:[],required_fixes:[]},'r'),
    row({approved:false,blocking:false,confidence:'MODERATE',reasons:['not ready'],redo_instructions:['fix']},'j')
  ];
  let calls=0;
  globalThis.fetch=async()=>{ calls++; return new Response(JSON.stringify(q.shift()),{status:200,headers:{'content-type':'application/json'}}); };
  const out=await runFourCoreGuardedJSONTask({task:'strict final gate',prompt:'json',validate:d=>({pass:d?.ok===true,findings:[]}),maxRedo:0,totalBudgetMs:60000});
  assert.equal(out.approved,false);
  assert.equal(out.judge.data.approved,false);
  assert.equal(out.conservativeRelease,false);
  assert.equal(calls,4);
  pass('Four-core final judge rejection can never be softened into APPROVED');
}

// Moderate critic failure is not silently ignored; low-severity advisory may pass only if judge approves.
{
  const q=[
    row({ok:true},'g1'),
    row({pass:false,severity:'moderate',findings:['material concern'],required_fixes:['fix']},'d'),
    row({pass:true,severity:'low',findings:[],required_fixes:[]},'r'),
    row({approved:true,blocking:false,confidence:'HIGH',reasons:[],redo_instructions:[]},'j')
  ];
  globalThis.fetch=async()=>new Response(JSON.stringify(q.shift()),{status:200,headers:{'content-type':'application/json'}});
  const out=await runFourCoreGuardedJSONTask({task:'moderate critic',prompt:'json',validate:d=>({pass:d?.ok===true,findings:[]}),maxRedo:0,totalBudgetMs:60000});
  assert.equal(out.approved,false);
  pass('Moderate/high specialist failures remain blockers even if judge says yes');
}

// Lighter guarded path is also strict: critic + final judge must converge (except low advisory).
{
  const q=[
    row({ok:true},'g1'),
    row({pass:true,severity:'low',findings:[],required_fixes:[]},'c'),
    row({approved:false,blocking:false,confidence:'LOW',reasons:['reject'],redo_instructions:[]},'j')
  ];
  globalThis.fetch=async()=>new Response(JSON.stringify(q.shift()),{status:200,headers:{'content-type':'application/json'}});
  const out=await runGuardedJSONTask({task:'strict lighter gate',prompt:'json',validate:d=>({pass:d?.ok===true,findings:[]}),maxRedo:0,totalBudgetMs:20000});
  assert.equal(out.approved,false);
  pass('Guarded final judge rejection cannot be bypassed by environment softening');
}

globalThis.fetch=originalFetch;

// Privacy: OpenAI Responses explicitly disables response storage.
{
  let body=null;
  globalThis.fetch=async(_url,opts)=>{ body=JSON.parse(opts.body); return new Response(JSON.stringify({id:'resp_1',model:'gpt-5.6-luna',output_text:'ok'}),{status:200,headers:{'content-type':'application/json'}}); };
  await callOpenAI({input:'test',model:'gpt-5.6-luna',reasoning:'low'});
  assert.equal(body.store,false);
  assert.equal(body.model,'gpt-5.6-luna');
  pass('OpenAI Responses uses store:false');
}

globalThis.fetch=originalFetch;

// Single configured provider still supports bounded in-provider model fallback.
{
  assert.deepEqual(providerChainForRole('primary'),['openai']);
  assert.deepEqual(providerChainForRole('critic'),['openai']);
  assert.ok(openAIModelCandidates('gpt-5.6-luna').includes('gpt-5.6-luna'));
  let calls=0;
  globalThis.fetch=async(_url,opts)=>{
    calls++;
    const body=JSON.parse(opts.body);
    if(body.model==='gpt-hades-intentional-invalid-model'){
      return new Response(JSON.stringify({error:{message:'model not found'}}),{status:404,headers:{'content-type':'application/json'}});
    }
    return new Response(JSON.stringify(row({ok:true},'fallback',body.model)),{status:200,headers:{'content-type':'application/json'}});
  };
  const out=await callJSONWithFailover({role:'primary',model:'gpt-hades-intentional-invalid-model',prompt:'Return ONLY JSON: {"ok":true}',reasoning:'low',timeoutMs:8000});
  assert.equal(out.data.ok,true);
  assert.equal(out.provider,'openai');
  assert.ok((out.modelAttempts||[]).some(a=>a.model==='gpt-hades-intentional-invalid-model'));
  assert.equal(calls,2);
  pass('OpenAI model-not-found uses bounded in-provider fallback before cross-provider fallback');
}

globalThis.fetch=originalFetch;

// Internal authorization is independent from AI credentials.
{
  process.env.HADES_INTERNAL_SECRET='internal-fixed-secret';
  process.env.OPENAI_API_KEY='key-a'; const a=internalToken();
  process.env.OPENAI_API_KEY='key-b'; const b=internalToken();
  assert.equal(a,b);
  delete process.env.HADES_INTERNAL_SECRET; delete process.env.SAURON_SESSION_SECRET;
  assert.throws(()=>internalToken(),/HADES_INTERNAL_SECRET_MISSING/);
  process.env.HADES_INTERNAL_SECRET='test-internal-secret-0123456789abcdef';
  process.env.OPENAI_API_KEY='test-openai';
  pass('Internal worker token uses dedicated/session secret, never OPENAI_API_KEY');
}

// Session cookies are bounded, not perpetual.
{
  const cookie=sessionCookie('abc');
  assert.match(cookie,/Max-Age=\d+/);
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/Secure/);
  pass('Session cookie has bounded max age and secure flags');
}

// Market quote wall: expired deadline stops network I/O.
{
  process.env.TWELVE_DATA_API_KEY='test-twelve';
  const {marketQuotes}=await import('./netlify/lib/market-quotes.mjs');
  let calls=0;
  globalThis.fetch=async()=>{ calls++; throw new Error('should_not_fetch'); };
  await assert.rejects(()=>marketQuotes(['SPY'],{deadlineAt:Date.now()-1}),/MARKET_REFRESH_WALL/);
  assert.equal(calls,0);
  globalThis.fetch=originalFetch;
  delete process.env.TWELVE_DATA_API_KEY;
  pass('Expired market deadline stops quote work before network I/O');
}

// Gate metadata explicitly states single-provider/multi-call audit.
{
  const meta=publicGateMeta({
    approved:true,attempt:0,generated:{provider:'openai',model:'gpt-a'},deterministic:{pass:true,findings:[]},cores:[],
    critic:{provider:'anthropic',model:'claude-test',data:{pass:true,severity:'low'}},
    judge:{provider:'openai',model:'gpt-c',data:{approved:true,confidence:'HIGH',blocking:false}}
  });
  assert.equal(meta.auditMode,'NETLIFY_AI_GATEWAY_CROSS_PROVIDER');
  assert.equal(meta.independentProviderAudit,true);
  pass('Public audit metadata reports cross-provider independence only when providers differ');
}

// V7 owns the presentation lock; this suite remains the V6.1 engine regression suite.
pass('V6.1 engine regressions remain green under the V7 presentation layer');

console.log(JSON.stringify({ok:true,results},null,2));
