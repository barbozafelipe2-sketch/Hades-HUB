import { getResearchSeries, seriesForSymbol } from './market-research-series.mjs';
import { twelveConfigured, twelveHistoricalClose } from './twelve-data.mjs';
import { finnhubConfigured, finnhubHistoricalClose } from './finnhub.mjs';
import { symbolShard } from './market-quotes.mjs';

function validDate(date){ return /^\d{4}-\d{2}-\d{2}$/.test(String(date||'')); }
function daysBetween(a,b){ return Math.floor((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000); }
function cachedPoint(bundle,symbol,date,maxLagDays){
  if(bundle?.grade!=='licensed_market_data') return null;
  const pts=seriesForSymbol(bundle,symbol).filter(p=>p.date<=date);
  const pt=pts.at(-1); if(!pt) return null;
  const lag=daysBetween(pt.date,date);
  if(lag<0 || lag>maxLagDays) return null;
  const source=String(pt.source||'').toLowerCase();
  if(!['twelve_data','finnhub'].includes(source)) return null;
  return {symbol:String(symbol||'').toUpperCase(),price:Number(pt.price),date:pt.date,asOf:`${pt.date}T23:59:59Z`,source,provider:source,requestedDate:date,exact:pt.date===date,cacheHit:true};
}
function providerOrder(symbol){
  const t=twelveConfigured(), f=finnhubConfigured();
  if(t&&f) return symbolShard(symbol)===0?['twelve','finnhub']:['finnhub','twelve'];
  if(t) return ['twelve']; if(f) return ['finnhub']; return [];
}
export async function historicalClose(symbol,date,{maxLagDays=7,skipCache=false}={}){
  const target=String(date||'').slice(0,10); if(!validDate(target)) throw new Error('HISTORICAL_DATE_INVALID');
  if(!skipCache){
    try{ const hit=cachedPoint(await getResearchSeries(),symbol,target,maxLagDays); if(hit) return hit; }catch{}
  }
  const errors=[];
  for(const provider of providerOrder(symbol)){
    try{
      const r=provider==='twelve'?await twelveHistoricalClose(symbol,target,{lookbackDays:maxLagDays+3}):await finnhubHistoricalClose(symbol,target,{lookbackDays:maxLagDays+3});
      const lag=daysBetween(r.date,target); if(lag<0||lag>maxLagDays) throw new Error(`HISTORICAL_CLOSE_TOO_OLD:${r.date}`);
      return {...r,cacheHit:false};
    }catch(e){ errors.push(`${provider}:${String(e?.message||e).slice(0,140)}`); }
  }
  throw new Error(`HISTORICAL_CLOSE_UNAVAILABLE:${String(symbol||'').toUpperCase()}:${target}:${errors.join('|')||'NO_LICENSED_PROVIDER'}`);
}

export async function historicalMarks(symbols,date,{concurrency=3,maxLagDays=7}={}){
  const list=[...new Set((symbols||[]).map(s=>String(s||'').trim().toUpperCase()).filter(Boolean))];
  const marks={}; const points={}; const errors=[]; const n=Math.max(1,Math.min(4,Number(concurrency)||3));
  for(let i=0;i<list.length;i+=n){
    const batch=list.slice(i,i+n);
    const rows=await Promise.all(batch.map(async symbol=>{
      try{return await historicalClose(symbol,date,{maxLagDays});}
      catch(e){errors.push({symbol,error:String(e?.message||e).slice(0,220)});return null;}
    }));
    for(const pt of rows.filter(Boolean)){
      points[pt.symbol]=pt;
      marks[pt.symbol]={price:pt.price,source:pt.source,asOf:pt.asOf,confidence:'historical_licensed_close',historical:true,requestedDate:date,priceDate:pt.date};
    }
  }
  return {marks,points,errors};
}
