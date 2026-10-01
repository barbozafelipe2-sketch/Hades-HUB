import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { callTextWithFailover, callJSONWithFailover, CHAT_PROVIDER_TIMEOUT_MS } from '../lib/llm.mjs';
import { getEnv } from '../lib/env.mjs';
import { publicGateMeta } from '../lib/ai-gate.mjs';
import { beginOperationalTrace } from '../lib/ops-trace.mjs';
import { getProfile,getPortfolio,getWorldState,getPerformance,getDecisions,modelSafeProfile,getEvolutionState,getAIMirror } from '../lib/state.mjs';
import {
  detectBuildWalletIntent,
  extractBudgetFromMessage,
  buildPaperWalletFromAllocation,
  formatBuildSummaryText
} from '../lib/portfolio-build.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { consumeWorkflowBudget } from '../lib/workflow-limit.mjs';

/** Soft ceiling so chat stays comfortably inside the synchronous Function wall. */
const CHAT_TOTAL_BUDGET_MS=Math.max(12000,Math.min(22000,Number(getEnv('HADES_CHAT_TOTAL_BUDGET_MS','18000'))));
const CHAT_AUDIT_BUDGET_MS=Math.max(2500,Math.min(7000,Number(getEnv('HADES_CHAT_AUDIT_BUDGET_MS','4500'))));
const MAX_QUESTION_CHARS=Math.max(2000,Math.min(20000,Number(getEnv('HADES_CHAT_MAX_QUESTION_CHARS','12000'))));
const MAX_CHAT_BODY_BYTES=Math.max(16000,Math.min(128000,Number(getEnv('HADES_CHAT_MAX_BODY_BYTES','64000'))));

function safeCitations(rows=[]){
  return (rows||[]).filter(c=>{try{const u=new URL(c?.url);return ['http:','https:'].includes(u.protocol);}catch{return false;}}).slice(0,8);
}
function validateAnswer(c){const findings=[];if(!String(c?.answer||'').trim())findings.push('answer_missing');return {pass:findings.length===0,findings};}

function classifyCoachTier(question='',body={}){
  const q=String(question||'').trim();
  const requested=String(body?.depth||body?.mode||'auto').toLowerCase();
  if(['deep','analysis','expert'].includes(requested)) return {tier:'deep',role:'deep',reason:'user_requested'};
  if(['fast','cheap','simple'].includes(requested)) return {tier:'fast',role:'chat',reason:'user_requested_fast'};
  const complex=/\b(compare|scenario|stress test|strategy|rebalance|allocation|portfolio construction|decision|crown|audit|thesis|downside|risk analysis|valuation|deep|detailed|trade[- ]?off|what should i do|best move)\b/i.test(q);
  if(q.length>700 || complex) return {tier:'deep',role:'deep',reason:q.length>700?'long_context':'complex_intent'};
  return {tier:'fast',role:'chat',reason:'routine_explanation'};
}

function isSimpleQuestion(question=''){
  const q=String(question||'').trim();
  if(q.length>220) return false;
  // Current-data / web-heavy prompts get a light audit; still single-pass generation.
  const heavy=/\b(today|current|latest|now|news|price|market|yield|fed|bitcoin|btc|ethereum|oil|gold|nasdaq|real estate|reit|allocate|portfolio|audit|crown|decision)\b/i.test(q);
  if(heavy) return false;
  return true;
}

function remainingMs(started,budget=CHAT_TOTAL_BUDGET_MS){
  return Math.max(0, budget-(Date.now()-started));
}

async function withTimeCap(promise, ms, tag='CHAT_GATE'){
  let timer;
  try{
    return await Promise.race([
      promise,
      new Promise((_,rej)=>{ timer=setTimeout(()=>rej(new Error(`${tag}_TIMEOUT`)), Math.max(500,ms)); })
    ]);
  }finally{ if(timer) clearTimeout(timer); }
}

