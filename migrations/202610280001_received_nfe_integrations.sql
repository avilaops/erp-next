CREATE TABLE service_api_keys (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 100),
    key_prefix text NOT NULL CHECK (char_length(key_prefix) BETWEEN 20 AND 80),
    key_hash bytea NOT NULL UNIQUE CHECK (octet_length(key_hash) = 32),
    created_by_identity_id uuid NOT NULL REFERENCES identities(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_used_at timestamptz,
    revoked_at timestamptz,
    UNIQUE (tenant_id, id)
);
CREATE INDEX service_api_keys_tenant_created_idx
    ON service_api_keys(tenant_id, created_at DESC, id DESC);

CREATE TABLE fiscal_received_nfes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    access_key char(44) NOT NULL CHECK (access_key ~ '^[0-9]{44}$'),
    issuer_document text NOT NULL CHECK (issuer_document ~ '^[0-9]{14}$'),
    issuer_name text NOT NULL CHECK (char_length(btrim(issuer_name)) BETWEEN 1 AND 200),
    recipient_document text NOT NULL CHECK (recipient_document ~ '^[0-9]{11}([0-9]{3})?$'),
    number bigint NOT NULL CHECK (number BETWEEN 1 AND 999999999),
    series integer NOT NULL CHECK (series BETWEEN 0 AND 999),
    issued_at timestamptz NOT NULL,
    total_cents bigint NOT NULL CHECK (total_cents BETWEEN 0 AND 99999999999999),
    item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 990),
    environment smallint NOT NULL CHECK (environment IN (1, 2)),
    xml text NOT NULL CHECK (octet_length(xml) BETWEEN 1 AND 921600),
    xml_sha256 char(64) NOT NULL CHECK (xml_sha256 ~ '^[0-9a-f]{64}$'),
    imported_by_identity_id uuid NOT NULL REFERENCES identities(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, access_key),
    UNIQUE (tenant_id, id)
);
CREATE INDEX fiscal_received_nfes_tenant_issued_idx
    ON fiscal_received_nfes(tenant_id, issued_at DESC, id DESC);
CREATE TRIGGER fiscal_received_nfes_append_only
    BEFORE UPDATE OR DELETE ON fiscal_received_nfes
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();

ALTER TABLE service_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY service_api_keys_isolation ON service_api_keys
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE fiscal_received_nfes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_received_nfes FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_received_nfes_isolation ON fiscal_received_nfes
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('platform.integrations.manage', 'Criar, consultar e revogar credenciais de integração'),
    ('fiscal.received_nfe.manage', 'Importar documentos fiscais recebidos autorizados')
ON CONFLICT (code) DO NOTHING;
