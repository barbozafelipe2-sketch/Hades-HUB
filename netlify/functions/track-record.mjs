import { requireSession } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { getSnapshots,getDecisions } from '../lib/state.mjs';
import { buildTrackRecord } from '../lib/track-record.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='GET') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{
    const [snapshots,decisions]=await Promise.all([getSnapshots(),getDecisions()]);
    return json(buildTrackRecord({snapshots,decisions}));
  }catch(e){ return json({error:String(e?.message||e)},500); }
};
