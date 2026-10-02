-- Append-only user-declared response history for Decision Review.
-- Responses describe what the user says they did; they do not establish causality.
CREATE TABLE IF NOT EXISTS decision_responses (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  decision_id text NOT NULL,
  user_id text,
  response text NOT NULL CHECK (response IN ('followed','overrode','no_action')),
  paper_order_id text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 220),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, decision_id) REFERENCES decisions(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS decision_responses_latest_idx
  ON decision_responses (tenant_id, decision_id, created_at DESC, id DESC);

-- The event is an append-only declaration. Applications should add a new row
-- when the user changes their answer; do not overwrite earlier responses.
