import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { getProfile,getPortfolio,getWorldState,modelSafeProfile,saveAIMirror } from '../lib/state.mjs';
import { buildUniverseView } from '../lib/market-universe.mjs';
import { runFourCoreGuardedJSONTask, publicGateMeta } from '../lib/ai-gate.mjs';
import { JSON_PROVIDER_TIMEOUT_MS } from '../lib/llm.mjs';
import { beginOperationalTrace } from '../lib/ops-trace.mjs';
import { consumeWorkflowBudget } from '../lib/workflow-limit.mjs';
import { setJSON, getJSON, pruneJSONCollection, configurePersistenceForRequest } from '../lib/store.mjs';
import { getEnv } from '../lib/env.mjs';
import { normalizeJobId, declaredBodyTooLarge } from '../lib/input.mjs';

function validateAIMirror(data,budget,allowed){
  const findings=[]; const rows=Array.isArray(data?.allocation)?data.allocation:[];
  if(!rows.length) findings.push('allocation_missing');
  let weights=0, amounts=0;
  for(const r of rows){
    const sym=String(r?.symbol||'').toUpperCase(); const w=Number(r?.weight_pct); const a=Number(r?.amount);
    if(!allowed.has(sym)) findings.push(`unapproved_symbol:${sym||'missing'}`);
    if(!Number.isFinite(w)||w<0||w>100) findings.push(`bad_weight:${sym}`); else weights+=w;
    if(!Number.isFinite(a)||a<0||a>budget*1.01) findings.push(`bad_amount:${sym}`); else amounts+=a;
  }
  if(rows.length && Math.abs(weights-100)>1) findings.push(`weights_sum_${weights.toFixed(2)}`);
  if(rows.length && Math.abs(amounts-budget)>Math.max(1,budget*0.015)) findings.push(`amounts_sum_${amounts.toFixed(2)}`);
  if(!String(data?.report||'').trim()) findings.push('report_missing');
  return {pass:findings.length===0,findings,weights:Math.round(weights*100)/100,amounts:Math.round(amounts*100)/100};
}

