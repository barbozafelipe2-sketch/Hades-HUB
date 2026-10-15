import fs from 'node:fs/promises';
const sources=['public/ui/tokens.css','public/styles.css','public/ui-reference.css','public/broker.css','public/v7.css','public/ui/paper-build.css'];
const output=(await Promise.all(sources.map(async path=>`/* Source: ${path} */\n${await fs.readFile(path,'utf8')}`))).join('\n');
if(process.argv.includes('--check')){
  if(await fs.readFile('public/app.css','utf8').catch(()=>'')!==output)throw new Error('STALE_STYLESHEET_BUNDLE: run npm run styles');
}else await fs.writeFile('public/app.css',output);
