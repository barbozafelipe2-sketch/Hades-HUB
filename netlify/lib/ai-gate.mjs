import {
  callJSONWithFailover,
  VALID_AI_ROLES,
  JSON_PROVIDER_TIMEOUT_MS,
  providerConfigured
} from './llm.mjs';
import { getEnv } from './env.mjs';

const clampText=(v,n=120000)=>String(v??'').slice(0,n);

export { callJSONWithFailover };

/** Soft ceiling for sync four-core. Background AI Mirror uses a higher wall via HADES_AI_MIRROR_TOTAL_BUDGET_MS. */
export const FOUR_CORE_TOTAL_BUDGET_MS=Math.max(16000,Math.min(55000,Number(getEnv('HADES_FOUR_CORE_TOTAL_BUDGET_MS','48000'))));

function configuredProviderCount(){
  return ['openai','anthropic','gemini'].filter(providerConfigured).length;
}
function auditProviderDiversity(rows=[]){
  const providers=[...new Set((rows||[]).map(r=>String(r?.provider||'').toLowerCase()).filter(p=>p&&p!=='skipped'&&p!=='deterministic'&&p!=='existing'))];
  const configured=configuredProviderCount();
  return {configured,providers,pass:configured<2 ? true : providers.length>=2};
}

function normalizeRole(role,fallback='primary'){
  const r=String(role||fallback);
  return VALID_AI_ROLES.includes(r)?r:fallback;
}

function remainingMs(deadlineAt){
  return Math.max(0, Number(deadlineAt||0)-Date.now());
}

function assertTime(deadlineAt,tag='AI_MIRROR_TIMEOUT'){
  if(Number.isFinite(deadlineAt) && Date.now()>=deadlineAt) throw new Error(tag);
}

/**
 * Explicit role only; each role uses a deliberate cross-provider Gateway policy with bounded failover.
 * Roles: primary|research|critic|risk|final_gate|chat|market_research (+ aliases in VALID_AI_ROLES).
 * V7.3: chat is cost-first; critic/risk roles start on independent providers; CROWN/final starts on OpenAI Sol.
 */
export async function generateJSON(prompt,{role='primary',reasoning='medium',timeoutMs,deadlineAt}={}){
  return await callJSONWithFailover({role:normalizeRole(role),prompt,reasoning,timeoutMs,deadlineAt});
}

/** CORE 2 — Devil's advocate / critic (Anthropic-first via Gateway). */
async function devilAdvocateJSON({task,candidate,criteria,timeoutMs,deadlineAt}){
  const prompt=`You are KAIROS CORE 2 — DEVIL'S ADVOCATE. Attack the candidate. Do not rewrite it. Check factual support, internal contradictions, unsupported precision, suitability to the supplied task, risk omissions, missing uncertainty, and schema/logic problems. Soft stylistic nits are NON-BLOCKING (severity low). Return ONLY JSON: {"pass":true|false,"severity":"low|moderate|high","findings":["..."],"required_fixes":["..."]}.\nTASK:\n${clampText(task,50000)}\nCRITERIA:\n${clampText(criteria,15000)}\nCANDIDATE:\n${clampText(JSON.stringify(candidate),60000)}`;
  return await callJSONWithFailover({role:'critic',prompt,timeoutMs,deadlineAt});
}

/** CORE 3 — Risk auditor (Gemini-first via Gateway). */
async function riskAuditorJSON({task,candidate,criteria,priorCores=[],timeoutMs,deadlineAt}){
  const prompt=`You are KAIROS CORE 3 — RISK AUDITOR. Search for concentration risk, regime risk, downside asymmetry, hidden assumptions, correlation risk, liquidity risk, and reasons the candidate could fail. Soft style complaints are NON-BLOCKING. Do not rewrite the candidate. Consider prior core findings. Return ONLY JSON: {"pass":true|false,"severity":"low|moderate|high","findings":["..."],"required_fixes":["..."]}.\nTASK:\n${clampText(task,42000)}\nCRITERIA:\n${clampText(criteria,14000)}\nPRIOR_CORES:\n${clampText(JSON.stringify(priorCores),20000)}\nCANDIDATE:\n${clampText(JSON.stringify(candidate),62000)}`;
  return await callJSONWithFailover({role:'risk',prompt,timeoutMs,deadlineAt});
}

