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
  // Tenant identifiers and full mark replacement must survive round trips.
  await replacePaperTransactions('regression-a',[{id:'same-backup-id',type:'DEPOSIT',amount:50}]);
  await replacePaperTransactions('regression-b',[{id:'same-backup-id',type:'DEPOSIT',amount:75}]);
  assert.equal((await getPaperTransactions('regression-a'))[0].amount,50);
  assert.equal((await getPaperTransactions('regression-b'))[0].amount,75);
  const {replacePaperMarks,getPaperMarks}=await import('../netlify/lib/database.mjs');
  const mark={price:100,source:'licensed_market_feed',license_id:'test-license',asOf:'2026-10-01T12:00:00Z'};
  await replacePaperMarks('regression-a',{AAPL:mark});
  await replacePaperMarks('regression-a',{AAPL:{...mark,price:80,asOf:'2026-09-01T12:00:00Z'}});
  assert.equal((await getPaperMarks('regression-a')).AAPL.price,80);
  await replacePaperMarks('regression-a',{});assert.deepEqual(await getPaperMarks('regression-a'),{});
  const store=await import('../netlify/lib/store.mjs');
  const state=await import('../netlify/lib/state.mjs');
  const lifecycle=await import('../netlify/lib/data-lifecycle.mjs');
  store.configurePersistenceForRequest({});
  store.configureTenantForRequest({tenantId:'t_fixlegacy',role:'owner',userId:'fix-user'});
  await store.setJSON('portfolio/transactions',[{id:'blob-legacy-deposit',type:'DEPOSIT',amount:90,date:'2026-10-01'}]);
  await client.query("DELETE FROM kairos_migration_markers WHERE tenant_id=$1",[store.databaseTenantScope()]);
  assert.equal((await state.getTransactions())[0].id,'blob-legacy-deposit');
  const tenantId='t_fixdelete',jobId='test-delete';
  store.configureTenantForRequest({tenantId,role:'owner',userId:'fix-user'});
  await store.setSystemJSON('auth/tenants/'+tenantId,{id:tenantId,status:'deleting',deletionJobId:jobId});
  await state.saveTransactions([{id:'deleted-deposit',type:'DEPOSIT',amount:123,date:'2026-10-01'}]);
  const scope=store.databaseTenantScope();
  await lifecycle.purgeKairosTenantData({tenantId,jobId});
  assert.equal((await client.query('SELECT count(*)::int n FROM paper_transactions WHERE tenant_id=$1',[scope])).rows[0].n,0);
  assert.equal((await client.query('SELECT count(*)::int n FROM paper_accounts WHERE tenant_id=$1',[scope])).rows[0].n,0);
  console.log('database-paper-regression: PASS (existing data, two runtime tenants, pending fill provenance)');
}finally{await client.end();}
// The application database pool is intentionally process-scoped.
process.exit(0);
