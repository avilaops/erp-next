CREATE TABLE logistics_checkouts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    order_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'completed', 'cancelled')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, order_id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id, id),
    CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR (status <> 'completed'))
);

CREATE TABLE logistics_checkout_lines (
    tenant_id uuid NOT NULL,
    checkout_id uuid NOT NULL,
    line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 100),
    product_id uuid NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    expected_quantity_micros bigint NOT NULL CHECK (expected_quantity_micros > 0),
    checked_quantity_micros bigint NOT NULL DEFAULT 0 CHECK (checked_quantity_micros >= 0),
    PRIMARY KEY (tenant_id, checkout_id, line_number),
    FOREIGN KEY (tenant_id, checkout_id) REFERENCES logistics_checkouts(tenant_id, id) ON DELETE CASCADE,
    CHECK (checked_quantity_micros <= expected_quantity_micros)
);

CREATE INDEX logistics_checkouts_tenant_created_idx ON logistics_checkouts(tenant_id, created_at DESC, id DESC);
CREATE INDEX logistics_checkout_lines_product_idx ON logistics_checkout_lines(tenant_id, product_id, checkout_id);

ALTER TABLE logistics_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_checkouts FORCE ROW LEVEL SECURITY;
CREATE POLICY logistics_checkouts_isolation ON logistics_checkouts
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE logistics_checkout_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_checkout_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY logistics_checkout_lines_isolation ON logistics_checkout_lines
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('logistics.checkout.read', 'Consultar conferências de pedidos da empresa'),
    ('logistics.checkout.manage', 'Conferir e concluir pedidos da empresa')
ON CONFLICT (code) DO NOTHING;
