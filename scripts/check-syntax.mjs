import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots=['netlify','public','test'];
const files=[];
function walk(dir){
  for(const name of readdirSync(dir)){
    const p=join(dir,name); const st=statSync(p);
    if(st.isDirectory()) walk(p);
    else if(['.js','.mjs','.cjs'].includes(extname(name))) files.push(p);
  }
}
for(const root of roots) walk(root);
for(const f of files.sort()){
  const r=spawnSync(process.execPath,['--check',f],{stdio:'inherit'});
  if(r.status!==0) process.exit(r.status||1);
}
console.log(`syntax PASS (${files.length} JS/MJS files)`);
