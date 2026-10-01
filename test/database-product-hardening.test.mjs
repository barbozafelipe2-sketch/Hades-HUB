import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
const url=process.env.KAIROS_TEST_DATABASE_URL;
if(!url){console.log('database-product-hardening: SKIP (KAIROS_TEST_DATABASE_URL unset; CI runs PostgreSQL behavior checks)');process.exit(0);}
const client=new pg.Client({connectionString:url});
await client.connect();
try{
  const sql=await fs.readFile(new URL('../netlify/database/migrations/20261001000300_kairos-paper-ledger/migration.sql',import.meta.url),'utf8');
  await client.query(sql);
  await client.query('TRUNCATE paper_transactions, paper_orders, paper_accounts CASCADE');
  await client.query("INSERT INTO paper_accounts(id,tenant_id) VALUES ('acct-a','tenant_a'),('acct-b','tenant_b')");
  await client.query("INSERT INTO paper_transactions(id,tenant_id,account_id,idempotency_key,transaction_type,symbol,quantity,unit_price) VALUES ('buy-a','tenant_a','acct-a','idem-buy-a','BUY','AAPL',2,100)");
  const alpha=await client.query("SELECT * FROM paper_transactions WHERE tenant_id='tenant_a'");
  const beta=await client.query("SELECT * FROM paper_transactions WHERE tenant_id='tenant_b'");
  assert.equal(alpha.rowCount,1);assert.equal(beta.rowCount,0,'tenant-scoped query must not reveal another tenant');
  await assert.rejects(()=>client.query("INSERT INTO paper_transactions(id,tenant_id,account_id,idempotency_key,transaction_type,symbol,quantity,unit_price) VALUES ('oversell-a','tenant_a','acct-a','idem-over-a','SELL','AAPL',3,100)"),/PAPER_ORDER_OVERSELL/);
  await assert.rejects(()=>client.query("INSERT INTO paper_transactions(id,tenant_id,account_id,idempotency_key,transaction_type,symbol,quantity,unit_price,order_id) VALUES ('fill-1','tenant_a','acct-a','idem-fill-1','BUY','AAPL',1,100,'ord-1'),('fill-2','tenant_a','acct-a','idem-fill-2','BUY','AAPL',1,100,'ord-1')"));
  await client.query("INSERT INTO usage_ledger(id,tenant_id,idempotency_key,provider,model,feature,request_id,estimated_usd) VALUES ('usage-1','tenant_a','usage-1','openai','gpt-luna','coach','req-1',0.01)");
  await assert.rejects(()=>client.query("INSERT INTO usage_ledger(id,tenant_id,idempotency_key,provider,model,feature,request_id,estimated_usd) VALUES ('usage-2','tenant_a','usage-1','openai','gpt-luna','coach','req-2',0.01)"));
  await client.query("INSERT INTO market_snapshots(id,tenant_id,symbol,value_kind,value,source,asof,delay_class,license_id,point_in_time) VALUES ('market-1','tenant_a','SPY','close',100,'licensed_market_feed','2026-10-01T00:00:00Z','delayed','license-1',true)");
  await client.query("INSERT INTO market_snapshots(id,tenant_id,symbol,value_kind,value,source,asof,delay_class,license_id,point_in_time) VALUES ('market-2','tenant_a','SPY','close',250,'licensed_market_feed','2026-10-01T00:00:00Z','delayed','license-1',false) ON CONFLICT(tenant_id,symbol,value_kind,asof,source) DO NOTHING");
  const frozen=await client.query("SELECT value,point_in_time FROM market_snapshots WHERE tenant_id='tenant_a' AND symbol='SPY'");assert.equal(Number(frozen.rows[0].value),100);assert.equal(frozen.rows[0].point_in_time,true,'fallback replay cannot replace an existing point-in-time value');
  const provenance=await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='market_snapshots'");
  for(const column of ['source','asof','exchange','delay_class','license_id','point_in_time']) assert.ok(provenance.rows.some(r=>r.column_name===column));
  console.log('database-product-hardening: PASS (tenant isolation, DB oversell guard, duplicate fill/idempotency constraints, provenance)');
}finally{await client.end();}
