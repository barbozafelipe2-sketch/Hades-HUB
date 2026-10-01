import { requireSession } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { getJSON, configurePersistenceForRequest } from '../lib/store.mjs';
import { validJobId } from '../lib/input.mjs';
export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  const id=new URL(req.url).searchParams.get('id'); if(!id) return json({error:'JOB_ID_REQUIRED'},400); if(!validJobId(id)) return json({error:'INVALID_JOB_ID'},400);
  const job=await getJSON(`jobs/ai-mirror/${id}`,null); if(!job) return json({error:'JOB_NOT_FOUND'},404);
  return json(job);
};