function mapMirrorError(e){
  const m=String(e?.message||e||'');
  if(/AI_MIRROR_TIMEOUT/i.test(m)) return {error:'AI_MIRROR_TIMEOUT', http:504};
  if(/MODEL_NOT_FOUND|OPENAI_MODEL_NOT_FOUND/i.test(m)) return {error:m, http:502};
  if(/billing|insufficient_quota|credit|payment|429/i.test(m)) return {error:m, http:502};
  if(/\b400\b|invalid_request|ALL_PROVIDERS_FAILED/i.test(m)) return {error:m, http:502};
  if(/_TIMEOUT|504|NO_AI_PROVIDER/i.test(m)) return {error:m, http:504};
  return {error:m, http:500};
}

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  if(declaredBodyTooLarge(req,16000)) return json({error:'PAYLOAD_TOO_LARGE'},413);
  const body=await readJSON(req); const budget=Math.max(1,Math.min(100000000,Number(body.budget||0)));
  if(!Number.isFinite(budget)||budget<=0) return json({error:'BUDGET_REQUIRED'},400);
  const focus=String(body.focus||'all').toLowerCase();
  let job; try{ job=normalizeJobId(body.jobId); }catch(e){ return json({error:String(e.message||e)},400); }
  const op=beginOperationalTrace(req,context,{functionName:'ai-mirror',jobId:job});
  const jobKey=`jobs/ai-mirror/${job}`;
  const prior=await getJSON(jobKey,null);
  if(prior?.status==='COMPLETE'){ await op.finish({status:'SKIPPED_IDEMPOTENT',jobId:job}); return; }
  if(prior?.status==='RUNNING' && Date.now()-Date.parse(prior.startedAt||0)<14*60*1000){ await op.finish({status:'SKIPPED_ALREADY_RUNNING',jobId:job}); return; }
  try{ await consumeWorkflowBudget('ai-mirror',{limit:4,windowMs:600000,jobId:job}); }
  catch(e){ try{await setJSON(jobKey,{id:job,status:'ERROR',error:'WORKFLOW_RATE_LIMITED',retryAfterMs:Number(e?.retryAfterMs)||null,finishedAt:new Date().toISOString()});}catch{} await op.finish({status:'RATE_LIMITED',error:e,jobId:job}); return; }
  await pruneJSONCollection('jobs/ai-mirror/',{maxEntries:120}).catch(()=>{});
  const started=Date.now();
  // Background path: generous wall (default 90s, env up to 120s) — Netlify background allows long runs.
  const totalBudgetMs=Math.max(30000,Math.min(120000,Number(getEnv('HADES_AI_MIRROR_TOTAL_BUDGET_MS','90000'))));
  const hopTimeoutMs=Math.max(8000,Math.min(20000,Number(getEnv('HADES_JSON_PROVIDER_TIMEOUT_MS',String(JSON_PROVIDER_TIMEOUT_MS||12000)))));
  await setJSON(jobKey,{id:job,status:'RUNNING',budget,focus,startedAt:new Date().toISOString()});
  try{
    const [profile,portfolio,world,universe]=await Promise.all([getProfile(),getPortfolio(),getWorldState(),buildUniverseView()]);
    const selected=focus==='all'?universe:universe.filter(x=>x.id===focus||x.kind.toLowerCase()===focus);
    if(!selected.length){
      await setJSON(jobKey,{id:job,status:'ERROR',error:'UNKNOWN_INVESTMENT_FOCUS',finishedAt:new Date().toISOString()});
      await op.finish({status:'ERROR',error:new Error('UNKNOWN_INVESTMENT_FOCUS'),jobId:job}); return;
    }
    const allowed=new Set(selected.map(x=>x.symbol));
    const context={budget,currency:profile.baseCurrency,focus,profile:modelSafeProfile(profile),currentPortfolio:{totalValue:portfolio.derived.totalValue,cash:portfolio.derived.cash,positions:portfolio.derived.positions.map(p=>({symbol:p.symbol,marketValue:p.marketValue,allocation:p.allocation}))},worldState:world,investmentUniverse:selected.map(x=>({id:x.id,label:x.label,symbol:x.symbol,kind:x.kind,current:x.current,periodReturn:x.periodReturn,historyPoints:x.series.length,description:x.description}))};
    const task=`Build KAIROS AI Mirror: how the system would allocate exactly the user's mirrored budget of ${budget} ${profile.baseCurrency}, using only the allowed investment universe. This is a model portfolio for comparison, not an order ticket.`;
    const prompt=`${task}\nUse the supplied context only. Never invent a live price. Missing data must be named as uncertainty. Do not promise returns. Scenario predictions must be qualitative and conditional. The allocation weights must total 100 and amounts must total the budget. Return ONLY JSON with this shape:{"budget":number,"currency":"...","stance_summary":"...","allocation":[{"symbol":"...","asset_class":"...","weight_pct":number,"amount":number,"role":"...","outlook":"BULLISH|NEUTRAL|CAUTIOUS|BEARISH|UNKNOWN","confidence":"HIGH|MODERATE|LOW","why":["..."],"risks":["..."]}],"scenario":{"base":"...","bull":"...","bear":"..."},"report":"...","unknowns":["..."]}.\nCONTEXT:\n${JSON.stringify(context).slice(0,40000)}`;
    const result=await runFourCoreGuardedJSONTask({
      task,
      prompt,
      role:'primary',
      criteria:'No fabricated prices; weights=100%; amounts equal budget; suitability respects risk/liquidity/horizon; uncertainty explicit; only allowed symbols.',
      validate:(d)=>validateAIMirror(d,budget,allowed),
      totalBudgetMs,
      hopTimeoutMs,
      maxRedo:1,
      timeoutTag:'AI_MIRROR_TIMEOUT'
    });
    const gate=publicGateMeta(result);
    if(!result?.approved){
      const reasons=gate?.rejectionReasons||[];
      const reasonText=reasons.length?reasons.slice(0,6).join(' · '):'Gate rejected without detailed findings — check provider health / model keys.';
      const blocked={
        generatedAt:new Date().toISOString(),budget,focus,status:'BLOCKED',gate,
        report:`KAIROS withheld the AI Mirror: ${reasonText}`,
        rejectionSummary:reasonText,
        rejectionReasons:reasons
      };
      await saveAIMirror(blocked);
      await setJSON(jobKey,{
        id:job,status:'COMPLETE',ok:false,error:'FINAL_GATE_REJECTED',
        message:`Final gate rejected: ${reasonText}`,
        rejectionReasons:reasons,
        gate,
        finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,budgetMs:totalBudgetMs
      });
      await op.finish({status:'BLOCKED',jobId:job,provider:result?.generated?.provider||null,model:result?.generated?.model||null});
      return;
    }
    const mirror={
      ...result.generated.data,
      generatedAt:new Date().toISOString(),
      focus,
      status:'APPROVED',
      gate,
      conservativeRelease:result.conservativeRelease===true,
      softNote:result.softNote||null
    };
    if(result.conservativeRelease){
      mirror.stance_summary=(mirror.stance_summary?mirror.stance_summary+' · ':'')+'Conservative paper release (deterministic checks passed).';
    }
    await saveAIMirror(mirror);
    await setJSON(jobKey,{
      id:job,status:'COMPLETE',ok:true,
      conservativeRelease:result.conservativeRelease===true,
      softNote:result.softNote||null,
      finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,budgetMs:totalBudgetMs
    });
    await op.finish({status:'COMPLETE',jobId:job,provider:result?.generated?.provider||null,model:result?.generated?.model||null});
    return;
  }catch(e){
    const mapped=mapMirrorError(e);
    const message=mapped.error==='AI_MIRROR_TIMEOUT'
      ? 'AI Mirror timed out — retry or check Netlify AI Gateway health/credits and market-data freshness'
      : (/MODEL_NOT_FOUND/i.test(String(mapped.error))
        ? `AI model route failed — verify the Netlify AI Gateway model policy. ${mapped.error}`
        : mapped.error);
    try{
      await setJSON(jobKey,{id:job,status:'ERROR',error:mapped.error,message,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started,budgetMs:totalBudgetMs});
    }catch{}
    await op.finish({status:'ERROR',error:e,jobId:job});
    return;
  }
};
export const config={background:true};
