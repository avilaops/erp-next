-- Offline inspection facts are separate from immutable source/cursor records.
CREATE TABLE fiscal_cte_inspections (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    document_id uuid NOT NULL,
    source_xml_sha256 char(64) NOT NULL CHECK (source_xml_sha256 ~ '^[0-9a-f]{64}$'),
    inspector_version text NOT NULL CHECK (char_length(inspector_version) BETWEEN 1 AND 50),
    schema_release text NOT NULL CHECK (char_length(schema_release) BETWEEN 1 AND 100),
    metadata jsonb NOT NULL CHECK (
        jsonb_typeof(metadata) = 'object'
        AND (metadata->>'xmlSha256') IS NOT DISTINCT FROM source_xml_sha256::text
        AND COALESCE(metadata->>'environment','') = 'homologation'
        AND (metadata->>'profile') IS NOT DISTINCT FROM schema_release
    ),
    inspected_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, document_id) REFERENCES fiscal_cte_distribution_documents(tenant_id, id),
    UNIQUE (tenant_id, document_id, inspector_version, source_xml_sha256)
);
CREATE TRIGGER fiscal_cte_inspections_append_only
    BEFORE UPDATE OR DELETE ON fiscal_cte_inspections
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();
ALTER TABLE fiscal_cte_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_cte_inspections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fiscal_cte_inspections
    USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid);
INSERT INTO permissions(code,description)
    VALUES ('fiscal.cte.inspect','Conferir offline documentos CT-e preservados, sem consultar SEFAZ');
