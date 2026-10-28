CREATE TABLE legacy_history (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    id uuid NOT NULL,
    collection text NOT NULL,
    title text NOT NULL,
    details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
    imported_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);
CREATE INDEX legacy_history_collection ON legacy_history(tenant_id, collection, id);
CREATE TABLE legacy_files (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    id uuid NOT NULL,
    history_id uuid NOT NULL,
    filename text NOT NULL,
    media_type text NOT NULL,
    content bytea NOT NULL,
    sha256 text NOT NULL,
    PRIMARY KEY (tenant_id,id),
    FOREIGN KEY (tenant_id,history_id) REFERENCES legacy_history(tenant_id,id)
);
CREATE TABLE legacy_imports (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
    source text NOT NULL,
    manifest jsonb NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE name text; BEGIN
    FOREACH name IN ARRAY ARRAY['legacy_history','legacy_files','legacy_imports'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',name);
        EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes()',name);
    END LOOP;
END $$;
INSERT INTO permissions(code,description) VALUES ('platform.legacy.read','Consultar o histórico importado do ERP anterior');
