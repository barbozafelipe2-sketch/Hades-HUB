const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function lineChart(s1=[],s2=null,s3=null,colors=['#f2c94c','#b8c4d6','#ffae42']){
  const dated=[s1,s2,s3].some(s=>s?.some(p=>p&&typeof p==='object'&&p.date));
  const series=[s1,s2,s3].map((s,index)=>({index,points:(s||[]).map((p,i)=>({x:dated?Date.parse(p?.date):i,value:typeof p==='object'?Number(p.value):Number(p)})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.value))})).filter(s=>s.points.length);
  if(!series.length)return '<div class="alert warn">No chart observations yet.</div>';
  const all=series.flatMap(s=>s.points),W=760,H=270,P=30,min=Math.min(...all.map(p=>p.value)),max=Math.max(...all.map(p=>p.value)),left=Math.min(...all.map(p=>p.x)),right=Math.max(...all.map(p=>p.x));
  const path=s=>s.map((p,i)=>`${i?'L':'M'} ${(P+(p.x-left)*(W-2*P)/(right-left||1)).toFixed(1)} ${(H-P-(p.value-min)/(max-min||1)*(H-2*P)).toFixed(1)}`).join(' ');
  const label=x=>dated?new Date(x).toISOString().slice(0,10):`Point ${x+1}`;
  return `<svg class="chart chart-glow" role="img" aria-label="Recorded series from ${esc(label(left))} to ${esc(label(right))}" viewBox="0 0 ${W} ${H}"><title>Recorded observations</title><desc>Range ${min.toFixed(2)} to ${max.toFixed(2)}. Missing series are omitted.</desc>${series.map(s=>`<path d="${path(s.points)}" fill="none" stroke="${colors[s.index]||colors[0]}" stroke-width="${s.index?2.2:3}"/>`).join('')}<text x="${P}" y="${H-5}" fill="currentColor" font-size="12">${esc(label(left))}</text><text x="${W-P}" y="${H-5}" text-anchor="end" fill="currentColor" font-size="12">${esc(label(right))}</text></svg>`;
}
