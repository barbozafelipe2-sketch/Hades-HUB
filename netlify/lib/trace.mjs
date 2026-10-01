import { getEnv } from './env.mjs';
import { getMarketWorldState } from './market-provider.mjs';
import { getPortfolio,getSettings,getMarks,saveMarks,saveWorldState,getTraceStatus,saveTraceStatus,getTransactions,getDecisions } from './state.mjs';
import { setJSON, getJSON, listKeys, withKeyLock } from './store.mjs';
import { netExternalFlowForDate, OUTCOME_CHECKPOINT_DAYS, derivePortfolio } from './portfolio.mjs';
import { UNIVERSE_SYMBOLS } from './market-universe.mjs';
import { maybeAutoEvolution } from './evolution.mjs';
import { processPendingPaperOrders } from './paper-orders.mjs';
import { historicalClose, historicalMarks } from './historical-prices.mjs';

function isoDate(d=new Date()){ return new Date(d).toISOString().slice(0,10); }
function shiftDate(date,days){ const d=new Date(`${String(date).slice(0,10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+Number(days||0)); return isoDate(d); }
export function marketDate(d=new Date()){
  const timeZone=getEnv('SAURON_MARKET_TIME_ZONE','America/New_York');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(d));
  const get=(type)=>parts.find(p=>p.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function datesBetweenExclusive(start,end,max=60){
  const out=[]; if(!start) return out;
  let d=new Date(start+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+1);
  const e=new Date(end+'T00:00:00Z');
  while(d<e && out.length<max){ out.push(isoDate(d)); d.setUTCDate(d.getUTCDate()+1); }
  return out;
}

/**
 * Finds missing trace dates across the whole bounded range, not merely the first
 * N calendar days after the anchor. This prevents a filled first window from
 * hiding later gaps forever.
 */
export async function missingTraceDates(today=marketDate(),maxResults=90){
  const keys=(await listKeys('traces/')).filter(k=>/^traces\/\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  const stored=new Set(keys.map(k=>k.slice('traces/'.length)));
  const status=await getTraceStatus();
  const anchor=status.traceStartDate || (stored.size?[...stored].sort()[0]:status.lastSuccessfulDate);
  if(!anchor) return [];
  const maxScan=Math.max(90,Math.min(3650,Number(getEnv('SAURON_TRACE_MAX_SCAN_DAYS',730))||730));
  const floor=shiftDate(today,-maxScan);
  let d=new Date(`${anchor<floor?floor:anchor}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+1);
  const e=new Date(`${today}T00:00:00Z`); const out=[];
  while(d<e && out.length<Math.max(1,maxResults)){
    const day=isoDate(d); if(!stored.has(day)) out.push(day); d.setUTCDate(d.getUTCDate()+1);
  }
  return out;
}

export async function refreshWorldState(date=marketDate(),{deadlineAt}={}){
  const portfolio=await getPortfolio();
  const symbols=[...new Set([...UNIVERSE_SYMBOLS,...portfolio.derived.positions.map(p=>p.symbol)])].slice(0,48);
  const ws=await getMarketWorldState({date,symbols,deadlineAt});
  const settings=await getSettings();
  if(settings.autoMarketMarks!==false){
    await withKeyLock('portfolio-ledger',async()=>{
      const marks=await getMarks();
      for(const i of ws.instruments||[]){
        const symbol=String(i.symbol||'').toUpperCase(); const price=Number(i.price);
        if(symbol && Number.isFinite(price) && price>0){
          const source=i.source||ws?._meta?.price_authority||ws?._meta?.market_source||'unverified';
          marks[symbol]={price,source,asOf:i.as_of||ws.generated_at||new Date().toISOString(),confidence:i.confidence||'unknown',sourceUrl:i.source_url||null};
        }
      }
      await saveMarks(marks);
    });
  }
  let paperOrderProcessing={fills:[],orders:[]};
  try{ paperOrderProcessing=await processPendingPaperOrders(); }
  catch(e){ paperOrderProcessing={fills:[],orders:[],error:String(e?.message||e).slice(0,180)}; }
  ws._meta={...(ws._meta||{}),paper_order_processing:{fills:paperOrderProcessing.fills||[],error:paperOrderProcessing.error||null}};
  await saveWorldState(ws);
  return ws;
}

