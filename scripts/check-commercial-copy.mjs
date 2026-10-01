import fs from 'node:fs';

const files=['public/index.html','public/app.js','public/manifest.webmanifest'];
const rules=[
  ['guaranteed_return',/\bguarantee(?:d|s|ing)?\s+(?:a\s+)?(?:return|returns|profit|profits)\b/i],
  ['beat_market_promise',/\b(?:will|can|designed\s+to)\s+beat\s+(?:the\s+market|spy)\b/i],
  ['get_rich',/\bget\s+rich\b/i],
  ['risk_free_profit',/\brisk[- ]free\s+(?:return|returns|profit|profits|investment)\b/i],
  ['assured_profit',/\bassured\s+(?:return|returns|profit|profits)\b/i],
  ['will_outperform',/\bwill\s+outperform\b/i]
];
let failures=0;
for(const path of files){
  const text=fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
  for(const [id,re] of rules){
    const match=text.match(re);
    if(match){ console.error('COMMERCIAL_COPY_FAIL',id,path,JSON.stringify(match[0])); failures++; }
  }
}
if(failures) process.exit(1);
console.log('commercial-copy: PASS');
