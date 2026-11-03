CREATE TABLE inventory_settings (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
    allow_manual_movements boolean NOT NULL,
    minimum_reason_length integer NOT NULL CHECK (minimum_reason_length BETWEEN 3 AND 200),
    revision bigint NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE inventory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_settings_isolation ON inventory_settings
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE purchase_settings (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
    minimum_order_amount_cents bigint NOT NULL CHECK (minimum_order_amount_cents BETWEEN 0 AND 99999999999999),
    maximum_payment_term_days integer NOT NULL CHECK (maximum_payment_term_days BETWEEN 0 AND 3650),
    require_supplier_contact boolean NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE purchase_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_settings_isolation ON purchase_settings
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
