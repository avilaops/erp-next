CREATE TABLE registration_settings (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 section text NOT NULL CHECK (section IN ('products','parties','contact-types','tax-profiles')),
 data jsonb NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,section)
);
ALTER TABLE registration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY registration_settings_isolation ON registration_settings
 USING(tenant_id=current_setting('app.tenant_id',true)::uuid)
 WITH CHECK(tenant_id=current_setting('app.tenant_id',true)::uuid);
