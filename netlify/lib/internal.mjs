import { getEnv } from './env.mjs';
import crypto from 'node:crypto';
function internalSecret(){
  const secret=String(getEnv('HADES_INTERNAL_SECRET')||getEnv('SAURON_SESSION_SECRET')||'').trim();
  if(!secret) throw new Error('HADES_INTERNAL_SECRET_MISSING');
  return secret;
}
export function internalToken(){
  const site=String(getEnv('NETLIFY_SITE_ID','site'));
  return crypto.createHmac('sha256',internalSecret()).update(`hades-internal:${site}:v1`).digest('hex');
}
export function validInternal(req){
  let expected; try{ expected=internalToken(); }catch{return false;}
  const got=req.headers.get('x-sauron-internal')||'';
  const a=Buffer.from(got),b=Buffer.from(expected); return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
