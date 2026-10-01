import { getEnv } from './env.mjs';

function suspicious(v){
  const s=String(v||'').trim();
  if(!s) return true;
  return /<[^>]+>|random|very[- ]long|placeholder|changeme|example|secret=|password=/i.test(s);
}
function entropyOk(v,min=32){
  const s=String(v||'').trim();
  return s.length>=min && !suspicious(s) && new Set(s).size>=10;
}
export function securityStatus(){
  const admin=String(getEnv('SAURON_ADMIN_PASSWORD')||'');
  const session=String(getEnv('SAURON_SESSION_SECRET')||'');
  const internal=String(getEnv('HADES_INTERNAL_SECRET')||'');
  const findings=[];
  if(!admin) findings.push('SAURON_ADMIN_PASSWORD_MISSING');
  else if(admin.length<12 || /^(admin123|password|hades|sauron)$/i.test(admin)) findings.push('SAURON_ADMIN_PASSWORD_WEAK');
  if(!entropyOk(session,32)) findings.push('SAURON_SESSION_SECRET_WEAK_OR_PLACEHOLDER');
  if(!entropyOk(internal,32)) findings.push('HADES_INTERNAL_SECRET_WEAK_OR_PLACEHOLDER');
  if(session && internal && session===internal) findings.push('SESSION_AND_INTERNAL_SECRET_MUST_DIFFER');
  return {
    pass:findings.length===0,
    findings,
    adminPasswordConfigured:!!admin,
    sessionSecretStrong:entropyOk(session,32),
    internalSecretStrong:entropyOk(internal,32),
    noSecretValuesExposed:true
  };
}
