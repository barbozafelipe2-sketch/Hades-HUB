CREATE TABLE IF NOT EXISTS kairos_audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  user_id TEXT,
  event_type TEXT NOT NULL,
  request_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kairos_audit_events_tenant_created_idx
  ON kairos_audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kairos_audit_events_event_created_idx
  ON kairos_audit_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS kairos_usage_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  period TEXT NOT NULL,
  feature TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, period, idempotency_key)
);

CREATE INDEX IF NOT EXISTS kairos_usage_events_tenant_period_idx
  ON kairos_usage_events (tenant_id, period, created_at DESC);
