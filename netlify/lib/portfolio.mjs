import crypto from 'node:crypto';
import { normalizeSymbolInput } from './input.mjs';

const POSITION_TYPES = new Set(['OPENING_POSITION','BUY','SELL']);
const CASH_FLOW_TYPES = new Set(['DEPOSIT','WITHDRAWAL','DIVIDEND','INTEREST','FEE','TAX']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRICE_MARK_MAX_AGE_HOURS = 48;
const MAX_TRANSACTION_QUANTITY=1e9;
const MAX_TRANSACTION_PRICE=1e9;
const MAX_TRANSACTION_AMOUNT=1e12;
const MAX_TRANSACTION_FEE=1e9;
const VERIFIED_MARK_SOURCES=new Set(['twelve_data','finnhub','licensed_market_feed','twelve_data+finnhub_sticky']);
export const OUTCOME_CHECKPOINT_DAYS = [1,7,30,90,365];

function num(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
export function todayISO(){ return new Date().toISOString().slice(0,10); }
function parseDateStrict(value){
  const date = String(value||'').trim();
  if(!ISO_DATE_RE.test(date)) throw new Error('INVALID_TRANSACTION_DATE');
  const [y,m,d] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(y,m-1,d));
  if(parsed.getUTCFullYear()!==y || parsed.getUTCMonth()!==m-1 || parsed.getUTCDate()!==d) throw new Error('INVALID_TRANSACTION_DATE');
  return date;
}
export function normalizeDate(value,{rejectFuture=true}={}){
  const date = parseDateStrict(value);
  if(rejectFuture && date > todayISO()) throw new Error('FUTURE_TRANSACTION_REJECTED');
  return date;
}
export function normalizeSymbol(symbol){ return normalizeSymbolInput(symbol); }
export function isStaleMark(mark,{now=Date.now(),maxAgeHours=PRICE_MARK_MAX_AGE_HOURS}={}){
  if(!mark?.asOf) return true;
  const t=Date.parse(mark.asOf);
  if(!Number.isFinite(t)) return true;
  return now - t > maxAgeHours*3600000 || t - now > 300000;
}
export function isVerifiedPositionPrice(position,{maxAgeHours=PRICE_MARK_MAX_AGE_HOURS}={}){
  if(!position) return false;
  if(!Number.isFinite(Number(position.price)) || Number(position.price)<=0) return false;
  if(position.priceSource==='cost_basis_fallback') return false;
  if(!VERIFIED_MARK_SOURCES.has(String(position.priceSource||'').toLowerCase())) return false;
  if(position.staleMark === true) return false;
  if(position.markAsOf && isStaleMark({asOf:position.markAsOf},{maxAgeHours})) return false;
  return true;
}

export function normalizeTransaction(input={}, opts={}){
  const type = String(input.type||'').toUpperCase();
  const allowed = ['OPENING_POSITION','DEPOSIT','WITHDRAWAL','BUY','SELL','DIVIDEND','INTEREST','FEE','TAX'];
  if(!allowed.includes(type)) throw new Error('INVALID_TRANSACTION_TYPE');
  const date = normalizeDate(input.date || todayISO(), {rejectFuture: opts.rejectFuture !== false});
  const tx = {
    id: input.id || crypto.randomUUID(),
    type,
    date,
    createdAt: input.createdAt || new Date().toISOString(),
    symbol: normalizeSymbol(input.symbol),
    quantity: num(input.quantity),
    unitPrice: num(input.unitPrice),
    amount: num(input.amount),
    fees: num(input.fees),
    taxes: num(input.taxes),
    note: String(input.note||'').slice(0,500),
  };
  if(POSITION_TYPES.has(type) && !tx.symbol) throw new Error('SYMBOL_REQUIRED');
  if(POSITION_TYPES.has(type) && (tx.quantity <= 0 || tx.quantity>MAX_TRANSACTION_QUANTITY)) throw new Error('QUANTITY_OUT_OF_RANGE');
  if(POSITION_TYPES.has(type) && (tx.unitPrice <= 0 || tx.unitPrice>MAX_TRANSACTION_PRICE)) throw new Error('PRICE_OUT_OF_RANGE');
  if(CASH_FLOW_TYPES.has(type) && (tx.amount <= 0 || tx.amount>MAX_TRANSACTION_AMOUNT)) throw new Error('AMOUNT_OUT_OF_RANGE');
  if(tx.fees<0 || tx.fees>MAX_TRANSACTION_FEE || tx.taxes<0 || tx.taxes>MAX_TRANSACTION_FEE) throw new Error('FEES_OUT_OF_RANGE');
  if(POSITION_TYPES.has(type) && !Number.isFinite(tx.quantity*tx.unitPrice)) throw new Error('TRANSACTION_VALUE_OUT_OF_RANGE');
  return tx;
}

export function openingPositionExternalValue(t){
  return Number(t.quantity||0)*Number(t.unitPrice||0)+Number(t.fees||0)+Number(t.taxes||0);
}

export function validateTransactionLedger(transactions=[]){
  if(!Array.isArray(transactions)) throw new Error('INVALID_TRANSACTIONS');
  const rows=transactions.map(t=>normalizeTransaction(t,{rejectFuture:false}));
  const ordered=rows.map((t,i)=>({t,i})).sort((a,b)=>{
    const ka=String(a.t.date||'')+'|'+String(a.t.createdAt||'')+'|'+String(a.i).padStart(8,'0');
    const kb=String(b.t.date||'')+'|'+String(b.t.createdAt||'')+'|'+String(b.i).padStart(8,'0');
    return ka.localeCompare(kb);
  });
  const qty=new Map();
  for(const {t} of ordered){
    if(t.type==='OPENING_POSITION' || t.type==='BUY'){ qty.set(t.symbol,(qty.get(t.symbol)||0)+t.quantity); continue; }
    if(t.type==='SELL'){
      const have=qty.get(t.symbol)||0;
      if(t.quantity>have+1e-10) throw new Error(`LEDGER_SELL_EXCEEDS_POSITION:${t.symbol}:${t.id}`);
      const next=have-t.quantity; qty.set(t.symbol,Math.abs(next)<1e-10?0:next);
    }
  }
  return rows;
}


export function derivePortfolio(transactions=[], marks={}, opts={}){
  const asOf = normalizeDate(opts.asOf || todayISO(), {rejectFuture:false});
  const txs = [...transactions].sort((a,b)=> String(a.date+a.createdAt).localeCompare(String(b.date+b.createdAt)));
  let cash=0, realizedPnL=0, externalFlows=0, income=0, totalFees=0, totalTaxes=0;
  const pos = {};
  const warnings=[];
  for(const raw of txs){
    const t = normalizeTransaction(raw,{rejectFuture:false});
    if(t.date > todayISO() || t.date > asOf){ warnings.push(`Future transaction ${t.id} excluded from ${asOf} portfolio state.`); continue; }
    if(t.type==='DEPOSIT'){ cash += t.amount; externalFlows += t.amount; continue; }
    if(t.type==='WITHDRAWAL'){ cash -= t.amount; externalFlows -= t.amount; continue; }
    if(t.type==='DIVIDEND' || t.type==='INTEREST'){ cash += t.amount; income += t.amount; continue; }
    if(t.type==='FEE'){ cash -= t.amount; totalFees += t.amount; continue; }
    if(t.type==='TAX'){ cash -= t.amount; totalTaxes += t.amount; continue; }
    const p = pos[t.symbol] || {symbol:t.symbol,quantity:0,costBasis:0,avgCost:0,realizedPnL:0};
    if(t.type==='OPENING_POSITION'){
      const openingValue = openingPositionExternalValue(t);
      externalFlows += openingValue;
      totalFees += t.fees; totalTaxes += t.taxes;
      p.costBasis += openingValue;
      p.quantity += t.quantity;
    }
    if(t.type==='BUY'){
      const gross=t.quantity*t.unitPrice;
      const out=gross+t.fees+t.taxes;
      cash -= out; totalFees += t.fees; totalTaxes += t.taxes;
      p.costBasis += out;
      p.quantity += t.quantity;
    }
    if(t.type==='SELL'){
      if(t.quantity > p.quantity + 1e-10){ warnings.push(`Sell ${t.symbol} exceeds tracked quantity; transaction ignored.`); continue; }
      const basisPer = p.quantity>0 ? p.costBasis/p.quantity : 0;
      const basisSold = basisPer*t.quantity;
      const proceeds = t.quantity*t.unitPrice - t.fees - t.taxes;
      cash += proceeds; totalFees += t.fees; totalTaxes += t.taxes;
      const rpnl = proceeds-basisSold;
      realizedPnL += rpnl; p.realizedPnL += rpnl;
      p.quantity -= t.quantity; p.costBasis -= basisSold;
      if(Math.abs(p.quantity)<1e-10){ p.quantity=0; p.costBasis=0; }
    }
    p.avgCost = p.quantity>0 ? p.costBasis/p.quantity : 0;
    pos[t.symbol]=p;
  }
  const asOfNow = Date.parse(`${asOf}T23:59:59Z`);
  const positions = Object.values(pos).filter(p=>p.quantity>0).map(p=>{
    const mark = marks[p.symbol];
    const hasMark = mark && Number.isFinite(Number(mark.price)) && Number(mark.price)>0;
    const price = hasMark ? Number(mark.price) : p.avgCost;
    const priceSource = hasMark ? (mark.source||'unknown') : 'cost_basis_fallback';
    const staleMark = hasMark ? isStaleMark(mark,{now:Number.isFinite(asOfNow)?asOfNow:Date.now(),maxAgeHours:Number(opts.markMaxAgeHours)||PRICE_MARK_MAX_AGE_HOURS}) : true;
    const marketValue = p.quantity*price;
    const unrealizedPnL = marketValue-p.costBasis;
    return {...p,price,priceSource,staleMark,markAsOf:mark?.asOf||null,marketValue,unrealizedPnL};
  });
  const securitiesValue=positions.reduce((s,p)=>s+p.marketValue,0);
  const costBasis=positions.reduce((s,p)=>s+p.costBasis,0);
  const unrealizedPnL=positions.reduce((s,p)=>s+p.unrealizedPnL,0);
  const totalValue=cash+securitiesValue;
  const positionsWithAllocation=positions.map(p=>({...p,allocation:totalValue!==0?p.marketValue/totalValue:0}));
  const completeMarks=positionsWithAllocation.every(p=>p.priceSource!=='cost_basis_fallback' && p.staleMark!==true);
  return {asOf,cash,positions:positionsWithAllocation,securitiesValue,totalValue,costBasis,unrealizedPnL,realizedPnL,income,totalFees,totalTaxes,externalFlows,completeMarks,warnings};
}

export function netExternalFlowForDate(transactions=[], date){
  const target = normalizeDate(date,{rejectFuture:false});
  return transactions.filter(t=>t.date===target).reduce((s,t)=>{
    const type=String(t.type).toUpperCase();
    if(type==='DEPOSIT') return s+Number(t.amount||0);
    if(type==='WITHDRAWAL') return s-Number(t.amount||0);
    if(type==='OPENING_POSITION') return s+openingPositionExternalValue(t);
    return s;
  },0);
}

export function performanceFromSnapshots(snapshots=[]){
  const s=[...snapshots].sort((a,b)=>a.date.localeCompare(b.date)).filter(x=>Number.isFinite(Number(x.portfolioValue)));
  if(s.length<2) return {ready:false,reason:'At least 2 dated snapshots are required.',points:s};
  const blocked=s.find(x=>x.completeMarks===false || x.markIntegrity==='stale_or_incomplete' || (x.positions||[]).some(p=>p.priceSource==='cost_basis_fallback'||p.staleMark===true));
  if(blocked) return {ready:false,reason:`Performance locked: snapshot ${blocked.date} has incomplete or stale marks.`,points:s};
  let growth=1; const series=[100]; const daily=[];
  for(let i=1;i<s.length;i++){
    const prev=Number(s[i-1].portfolioValue); const cur=Number(s[i].portfolioValue); const flow=Number(s[i].netExternalFlow||0);
    if(prev<=0){ series.push(series.at(-1)); continue; }
    const r=(cur-flow-prev)/prev; daily.push(r); growth*=1+r; series.push(growth*100);
  }
  let peak=series[0], maxDD=0;
  for(const v of series){ peak=Math.max(peak,v); maxDD=Math.min(maxDD,(v-peak)/peak); }
  const mean=daily.reduce((a,b)=>a+b,0)/(daily.length||1);
  const variance=daily.length>1 ? daily.reduce((s,r)=>s+(r-mean)**2,0)/(daily.length-1) : 0;
  const vol=Math.sqrt(variance)*Math.sqrt(252);
  const annualizedReturn=(growth**(252/Math.max(1,daily.length)))-1;
  const sharpe=vol>0 ? annualizedReturn/vol : null;
  const bench=s.map(x=>({...x,_spy:Number(x.spyPrice ?? x.sp500Level)})).filter(x=>Number.isFinite(x._spy)&&x._spy>0);
  const benchReturn=bench.length>=2 ? bench.at(-1)._spy/bench[0]._spy-1 : null;
  return {ready:true,totalReturn:growth-1,maxDrawdown:maxDD,annualizedVol:vol,riskAdjusted:sharpe,benchmarkReturn:benchReturn,series,points:s};
}
