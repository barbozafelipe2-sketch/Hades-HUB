-- Additive commercial ledger: legacy JSON remains readable and is never dropped.
CREATE TABLE IF NOT EXISTS paper_accounts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  cash_balance numeric(24,8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (currency ~ '^[A-Z]{3}$')
);
CREATE INDEX IF NOT EXISTS paper_accounts_tenant_idx ON paper_accounts(tenant_id);

CREATE TABLE IF NOT EXISTS paper_transactions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  account_id text NOT NULL,
  idempotency_key text NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('OPENING_POSITION','BUY','SELL','DEPOSIT','WITHDRAWAL','DIVIDEND','INTEREST','FEE','TAX')),
  symbol text,
  quantity numeric(24,8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_price numeric(24,8) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount numeric(24,8) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  source text,
  asof timestamptz,
  exchange text,
  delay_class text,
  license_id text,
  point_in_time boolean,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES paper_accounts(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS paper_transactions_account_idx ON paper_transactions(tenant_id, account_id, created_at);

CREATE TABLE IF NOT EXISTS paper_orders (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  account_id text NOT NULL,
  idempotency_key text NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  quantity numeric(24,8) NOT NULL CHECK (quantity > 0),
  filled_quantity numeric(24,8) NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0 AND filled_quantity <= quantity),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','filled','cancelled','rejected')),
  execution_price numeric(24,8),
  source text,
  asof timestamptz,
  exchange text,
  delay_class text,
  license_id text,
  point_in_time boolean,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES paper_accounts(tenant_id, id),
  CHECK (status <> 'filled' OR (filled_quantity = quantity AND execution_price > 0 AND source <> 'manual' AND license_id IS NOT NULL AND license_id <> 'unverified'))
);
CREATE INDEX IF NOT EXISTS paper_orders_account_idx ON paper_orders(tenant_id, account_id, created_at);

CREATE TABLE IF NOT EXISTS paper_marks (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  account_id text NOT NULL,
  symbol text NOT NULL,
  price numeric(24,8) NOT NULL CHECK (price > 0),
  source text NOT NULL,
  asof timestamptz NOT NULL,
  exchange text,
  delay_class text,
  license_id text,
  point_in_time boolean NOT NULL DEFAULT false,
  manual boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_id, symbol, asof, source),
  FOREIGN KEY (tenant_id, account_id) REFERENCES paper_accounts(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS paper_marks_latest_idx ON paper_marks(tenant_id, account_id, symbol, asof DESC);

CREATE TABLE IF NOT EXISTS decisions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  idempotency_key text NOT NULL,
  symbol text NOT NULL,
  reference_price numeric(24,8),
  source text,
  asof timestamptz,
  exchange text,
  delay_class text,
  license_id text,
  point_in_time boolean,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS decisions_tenant_created_idx ON decisions(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decision_outcomes (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  decision_id text NOT NULL,
  checkpoint_days integer NOT NULL CHECK (checkpoint_days > 0),
  outcome_return numeric(18,8),
  benchmark_return numeric(18,8),
  relative_return numeric(18,8),
  source text,
  asof timestamptz,
  exchange text,
  delay_class text,
  license_id text,
  point_in_time boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, decision_id, checkpoint_days),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, decision_id) REFERENCES decisions(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  symbol text NOT NULL,
  value_kind text NOT NULL CHECK (value_kind IN ('quote','close','benchmark')),
  value numeric(24,8) NOT NULL CHECK (value > 0),
  source text NOT NULL,
  asof timestamptz NOT NULL,
  exchange text,
  delay_class text NOT NULL,
  license_id text NOT NULL,
  point_in_time boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, symbol, value_kind, asof, source)
);
CREATE INDEX IF NOT EXISTS market_snapshots_lookup_idx ON market_snapshots(tenant_id, symbol, asof DESC);

CREATE TABLE IF NOT EXISTS entitlements (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  plan text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  idempotency_key text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS entitlements_tenant_effective_idx ON entitlements(tenant_id, effective_at DESC);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  idempotency_key text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_usd numeric(18,8) NOT NULL DEFAULT 0 CHECK (estimated_usd >= 0),
  feature text NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, request_id)
);
CREATE INDEX IF NOT EXISTS usage_ledger_tenant_created_idx ON usage_ledger(tenant_id, created_at DESC);

-- The account lock is held by the transaction that performs position/cash updates.
-- This trigger is the database-level oversell guard, including concurrent writers.
CREATE OR REPLACE FUNCTION kairos_guard_paper_oversell() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE available numeric(24,8);
BEGIN
  IF NEW.transaction_type <> 'SELL' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id || ':' || NEW.account_id || ':' || NEW.symbol, 0));
  SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('OPENING_POSITION','BUY') THEN quantity WHEN transaction_type='SELL' THEN -quantity ELSE 0 END),0)
    INTO available FROM paper_transactions
    WHERE tenant_id=NEW.tenant_id AND account_id=NEW.account_id AND symbol=NEW.symbol AND id<>NEW.id;
  IF NEW.quantity > available THEN RAISE EXCEPTION 'PAPER_ORDER_OVERSELL' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='paper_transactions_oversell_guard') THEN
    CREATE TRIGGER paper_transactions_oversell_guard BEFORE INSERT OR UPDATE ON paper_transactions FOR EACH ROW EXECUTE FUNCTION kairos_guard_paper_oversell();
  END IF;
END $$;

-- Exactly-once, non-destructive import marker for the bootstrap owner. The JSON
-- source remains intact; runtime import code records a marker after successful copy.
CREATE TABLE IF NOT EXISTS kairos_migration_markers (
  tenant_id text NOT NULL,
  marker text NOT NULL,
  source_key text NOT NULL,
  source_hash text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, marker)
);

ALTER TABLE paper_transactions ADD COLUMN IF NOT EXISTS order_id text;
CREATE UNIQUE INDEX IF NOT EXISTS paper_transactions_fill_unique
  ON paper_transactions (tenant_id, order_id) WHERE order_id IS NOT NULL;
