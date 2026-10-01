import { getWorldState, getMarketHistory, getMarks, saveMarks } from './state.mjs';
import { getResearchSeries, seriesForSymbol } from './market-research-series.mjs';
import { marketQuote, primaryProviderForSymbol } from './market-quotes.mjs';
import { twelveConfigured, twelveSeries } from './twelve-data.mjs';
import { finnhubConfigured, finnhubSeries } from './finnhub.mjs';
import { withKeyLock } from './store.mjs';

// Curated paper-broker universe: single stocks + liquid ETF/proxies.
// Data-driven so a licensed vendor can expand later.
export const INVESTMENT_UNIVERSE=[
  // Single stocks (US Equity)
  {id:'aapl',label:'Apple',symbol:'AAPL',kind:'US Equity',description:'Apple Inc. — single-stock US large-cap equity.'},
  {id:'ko',label:'Coca-Cola',symbol:'KO',kind:'US Equity',description:'The Coca-Cola Company — single-stock US large-cap equity.'},
  {id:'msft',label:'Microsoft',symbol:'MSFT',kind:'US Equity',description:'Microsoft Corporation — single-stock US large-cap equity.'},
  {id:'amzn',label:'Amazon',symbol:'AMZN',kind:'US Equity',description:'Amazon.com Inc. — single-stock US large-cap equity.'},
  {id:'googl',label:'Alphabet',symbol:'GOOGL',kind:'US Equity',description:'Alphabet Inc. Class A — single-stock US large-cap equity.'},
  {id:'meta',label:'Meta',symbol:'META',kind:'US Equity',description:'Meta Platforms Inc. — single-stock US large-cap equity.'},
  {id:'nvda',label:'NVIDIA',symbol:'NVDA',kind:'US Equity',description:'NVIDIA Corporation — single-stock US large-cap equity.'},
  {id:'tsla',label:'Tesla',symbol:'TSLA',kind:'US Equity',description:'Tesla Inc. — single-stock US large-cap equity.'},
  {id:'jpm',label:'JPMorgan',symbol:'JPM',kind:'US Equity',description:'JPMorgan Chase & Co. — single-stock US large-cap equity.'},
  {id:'xom',label:'Exxon Mobil',symbol:'XOM',kind:'US Equity',description:'Exxon Mobil Corporation — single-stock US large-cap equity.'},
  // ETF / proxies
  {id:'nasdaq',label:'NASDAQ 100',symbol:'QQQ',kind:'US Growth',description:'Large-cap US growth and technology exposure through the Nasdaq-100 proxy.'},
  {id:'sp500',label:'SPDR S&P 500 ETF (SPY)',symbol:'SPY',kind:'US Equity',description:'Broad US large-cap equity exposure.'},
  {id:'smallcap',label:'US Small Cap',symbol:'IWM',kind:'US Equity',description:'US small-cap equity exposure through the Russell 2000 proxy.'},
  {id:'technology',label:'Technology',symbol:'XLK',kind:'Sector',description:'US technology-sector equity exposure.'},
  {id:'energy',label:'Energy',symbol:'XLE',kind:'Sector',description:'US energy-sector equity exposure.'},
  {id:'crypto',label:'Bitcoin',symbol:'BTC',kind:'Crypto',description:'Bitcoin market exposure.'},
  {id:'ethereum',label:'Ethereum',symbol:'ETH',kind:'Crypto',description:'Ethereum network asset exposure.'},
  {id:'realestate',label:'Real Estate',symbol:'VNQ',kind:'REITs',description:'US listed real-estate investment trust exposure.'},
  {id:'gold',label:'Gold',symbol:'GLD',kind:'Commodity',description:'Gold exposure through a widely followed ETF proxy.'},
  {id:'silver',label:'Silver',symbol:'SLV',kind:'Commodity',description:'Silver exposure through a widely followed ETF proxy.'},
  {id:'bonds',label:'Long Treasuries',symbol:'TLT',kind:'Bonds',description:'Long-duration US Treasury exposure.'},
  {id:'tbills',label:'T-Bills',symbol:'BIL',kind:'Cash / Bonds',description:'Short-duration US Treasury-bill exposure.'},
  {id:'credit',label:'Corporate Bonds',symbol:'LQD',kind:'Bonds',description:'Investment-grade US corporate-bond exposure.'},
  {id:'global',label:'Global Equity',symbol:'VT',kind:'Global Equity',description:'Global developed and emerging stock-market exposure.'},
  {id:'emerging',label:'Emerging Markets',symbol:'VWO',kind:'Global Equity',description:'Diversified emerging-market equity exposure.'}
];
export const UNIVERSE_SYMBOLS=INVESTMENT_UNIVERSE.map(x=>x.symbol);

function instrument(ws,symbol){ return (ws?.instruments||[]).find(i=>String(i.symbol||'').toUpperCase()===symbol); }
function benchmarkPrice(ws,symbol){
  // BTC benchmark is the same underlying asset. Do NOT substitute S&P index levels
  // for SPY ETF prices or gold spot for GLD ETF prices. Those are different instruments.
  if(symbol==='BTC') return Number(ws?.benchmarks?.btc_price)||null;
  return null;
}

function point(ws,symbol){
  const i=instrument(ws,symbol); const price=Number(i?.price);
  const fallback=benchmarkPrice(ws,symbol);
  const p=Number.isFinite(price)&&price>0?price:(Number.isFinite(fallback)&&fallback>0?fallback:null);
  return p==null?null:{date:ws.date||String(ws.generated_at||'').slice(0,10),price:p,asOf:i?.as_of||ws.generated_at||null,source:i?.source_url||null,confidence:i?.confidence||null};
}

