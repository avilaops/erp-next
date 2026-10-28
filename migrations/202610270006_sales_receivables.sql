CREATE TABLE sales_orders (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    customer_id uuid NOT NULL,
    customer_name text NOT NULL,
    customer_tax_id text NOT NULL,
    due_date date NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999999),
    status text NOT NULL CHECK (status IN ('draft', 'confirmed', 'completed', 'cancelled')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES parties(tenant_id, id)
);
CREATE INDEX sales_orders_tenant_created_idx ON sales_orders(tenant_id, created_at DESC, id DESC);
CREATE TABLE sales_order_lines (
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 100),
    product_id uuid NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros BETWEEN 1 AND 999999999999999999),
    price_cents bigint NOT NULL CHECK (price_cents BETWEEN 0 AND 99999999999999),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 0 AND 99999999999999),
    CHECK (amount_cents = floor((quantity_micros::numeric * price_cents + 500000) / 1000000)),
    PRIMARY KEY (tenant_id, order_id, line_number),
    UNIQUE (tenant_id, order_id, product_id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id, id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);
CREATE INDEX sales_lines_product_idx ON sales_order_lines(tenant_id, product_id, order_id);

ALTER TABLE stock_movements ADD COLUMN source_order_id uuid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movement_order_fk
    FOREIGN KEY (tenant_id, source_order_id) REFERENCES sales_orders(tenant_id, id);

CREATE TABLE receivables (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    order_id uuid NOT NULL,
    customer_name text NOT NULL,
    due_date date NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999999),
    status text NOT NULL CHECK (status IN ('open', 'paid')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    payment_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, order_id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id, id),
    CHECK ((status = 'open' AND payment_id IS NULL) OR (status = 'paid' AND payment_id IS NOT NULL))
);
CREATE INDEX receivables_tenant_due_idx ON receivables(tenant_id, due_date, id);
CREATE TABLE receivable_payments (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    receivable_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('receipt', 'reversal')),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999999),
    method text NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'card', 'other')),
    reference text NOT NULL CHECK (char_length(btrim(reference)) BETWEEN 3 AND 200),
    occurred_on date NOT NULL,
    reverses_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, reverses_id),
    FOREIGN KEY (tenant_id, receivable_id) REFERENCES receivables(tenant_id, id),
    FOREIGN KEY (tenant_id, reverses_id) REFERENCES receivable_payments(tenant_id, id),
    CHECK ((kind = 'receipt' AND reverses_id IS NULL) OR (kind = 'reversal' AND reverses_id IS NOT NULL))
);
ALTER TABLE receivables ADD CONSTRAINT receivable_payment_fk
    FOREIGN KEY (tenant_id, payment_id) REFERENCES receivable_payments(tenant_id, id);
CREATE TRIGGER receivable_payments_append_only BEFORE UPDATE OR DELETE ON receivable_payments
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_orders_isolation ON sales_orders
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_order_lines_isolation ON sales_order_lines
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivables FORCE ROW LEVEL SECURITY;
CREATE POLICY receivables_isolation ON receivables
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE receivable_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivable_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY receivable_payments_isolation ON receivable_payments
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('sales.orders.read', 'Consultar pedidos da empresa'),
    ('sales.orders.manage', 'Criar, reservar, cancelar e concluir pedidos da empresa'),
    ('finance.receivables.read', 'Consultar contas a receber da empresa'),
    ('finance.receivables.manage', 'Registrar e estornar recebimentos manuais da empresa')
ON CONFLICT (code) DO NOTHING;
