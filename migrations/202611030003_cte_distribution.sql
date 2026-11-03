-- CT-e distribution has its own source identity and cursor; never reuse NF-e NSU.
CREATE TABLE fiscal_cte_distribution_state (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    environment smallint NOT NULL DEFAULT 2 CHECK (environment = 2),
    company_tax_id text NOT NULL CHECK (company_tax_id ~ '^[0-9]{14}$'),
    last_nsu char(15) NOT NULL DEFAULT '000000000000000' CHECK (last_nsu ~ '^[0-9]{15}$'),
    max_nsu char(15) NOT NULL DEFAULT '000000000000000' CHECK (max_nsu ~ '^[0-9]{15}$' AND max_nsu >= last_nsu),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    next_query_at timestamptz,
    lease_id uuid,
    lease_until timestamptz,
    last_code text,
    PRIMARY KEY (tenant_id, environment),
    CHECK ((lease_id IS NULL) = (lease_until IS NULL))
);
CREATE TABLE fiscal_cte_distribution_runs (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    id uuid NOT NULL,
    environment smallint NOT NULL CHECK (environment = 2),
    company_tax_id text NOT NULL CHECK (company_tax_id ~ '^[0-9]{14}$'),
    author_state char(2) NOT NULL,
    auth_subject text NOT NULL,
    command_key uuid NOT NULL,
    requested_nsu char(15) NOT NULL CHECK (requested_nsu ~ '^[0-9]{15}$'),
    status text NOT NULL CHECK (status IN ('running','completed','rejected','failed','unknown')),
    code text,
    document_count integer NOT NULL DEFAULT 0 CHECK (document_count BETWEEN 0 AND 50),
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, auth_subject, command_key)
);
CREATE TABLE fiscal_cte_distribution_documents (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    environment smallint NOT NULL CHECK (environment = 2),
    company_tax_id text NOT NULL CHECK (company_tax_id ~ '^[0-9]{14}$'),
    nsu char(15) NOT NULL CHECK (nsu ~ '^[0-9]{15}$' AND nsu > '000000000000000'),
    schema_name text NOT NULL CHECK (char_length(schema_name) BETWEEN 1 AND 100),
    kind text NOT NULL CHECK (kind IN ('full','event','unrecognized')),
    xml text NOT NULL CHECK (octet_length(xml) BETWEEN 1 AND 2097152),
    xml_sha256 char(64) NOT NULL CHECK (xml_sha256 ~ '^[0-9a-f]{64}$'),
    verification text NOT NULL DEFAULT 'pending' CHECK (verification = 'pending'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, environment, company_tax_id, nsu),
    FOREIGN KEY (tenant_id, run_id) REFERENCES fiscal_cte_distribution_runs(tenant_id, id)
);
CREATE TRIGGER fiscal_cte_documents_append_only
    BEFORE UPDATE OR DELETE ON fiscal_cte_distribution_documents
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();
DO $$ DECLARE item text; BEGIN
    FOREACH item IN ARRAY ARRAY['fiscal_cte_distribution_state','fiscal_cte_distribution_runs','fiscal_cte_distribution_documents'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',item);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',item);
    END LOOP;
END $$;
INSERT INTO permissions(code,description) VALUES
    ('fiscal.cte.read','Consultar documentos e execuções de distribuição CT-e'),
    ('fiscal.cte.query','Solicitar distribuição CT-e em homologação');