/** CORE 4 — Final CROWN judge (GPT-5.6 Sol first; bounded provider fallback). */
async function finalJudge({task,candidate,critic,deterministic,criteria,cores=[],timeoutMs,deadlineAt}){
  const prompt=`You are KAIROS CORE 4 — FINAL DECISION REVIEW JUDGE for a PAPER SIMULATION model portfolio (not live orders). You are the independent final adjudication call. Do not rubber-stamp. Prefer APPROVING a conservative, schema-valid allocation that passes deterministic checks over endless abstain — as long as there are no fabricated prices, no disallowed symbols, and uncertainty is named. Soft stylistic or depth complaints are NON-BLOCKING. Reject only for hard failures: invented prices, weights/amounts that fail math, disallowed symbols, or high-severity safety/suitability contradictions. When earlier cores were time-skipped, do not punish for their absence. Judge the supplied evidence and cross-provider reviews; do not request another review loop. Return ONLY JSON: {"approved":true|false,"confidence":"HIGH|MODERATE|LOW","reasons":["..."],"redo_instructions":["..."],"blocking":true|false}.\nTASK:\n${clampText(task,45000)}\nCRITERIA:\n${clampText(criteria,15000)}\nDETERMINISTIC_CHECKS:\n${clampText(JSON.stringify(deterministic),12000)}\nFOUR_CORE_REVIEW:\n${clampText(JSON.stringify(cores),36000)}\nCRITIC:\n${clampText(JSON.stringify(critic),30000)}\nCANDIDATE:\n${clampText(JSON.stringify(candidate),65000)}`;
  return await callJSONWithFailover({
    role:'final_gate',
    prompt,
    reasoning:'high',
    timeoutMs,
    deadlineAt
  });
}

function hopBudget(deadlineAt, preferred=JSON_PROVIDER_TIMEOUT_MS){
  const left=Number.isFinite(deadlineAt)?remainingMs(deadlineAt):preferred;
  return Math.min(preferred, Math.max(5000, left-1500));
}

/**
 * V7.3 four-core audition — SEQUENTIAL, cross-provider:
 *   CORE 1 Analyst → CORE 2 Devil's advocate → CORE 3 Risk auditor → CORE 4 Final CROWN judge
 * All four must converge / pass (soft style nits non-blocking). CORE 1 is OpenAI/Terra-first, CORE 2 Anthropic-first, CORE 3 Gemini-first, and CORE 4 OpenAI/Sol-first. Each hop has bounded provider fallback.
 */
