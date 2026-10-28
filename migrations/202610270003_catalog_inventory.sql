CREATE TABLE products (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    sku text NOT NULL CHECK (char_length(sku) BETWEEN 1 AND 80 AND sku ~ '^[A-Z0-9._/-]+$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    unit text NOT NULL CHECK (unit ~ '^[A-Z]{1,6}$'),
    ncm text CHECK (ncm ~ '^[0-9]{8}$'),
    cest text CHECK (cest ~ '^[0-9]{7}$'),
    price_cents bigint NOT NULL CHECK (price_cents BETWEEN 0 AND 99999999999999),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, sku)
);
CREATE INDEX products_tenant_name_idx ON products(tenant_id, name, id);

CREATE TABLE stock_balances (
    tenant_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity_micros bigint NOT NULL DEFAULT 0 CHECK (quantity_micros BETWEEN 0 AND 999999999999999999),
    PRIMARY KEY (tenant_id, product_id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);

CREATE TABLE stock_movements (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    product_id uuid NOT NULL,
    direction text NOT NULL CHECK (direction IN ('receipt', 'issue')),
    quantity_micros bigint NOT NULL CHECK (quantity_micros BETWEEN 1 AND 999999999999999999),
    balance_after_micros bigint NOT NULL CHECK (balance_after_micros >= 0),
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
    reverses_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
    FOREIGN KEY (tenant_id, reverses_id) REFERENCES stock_movements(tenant_id, id),
    UNIQUE (tenant_id, reverses_id)
);
CREATE INDEX stock_movements_product_idx ON stock_movements(tenant_id, product_id, created_at DESC, id DESC);
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();

CREATE TABLE domain_commands (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    auth_subject text NOT NULL,
    command_key uuid NOT NULL,
    scope text NOT NULL,
    request jsonb NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, auth_subject, command_key)
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY products_isolation ON products
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_balances_isolation ON stock_balances
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_isolation ON stock_movements
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE domain_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_commands_isolation ON domain_commands
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('catalog.products.read', 'Consultar produtos da empresa'),
    ('catalog.products.manage', 'Criar e alterar produtos da empresa'),
    ('inventory.stock.read', 'Consultar saldos e movimentos da empresa'),
    ('inventory.stock.manage', 'Lançar movimentos e estornos de estoque')
ON CONFLICT (code) DO NOTHING;
