import { requireSession } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { getTraceStatus } from '../lib/state.mjs';
import { missingTraceDates, marketDate } from '../lib/trace.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);
  const status=await getTraceStatus(); const today=marketDate();
  const missing=await missingTraceDates(today,90);
  return json({status,today,missing,needsCatchup:missing.length>0});
};
