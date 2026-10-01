import { requireSession } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { buildPerformanceMirror } from '../lib/mirror-performance.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='GET') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{return json(await buildPerformanceMirror());}
  catch(e){return json({error:String(e.message||e)},500);}
};
