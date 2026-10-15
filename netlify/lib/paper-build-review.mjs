import crypto from 'node:crypto';
import { getJSON,setJSON,withKeyLock } from './store.mjs';
import { getTransactions,saveTransactions,getMarks,saveMarks,getPortfolio } from './state.mjs';
import { buildPaperWalletFromAllocation } from './portfolio-build.mjs';
import { freshMark } from './market-authority.mjs';

const TTL_MS=2*60*1000;
const key=id=>`draft/paper-build/${id}`;
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const digest=rows=>crypto.createHash('sha256').update(canonical(rows)).digest('hex');
function publicPreview(plan){return {ok:true,dryRun:true,planId:plan.id,expiresAt:plan.expiresAt,currency:'USD',...plan.preview};}

export async function preparePaperBuild(session,options={}){
  if(!Number.isFinite(Number(options.budget))||Number(options.budget)<=0)throw new Error('BUDGET_REQUIRED');
  return withKeyLock('portfolio-ledger',async()=>{
    const prepared=await buildPaperWalletFromAllocation({...options,dryRun:true,prepare:true});
    const {preparedTransactions,preparedMarks,initialTransactions,...preview}=prepared;
    const plan={id:crypto.randomUUID(),userId:session.userId,status:'PREPARED',expiresAt:new Date(Date.now()+TTL_MS).toISOString(),ledgerHash:digest(initialTransactions),transactions:preparedTransactions,marks:preparedMarks,preview};
    await setJSON(key(plan.id),plan);
    return publicPreview(plan);
  });
}

export async function confirmPaperBuild(session,planId){
  if(!/^[a-f0-9-]{36}$/i.test(String(planId||'')))throw new Error('PAPER_BUILD_PLAN_REQUIRED');
  return withKeyLock('portfolio-ledger',async()=>{
    const plan=await getJSON(key(planId),null);
    if(!plan||plan.userId!==session.userId)throw new Error('PAPER_BUILD_PLAN_NOT_FOUND');
    if(plan.status==='COMPLETE')return {...plan.result,idempotent:true};
    const current=await getTransactions();
    const byId=new Map(current.map(t=>[t.id,t]));
    const existing=plan.transactions.filter(t=>byId.has(t.id));
    if(existing.some(t=>digest(byId.get(t.id))!==digest(t)))throw new Error('PAPER_BUILD_TRANSACTION_CONFLICT');
    if(existing.length&&existing.length!==plan.transactions.length)throw new Error('PAPER_BUILD_PARTIAL_LEDGER');
    const alreadyApplied=existing.length===plan.transactions.length;
    if(!alreadyApplied){
      if(Date.now()>Date.parse(plan.expiresAt))throw new Error('PAPER_BUILD_PLAN_EXPIRED');
      if(digest(current)!==plan.ledgerHash)throw new Error('PAPER_BUILD_LEDGER_CHANGED');
      const currentMarks=await getMarks();
      for(const buy of plan.preview.buys){
        const approved=freshMark(plan.marks,buy.symbol);
        if(!approved)throw new Error('LICENSED_FRESH_MARK_REQUIRED');
        const latest=currentMarks[buy.symbol];
        if(latest&&(!freshMark(currentMarks,buy.symbol)||Number(latest.price)!==buy.unitPrice))throw new Error('PAPER_BUILD_PRICE_CHANGED');
      }
      await saveTransactions([...current,...plan.transactions]);
    }
    // Recover a lost response without duplicating fills or overwriting newer marks.
    const marks=await getMarks();
    for(const buy of plan.preview.buys){
      const approved=plan.marks[buy.symbol],latest=marks[buy.symbol];
      if(!latest||Date.parse(latest.asOf)<Date.parse(approved.asOf))marks[buy.symbol]=approved;
    }
    await saveMarks(marks);
    const portfolio=(await getPortfolio()).derived;
    const result={...plan.preview,ok:true,dryRun:false,planId,currency:'USD',transactionsAdded:plan.transactions.length,portfolio,idempotent:alreadyApplied};
    await setJSON(key(planId),{...plan,status:'COMPLETE',result,completedAt:new Date().toISOString()});
    return result;
  });
}
