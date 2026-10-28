CREATE TABLE company_profiles (
    tenant_id uuid PRIMARY KEY REFERENCES tenants (id),
    revision bigint NOT NULL CHECK (revision > 0),
    details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY company_profiles_isolation ON company_profiles
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON tenants
    USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions (code, description) VALUES
    ('platform.company.read', 'Consultar dados da empresa'),
    ('platform.company.manage', 'Alterar dados da empresa')
ON CONFLICT (code) DO NOTHING;

CREATE FUNCTION reject_audit_log_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();
