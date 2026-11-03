-- Manual national NFS-e imports. No shared NF-e key, NSU or capture cursor.
CREATE TABLE fiscal_received_nfses (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    id uuid NOT NULL,
    source text NOT NULL CHECK (source = 'nfse_nacional'),
    environment text NOT NULL CHECK (environment IN ('production','homologation')),
    access_key text NOT NULL CHECK (access_key ~ '^[0-9]{50}$'),
    company_tax_id text NOT NULL CHECK (company_tax_id ~ '^[0-9]{14}$'),
    xml text NOT NULL CHECK (octet_length(xml) BETWEEN 1 AND 1048576),
    xml_sha256 text NOT NULL CHECK (xml_sha256 ~ '^[0-9a-f]{64}$'),
    metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
    auth_subject text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,source,environment,access_key),
    CHECK (metadata->>'source' IS NOT DISTINCT FROM source),
    CHECK (metadata->>'environment' IS NOT DISTINCT FROM environment),
    CHECK (metadata->>'accessKey' IS NOT DISTINCT FROM access_key),
    CHECK (metadata->>'xmlSha256' IS NOT DISTINCT FROM xml_sha256),
    CHECK (metadata#>>'{recipient,kind}' IS NOT DISTINCT FROM 'CNPJ'),
    CHECK (metadata#>>'{recipient,value}' IS NOT DISTINCT FROM company_tax_id),
    CHECK (metadata#>>'{verification,signature}' IS NOT DISTINCT FROM 'not_verified'),
    CHECK (metadata#>>'{verification,currentStatus}' IS NOT DISTINCT FROM 'not_queried')
);
CREATE TRIGGER fiscal_received_nfses_append_only
    BEFORE UPDATE OR DELETE ON fiscal_received_nfses
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();
ALTER TABLE fiscal_received_nfses ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_received_nfses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fiscal_received_nfses
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
INSERT INTO permissions(code,description) VALUES
    ('fiscal.nfse.read','Consultar XML e dados de NFS-e recebida'),
    ('fiscal.nfse.import','Importar XML nacional de NFS-e recebida sem emissão');
