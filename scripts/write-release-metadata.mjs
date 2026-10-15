import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
let commit=String(process.env.COMMIT_REF||'');
if(!/^[a-f0-9]{40}$/i.test(commit))commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/i.test(commit))throw new Error('RELEASE_COMMIT_REQUIRED');
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const requiredMigrations=(await fs.readdir('netlify/database/migrations')).sort();
await fs.writeFile('public/release.json',JSON.stringify({commit,version:pkg.version,builtAt:new Date().toISOString(),requiredMigrations})+'\n');
