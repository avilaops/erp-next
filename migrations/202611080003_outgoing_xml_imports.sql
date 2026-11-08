-- Authorized outbound XML archive only; does not issue or book fiscal operations.
CREATE TABLE fiscal_outgoing_imports (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    access_key char(44) NOT NULL CHECK (access_key ~ '^[0-9]{44}$'),
    issuer_document text NOT NULL CHECK (issuer_document ~ '^[0-9]{11}([0-9]{3})?$'),
    issuer_name text NOT NULL CHECK (char_length(btrim(issuer_name)) BETWEEN 1 AND 200),
    recipient_document text CHECK (recipient_document ~ '^[0-9]{11}([0-9]{3})?$'),
    recipient_name text NOT NULL CHECK (char_length(btrim(recipient_name)) BETWEEN 1 AND 200),
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
CREATE INDEX fiscal_outgoing_imports_tenant_issued_idx
    ON fiscal_outgoing_imports(tenant_id, issued_at DESC, id DESC);
CREATE TRIGGER fiscal_outgoing_imports_append_only
    BEFORE UPDATE OR DELETE ON fiscal_outgoing_imports
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();

ALTER TABLE fiscal_outgoing_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_outgoing_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_outgoing_imports_isolation ON fiscal_outgoing_imports
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