export async function runFourCoreGuardedJSONTask({task,prompt,role='primary',criteria='',validate,totalBudgetMs,deadlineAt,hopTimeoutMs,maxRedo,timeoutTag='AI_MIRROR_TIMEOUT'}={}){
  const started=Date.now();
  const budget=Number.isFinite(Number(totalBudgetMs))&&Number(totalBudgetMs)>0
    ? Math.max(8000,Math.min(120000,Number(totalBudgetMs)))
    : FOUR_CORE_TOTAL_BUDGET_MS;
  const deadline=Number.isFinite(deadlineAt)?deadlineAt:(started+budget);
  const preferredHop=Math.max(5000,Math.min(12000,Number(hopTimeoutMs||JSON_PROVIDER_TIMEOUT_MS)));
  let redoCap=Math.min(1,Math.max(0,Number(maxRedo??getEnv('SAURON_MAX_REDO','1'))));
  let attempt=0,last=null;
  const genRole=normalizeRole(role,'primary');
  while(attempt<=redoCap){
    assertTime(deadline,timeoutTag);
    const priorFixes=[...(last?.judge?.data?.redo_instructions||[]),...(last?.critic?.data?.required_fixes||[]),...((last?.cores||[]).flatMap(c=>c?.data?.required_fixes||[]))];
    const generationPrompt=attempt===0?prompt:`${prompt}\n\nThe previous candidate was REJECTED by the 4-core cross-provider audit. Rebuild from scratch. Address every audited issue:\n- ${priorFixes.join('\n- ')}`;
    const genHop=hopBudget(deadline, preferredHop);
    // CORE 1 — Analyst
    const generated=await generateJSON(generationPrompt,{role:genRole,reasoning:'medium',timeoutMs:genHop,deadlineAt:deadline});
    const deterministic=typeof validate==='function'?validate(generated.data):{pass:true,findings:[]};
    if(deterministic?.pass!==true){
      last={generated,deterministic,cores:[],critic:{data:{pass:false,findings:['deterministic_pre_gate_failed'],required_fixes:deterministic?.findings||[]},provider:'deterministic',model:null},judge:{data:{approved:false,confidence:'HIGH',reasons:deterministic?.findings||['deterministic_pre_gate_failed'],redo_instructions:deterministic?.findings||[],blocking:true},provider:'deterministic',model:null},attempt,approved:false,preGateRejected:true};
      if(remainingMs(deadline) < preferredHop+3000) redoCap=attempt;
      attempt++;
      continue;
    }
    assertTime(deadline,timeoutTag);

    let devil, risk;
    let coresSkipped=false;
    if(remainingMs(deadline) < preferredHop*2+4000){
      // Time-tight: skip cores 2–3; deterministic + final judge only
      coresSkipped=true;
      devil={provider:'skipped',model:null,data:{pass:true,findings:['core_skipped_time_budget'],severity:'moderate',required_fixes:[]}};
      risk={provider:'skipped',model:null,data:{pass:true,findings:['core_skipped_time_budget'],severity:'moderate',required_fixes:[]}};
    }else{
      // CORE 2 — Devil's advocate (sequential)
      const devilHop=hopBudget(deadline, preferredHop);
      devil=await devilAdvocateJSON({task,candidate:generated.data,criteria,timeoutMs:devilHop,deadlineAt:deadline});
      assertTime(deadline,timeoutTag);
      // CORE 3 — Risk auditor (sequential)
      const riskHop=hopBudget(deadline, preferredHop);
      risk=await riskAuditorJSON({
        task,
        candidate:generated.data,
        criteria,
        priorCores:[{core:'CORE_2_DEVIL',pass:devil.data?.pass===true,severity:devil.data?.severity,findings:devil.data?.findings||[]}],
        timeoutMs:riskHop,
        deadlineAt:deadline
      });
    }

    const cores=[
      {core:'CORE_1_ANALYST',provider:generated.provider,model:generated.model,pass:true,data:{pass:true,findings:[]}},
      {core:'CORE_2_DEVIL',provider:devil.provider,model:devil.model,pass:devil.data?.pass===true,data:devil.data},
      {core:'CORE_3_RISK',provider:risk.provider,model:risk.model,pass:risk.data?.pass===true,data:risk.data}
    ];
    assertTime(deadline,timeoutTag);
    const judgeHop=hopBudget(deadline, preferredHop);
    const judgeCriteria=coresSkipped
      ? `${criteria}\nNOTE: Devil/Risk cores were time-skipped under wall budget (auto-pass informational only). Do not reject solely because those cores did not run. Approve if deterministic checks pass and the candidate is coherent/suitable.`
      : criteria;
    // CORE 4 — Final CROWN judge
    const judge=await finalJudge({
      task,
      candidate:generated.data,
      critic:devil.data,
      deterministic,
      criteria:judgeCriteria,
      cores:[...cores,{core:'CORE_4_JUDGE_PENDING',pass:null}],
      timeoutMs:judgeHop,
      deadlineAt:deadline
    });
    cores.push({core:'CORE_4_JUDGE',provider:judge.provider,model:judge.model,pass:judge.data?.approved===true,data:judge.data});

    const devilPass=devil?.data?.pass===true;
    const riskPass=risk?.data?.pass===true;
    const judgePass=judge?.data?.approved===true;
    const devilSeverity=String(devil?.data?.severity||'').toLowerCase();
    const riskSeverity=String(risk?.data?.severity||'').toLowerCase();
    // Low-severity stylistic findings are advisory. Moderate/high findings are not.
    const devilAccept=coresSkipped || devilPass || devilSeverity==='low';
    const riskAccept=coresSkipped || riskPass || riskSeverity==='low';

    const diversity=auditProviderDiversity([generated,devil,risk,judge]);
    // FINAL means final: the judge MUST approve. When 2+ providers are configured,
    // a supposedly cross-provider council must actually contain >=2 provider families.
    const approved=deterministic?.pass===true && devilAccept && riskAccept && judgePass && diversity.pass;
    const conservativeRelease=false;
    const softNote=approved && (!devilPass || !riskPass)
      ? 'approved_with_low_severity_advisories'
      : null;
    last={generated,deterministic,cores,critic:devil,judge,attempt,approved,coresSkipped,conservativeRelease,softNote,providerDiversity:diversity,timing:{elapsedMs:Date.now()-started,budgetMs:budget},gate:'gateway_cross_provider_4core_strict'};
    if(approved) return last;
    if(remainingMs(deadline) < preferredHop*2+4000){
      last.redoSkipped='time_budget';
      return last;
    }
    attempt++;
  }
  return last;
}

