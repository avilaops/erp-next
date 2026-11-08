-- Outbound customer packages are separate from the signing-provider state.
-- SMTP acceptance is recorded without storing message bodies or credentials.
CREATE TABLE commercial_contract_deliveries (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    contract_id uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'unknown')),
    recipients jsonb NOT NULL CHECK (jsonb_typeof(recipients) = 'array'),
    attachments jsonb NOT NULL CHECK (jsonb_typeof(attachments) = 'array'),
    message_sha256 text NOT NULL CHECK (message_sha256 ~ '^[0-9a-f]{64}$'),
    attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
    last_error text,
    sent_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, contract_id),
    FOREIGN KEY (tenant_id, contract_id) REFERENCES commercial_contracts(tenant_id, id),
    CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

ALTER TABLE commercial_contract_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_contract_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_contract_deliveries_isolation ON commercial_contract_deliveries
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('sales.contracts.package', 'Enviar pedido, contrato, NF-e e comprovante ao cliente')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT id, 'sales.contracts.package' FROM roles WHERE code IN ('admin', 'administrator')
ON CONFLICT DO NOTHING;
