import crypto from 'node:crypto';
import { getPaperOrders, savePaperOrders, getTransactions, saveTransactions, getMarks } from './state.mjs';
import { normalizeSymbol, normalizeTransaction, derivePortfolio, isStaleMark } from './portfolio.mjs';
import { withKeyLock } from './store.mjs';

const ORDER_TYPES=new Set(['LIMIT','STOP','STOP_LIMIT']);
const SIDES=new Set(['BUY','SELL']);
const VERIFIED_MARK_SOURCES=new Set(['twelve_data','finnhub','licensed_market_feed','twelve_data+finnhub_sticky']);
const MAX_ORDER_QUANTITY=1e9, MAX_ORDER_PRICE=1e9, MAX_ORDER_FEES=1e9;

function finitePositive(v){ const n=Number(v); return Number.isFinite(n)&&n>0?n:null; }
function freshMark(marks,symbol){
  const mark=marks?.[symbol];
  const price=finitePositive(mark?.price);
  if(!price || isStaleMark(mark)) return null;
  if(mark?.manual===true || ['unverified','operator-attested'].includes(String(mark?.license_id||'')) || !mark?.license_id) return null;
  if(!VERIFIED_MARK_SOURCES.has(String(mark?.source||'').toLowerCase())) return null;
  return {price,mark};
}
function triggerCondition(order,price){
  if(order.orderType==='LIMIT') return order.side==='BUY' ? price<=order.limitPrice : price>=order.limitPrice;
  if(order.orderType==='STOP') return order.side==='BUY' ? price>=order.stopPrice : price<=order.stopPrice;
  if(order.orderType==='STOP_LIMIT'){
    const stopHit=order.triggered===true || (order.side==='BUY'?price>=order.stopPrice:price<=order.stopPrice);
    const limitHit=order.side==='BUY'?price<=order.limitPrice:price>=order.limitPrice;
    return stopHit && limitHit;
  }
  return false;
}
export function normalizePaperOrder(input={}){
  const symbol=normalizeSymbol(input.symbol);
  if(!symbol) throw new Error('SYMBOL_REQUIRED');
  const side=String(input.side||'').toUpperCase();
  if(!SIDES.has(side)) throw new Error('INVALID_ORDER_SIDE');
  const orderType=String(input.orderType||'').toUpperCase().replace(/\s+/g,'_');
  if(!ORDER_TYPES.has(orderType)) throw new Error('INVALID_ORDER_TYPE');
  const quantity=finitePositive(input.quantity); if(!quantity || quantity>MAX_ORDER_QUANTITY) throw new Error('QUANTITY_OUT_OF_RANGE');
  const limitPrice=orderType.includes('LIMIT')?finitePositive(input.limitPrice):null;
  const stopPrice=orderType.includes('STOP')?finitePositive(input.stopPrice):null;
  if(orderType.includes('LIMIT')&&!limitPrice) throw new Error('LIMIT_PRICE_REQUIRED');
  if(limitPrice&&limitPrice>MAX_ORDER_PRICE) throw new Error('LIMIT_PRICE_OUT_OF_RANGE');
  if(orderType.includes('STOP')&&!stopPrice) throw new Error('STOP_PRICE_REQUIRED');
  if(stopPrice&&stopPrice>MAX_ORDER_PRICE) throw new Error('STOP_PRICE_OUT_OF_RANGE');
  const fees=Math.max(0,Number(input.fees)||0); if(fees>MAX_ORDER_FEES) throw new Error('FEES_OUT_OF_RANGE');
  return {
    id:input.id||crypto.randomUUID(), symbol, side, orderType, quantity,
    limitPrice, stopPrice, fees, status:'OPEN', triggered:false,
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    note:String(input.note||'').slice(0,240)
  };
}

async function placePendingPaperOrderUnlocked(input={}){
  const order=normalizePaperOrder(input);
  const [orders,txs,marks]=await Promise.all([getPaperOrders(),getTransactions(),getMarks()]);
  const portfolio=derivePortfolio(txs,marks);
  if(order.side==='SELL'){
    const pos=portfolio.positions.find(p=>p.symbol===order.symbol);
    const reserved=orders.filter(o=>o.status==='OPEN'&&o.side==='SELL'&&o.symbol===order.symbol).reduce((s,o)=>s+Number(o.quantity||0),0);
    if(Number(pos?.quantity||0)-reserved+1e-10<order.quantity) throw new Error('INSUFFICIENT_HOLDINGS_FOR_ORDER');
  }
  if(order.side==='BUY'){
    const basis=order.limitPrice||order.stopPrice||freshMark(marks,order.symbol)?.price;
    if(basis){
      const reserved=orders.filter(o=>o.status==='OPEN'&&o.side==='BUY').reduce((s,o)=>s+(Number(o.quantity||0)*(Number(o.limitPrice||o.stopPrice||0))+Number(o.fees||0)),0);
      if(portfolio.cash-reserved+1e-8 < order.quantity*basis+order.fees) throw new Error('INSUFFICIENT_BUYING_POWER_FOR_ORDER');
    }
  }
  orders.push(order); await savePaperOrders(orders); return order;
}