/** Lighter gate for chat/wallet: generator → independent critic → final judge. */
export async function runGuardedJSONTask({task,prompt,role='primary',criteria='',validate,totalBudgetMs,deadlineAt,hopTimeoutMs,maxRedo,timeoutTag='GATE_TIMEOUT'}={}){
  const started=Date.now();
  const budget=Number.isFinite(Number(totalBudgetMs))&&Number(totalBudgetMs)>0
    ? Math.max(8000,Math.min(24000,Number(totalBudgetMs)))
    : null;
  const deadline=Number.isFinite(deadlineAt)?deadlineAt:(budget?started+budget:null);
  const preferredHop=Math.max(5000,Math.min(12000,Number(hopTimeoutMs||JSON_PROVIDER_TIMEOUT_MS)));
  let redoCap=Math.min(1,Math.max(0,Number(maxRedo??getEnv('SAURON_MAX_REDO','1'))));
  let attempt=0, last=null;
  const genRole=normalizeRole(role,'primary');
  while(attempt<=redoCap){
    if(deadline) assertTime(deadline,timeoutTag);
    const generationPrompt=attempt===0?prompt:`${prompt}\n\nA previous candidate was REJECTED. Rebuild from scratch and explicitly fix these issues:\n${(last?.judge?.data?.redo_instructions||last?.judge?.data?.reasons||last?.critic?.data?.required_fixes||[]).join('\n- ')}`;
    const genHop=deadline?hopBudget(deadline, preferredHop):preferredHop;
    const generated=await generateJSON(generationPrompt,{role:genRole,reasoning:'medium',timeoutMs:genHop,deadlineAt:deadline||undefined});
    const deterministic=typeof validate==='function'?validate(generated.data):{pass:true,findings:[]};
    if(deterministic?.pass!==true){
      last={generated,deterministic,critic:{data:{pass:false,findings:['deterministic_pre_gate_failed'],required_fixes:deterministic?.findings||[]},provider:'deterministic',model:null},judge:{data:{approved:false,confidence:'HIGH',reasons:deterministic?.findings||['deterministic_pre_gate_failed'],redo_instructions:deterministic?.findings||[],blocking:true},provider:'deterministic',model:null},attempt,approved:false,preGateRejected:true};
      if(deadline && remainingMs(deadline) < preferredHop+3000) redoCap=attempt;
      attempt++;
      continue;
    }
    if(deadline) assertTime(deadline,timeoutTag);
    const criticHop=deadline?hopBudget(deadline, preferredHop):preferredHop;
    const critic=await devilAdvocateJSON({task,candidate:generated.data,criteria,timeoutMs:criticHop,deadlineAt:deadline||undefined});
    if(deadline) assertTime(deadline,timeoutTag);
    const judgeHop=deadline?hopBudget(deadline, preferredHop):preferredHop;
    const judge=await finalJudge({task,candidate:generated.data,critic:critic.data,deterministic,criteria,timeoutMs:judgeHop,deadlineAt:deadline||undefined});
    const criticPass=critic?.data?.pass===true;
    const judgePass=judge?.data?.approved===true;
    const criticSeverity=String(critic?.data?.severity||'').toLowerCase();
    const criticAccept=criticPass || criticSeverity==='low';
    const diversity=auditProviderDiversity([generated,critic,judge]);
    // No environment flag can soften a final rejection. If multiple providers are
    // configured, the guarded gate must include actual independent-provider review.
    const approved=deterministic?.pass===true && criticAccept && judgePass && diversity.pass;
    const conservativeRelease=false;
    const softNote=approved && !criticPass ? 'approved_with_low_severity_advisory' : null;
    last={generated,deterministic,critic,judge,attempt,approved,conservativeRelease,softNote,providerDiversity:diversity,gate:'gateway_cross_provider_guarded_strict'};
    if(approved) return last;
    if(deadline && remainingMs(deadline) < preferredHop*2+3000){
      last.redoSkipped='time_budget';
      return last;
    }
    attempt++;
  }
  return last;
}

