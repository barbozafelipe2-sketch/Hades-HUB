import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { getJSON } from '../lib/store.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { getPaperOrders } from '../lib/state.mjs';
import { recordDecisionResponse } from '../lib/database.mjs';
import { normalizeJobId, declaredBodyTooLarge } from '../lib/input.mjs';

const ALLOWED_RESPONSES=new Set(['followed','adapted','no_action']);

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req);if(!session)return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(declaredBodyTooLarge(req,8000))return json({error:'PAYLOAD_TOO_LARGE'},413);
  let body;try{body=await readJSON(req,{maxBytes:8000});}catch(e){return json({error:String(e?.message||'INVALID_JSON')},400);}
  let decisionId,idempotencyKey,paperOrderId=null;
  try{
    decisionId=normalizeJobId(body.decisionId);
    idempotencyKey=normalizeJobId(body.idempotencyKey);
    if(body.paperOrderId)paperOrderId=normalizeJobId(body.paperOrderId);
  }catch(e){return json({error:String(e.message||'INVALID_ID')},400);}
  const response=String(body.response||'');if(!ALLOWED_RESPONSES.has(response))return json({error:'INVALID_DECISION_RESPONSE'},400);
  const decision=await getJSON(`decisions/${decisionId}`,null);
  if(!decision||String(decision.id)!==decisionId)return json({error:'DECISION_NOT_FOUND'},404);
  if(paperOrderId){
    const orders=await getPaperOrders();
    const order=(orders||[]).find(row=>String(row.id)===paperOrderId);
    if(!order||String(order.symbol||'').toUpperCase()!==String(decision.asset||'').toUpperCase())return json({error:'PAPER_ORDER_NOT_LINKABLE'},400);
  }
  try{
    const saved=await recordDecisionResponse({tenantId:session.tenantId,userId:session.userId,decision,response,paperOrderId,idempotencyKey});
    return json({ok:true,response:saved});
  }catch(e){
    const code=String(e?.message||'DECISION_RESPONSE_FAILED');
    const status=code==='DECISION_RESPONSE_REFERENCE_INVALID'||code==='IDEMPOTENCY_KEY_REUSED'?409:500;
    return json({error:code},status);
  }
};
