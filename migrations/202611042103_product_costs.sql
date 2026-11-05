CREATE TABLE product_costs (
    tenant_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_line text NOT NULL CHECK (product_line IN ('imported','national')),
    purchase_cost_cents bigint NOT NULL CHECK (purchase_cost_cents BETWEEN 0 AND 1000000000000),
    tax_credit_bps integer NOT NULL CHECK (tax_credit_bps BETWEEN 0 AND 10000),
    packaging_cents bigint NOT NULL CHECK (packaging_cents BETWEEN 0 AND 1000000000000),
    revision bigint NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id,product_id),
    FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id)
);
ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_costs FORCE ROW LEVEL SECURITY;
CREATE POLICY product_costs_isolation ON product_costs
    USING (tenant_id=current_setting('app.tenant_id',true)::uuid)
    WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);
