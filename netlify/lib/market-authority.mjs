import { isStaleMark } from './portfolio.mjs';
const VERIFIED_MARK_SOURCES=new Set(['twelve_data','finnhub','licensed_market_feed','twelve_data+finnhub_sticky']);
function finitePositive(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null;}
export function freshMark(marks,symbol){
  const mark=marks?.[symbol];
  const price=finitePositive(mark?.price);
  if(!price || mark?.stale===true || isStaleMark(mark)) return null;
  if(mark?.manual===true || ['unverified','operator-attested'].includes(String(mark?.license_id||'')) || !mark?.license_id) return null;
  if(!VERIFIED_MARK_SOURCES.has(String(mark?.source||'').toLowerCase())) return null;
  return {price,mark};
}
