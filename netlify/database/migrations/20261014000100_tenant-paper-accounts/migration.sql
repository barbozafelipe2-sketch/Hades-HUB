-- Account names are local to a tenant. Preserve existing IDs and every foreign
-- key while allowing each workspace to use its own paper-main account.
BEGIN;
ALTER TABLE paper_accounts DROP CONSTRAINT IF EXISTS paper_accounts_pkey;
ALTER TABLE paper_accounts ADD PRIMARY KEY (tenant_id, id);
COMMIT;