async function cancelPaperOrderUnlocked(id){
  const orders=await getPaperOrders();
  const idx=orders.findIndex(o=>o.id===id); if(idx<0) throw new Error('ORDER_NOT_FOUND');
  if(orders[idx].status!=='OPEN') throw new Error('ORDER_NOT_OPEN');
  orders[idx]={...orders[idx],status:'CANCELLED',cancelledAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  await savePaperOrders(orders); return orders[idx];
}

async function executeMarketPaperOrderUnlocked({symbol,side,quantity,fees=0,note='',orderId=null}){
  symbol=normalizeSymbol(symbol); side=String(side||'').toUpperCase();
  if(!symbol||!SIDES.has(side)) throw new Error('INVALID_MARKET_ORDER');
  quantity=finitePositive(quantity); if(!quantity || quantity>MAX_ORDER_QUANTITY) throw new Error('QUANTITY_OUT_OF_RANGE');
  fees=Math.max(0,Number(fees)||0); if(fees>MAX_ORDER_FEES) throw new Error('FEES_OUT_OF_RANGE');
  const id=orderId||crypto.randomUUID(); const txId=`paper-fill:${id}`;
  const [txs,marks,orders]=await Promise.all([getTransactions(),getMarks(),getPaperOrders()]);
  const priorTx=txs.find(t=>t.id===txId); const priorOrder=orders.find(o=>o.id===id);
  if(priorTx){
    const same=String(priorTx.type||'').toUpperCase()===side && priorTx.symbol===symbol && Math.abs(Number(priorTx.quantity||0)-quantity)<1e-10;
    if(!same) throw new Error('PAPER_FILL_IDEMPOTENCY_CONFLICT');
    const rec={id,symbol,side,orderType:'MARKET',quantity,fees:Number(priorTx.fees||fees||0),status:'FILLED',fillPrice:Number(priorTx.unitPrice),createdAt:priorOrder?.createdAt||priorTx.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),filledAt:priorOrder?.filledAt||priorTx.createdAt||new Date().toISOString(),transactionId:txId,marketEvidence:{source:priorTx.source,asof:priorTx.asof,exchange:priorTx.exchange,delay_class:priorTx.delay_class,license_id:priorTx.license_id,point_in_time:priorTx.point_in_time},note:String(priorOrder?.note||note||'')};
    if(!priorOrder || priorOrder.status!=='FILLED' || priorOrder.transactionId!==txId){
      const nextOrders=priorOrder?orders.map(o=>o.id===id?rec:o):[...orders,rec];
      await savePaperOrders(nextOrders);
    }
    return {order:rec,transaction:priorTx,portfolio:derivePortfolio(txs,marks),idempotent:true,reconciled:!priorOrder||priorOrder.status!=='FILLED'};
  }
  if(priorOrder?.status==='FILLED') throw new Error('PAPER_ORDER_FILL_TRANSACTION_MISSING');
  const fm=freshMark(marks,symbol); if(!fm) throw new Error('LICENSED_FRESH_MARK_REQUIRED');
  const before=derivePortfolio(txs,marks);
  if(side==='SELL'){ const pos=before.positions.find(p=>p.symbol===symbol); if(Number(pos?.quantity||0)+1e-10<quantity) throw new Error('SELL_EXCEEDS_POSITION'); }
  if(side==='BUY' && Number(before.cash||0)+1e-8<quantity*fm.price+fees) throw new Error('INSUFFICIENT_TRACKED_CASH');
  const tx=normalizeTransaction({id:txId,type:side,symbol,quantity,unitPrice:fm.price,fees,date:new Date().toISOString().slice(0,10),note:String(note||'Market paper order').slice(0,500),...fm.mark});
  const nextTxs=priorTx?txs:[...txs,tx];
  if(!priorTx) await saveTransactions(nextTxs);
  const rec={id,symbol,side,orderType:'MARKET',quantity,fees,status:'FILLED',fillPrice:fm.price,createdAt:priorOrder?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),filledAt:new Date().toISOString(),transactionId:txId,marketEvidence:{source:fm.mark.source,asof:fm.mark.asOf,exchange:fm.mark.exchange,delay_class:fm.mark.delay_class,license_id:fm.mark.license_id,point_in_time:fm.mark.point_in_time},note:String(note||'')};
  const nextOrders=priorOrder?orders.map(o=>o.id===id?rec:o):[...orders,rec];
  await savePaperOrders(nextOrders);
  return {order:rec,transaction:tx,portfolio:derivePortfolio(nextTxs,marks),idempotent:!!priorTx};
}

