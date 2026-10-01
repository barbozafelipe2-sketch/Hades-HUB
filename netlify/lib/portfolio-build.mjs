/**
 * Apply an AI Mirror (or budget) allocation into the paper wallet as DEPOSIT + BUY txs.
 * Simulation only — never invents prices; skips symbols without a known mark/research close.
 */
import { getTransactions, saveTransactions, getMarks, saveMarks, getAIMirror, getProfile, getPortfolio } from './state.mjs';
import { normalizeTransaction, derivePortfolio, todayISO } from './portfolio.mjs';
import { withKeyLock } from './store.mjs';
import { buildUniverseView, UNIVERSE_SYMBOLS } from './market-universe.mjs';
import {
  detectBuildWalletIntent,
  extractBudgetFromMessage,
  resolveKnownPrice,
  moneyRound,
  scaleAllocation,
  formatBuildSummaryText
} from './portfolio-build-helpers.mjs';

export {
  detectBuildWalletIntent,
  extractBudgetFromMessage,
  resolveKnownPrice,
  formatBuildSummaryText
};

/**
 * @param {{budget?:number, focus?:string, source?:'ai-mirror'|'chat'|'budget', allocation?:array, dryRun?:boolean}} opts
 */
async function buildPaperWalletFromAllocationUnlocked(opts={}){
  const source=String(opts.source||'ai-mirror');
  const focus=String(opts.focus||'all').toLowerCase();
  const profile=await getProfile();
  const mirror=await getAIMirror();
  let budget=Number(opts.budget);
  if(!Number.isFinite(budget)||budget<=0){
    budget=Number(mirror?.budget)||Number(profile?.contributionAmount)||0;
  }
  budget=Math.max(1,Math.min(1e8,budget));
  if(!Number.isFinite(budget)||budget<=0) throw new Error('BUDGET_REQUIRED');

  let allocation=Array.isArray(opts.allocation)?opts.allocation:null;
  let allocationSource='provided';
  if(!allocation?.length){
    if(mirror?.status==='APPROVED' && Array.isArray(mirror.allocation) && mirror.allocation.length){
      allocation=mirror.allocation;
      allocationSource='ai-mirror';
      if((!Number.isFinite(Number(opts.budget))||Number(opts.budget)<=0) && Number(mirror.budget)>0){
        budget=Number(mirror.budget);
      }
    }else{
      throw new Error('AI_MIRROR_REQUIRED');
    }
  }

  const weights=allocation.reduce((s,r)=>s+Number(r.weight_pct||0),0);
  if(Math.abs(weights-100)>2.5) throw new Error(`ALLOCATION_WEIGHTS_INVALID:${weights.toFixed(2)}`);

  let lines=scaleAllocation(allocation, budget);
  if(!lines.length) throw new Error('ALLOCATION_EMPTY');

  const [universe, txs0, marks0]=await Promise.all([buildUniverseView(), getTransactions(), getMarks()]);
  const allowed=new Set(UNIVERSE_SYMBOLS.map(s=>String(s).toUpperCase()));
  if(focus!=='all'){
    const selected=universe.filter(x=>x.id===focus||String(x.kind||'').toLowerCase()===focus);
    if(selected.length){
      const focusSet=new Set(selected.map(x=>String(x.symbol).toUpperCase()));
      const filtered=lines.filter(r=>focusSet.has(r.symbol));
      if(!filtered.length) throw new Error('UNKNOWN_INVESTMENT_FOCUS');
      const fw=filtered.reduce((s,r)=>s+r.weight_pct,0);
      lines=filtered.map(r=>{
        const w=r.weight_pct/fw*100;
        return {...r, weight_pct:Math.round(w*100)/100, amount:moneyRound(budget*(w/100))};
      });
    }
  }

  const before=derivePortfolio(txs0, marks0);
  const newTxs=[];
  const buys=[];
  const skipped=[];
  const marksPatch={...marks0};
  let workingCash=before.cash;

  const shortfall=moneyRound(Math.max(0, budget - workingCash));
  if(shortfall>0.009){
    const dep=normalizeTransaction({
      type:'DEPOSIT',
      amount:shortfall,
      date:todayISO(),
      note:`Paper deposit to fund ${source} wallet build (budget ${budget})`
    });
    newTxs.push(dep);
    workingCash=moneyRound(workingCash+shortfall);
  }

  for(const line of lines){
    const sym=line.symbol;
    if(!allowed.has(sym)){
      skipped.push({symbol:sym, reason:'unapproved_symbol', amount:line.amount});
      continue;
    }
    const px=resolveKnownPrice(sym,{marks:marksPatch, universe});
    if(!px){
      skipped.push({symbol:sym, reason:'price_missing', amount:line.amount});
      continue;
    }
    const spend=Math.min(line.amount, workingCash);
    if(!(spend>0.5)){
      skipped.push({symbol:sym, reason:'insufficient_cash', amount:line.amount});
      continue;
    }
    const qty=Math.floor((spend/px.price)*1e6)/1e6;
    if(!(qty>0)){
      skipped.push({symbol:sym, reason:'quantity_zero', amount:line.amount, price:px.price});
      continue;
    }
    const notional=moneyRound(qty*px.price);
    const buy=normalizeTransaction({
      type:'BUY',
      symbol:sym,
      quantity:qty,
      unitPrice:px.price,
      date:todayISO(),
      fees:0,
      taxes:0,
      note:`Paper BUY from ${allocationSource} · ${line.weight_pct}% · ${source}`
    });
    newTxs.push(buy);
    workingCash=moneyRound(workingCash-notional);
    buys.push({
      symbol:sym,
      quantity:qty,
      unitPrice:px.price,
      amount:notional,
      weight_pct:line.weight_pct,
      priceSource:px.source,
      priceAsOf:px.asOf
    });
    marksPatch[sym]={price:px.price, source:px.source||'build', asOf:px.asOf||new Date().toISOString(), confidence:'universe_or_research'};
  }

  if(!buys.length){
    throw new Error(`NO_BUYS_APPLIED:${skipped.map(s=>`${s.symbol}:${s.reason}`).join(',')||'empty'}`);
  }

  if(opts.dryRun){
    const candidate=[...txs0, ...newTxs];
    return {
      ok:true,
      dryRun:true,
      budget,
      focus,
      source,
      allocationSource,
      deposited:shortfall,
      buys,
      skipped,
      portfolio:derivePortfolio(candidate, marksPatch)
    };
  }

  const candidate=[...txs0, ...newTxs];
  await saveTransactions(candidate);
  await saveMarks(marksPatch);
  const portfolio=await getPortfolio();
  return {
    ok:true,
    dryRun:false,
    budget,
    focus,
    source,
    allocationSource,
    deposited:shortfall,
    buys,
    skipped,
    transactionsAdded:newTxs.length,
    portfolio:portfolio.derived,
    summary:{
      cash:portfolio.derived.cash,
      totalValue:portfolio.derived.totalValue,
      buyCount:buys.length,
      skippedCount:skipped.length,
      deposited:shortfall
    }
  };
}


export async function buildPaperWalletFromAllocation(opts={}){
  if(opts?.dryRun===true) return await buildPaperWalletFromAllocationUnlocked(opts);
  return await withKeyLock('portfolio-ledger',()=>buildPaperWalletFromAllocationUnlocked(opts),{ttlMs:30000,waitMs:8000});
}