export async function saveDailySnapshot(date,ws,{marksOverride=null,historical=false}={}){
  const txs=await getTransactions();
  const derived=marksOverride
    ? derivePortfolio(txs,marksOverride,{asOf:date,markMaxAgeHours:historical?168:48})
    : (await getPortfolio({asOf:date})).derived;
  const markIntegrity=derived.completeMarks?'complete':'stale_or_incomplete';
  const snap={
    date,
    createdAt:new Date().toISOString(),
    reconstruction:historical?'licensed_point_in_time':null,
    portfolioValue:derived.totalValue,
    cash:derived.cash,
    costBasis:derived.costBasis,
    unrealizedPnL:derived.unrealizedPnL,
    realizedPnL:derived.realizedPnL,
    netExternalFlow:netExternalFlowForDate(txs,date),
    spyPrice:Number(ws?.benchmarks?.spy_price)||Number(ws?.benchmarks?.sp500_level)||null,
    goldPrice:Number(ws?.benchmarks?.gold_price)||null,
    btcPrice:Number(ws?.benchmarks?.btc_price)||null,
    regime:ws?.regime||null,
    completeMarks:derived.completeMarks,
    markIntegrity,
    positions:derived.positions.map(p=>({symbol:p.symbol,quantity:p.quantity,price:p.price,marketValue:p.marketValue,priceSource:p.priceSource,staleMark:p.staleMark,markAsOf:p.markAsOf}))
  };
  await setJSON(`snapshots/${date}`,snap);
  return snap;
}

/** Score missing checkpoints against the licensed close available at that point in time. */
export async function scoreDecisionOutcomes(asOfDate){
  const decisions=await getDecisions();
  const work=[];
  for(const d of decisions.slice(0,100)){
    if(!d?.final?.status || !['ADD','REDUCE'].includes(d.final.status)) continue;
    const ref=Number(d.referencePrice); const decisionDate=String(d.date||'').slice(0,10);
    if(!Number.isFinite(ref)||ref<=0||!/^\d{4}-\d{2}-\d{2}$/.test(decisionDate)) continue;
    const full=await getJSON(`decisions/${d.id}`,null); if(!full) continue;
    full.outcomes=Array.isArray(full.outcomes)?full.outcomes:[];
    for(const checkpointDays of OUTCOME_CHECKPOINT_DAYS){
      const targetDate=shiftDate(decisionDate,checkpointDays);
      if(targetDate>asOfDate || full.outcomes.some(x=>x.checkpointDays===checkpointDays)) continue;
      work.push({d,full,ref,checkpointDays,targetDate});
    }
  }
  const cache=new Map(); const failures=[];
  for(const item of work){
    const key=`${item.d.asset}:${item.targetDate}`;
    let pt=cache.get(key);
    if(pt===undefined){
      try{ pt=await historicalClose(item.d.asset,item.targetDate,{maxLagDays:7}); }
      catch(e){ pt=null; failures.push({asset:item.d.asset,targetDate:item.targetDate,error:String(e?.message||e).slice(0,180)}); }
      cache.set(key,pt);
    }
    if(!pt) continue;
    const ret=Number(pt.price)/item.ref-1;
    item.full.outcomes.push({
      checkpointDays:item.checkpointDays,
      targetDate:item.targetDate,
      asOf:pt.date,
      priceAsOf:pt.asOf,
      daysSinceDecision:item.checkpointDays,
      returnSinceDecision:ret,
      directionalCorrect:item.d.final.status==='ADD'?ret>0:ret<0,
      priceSource:pt.source,
      pointInTime:true,
      exactTradingDate:pt.exact===true
    });
  }
  const changed=new Map(); for(const item of work) changed.set(item.d.id,item.full);
  for(const [id,full] of changed) await setJSON(`decisions/${id}`,full);
  return {scored:work.length-failures.length,failures};
}

