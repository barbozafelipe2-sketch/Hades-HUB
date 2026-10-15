-- Preserve records and composite foreign keys; remove global identifier collisions.
ALTER TABLE paper_transactions DROP CONSTRAINT IF EXISTS paper_transactions_pkey;
ALTER TABLE paper_transactions ADD CONSTRAINT paper_transactions_pkey PRIMARY KEY (tenant_id,id);
ALTER TABLE paper_orders DROP CONSTRAINT IF EXISTS paper_orders_pkey;
ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_pkey PRIMARY KEY (tenant_id,id);
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_pkey;
ALTER TABLE decisions ADD CONSTRAINT decisions_pkey PRIMARY KEY (tenant_id,id);
ALTER TABLE decision_outcomes DROP CONSTRAINT IF EXISTS decision_outcomes_pkey;
ALTER TABLE decision_outcomes ADD CONSTRAINT decision_outcomes_pkey PRIMARY KEY (tenant_id,id);
ALTER TABLE decision_responses DROP CONSTRAINT IF EXISTS decision_responses_pkey;
ALTER TABLE decision_responses ADD CONSTRAINT decision_responses_pkey PRIMARY KEY (tenant_id,id);
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS entitlements_pkey;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_pkey PRIMARY KEY (tenant_id,id);
ALTER TABLE usage_ledger DROP CONSTRAINT IF EXISTS usage_ledger_pkey;
ALTER TABLE usage_ledger ADD CONSTRAINT usage_ledger_pkey PRIMARY KEY (tenant_id,id);