function mapChatError(e){
  const m=String(e?.message||e||'');
  if(/ALL_PROVIDERS_FAILED|_TIMEOUT|MODEL_NOT_FOUND|NO_AI_PROVIDER|OPENAI_|ANTHROPIC_|GEMINI_/i.test(m)){
    return {error:m, http:504};
  }
  return {error:m, http:500};
}

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ await consumeWorkflowBudget('coach',{limit:30,windowMs:10*60*1000}); }
  catch(e){ return json({error:'WORKFLOW_RATE_LIMITED',retryAfterMs:Number(e?.retryAfterMs)||null},429); }
  const declaredBytes=Number(req.headers.get('content-length')||0);
  if(declaredBytes>MAX_CHAT_BODY_BYTES) return json({error:'PAYLOAD_TOO_LARGE'},413);
  const body=await readJSON(req); const question=String(body.question||'').trim();
  if(!question) return json({error:'QUESTION_REQUIRED'},400);
  if(question.length>MAX_QUESTION_CHARS) return json({error:'QUESTION_TOO_LONG',maxChars:MAX_QUESTION_CHARS},413);
  const started=Date.now();
  const op=beginOperationalTrace(req,context,{functionName:'ai-chat'});
  try{
    // --- Explicit paper-wallet build intent (server executes) ---
    if(detectBuildWalletIntent(question)){
      const [profile,mirror]=await Promise.all([getProfile(),getAIMirror()]);
      const budget=extractBudgetFromMessage(question,{
        mirrorBudget:mirror?.budget,
        contributionAmount:profile?.contributionAmount
      });
      if(!budget){
        await op.finish({status:'NEEDS_INPUT',route:'wallet-build'});
        return json({
          ok:true,
          answer:'I can apply an allocation to your paper wallet, but I need a budget (for example: “build my wallet with $10,000”). You can also open AI Mirror → Build Whole Portfolio → Apply to Wallet (paper).',
          citations:[],
          model:null,
          provider:null,
          gate:null,
          walletBuild:{needed:'budget'}
        });
      }
      try{
        const built=await buildPaperWalletFromAllocation({budget, focus:'all', source:'chat'});
        const summary=formatBuildSummaryText(built);
        await op.finish({status:'COMPLETE',route:'wallet-build',provider:'portfolio-build'});
        return json({
          ok:true,
          answer:summary,
          citations:[],
          model:null,
          provider:'portfolio-build',
          gate:null,
          walletBuild:built
        });
      }catch(be){
        const em=String(be.message||be);
        if(/AI_MIRROR_REQUIRED/.test(em)){
          await op.finish({status:'BLOCKED',route:'wallet-build',resultStatus:'AI_MIRROR_REQUIRED'});
          return json({
            ok:true,
            answer:`I understood you want a paper wallet built with budget ${budget}, but there is no approved AI Mirror allocation yet. Open AI Mirror → Build Whole Portfolio (budget ${budget}), then tap Apply to Wallet (paper) — or ask again after the mirror is approved.`,
            citations:[],
            model:null,
            provider:null,
            gate:null,
            walletBuild:{error:'AI_MIRROR_REQUIRED', budget}
          });
        }
        await op.finish({status:'ERROR',error:be,route:'wallet-build'});
        return json({ok:false, error:em, answer:`Paper wallet build failed: ${em}`},400);
      }
    }

    const [profile,portfolio,worldState,performance,decisions,evolution]=await Promise.all([getProfile(),getPortfolio(),getWorldState(),getPerformance(),getDecisions(),getEvolutionState()]);
    const context={screen:body.screen||'unknown',profile:modelSafeProfile(profile),portfolio:portfolio.derived,worldState,performance:{...performance,points:undefined},recentDecisions:decisions.slice(0,5).map(d=>({asset:d.asset,date:d.date,final:d.final,confidence:d.final?.confidence})),evolutionChampion:evolution?.champion||null};
    const current=/\b(today|current|latest|now|news|price|market|yield|fed|bitcoin|btc|ethereum|oil|gold|nasdaq|real estate|reit)\b/i.test(question);
    const simple=isSimpleQuestion(question);
    const coach=classifyCoachTier(question,body);
    const base=`You are KAIROS Private's explanation assistant. Explain charts, portfolio behavior, market regimes, mirrors, and audited decisions clearly. Use the supplied KAIROS context as the primary truth. Never invent a number. If data is missing, say it is missing. Clearly distinguish user data, stored KAIROS analysis, and web research. Do not claim that a decision was audited unless a stored audit object says so. This is decision support, not guaranteed outcome prediction. Chat never places trades; tell the user to use AI Mirror → Apply to Wallet (paper) or ask to “build my wallet with $X” when they want paper trades.\n\nCONTEXT:\n${JSON.stringify(context).slice(0,simple?40000:70000)}\n\nUSER QUESTION:\n${question}`;

    // Cost-first Gateway routing: Luna for routine explanations; Terra/deep chain only when complexity warrants it.
    const chatDeadlineAt=started+CHAT_TOTAL_BUDGET_MS-1000;
    const hopMs=Math.min(CHAT_PROVIDER_TIMEOUT_MS, Math.max(3000, remainingMs(started)-2000));
    let res=await callTextWithFailover({role:coach.role,prompt:base,web:current,reasoning:coach.tier==='deep'?'medium':'low',timeoutMs:hopMs,deadlineAt:chatDeadlineAt});
    let candidate={answer:res.text};
    let audited=null;

    const left=remainingMs(started);
    // Routine coach answers stay single-pass on Luna. Deep answers get ONE cheap, independent
    // verifier (Gemini Flash -> Claude Haiku -> Luna fallback), not the expensive CROWN stack.
    if(coach.tier==='deep' && left > 3000){
      const auditMs=Math.min(CHAT_AUDIT_BUDGET_MS, left-1200);
      try{
        const verifyPrompt=`You are KAIROS Coach Verifier. Audit the proposed answer against the supplied context. Do not rewrite it. Block only for invented numeric claims, contradictions with KAIROS data, unsupported certainty, or presenting web research as licensed market data. Return ONLY JSON {"pass":true|false,"severity":"low|moderate|high","findings":["..."],"required_fixes":["..."]}.\nQUESTION:${question.slice(0,2000)}\nANSWER:${candidate.answer.slice(0,18000)}\nCONTEXT:${JSON.stringify(context).slice(0,30000)}`;
        const vr=await withTimeCap(
          callJSONWithFailover({role:'coach_verify',prompt:verifyPrompt,reasoning:'low',web:false,timeoutMs:auditMs,deadlineAt:chatDeadlineAt}),
          auditMs,
          'CHAT_VERIFY'
        );
        const pass=vr?.data?.pass===true || String(vr?.data?.severity||'').toLowerCase()==='low';
        audited={
          approved:pass,skipped:false,generated:{data:candidate},
          deterministic:validateAnswer(candidate),
          critic:{provider:vr.provider,model:vr.model,data:vr.data},
          judge:{provider:'deterministic',model:null,data:{approved:pass,confidence:pass?'MODERATE':'LOW',reasons:vr?.data?.findings||[]}},
          attempt:0
        };
        if(!pass && remainingMs(started)>hopMs+1800){
          const fixes=(vr?.data?.required_fixes||vr?.data?.findings||[]).slice(0,6).join('\n- ');
          res=await callTextWithFailover({role:coach.role,prompt:`${base}\n\nIndependent verification found material issues. Rebuild once and correct:\n- ${fixes}`,web:false,reasoning:'medium',timeoutMs:hopMs,deadlineAt:chatDeadlineAt});
          candidate={answer:res.text};
          const det=validateAnswer(candidate);
          audited={approved:det.pass,skipped:true,reason:'single_bounded_redo_after_verifier',generated:{data:candidate},deterministic:det,critic:{data:vr.data},judge:{data:{approved:det.pass,confidence:'LOW',reasons:['redo_not_reverified_to_bound_cost']}},attempt:1};
        }
      }catch(ae){
        const det=validateAnswer(candidate);
        audited={approved:det.pass,skipped:true,reason:`cheap_verifier_unavailable:${String(ae.message||ae).slice(0,120)}`,generated:{data:candidate},deterministic:det,critic:{data:{pass:true}},judge:{data:{approved:det.pass,confidence:'LOW',reasons:['verifier_unavailable']}},attempt:0};
      }
      if(audited?.approved===false){ await op.finish({status:'BLOCKED',route:coach.role,provider:res?.provider||null,model:res?.model||null,resultStatus:'COACH_VERIFICATION_REJECTED'}); return json({ok:false,error:'COACH_VERIFICATION_REJECTED',answer:'KAIROS withheld this answer because independent verification found a material issue.',gate:publicGateMeta(audited)},422); }
    }else{
      const det=validateAnswer(candidate);
      audited={approved:det.pass, skipped:true, reason:simple?'routine_luna_single_pass':'time_budget_single_pass', generated:{data:candidate}, deterministic:det, critic:{data:{pass:true}}, judge:{data:{approved:det.pass,confidence:'MODERATE',reasons:['single_pass']}}, attempt:0};
      if(!det.pass){ await op.finish({status:'ERROR',route:coach.role,resultStatus:'ANSWER_EMPTY'}); return json({ok:false,error:'ANSWER_EMPTY',answer:'KAIROS could not produce an answer.'},422); }
    }

    await op.finish({status:'COMPLETE',route:coach.role,provider:res.provider,model:res.model,fallbackUsed:Array.isArray(res.providerAttempts)&&res.providerAttempts.length>0});
    return json({
      ok:true,
      answer:res.text,
      citations:safeCitations(res.citations),
      model:res.model,
      provider:res.provider,
      responseId:res.responseId||null,
      gate:publicGateMeta(audited),
      coachTier:coach.tier,
      routing:{reason:coach.reason,webRequested:current},
      timing:{elapsedMs:Date.now()-started, providerHopMs:hopMs, simple}
    });
  }catch(e){
    await op.finish({status:'ERROR',error:e,route:'coach'});
    const mapped=mapChatError(e);
    return json({
      ok:false,
      error:mapped.error,
      answer: /_TIMEOUT|504|ALL_PROVIDERS_FAILED|MODEL_NOT_FOUND/i.test(mapped.error)
        ? 'AI Gateway request timed out or all configured providers failed. Retry, or check Netlify AI Features/credits and provider health.'
        : `Chat failed: ${mapped.error}`,
      timing:{elapsedMs:Date.now()-started}
    }, mapped.http);
  }
};
export const config={path:'/.netlify/functions/ai-chat'};
