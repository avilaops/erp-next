-- After contract templates: keep a unique migration version for the monitor.
-- NF-e may be issued by a producer identified by CPF, padded in the access key.
ALTER TABLE fiscal_received_nfes DROP CONSTRAINT fiscal_received_nfes_issuer_document_check;
ALTER TABLE fiscal_received_nfes ADD CONSTRAINT fiscal_received_nfes_issuer_document_check
    CHECK (issuer_document ~ '^[0-9]{11}([0-9]{3})?$');

CREATE TABLE fiscal_monitor_state (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
    tax_id text NOT NULL CHECK (tax_id ~ '^[0-9]{14}$'),
    last_nsu char(15) NOT NULL DEFAULT '000000000000000' CHECK (last_nsu ~ '^[0-9]{15}$'),
    max_nsu char(15) NOT NULL DEFAULT '000000000000000' CHECK (max_nsu ~ '^[0-9]{15}$' AND max_nsu >= last_nsu),
    next_query_at timestamptz,
    last_status text,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE fiscal_monitor_runs (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    command_key uuid NOT NULL,
    auth_subject text NOT NULL,
    cursor_before char(15) NOT NULL,
    outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','applied','failed')),
    status text,
    document_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    UNIQUE (tenant_id,command_key),
    UNIQUE (tenant_id,id)
);
CREATE INDEX fiscal_monitor_runs_latest ON fiscal_monitor_runs(tenant_id,created_at DESC);
CREATE TABLE fiscal_monitor_documents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    run_id uuid NOT NULL,
    nsu char(15) NOT NULL CHECK (nsu ~ '^[0-9]{15}$'),
    schema text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('summary','nfe','event','other')),
    access_key char(44),
    issuer_document text,
    issuer_name text,
    issued_at timestamptz,
    total_cents bigint,
    situation text,
    xml text NOT NULL CHECK (octet_length(xml) BETWEEN 1 AND 921600),
    xml_sha256 char(64) NOT NULL CHECK (xml_sha256 ~ '^[0-9a-f]{64}$'),
    received_nfe_id bigint,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (tenant_id,run_id) REFERENCES fiscal_monitor_runs(tenant_id,id),
    FOREIGN KEY (tenant_id,received_nfe_id) REFERENCES fiscal_received_nfes(tenant_id,id),
    UNIQUE (tenant_id,nsu),
    UNIQUE (tenant_id,id)
);
CREATE INDEX fiscal_monitor_documents_key ON fiscal_monitor_documents(tenant_id,access_key);
CREATE TRIGGER fiscal_monitor_documents_append_only BEFORE UPDATE OR DELETE ON fiscal_monitor_documents
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();

CREATE TABLE fiscal_monitor_manifestations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    document_id bigint NOT NULL,
    access_key char(44) NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('210200','210210','210220','210240')),
    justification text,
    command_key uuid NOT NULL,
    auth_subject text NOT NULL,
    outcome text NOT NULL DEFAULT 'unknown' CHECK (outcome IN ('unknown','accepted','rejected')),
    status text,
    protocol text,
    signed_xml text NOT NULL,
    response_xml text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    FOREIGN KEY (tenant_id,document_id) REFERENCES fiscal_monitor_documents(tenant_id,id),
    UNIQUE (tenant_id,command_key),
    UNIQUE (tenant_id,access_key,event_type)
);

ALTER TABLE fiscal_monitor_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_monitor_state FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_monitor_state_isolation ON fiscal_monitor_state
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE fiscal_monitor_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_monitor_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_monitor_runs_isolation ON fiscal_monitor_runs
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE fiscal_monitor_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_monitor_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_monitor_documents_isolation ON fiscal_monitor_documents
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE fiscal_monitor_manifestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_monitor_manifestations FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_monitor_manifestations_isolation ON fiscal_monitor_manifestations
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code,description) VALUES
    ('fiscal.monitor.read','Consultar distribuição e documentos do monitor fiscal'),
    ('fiscal.monitor.manage','Consultar um lote de distribuição na SEFAZ'),
    ('fiscal.monitor.manifest','Enviar manifestação explícita do destinatário');
