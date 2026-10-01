export function json(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
}
export async function readJSON(req,{maxBytes=65536}={}){
  const declared=Number(req.headers.get('content-length')||0);
  if(Number.isFinite(declared) && declared>maxBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
  const reader=req.body?.getReader?.();
  if(!reader){ try{return await req.json();}catch{return {};} }
  const chunks=[]; let total=0;
  try{
    while(true){
      const {done,value}=await reader.read(); if(done) break;
      total += value?.byteLength||0;
      if(total>maxBytes){ try{await reader.cancel();}catch{} throw new Error('REQUEST_BODY_TOO_LARGE'); }
      chunks.push(value);
    }
    const bytes=new Uint8Array(total); let off=0;
    for(const c of chunks){ bytes.set(c,off); off+=c.byteLength; }
    if(!bytes.length) return {};
    try{return JSON.parse(new TextDecoder().decode(bytes));}catch{return {};}
  }finally{ try{reader.releaseLock();}catch{} }
}


export async function readText(req,{maxBytes=262144}={}){
  const declared=Number(req.headers.get('content-length')||0);
  if(Number.isFinite(declared) && declared>maxBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
  const reader=req.body?.getReader?.();
  if(!reader) return await req.text();
  const chunks=[]; let total=0;
  try{
    while(true){
      const {done,value}=await reader.read(); if(done) break;
      total += value?.byteLength||0;
      if(total>maxBytes){ try{await reader.cancel();}catch{} throw new Error('REQUEST_BODY_TOO_LARGE'); }
      chunks.push(value);
    }
    const bytes=new Uint8Array(total); let off=0;
    for(const c of chunks){ bytes.set(c,off); off+=c.byteLength; }
    return new TextDecoder().decode(bytes);
  }finally{ try{reader.releaseLock();}catch{} }
}