async function reconstructHistoricalWorldState(date){
  const txs=await getTransactions();
  const skeleton=derivePortfolio(txs,{}, {asOf:date,markMaxAgeHours:168});
  const held=skeleton.positions.map(p=>p.symbol);
  const requested=[...new Set([...held,'SPY','GLD','BTC'])];
  const hist=await historicalMarks(requested,date,{concurrency:3,maxLagDays:7});
  const missingHeld=held.filter(s=>!hist.marks[s]);
  if(missingHeld.length) throw new Error(`HISTORICAL_MARKS_INCOMPLETE:${missingHeld.join(',')}`);
  const point=s=>hist.points[s]||null;
  const ws={
    date,
    generated_at:new Date().toISOString(),
    freshness:'historical_reconstruction',
    market_session:'historical_close',
    summary:'Point-in-time reconstruction from licensed daily closes. No current quotes, news, AI prices, or present-day regime data are injected into this historical trace.',
    regime:{name:'Historical price reconstruction',trend:'UNKNOWN',volatility:'UNKNOWN',liquidity:'UNKNOWN'},
    benchmarks:{spy_price:point('SPY')?.price??null,gold_price:point('GLD')?.price??null,btc_price:point('BTC')?.price??null,us10y_yield:null,dxy:null},
    instruments:requested.filter(s=>point(s)).map(s=>({symbol:s,price:point(s).price,as_of:point(s).asOf,source:point(s).source,confidence:'historical_licensed_close'})),
    drivers:[],cross_asset:[],risks:[],unknowns:['Historical news/regime context intentionally not reconstructed to avoid look-ahead bias.'],
    _meta:{market_source:'licensed_historical_close',price_authority:'licensed_historical_close',historical_reconstruction:true,point_in_time:true,look_ahead_guard:true,errors:hist.errors}
  };
  await setJSON(`trace/world-state/${date}`,ws); // never overwrite latest current world state
  return {ws,marks:hist.marks};
}

async function runHistoricalTrace(date){
  const status=await getTraceStatus();
  const attempt={...status,lastAttemptAt:new Date().toISOString(),lastError:null}; await saveTraceStatus(attempt);
  try{
    const {ws,marks}=await reconstructHistoricalWorldState(date);
    const snap=await saveDailySnapshot(date,ws,{marksOverride:marks,historical:true});
    const outcomes=await scoreDecisionOutcomes(date);
    const trace={date,createdAt:new Date().toISOString(),worldState:ws,snapshot:snap,status:'COMPLETE',freshness:'historical_reconstruction',outcomeScoring:outcomes,evolution:{ok:true,skipped:true,reason:'historical_reconstruction_no_present_day_evolution'}};
    await setJSON(`traces/${date}`,trace);
    const currentStatus=await getTraceStatus();
    const newestDate=[currentStatus.lastSuccessfulDate,date].filter(Boolean).sort().at(-1)||date;
    await saveTraceStatus({...currentStatus,traceStartDate:status.traceStartDate||date,lastSuccessfulDate:newestDate,lastSuccessfulAt:new Date().toISOString(),lastError:null,lastHistoricalReconstructionAt:new Date().toISOString()});
    return trace;
  }catch(e){
    await saveTraceStatus({...await getTraceStatus(),lastError:String(e.message||e)}); throw e;
  }
}

export async function runDailyTrace(date=marketDate(),freshness='current'){
  if(freshness==='historical_reconstruction' || date<marketDate()) return await runHistoricalTrace(date);
  const status=await getTraceStatus();
  const attempt={...status,lastAttemptAt:new Date().toISOString(),lastError:null}; await saveTraceStatus(attempt);
  try{
    const ws=await refreshWorldState(date); ws.freshness=freshness||ws.freshness;
    const snap=await saveDailySnapshot(date,ws);
    const trace={date,createdAt:new Date().toISOString(),worldState:ws,snapshot:snap,status:'COMPLETE'};
    trace.outcomeScoring=await scoreDecisionOutcomes(date);
    let evolution={ok:true,error:null};
    try{ await maybeAutoEvolution(); }
    catch(e){ evolution={ok:false,error:String(e?.message||e).slice(0,240)}; }
    trace.evolution=evolution;
    await setJSON(`traces/${date}`,trace);
    await saveTraceStatus({...await getTraceStatus(),traceStartDate:status.traceStartDate||date,lastSuccessfulDate:date,lastSuccessfulAt:new Date().toISOString(),lastError:null,lastEvolutionError:evolution.error});
    return trace;
  }catch(e){
    await saveTraceStatus({...await getTraceStatus(),lastError:String(e.message||e)}); throw e;
  }
}
