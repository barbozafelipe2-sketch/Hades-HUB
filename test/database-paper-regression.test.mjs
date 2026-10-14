import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { getPaperTransactions, replacePaperTransactions, replaceRelationalPaperOrders, getRelationalPaperOrders } from '../netlify/lib/database.mjs';

const url=process.env.KAIROS_TEST_DATABASE_URL;
if(!url){console.log('database-paper-regression: SKIP (KAIROS_TEST_DATABASE_URL unset)');process.exit(0);}
process.env.KAIROS_DATA_BACKEND='postgres';
process.env.NETLIFY_DB_URL=url;
delete process.env.KAIROS_DATABASE_QA_MEMORY;
const client=new pg.Client({connectionString:url});
await client.connect();
try{
  const root=new URL('../netlify/database/migrations/',import.meta.url);
  const migration='20261014000100_tenant-paper-accounts';
  for(const dir of (await fs.readdir(root)).sort()){
    if(dir===migration)continue;
    await client.query(await fs.readFile(new URL(`${dir}/migration.sql`,root),'utf8'));
  }
  // Reproduce the deployed schema with an existing account and child record.
  await client.query('TRUNCATE paper_accounts CASCADE');
  await client.query("INSERT INTO paper_accounts(id,tenant_id) VALUES ('paper-main','regression-a')");
  await client.query("INSERT INTO paper_orders(id,tenant_id,account_id,idempotency_key,symbol,side,quantity) VALUES ('regression-order','regression-a','paper-main','regression-order','AAPL','buy',1)");
  const fix=await fs.readFile(new URL(`${migration}/migration.sql`,root),'utf8');
  await client.query(fix);
  await client.query(fix);
  await Promise.all([getPaperTransactions('regression-a'),getPaperTransactions('regression-b')]);
  const accounts=await client.query("SELECT tenant_id FROM paper_accounts WHERE id='paper-main'");
  assert.equal(accounts.rowCount,2,'the runtime must create one paper-main account per tenant');
  assert.equal((await getRelationalPaperOrders('regression-a')).length,1,'migration must preserve existing orders');
  await replacePaperTransactions('regression-b',[{id:'regression-deposit',type:'DEPOSIT',amount:500}]);
  assert.equal((await getPaperTransactions('regression-a')).length,0);
  assert.equal((await getPaperTransactions('regression-b')).length,1);
  const order={id:'regression-order',symbol:'AAPL',side:'BUY',quantity:1,status:'OPEN'};
  await replaceRelationalPaperOrders('regression-a',[order]);
  const marketEvidence={source:'licensed_market_feed',asof:'2026-10-14T12:00:00Z',exchange:'NASDAQ',delay_class:'real_time',license_id:'regression-license',point_in_time:false};
  await replaceRelationalPaperOrders('regression-a',[{...order,status:'FILLED',fillPrice:100,marketEvidence}]);
  const saved=(await client.query("SELECT * FROM paper_orders WHERE tenant_id='regression-a' AND id='regression-order'")).rows[0];
  assert.equal(saved.status,'filled');assert.equal(Number(saved.execution_price),100);
  for(const key of ['source','exchange','delay_class','license_id','point_in_time'])assert.equal(saved[key],marketEvidence[key]);
  assert.equal(saved.asof.toISOString(),'2026-10-14T12:00:00.000Z');
  assert.equal((await getRelationalPaperOrders('regression-b')).length,0);
  console.log('database-paper-regression: PASS (existing data, two runtime tenants, pending fill provenance)');
}finally{await client.end();}
// The application database pool is intentionally process-scoped.
process.exit(0);
