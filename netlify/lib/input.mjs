import crypto from 'node:crypto';

const SYMBOL_RE=/^[A-Z0-9][A-Z0-9.\-]{0,23}$/;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeSymbolInput(value,{required=false}={}){
  const s=String(value||'').trim().toUpperCase();
  if(!s){ if(required) throw new Error('SYMBOL_REQUIRED'); return ''; }
  if(!SYMBOL_RE.test(s)) throw new Error('INVALID_SYMBOL');
  return s;
}

export function normalizeSymbolList(values,{max=100}={}){
  const out=[];
  for(const raw of Array.isArray(values)?values:[]){
    let s=''; try{ s=normalizeSymbolInput(raw); }catch{ continue; }
    if(s && !out.includes(s)) out.push(s);
    if(out.length>=max) break;
  }
  return out;
}

export function normalizeJobId(value){
  const s=String(value||'').trim();
  if(!s) return crypto.randomUUID();
  if(!UUID_RE.test(s)) throw new Error('INVALID_JOB_ID');
  return s;
}

export function validJobId(value){
  return UUID_RE.test(String(value||'').trim());
}

export function declaredBodyTooLarge(req,maxBytes){
  const n=Number(req?.headers?.get?.('content-length')||0);
  return Number.isFinite(n) && n>Number(maxBytes||0);
}
