import {configurePersistenceForRequest} from '../lib/store.mjs';
import {validInternal} from '../lib/internal.mjs';
import {getEnv} from '../lib/env.mjs';
import {json} from '../lib/http.mjs';
import {collectConsentedGlobalTrace} from '../lib/global-trace-collection.mjs';
import {assessCollectiveLearningReference} from '../lib/learning-evidence.mjs';

// Server-to-server only. There is no customer-facing/global metrics endpoint.
export default async(req,context)=>{
  configurePersistenceForRequest(context);
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(!validInternal(req))return json({error:'FORBIDDEN'},403);
  if(String(getEnv('KAIROS_GLOBAL_TRACE_COLLECTION_ENABLED','false')).toLowerCase()!=='true')
    return json({error:'GLOBAL_TRACE_COLLECTION_DISABLED'},409);
  try{
    const aggregate=await collectConsentedGlobalTrace();
    return json({ok:true,...aggregate,learningLabReference:assessCollectiveLearningReference(aggregate)});
  }catch{
    // Do not disclose tenant IDs or individual metrics through error messages.
    return json({error:'GLOBAL_TRACE_COLLECTION_UNAVAILABLE'},503);
  }
};
