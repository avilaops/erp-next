CREATE TABLE financial_settings (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
    default_payment_method text NOT NULL CHECK (default_payment_method IN ('cash','bank_transfer','card','other')),
    revision bigint NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE financial_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_settings_isolation ON financial_settings
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
