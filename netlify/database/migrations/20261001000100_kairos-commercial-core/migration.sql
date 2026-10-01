CREATE TABLE IF NOT EXISTS kairos_system_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kairos_tenant_state (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS kairos_tenant_state_tenant_updated_idx
  ON kairos_tenant_state (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS kairos_system_state_updated_idx
  ON kairos_system_state (updated_at DESC);
