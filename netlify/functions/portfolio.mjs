import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { getTransactions, saveTransactions, getMarks, saveMarks, getPortfolio, getPaperOrders, getWatchlist, saveWatchlist } from '../lib/state.mjs';
import { normalizeTransaction, derivePortfolio, normalizeSymbol } from '../lib/portfolio.mjs';
import { withKeyLock, configurePersistenceForRequest } from '../lib/store.mjs';
import { assertCommercialAccess, commercialErrorJSON, auditCommercialEvent } from '../lib/commercial-control.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req); if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method==='GET') {
    const [portfolio,orders,watchlist]=await Promise.all([getPortfolio(),getPaperOrders(),getWatchlist()]);
    return json({...portfolio,orders,watchlist});
  }
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ await assertCommercialAccess(session); }catch(e){ const ce=commercialErrorJSON(e); if(ce)return json(ce.body,ce.status); throw e; }
  const body=await readJSON(req);
  try{
    if(body.action==='addTransaction'){
      return await withKeyLock('portfolio-ledger',async()=>{
        const [txs,marks]=await Promise.all([getTransactions(),getMarks()]);
        const tx=normalizeTransaction(body.transaction||{});
        const candidate=[...txs,tx];
        const before=derivePortfolio(txs,marks); const after=derivePortfolio(candidate,marks);
        if(tx.type==='SELL' && after.warnings.length>before.warnings.length) return json({error:'SELL_EXCEEDS_POSITION'},400);
        if(tx.type==='BUY' && after.cash < -0.01 && !body.allowNegativeCash) return json({error:'INSUFFICIENT_TRACKED_CASH','message':'Add a deposit first or explicitly allow negative cash.'},400);
        await saveTransactions(candidate);
        await auditCommercialEvent(session,'paper.transaction_added',{requestId:context?.requestId,details:{action:tx.type,feature:'paper-ledger'}}).catch(()=>{});
        return json({ok:true,transaction:tx,portfolio:after});
      });
    }
    if(body.action==='deleteTransaction'){
      return await withKeyLock('portfolio-ledger',async()=>{
        const [txs,marks]=await Promise.all([getTransactions(),getMarks()]);
        const next=txs.filter(t=>t.id!==body.id); if(next.length===txs.length) return json({error:'TRANSACTION_NOT_FOUND'},404);
        await saveTransactions(next); await auditCommercialEvent(session,'paper.transaction_deleted',{requestId:context?.requestId,details:{action:'delete',feature:'paper-ledger'}}).catch(()=>{}); return json({ok:true,portfolio:derivePortfolio(next,marks)});
      });
    }
    if(body.action==='placeOrder'){
      const { executeMarketPaperOrder, placePendingPaperOrder } = await import('../lib/paper-orders.mjs');
      const orderType=String(body.order?.orderType||'MARKET').toUpperCase().replace(/\s+/g,'_');
      if(orderType==='MARKET'){
        const r=await executeMarketPaperOrder(body.order||{});
        await auditCommercialEvent(session,'paper.order_filled',{requestId:context?.requestId,details:{action:String(body.order?.side||'').toUpperCase(),feature:'paper-order'}}).catch(()=>{});
        return json({ok:true,...r});
      }
      const order=await placePendingPaperOrder(body.order||{});
      await auditCommercialEvent(session,'paper.order_opened',{requestId:context?.requestId,details:{action:order?.side||null,feature:'paper-order'}}).catch(()=>{});
      return json({ok:true,order});
    }
    if(body.action==='cancelOrder'){
      const { cancelPaperOrder } = await import('../lib/paper-orders.mjs');
      const order=await cancelPaperOrder(body.id); await auditCommercialEvent(session,'paper.order_cancelled',{requestId:context?.requestId,details:{action:'cancel',feature:'paper-order'}}).catch(()=>{}); return json({ok:true,order});
    }
    if(body.action==='processOrders'){
      const { processPendingPaperOrders } = await import('../lib/paper-orders.mjs');
      return json({ok:true,...await processPendingPaperOrders()});
    }
    if(body.action==='setWatchlist'){
      return await withKeyLock('watchlist',async()=>{ const watchlist=await saveWatchlist(body.symbols||[]); await auditCommercialEvent(session,'watchlist.updated',{requestId:context?.requestId,details:{action:'set'}}).catch(()=>{}); return json({ok:true,watchlist}); });
    }
    if(body.action==='toggleWatchlist'){
      let symbol; try{ symbol=normalizeSymbol(body.symbol); }catch(e){ return json({error:String(e.message||e)},400); } if(!symbol) return json({error:'SYMBOL_REQUIRED'},400);
      return await withKeyLock('watchlist',async()=>{
        const list=await getWatchlist(); const next=list.includes(symbol)?list.filter(x=>x!==symbol):[...list,symbol];
        const watchlist=await saveWatchlist(next); await auditCommercialEvent(session,'watchlist.updated',{requestId:context?.requestId,details:{action:'toggle'}}).catch(()=>{}); return json({ok:true,watchlist});
      });
    }
    if(body.action==='setMark'){
      let symbol; try{ symbol=normalizeSymbol(body.symbol); }catch(e){ return json({error:String(e.message||e)},400); } const price=Number(body.price);
      if(!symbol || !Number.isFinite(price) || price<=0 || price>1e9) return json({error:'INVALID_MARK'},400);
      return await withKeyLock('portfolio-ledger',async()=>{
        const [txs,marks]=await Promise.all([getTransactions(),getMarks()]);
        marks[symbol]={price,source:'manual',asOf:new Date().toISOString(),confidence:'user-entered'};
        await saveMarks(marks); await auditCommercialEvent(session,'paper.manual_mark_set',{requestId:context?.requestId,details:{action:'setMark'}}).catch(()=>{}); return json({ok:true,marks,portfolio:derivePortfolio(txs,marks)});
      });
    }
    if(body.action==='buildFromMirror' || body.action==='buildFromBudget'){
      const { buildPaperWalletFromAllocation, formatBuildSummaryText } = await import('../lib/portfolio-build.mjs');
      const result=await buildPaperWalletFromAllocation({
        budget:body.budget,
        focus:body.focus||'all',
        source:body.source||(body.action==='buildFromBudget'?'budget':'ai-mirror'),
        allocation:body.allocation,
        dryRun:body.dryRun===true
      });
      return json({ok:true,...result,message:formatBuildSummaryText(result)});
    }
    return json({error:'UNKNOWN_ACTION'},400);
  }catch(e){
    const message=String(e?.message||e||'PORTFOLIO_ACTION_FAILED');
    const status=/ORDER_NOT_FOUND/.test(message)?404:/ORDER_NOT_OPEN|FRESH_MARK_REQUIRED|INSUFFICIENT_|SELL_EXCEEDS_POSITION|PERSISTENCE_LOCK_TIMEOUT/.test(message)?409:400;
    return json({error:message,message},status);
  }
};
