/** Pure helpers for paper wallet build (no Netlify blobs / state imports). */

export function detectBuildWalletIntent(question=''){
  const q=String(question||'');
  return /\b(build|construct|create|allocate|apply|fund|fill|make)\b.{0,40}\b(wallet|portfolio|allocation|holdings)\b|\b(allocate|invest|deploy)\b.{0,30}\b(budget|cash|capital|money|\$|usd)\b|\bapply\b.{0,20}\b(mirror|allocation)\b/i.test(q);
}

export function extractBudgetFromMessage(question='', fallbacks={}){
  const q=String(question||'');
  const patterns=[
    /\$\s*([\d,]+(?:\.\d+)?)\s*(k|m)?\b/i,
    /\b([\d,]+(?:\.\d+)?)\s*(k|m)?\s*(usd|dollars?)\b/i,
    /\b(?:budget|capital|cash|with|of)\s*[:=]?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m)?\b/i
  ];
  for(const re of patterns){
    const m=q.match(re);
    if(!m) continue;
    let n=Number(String(m[1]).replace(/,/g,''));
    if(!Number.isFinite(n)||n<=0) continue;
    const suf=String(m[2]||'').toLowerCase();
    if(suf==='k') n*=1000;
    if(suf==='m') n*=1_000_000;
    if(n>=1 && n<=1e8) return n;
  }
  const mirrorBudget=Number(fallbacks.mirrorBudget);
  if(Number.isFinite(mirrorBudget)&&mirrorBudget>0) return mirrorBudget;
  const contribution=Number(fallbacks.contributionAmount);
  if(Number.isFinite(contribution)&&contribution>0) return contribution;
  return null;
}

/** Resolve latest known price for a symbol: marks → universe current → research/series last close. */
export function resolveKnownPrice(symbol, {marks={}, universe=[]}={}){
  const sym=String(symbol||'').trim().toUpperCase();
  if(!sym) return null;
  const mark=marks[sym];
  const mp=Number(mark?.price);
  if(Number.isFinite(mp) && mp>0){
    return {price:mp, source:mark.source||'mark', asOf:mark.asOf||null};
  }
  const u=(universe||[]).find(x=>String(x.symbol||'').toUpperCase()===sym);
  const cur=Number(u?.current?.price);
  if(Number.isFinite(cur) && cur>0){
    return {price:cur, source:u.current.source||'universe', asOf:u.current.asOf||u.current.date||null};
  }
  const last=u?.series?.at?.(-1);
  const lp=Number(last?.price);
  if(Number.isFinite(lp) && lp>0){
    return {price:lp, source:last.source||u.seriesSource||'research_series', asOf:last.asOf||last.date||null};
  }
  return null;
}

export function moneyRound(n){ return Math.round(Number(n)*100)/100; }

export function scaleAllocation(allocation, budget){
  const rows=(allocation||[]).map(r=>({
    symbol:String(r.symbol||'').toUpperCase(),
    weight_pct:Number(r.weight_pct),
    amount:Number(r.amount),
    asset_class:r.asset_class||'',
    role:r.role||''
  })).filter(r=>r.symbol && Number.isFinite(r.weight_pct) && r.weight_pct>0);
  if(!rows.length) return [];
  const wSum=rows.reduce((s,r)=>s+r.weight_pct,0);
  if(!(wSum>0)) return [];
  return rows.map(r=>{
    const w=r.weight_pct/wSum*100;
    return {...r, weight_pct:Math.round(w*100)/100, amount:moneyRound(budget*(w/100))};
  });
}

export function formatBuildSummaryText(result){
  if(!result?.ok) return 'Paper wallet build failed.';
  const lines=[
    `Paper wallet build applied (simulation only).`,
    `Budget: ${result.budget}. Deposit added: ${result.deposited||0}.`,
    `Buys (${result.buys?.length||0}): ${(result.buys||[]).map(b=>`${b.symbol} qty ${b.quantity} @ ${b.unitPrice} (${b.priceSource})`).join('; ')||'none'}.`
  ];
  if(result.skipped?.length){
    lines.push(`Skipped: ${result.skipped.map(s=>`${s.symbol} (${s.reason})`).join('; ')}.`);
  }
  lines.push(`Cash now: ${result.portfolio?.cash ?? result.summary?.cash}. Total value: ${result.portfolio?.totalValue ?? result.summary?.totalValue}.`);
  return lines.join('\n');
}
