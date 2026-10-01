import { getSnapshots, getMarketHistory, getAIMirrorHistory } from './state.mjs';
import { INVESTMENT_UNIVERSE } from './market-universe.mjs';

function finite(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function isoDate(v){ return String(v||'').slice(0,10); }
function instrumentPrice(ws,symbol){
  // Use the actual instrument series for ETFs/securities. Never substitute an index level
  // or spot commodity quote for an ETF price. BTC may use the BTC benchmark because it is
  // the same underlying asset when an explicit instrument row is unavailable.
  const hit=(ws?.instruments||[]).find(i=>String(i?.symbol||'').toUpperCase()===String(symbol).toUpperCase());
  const p=finite(hit?.price);
  if(p!=null && p>0) return p;
  if(String(symbol).toUpperCase()==='BTC'){
    const b=finite(ws?.benchmarks?.btc_price); return b!=null && b>0 ? b : null;
  }
  return null;
}
function normalizeIndex(points){
  if(!points.length) return [];
  const first=Number(points[0].value)||100;
  return points.map(p=>({...p,value:first?Number(p.value)/first*100:100}));
}
function userSeries(snaps=[]){
  const s=[...snaps].sort((a,b)=>a.date.localeCompare(b.date)).filter(x=>Number.isFinite(Number(x.portfolioValue)));
  if(s.length<2) return {ready:false,reason:'Need at least two verified wallet snapshots.',series:[]};
  const bad=s.find(x=>x.completeMarks===false || x.markIntegrity==='stale_or_incomplete');
  if(bad) return {ready:false,reason:`Wallet performance locked: ${bad.date} has stale/incomplete marks.`,series:[]};
  let growth=1; const out=[{date:s[0].date,value:100}];
  for(let i=1;i<s.length;i++){
    const prev=Number(s[i-1].portfolioValue), cur=Number(s[i].portfolioValue), flow=Number(s[i].netExternalFlow||0);
    if(prev<=0){ out.push({date:s[i].date,value:out.at(-1).value}); continue; }
    growth*=1+((cur-flow-prev)/prev); out.push({date:s[i].date,value:growth*100});
  }
  return {ready:true,series:out,totalReturn:growth-1};
}
function benchmarkSeries(history=[]){
  const pts=history.map(ws=>({date:ws.date,value:instrumentPrice(ws,'SPY') ?? finite(ws?.benchmarks?.spy_price) ?? finite(ws?.benchmarks?.sp500_level)})).filter(x=>x.value!=null&&x.value>0);
  const norm=normalizeIndex(pts); return {ready:norm.length>=2,series:norm,totalReturn:norm.length>=2?norm.at(-1).value/100-1:null};
}
function activeRun(runs,date){
  const eligible=runs.filter(r=>isoDate(r.generatedAt)<=date && r.status==='APPROVED');
  return eligible.length?eligible.at(-1):null;
}
function aiSeries(history=[],runs=[]){
  const approved=[...runs].filter(r=>r?.status==='APPROVED'&&Array.isArray(r.allocation)&&r.allocation.length).sort((a,b)=>String(a.generatedAt).localeCompare(String(b.generatedAt)));
  if(!approved.length) return {ready:false,reason:'Run AI Mirror once to create the comparison baseline.',series:[]};
  const start=isoDate(approved[0].generatedAt);
  const hs=[...history].filter(ws=>String(ws.date)>=start).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if(hs.length<2) return {ready:false,reason:'Need at least two recorded market states after the first AI Mirror.',series:[]};
  let index=100; const out=[{date:hs[0].date,value:index,coverage:1}];
  for(let i=1;i<hs.length;i++){
    const prev=hs[i-1], cur=hs[i]; const run=activeRun(approved,prev.date)||approved[0];
    let weighted=0, covered=0;
    for(const row of run.allocation||[]){
      const w=Math.max(0,Number(row.weight_pct||0))/100; if(!w) continue;
      const p0=instrumentPrice(prev,row.symbol), p1=instrumentPrice(cur,row.symbol);
      if(p0!=null&&p0>0&&p1!=null&&p1>0){ weighted+=w*(p1/p0-1); covered+=w; }
    }
    if(covered<0.60){ out.push({date:cur.date,value:index,coverage:covered}); continue; }
    index*=1+weighted; out.push({date:cur.date,value:index,coverage:covered});
  }
  return {ready:out.length>=2,series:out,totalReturn:out.length>=2?out.at(-1).value/100-1:null,simulationNote:'AI Mirror return is a paper simulation from recorded market states. It excludes taxes, spreads, fees and slippage.'};
}
function latestValue(series=[]){ return series.length?Number(series.at(-1).value):null; }

export async function buildPerformanceMirror(){
  const [snaps,history,runs]=await Promise.all([getSnapshots(),getMarketHistory(730),getAIMirrorHistory()]);
  const user=userSeries(snaps), ai=aiSeries(history,runs), benchmark=benchmarkSeries(history);
  const userVal=latestValue(user.series), aiVal=latestValue(ai.series), benchVal=latestValue(benchmark.series);
  const leader=[['YOU',userVal],['KAIROS',aiVal],['SPY',benchVal]].filter(([,v])=>v!=null).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  return {generatedAt:new Date().toISOString(),user,ai,benchmark,leader,legend:{user:'YOUR WALLET',ai:'KAIROS AI MIRROR',benchmark:'SPY'},method:'normalized_return_index_100'};
}
