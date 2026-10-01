import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { getProfile,getPortfolio,getWorldState,getDecisions,modelSafeProfile,saveWalletMirror } from '../lib/state.mjs';
import { runFourCoreGuardedJSONTask, publicGateMeta } from '../lib/ai-gate.mjs';
import { normalizeJobId, declaredBodyTooLarge } from '../lib/input.mjs';
import { getJSON, setJSON, pruneJSONCollection, configurePersistenceForRequest } from '../lib/store.mjs';
import { getEnv } from '../lib/env.mjs';
import { JSON_PROVIDER_TIMEOUT_MS } from '../lib/llm.mjs';
import { beginOperationalTrace } from '../lib/ops-trace.mjs';
import { consumeWorkflowBudget } from '../lib/workflow-limit.mjs';

function validateWallet(data,positions){
  const allowed=new Set(positions.map(p=>p.symbol)); const findings=[];
  const rows=Array.isArray(data?.holdings)?data.holdings:[];
  const seen=new Set();
  for(const r of rows){ const sym=String(r?.symbol||'').toUpperCase(); if(!allowed.has(sym)) findings.push(`unknown_holding:${sym}`); if(seen.has(sym))findings.push(`duplicate:${sym}`); seen.add(sym); if(!['ADD','REDUCE','HOLD','WATCH','NO_ACTION','ABSTAIN'].includes(String(r?.action||''))) findings.push(`bad_action:${sym}`); }
  for(const p of positions) if(!seen.has(p.symbol)) findings.push(`missing_holding:${p.symbol}`);
  if(!String(data?.portfolio_report||'').trim()) findings.push('portfolio_report_missing');
  return {pass:findings.length===0,findings};
}

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  if(declaredBodyTooLarge(req,8000)) return json({error:'PAYLOAD_TOO_LARGE'},413);
  const body=await readJSON(req);
  let job; try{ job=normalizeJobId(body?.jobId); }catch(e){ return json({error:String(e.message||e)},400); }
  const jobKey=`jobs/wallet-mirror/${job}`;
  const op=beginOperationalTrace(req,context,{functionName:'wallet-mirror',jobId:job});
  const prior=await getJSON(jobKey,null);
  if(prior?.status==='COMPLETE'){ await op.finish({status:'SKIPPED_IDEMPOTENT',jobId:job}); return; }
  if(prior?.status==='RUNNING' && Date.now()-Date.parse(prior.startedAt||0)<14*60*1000){ await op.finish({status:'SKIPPED_ALREADY_RUNNING',jobId:job}); return; }
  try{ await consumeWorkflowBudget('wallet-mirror',{limit:4,windowMs:600000,jobId:job}); }
  catch(e){ try{await setJSON(jobKey,{id:job,status:'ERROR',error:'WORKFLOW_RATE_LIMITED',retryAfterMs:Number(e?.retryAfterMs)||null,finishedAt:new Date().toISOString()});}catch{} await op.finish({status:'RATE_LIMITED',error:e,jobId:job}); return; }
  await pruneJSONCollection('jobs/wallet-mirror/',{maxEntries:120}).catch(()=>{});
  const started=Date.now();
  const totalBudgetMs=Math.max(30000,Math.min(120000,Number(getEnv('HADES_WALLET_MIRROR_TOTAL_BUDGET_MS','90000'))));
  const hopTimeoutMs=Math.max(8000,Math.min(20000,Number(getEnv('HADES_JSON_PROVIDER_TIMEOUT_MS',String(JSON_PROVIDER_TIMEOUT_MS||12000)))));
  await setJSON(jobKey,{id:job,status:'RUNNING',startedAt:new Date().toISOString(),idempotencyKey:job});
  try{
    const [profile,portfolio,world,decisions]=await Promise.all([getProfile(),getPortfolio(),getWorldState(),getDecisions()]);
    const positions=portfolio.derived.positions.map(p=>({symbol:p.symbol,quantity:p.quantity,price:p.price,marketValue:p.marketValue,costBasis:p.costBasis,unrealizedPnL:p.unrealizedPnL,allocation:p.allocation,priceSource:p.priceSource,staleMark:p.staleMark}));
    if(!positions.length){
      await setJSON(jobKey,{id:job,status:'ERROR',error:'PORTFOLIO_EMPTY',finishedAt:new Date().toISOString()});
      await op.finish({status:'ERROR',error:new Error('PORTFOLIO_EMPTY'),jobId:job}); return;
    }
    const context={profile:modelSafeProfile(profile),portfolio:{totalValue:portfolio.derived.totalValue,cash:portfolio.derived.cash,realizedPnL:portfolio.derived.realizedPnL,unrealizedPnL:portfolio.derived.unrealizedPnL,completeMarks:portfolio.derived.completeMarks,positions},worldState:world,recentDecisions:decisions.slice(0,20).map(d=>({asset:d.asset,date:d.date,referencePrice:d.referencePrice,final:d.final,outcomes:d.outcomes}))};
    const task='Build the Wallet Mirror: analyze the customer actual mirrored portfolio, explain what KAIROS would do with the same wallet, provide conditional outlooks, risks, concentration feedback, and a complete report without pretending to execute trades.';
    const prompt=`${task}\nUse only supplied data. Never invent prices or fundamentals. If marks are stale/incomplete, reduce confidence or ABSTAIN. Predictions are scenario-based, never guarantees. Return ONLY JSON:{"summary":"...","portfolio_outlook":"BULLISH|NEUTRAL|CAUTIOUS|BEARISH|UNKNOWN","risk_score":"LOW|MODERATE|HIGH","holdings":[{"symbol":"...","action":"ADD|REDUCE|HOLD|WATCH|NO_ACTION|ABSTAIN","outlook":"BULLISH|NEUTRAL|CAUTIOUS|BEARISH|UNKNOWN","confidence":"HIGH|MODERATE|LOW","prediction":"conditional scenario text","why":["..."],"risks":["..."]}],"concentration_feedback":["..."],"next_contribution":"...","portfolio_report":"...","unknowns":["..."]}.\nCONTEXT:\n${JSON.stringify(context).slice(0,110000)}`;
    const result=await runFourCoreGuardedJSONTask({
      task,prompt,role:'primary',criteria:'Every tracked holding represented exactly once; no fabricated live facts; mark freshness respected; actions compatible with user risk/liquidity/horizon; uncertainty explicit.',validate:(d)=>validateWallet(d,positions),
      totalBudgetMs,hopTimeoutMs,maxRedo:1,timeoutTag:'WALLET_MIRROR_TIMEOUT'
    });
    const gate=publicGateMeta(result);
    if(!result?.approved){
      const blocked={generatedAt:new Date().toISOString(),status:'BLOCKED',gate,portfolio_report:'KAIROS withheld the Wallet Mirror because the final verification gate rejected it.'};
      await saveWalletMirror(blocked);
      await setJSON(jobKey,{id:job,status:'COMPLETE',ok:false,error:'FINAL_GATE_REJECTED',gate,rejectionReasons:gate?.rejectionReasons||[],finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started});
      await op.finish({status:'BLOCKED',jobId:job,provider:result?.generated?.provider||null,model:result?.generated?.model||null}); return;
    }
    const mirror={...result.generated.data,generatedAt:new Date().toISOString(),status:'APPROVED',gate};
    await saveWalletMirror(mirror);
    await setJSON(jobKey,{id:job,status:'COMPLETE',ok:true,finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started});
    await op.finish({status:'COMPLETE',jobId:job,provider:result?.generated?.provider||null,model:result?.generated?.model||null});
  }catch(e){
    try{await setJSON(jobKey,{id:job,status:'ERROR',error:String(e.message||e),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-started});}catch{}
    await op.finish({status:'ERROR',error:e,jobId:job});
  }
};
export const config={background:true};