export function publicGateMeta(result){
  if(!result) return null;
  const reasons=[];
  if(result.approved!==true){
    for(const r of (result.judge?.data?.reasons||[])) if(r) reasons.push(String(r));
    for(const r of (result.critic?.data?.findings||[])) if(r && !reasons.includes(String(r))) reasons.push(String(r));
    for(const c of (result.cores||[])){
      if(c.pass===false){
        for(const f of (c.data?.findings||[])) if(f && !reasons.includes(String(f))) reasons.push(String(f));
      }
    }
    for(const r of (result.deterministic?.findings||[])) if(r && !reasons.includes(String(r))) reasons.push(String(r));
    if(result.preGateRejected) reasons.unshift('deterministic_pre_gate_failed');
  }
  return {
    approved:result.approved===true,
    attempts:Number(result.attempt||0)+1,
    gate:result.gate||'gateway_cross_provider_4core',
    generator:{provider:result.generated?.provider||null,model:result.generated?.model||null},
    cores:(result.cores||[]).map(c=>({core:c.core,provider:c.provider||null,model:c.model||null,pass:c.pass===true})),
    critic:{provider:result.critic?.provider||null,model:result.critic?.model||null,pass:result.critic?.data?.pass===true,severity:result.critic?.data?.severity||null},
    final:{provider:result.preGateRejected?'deterministic':(result.judge?.provider||null),model:result.judge?.model||null,approved:result.judge?.data?.approved===true,confidence:result.judge?.data?.confidence||null,blocking:result.judge?.data?.blocking===true},
    deterministic:result.deterministic||null,
    rejectionReasons:reasons.slice(0,12),
    timing:result.timing||null,
    redoSkipped:result.redoSkipped||null,
    coresSkipped:result.coresSkipped===true,
    conservativeRelease:result.conservativeRelease===true,
    softNote:result.softNote||null,
    auditMode:'NETLIFY_AI_GATEWAY_CROSS_PROVIDER',
    independentProviderAudit:result.providerDiversity?.pass ?? (new Set((result.cores||[]).map(c=>c.provider).filter(p=>p&&p!=='skipped'&&p!=='deterministic')).size>1 || (!!result.critic?.provider && !!result.judge?.provider && result.critic.provider!==result.judge.provider)),
    providerDiversity:result.providerDiversity||null,
    auditSkipped:result.skipped===true,
    auditStatus:result.skipped===true?'SKIPPED_OR_SINGLE_PASS':(result.approved===true?'APPROVED':'REJECTED')
  };
}

export async function auditExistingJSON({task,candidate,criteria='',validate,redoPrompt=null,role='primary',deadlineAt,hopTimeoutMs}={}){
  const preferredHop=Math.max(5000,Math.min(12000,Number(hopTimeoutMs||JSON_PROVIDER_TIMEOUT_MS)));
  const criticHop=deadlineAt?hopBudget(deadlineAt, preferredHop):preferredHop;
  const deterministic=typeof validate==='function'?validate(candidate):{pass:true,findings:[]};
  const critic=await devilAdvocateJSON({task,candidate,criteria,timeoutMs:criticHop,deadlineAt});
  if(deadlineAt) assertTime(deadlineAt,'CHAT_AUDIT_TIMEOUT');
  const judgeHop=deadlineAt?hopBudget(deadlineAt, preferredHop):preferredHop;
  const judge=await finalJudge({task,candidate,critic:critic.data,deterministic,criteria,timeoutMs:judgeHop,deadlineAt});
  const approved=deterministic?.pass===true && critic?.data?.pass===true && judge?.data?.approved===true;
  if(approved) return {generated:{data:candidate,provider:'existing',model:null},deterministic,critic,judge,attempt:0,approved:true};
  if(redoPrompt){
    return await runGuardedJSONTask({task,prompt:`${redoPrompt}\n\nThe previous candidate was rejected. Fix these issues:\n${(judge?.data?.redo_instructions||judge?.data?.reasons||critic?.data?.required_fixes||[]).join('\n- ')}`,role:normalizeRole(role),criteria,validate,deadlineAt,hopTimeoutMs:preferredHop});
  }
  return {generated:{data:candidate,provider:'existing',model:null},deterministic,critic,judge,attempt:0,approved:false};
}
