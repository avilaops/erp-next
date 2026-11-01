CREATE TABLE sales_settings (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
    minimum_order_amount_cents bigint NOT NULL CHECK (minimum_order_amount_cents BETWEEN 0 AND 99999999999999),
    maximum_payment_term_days integer NOT NULL CHECK (maximum_payment_term_days BETWEEN 0 AND 3650),
    require_customer_contact boolean NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sales_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_settings_isolation ON sales_settings
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
