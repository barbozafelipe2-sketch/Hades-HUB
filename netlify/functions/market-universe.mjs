import { requireSession } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { buildUniverseView } from '../lib/market-universe.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='GET') return json({error:'METHOD_NOT_ALLOWED'},405);
  return json({ok:true,assets:await buildUniverseView(),generatedAt:new Date().toISOString()});
};