export async function buildUniverseView(){
  const [world,history,research]=await Promise.all([getWorldState(),getMarketHistory(365),getResearchSeries()]);
  return INVESTMENT_UNIVERSE.map(def=>{
    const current=point(world,def.symbol);
    const inst=instrument(world,def.symbol);
    let series=history.map(ws=>point(ws,def.symbol)).filter(Boolean);
    let seriesSource='recorded';
    // Always prefer research/licensed series when recorded history is thin (<2)
    const researchPts=seriesForSymbol(research,def.symbol);
    if(series.length<2 && researchPts.length>=2){
      if(!series.length){
        series=researchPts.map(p=>({date:p.date,price:p.price,asOf:p.date,source:p.source||'research',confidence:p.confidence||'moderate'}));
        seriesSource=research?.provider||(research?.grade==='licensed_market_data'?'licensed':'research');
      }else{
        const byDate=new Map(series.map(p=>[p.date,p]));
        for(const p of researchPts){ if(!byDate.has(p.date)) byDate.set(p.date,{date:p.date,price:p.price,asOf:p.date,source:p.source||'research',confidence:p.confidence||'moderate'}); }
        series=[...byDate.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
        seriesSource='mixed';
      }
    }else if(series.length<2 && researchPts.length===1){
      series=researchPts.map(p=>({date:p.date,price:p.price,asOf:p.date,source:p.source||'research',confidence:p.confidence||'moderate'}));
      seriesSource='partial';
    }
    // Append live quote as latest point so cards leave "History pending" after a market refresh
    if(current?.price>0){
      const d=String(current.date||current.asOf||'').slice(0,10) || new Date().toISOString().slice(0,10);
      const byDate=new Map(series.map(p=>[p.date,p]));
      byDate.set(d,{date:d,price:current.price,asOf:current.asOf||d,source:current.source||'quote',confidence:current.confidence||'high'});
      series=[...byDate.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
      if(seriesSource==='recorded' && series.length>=2) seriesSource='recorded+quote';
    }
    const first=series[0]?.price, last=series.at(-1)?.price;
    let periodReturn=Number.isFinite(first)&&first>0&&Number.isFinite(last)&&series.length>=2?last/first-1:null;
    // Day change from quote when multi-day history still thin
    const dayChange=Number.isFinite(Number(inst?.percent_change))?Number(inst.percent_change)/100:null;
    if(periodReturn==null && dayChange!=null) periodReturn=dayChange;
    return {
      ...def,
      current,
      series,
      periodReturn,
      dayChange,
      historyReady:series.length>=2 || dayChange!=null,
      seriesSource,
      researchMeta:seriesSource!=='recorded' && seriesSource!=='recorded+quote'?{
        grade:research?.grade||'research',
        provider:research?.provider||null,
        disclaimer:research?.disclaimer||null,
        generatedAt:research?.generatedAt||null
      }:null
    };
  });
}


async function directSeries(symbol){
  const primary=primaryProviderForSymbol(symbol);
  const order=primary==='finnhub'?['finnhub','twelve']:['twelve','finnhub'];
  for(const provider of order){
    try{
      if(provider==='twelve' && twelveConfigured()) return {provider:'twelve_data',points:(await twelveSeries(symbol,{outputsize:60})).points};
      if(provider==='finnhub' && finnhubConfigured()) return {provider:'finnhub',points:(await finnhubSeries(symbol,{outputsize:60})).points};
    }catch{}
  }
  return {provider:null,points:[]};
}

export async function buildDynamicAssetView(def,{persistMark=true}={}){
  if(!def?.symbol) throw new Error('ASSET_SYMBOL_REQUIRED');
  const q=await marketQuote(def.symbol);
  const seriesResult=await directSeries(def.symbol);
  const series=(seriesResult.points||[]).map(p=>({date:p.date,price:Number(p.price),asOf:p.date,source:p.source||seriesResult.provider,confidence:p.confidence||'high'})).filter(p=>Number.isFinite(p.price)&&p.price>0);
  const d=String(q.asOf||new Date().toISOString()).slice(0,10);
  const byDate=new Map(series.map(p=>[p.date,p]));
  byDate.set(d,{date:d,price:q.price,asOf:q.asOf,source:q.provider||'market_quote',confidence:q.stale?'moderate':'high'});
  const merged=[...byDate.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const first=merged[0]?.price,last=merged.at(-1)?.price;
  const periodReturn=Number.isFinite(first)&&first>0&&Number.isFinite(last)&&merged.length>=2?last/first-1:null;
  if(persistMark){
    await withKeyLock('portfolio-ledger',async()=>{
      const marks=await getMarks();
      marks[def.symbol]={price:q.price,source:q.source||q.provider||'market_quote',asOf:q.asof||q.asOf||new Date().toISOString(),exchange:q.exchange||null,delay_class:q.delay_class||'unknown',license_id:q.license_id||'unverified',point_in_time:q.point_in_time===true,manual:false,confidence:q.stale?'moderate':'high'};
      await saveMarks(marks);
    });
  }
  return {...def,current:{date:d,price:q.price,asOf:q.asof||q.asOf,source:q.source||q.provider||null,exchange:q.exchange||null,delay_class:q.delay_class||'unknown',license_id:q.license_id||null,point_in_time:q.point_in_time===true,confidence:q.stale?'moderate':'high'},series:merged,periodReturn,dayChange:Number.isFinite(Number(q.percentChange))?Number(q.percentChange)/100:null,historyReady:merged.length>=2,seriesSource:seriesResult.provider||'quote_only',researchMeta:{grade:'licensed_market_data',provider:seriesResult.provider||q.provider||null,generatedAt:new Date().toISOString(),disclaimer:'Crypto price/history supplied by licensed market-data providers; coverage depends on provider entitlement.'}};
}
