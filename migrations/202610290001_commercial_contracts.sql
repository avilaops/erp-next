-- Commercial signing is independent of fiscal issuance and laboratory contracts.
CREATE TABLE commercial_contracts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    customer_id uuid NOT NULL,
    order_id uuid NOT NULL,
    template_id bigint NOT NULL CHECK (template_id > 0),
    template_name text NOT NULL,
    template_snapshot jsonb NOT NULL,
    snapshot jsonb NOT NULL,
    recipients jsonb NOT NULL,
    fields jsonb NOT NULL,
    fingerprint text NOT NULL,
    external_id bigint UNIQUE,
    status text NOT NULL CHECK (status IN ('creation_requested','created','reviewed','send_requested','sent','opened','completed','declined','expired')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    problem text,
    progress jsonb NOT NULL DEFAULT '[]',
    reviewed_by text,
    reviewed_at timestamptz,
    send_requested_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, fingerprint),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES parties(tenant_id, id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id, id)
);
CREATE INDEX commercial_contracts_order ON commercial_contracts(tenant_id, order_id, created_at DESC);
CREATE INDEX commercial_contracts_customer ON commercial_contracts(tenant_id, customer_id, created_at DESC);

-- Private PostgreSQL storage follows the existing legacy_files approach. PDFs and
-- the audit trail survive provider link expiry and are included in database backups.
CREATE TABLE commercial_contract_files (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('preview','signed','audit')),
    position integer NOT NULL CHECK (position BETWEEN 0 AND 9),
    sha256 text NOT NULL,
    content bytea NOT NULL CHECK (octet_length(content) BETWEEN 5 AND 20971520),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, contract_id, kind, position),
    FOREIGN KEY (tenant_id, contract_id) REFERENCES commercial_contracts(tenant_id, id)
);
CREATE TRIGGER commercial_contract_files_append_only BEFORE UPDATE OR DELETE ON commercial_contract_files
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();

CREATE TABLE commercial_contract_webhooks (
    tenant_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    digest text NOT NULL,
    event_type text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, contract_id, digest),
    FOREIGN KEY (tenant_id, contract_id) REFERENCES commercial_contracts(tenant_id, id)
);

CREATE FUNCTION preserve_commercial_contract_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.tenant_id,NEW.customer_id,NEW.order_id,NEW.template_id,NEW.template_snapshot,
           NEW.snapshot,NEW.recipients,NEW.fields,NEW.fingerprint)
       IS DISTINCT FROM
       ROW(OLD.tenant_id,OLD.customer_id,OLD.order_id,OLD.template_id,OLD.template_snapshot,
           OLD.snapshot,OLD.recipients,OLD.fields,OLD.fingerprint) THEN
        RAISE EXCEPTION 'Commercial contract snapshot is immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER commercial_contract_snapshot_immutable BEFORE UPDATE ON commercial_contracts
    FOR EACH ROW EXECUTE FUNCTION preserve_commercial_contract_snapshot();

ALTER TABLE commercial_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_contracts_isolation ON commercial_contracts
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE commercial_contract_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_contract_files FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_contract_files_isolation ON commercial_contract_files
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE commercial_contract_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_contract_webhooks FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_contract_webhooks_isolation ON commercial_contract_webhooks
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('sales.contracts.send', 'Revisar contratos comerciais e solicitar convites de assinatura')
ON CONFLICT (code) DO NOTHING;
-- Existing administrators keep administrative capability; other roles opt in.
INSERT INTO role_permissions(role_id, permission_code)
SELECT id, 'sales.contracts.send' FROM roles WHERE code IN ('admin', 'administrator')
ON CONFLICT DO NOTHING;