async function processPendingPaperOrdersUnlocked(){
  const [orders0,txs0,marks]=await Promise.all([getPaperOrders(),getTransactions(),getMarks()]);
  const orders=orders0.map(o=>({...o})); let txs=[...txs0]; const fills=[];
  for(let i=0;i<orders.length;i++){
    const o=orders[i]; if(o.status!=='OPEN') continue;
    const txId=`paper-fill:${o.id}`;
    const existing=txs.find(t=>t.id===txId);
    if(existing){
      const same=String(existing.type||'').toUpperCase()===o.side && existing.symbol===o.symbol && Math.abs(Number(existing.quantity||0)-Number(o.quantity||0))<1e-10;
      if(!same){ Object.assign(o,{status:'REJECTED',rejectedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reason:'PAPER_FILL_IDEMPOTENCY_CONFLICT'}); continue; }
      Object.assign(o,{status:'FILLED',fillPrice:Number(existing.unitPrice),filledAt:o.filledAt||existing.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),transactionId:existing.id,reconciled:true});
      fills.push({orderId:o.id,symbol:o.symbol,side:o.side,quantity:o.quantity,fillPrice:Number(existing.unitPrice),reconciled:true});
      continue;
    }
    const fm=freshMark(marks,o.symbol); if(!fm) continue;
    if(o.orderType==='STOP_LIMIT' && !o.triggered){
      const hit=o.side==='BUY'?fm.price>=Number(o.stopPrice):fm.price<=Number(o.stopPrice);
      if(hit){ o.triggered=true; o.triggeredAt=new Date().toISOString(); o.updatedAt=new Date().toISOString(); }
    }
    if(!triggerCondition(o,fm.price)) continue;
    try{
      const before=derivePortfolio(txs,marks);
      if(o.side==='SELL'){
        const pos=before.positions.find(p=>p.symbol===o.symbol);
        if(Number(pos?.quantity||0)+1e-10<Number(o.quantity||0)) throw new Error('SELL_EXCEEDS_POSITION');
      }
      if(o.side==='BUY' && Number(before.cash||0)+1e-8 < Number(o.quantity||0)*fm.price+Number(o.fees||0)) throw new Error('INSUFFICIENT_TRACKED_CASH_AT_FILL');
      const tx=normalizeTransaction({id:txId,type:o.side,symbol:o.symbol,quantity:o.quantity,unitPrice:fm.price,fees:o.fees,date:new Date().toISOString().slice(0,10),note:`Filled ${o.orderType} paper order${o.note?` · ${o.note}`:''}`,...fm.mark});
      derivePortfolio([...txs,tx],marks);
      txs.push(tx);
      Object.assign(o,{status:'FILLED',fillPrice:fm.price,marketEvidence:{source:fm.mark.source,asof:fm.mark.asOf,exchange:fm.mark.exchange,delay_class:fm.mark.delay_class,license_id:fm.mark.license_id,point_in_time:fm.mark.point_in_time},filledAt:new Date().toISOString(),updatedAt:new Date().toISOString(),transactionId:tx.id});
      fills.push({orderId:o.id,symbol:o.symbol,side:o.side,quantity:o.quantity,fillPrice:fm.price});
    }catch(e){
      Object.assign(o,{status:'REJECTED',rejectedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reason:String(e.message||e)});
    }
  }
  if(txs.length!==txs0.length) await saveTransactions(txs);
  if(JSON.stringify(orders)!==JSON.stringify(orders0)) await savePaperOrders(orders);
  return {fills,orders};
}


export async function placePendingPaperOrder(input={}){
  return await withKeyLock('portfolio-ledger',()=>placePendingPaperOrderUnlocked(input));
}
export async function cancelPaperOrder(id){
  return await withKeyLock('portfolio-ledger',()=>cancelPaperOrderUnlocked(id));
}
export async function executeMarketPaperOrder(input={}){
  return await withKeyLock('portfolio-ledger',()=>executeMarketPaperOrderUnlocked(input));
}
export async function processPendingPaperOrders(){
  return await withKeyLock('portfolio-ledger',()=>processPendingPaperOrdersUnlocked());
}
