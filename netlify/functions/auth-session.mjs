import { requireSession, publicAuthState } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req);
  if(!session) return json({ok:false},401);
  return json({ok:true,session,auth:await publicAuthState(session)});
};
