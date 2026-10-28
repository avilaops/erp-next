CREATE TABLE purchase_orders (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    supplier_id uuid NOT NULL,
    supplier_name text NOT NULL,
    supplier_tax_id text NOT NULL,
    due_date date NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999999),
    status text NOT NULL CHECK (status IN ('draft','confirmed','partially_received','received','cancelled','closed')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id,id),
    FOREIGN KEY(tenant_id,supplier_id) REFERENCES parties(tenant_id,id)
);
CREATE INDEX purchase_orders_tenant_created_idx ON purchase_orders(tenant_id,created_at DESC,id DESC);
CREATE TABLE purchase_order_lines (
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 100),
    sku text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros BETWEEN 1 AND 999999999999999999),
    received_micros bigint NOT NULL DEFAULT 0 CHECK (received_micros BETWEEN 0 AND quantity_micros),
    cost_cents bigint NOT NULL CHECK (cost_cents BETWEEN 0 AND 99999999999999),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 0 AND 99999999999999),
    PRIMARY KEY(tenant_id,order_id,product_id),
    UNIQUE(tenant_id,order_id,line_number),
    FOREIGN KEY(tenant_id,order_id) REFERENCES purchase_orders(tenant_id,id),
    FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE purchase_receipts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    reference text NOT NULL CHECK (char_length(btrim(reference)) BETWEEN 3 AND 200),
    occurred_on date NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 0 AND 99999999999999),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(tenant_id,id),
    UNIQUE(tenant_id,order_id,reference),
    FOREIGN KEY(tenant_id,order_id) REFERENCES purchase_orders(tenant_id,id)
);
CREATE TABLE purchase_receipt_lines (
    tenant_id uuid NOT NULL,
    receipt_id uuid NOT NULL,
    product_id uuid NOT NULL,
    unit text NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros BETWEEN 1 AND 999999999999999999),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 0 AND 99999999999999),
    PRIMARY KEY(tenant_id,receipt_id,product_id),
    FOREIGN KEY(tenant_id,receipt_id) REFERENCES purchase_receipts(tenant_id,id),
    FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
ALTER TABLE stock_movements ADD COLUMN source_purchase_receipt_id uuid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_purchase_receipt_fk
    FOREIGN KEY(tenant_id,source_purchase_receipt_id) REFERENCES purchase_receipts(tenant_id,id);
ALTER TABLE stock_movements ADD CONSTRAINT stock_purchase_receipt_direction
    CHECK (source_purchase_receipt_id IS NULL OR (direction='receipt' AND source_order_id IS NULL AND reverses_id IS NULL));
CREATE UNIQUE INDEX stock_purchase_receipt_product_unique ON stock_movements(tenant_id,source_purchase_receipt_id,product_id)
    WHERE source_purchase_receipt_id IS NOT NULL;

CREATE TABLE payables (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    receipt_id uuid NOT NULL,
    supplier_name text NOT NULL,
    due_date date NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999999),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    payment_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id,id),
    UNIQUE(tenant_id,receipt_id),
    FOREIGN KEY(tenant_id,receipt_id) REFERENCES purchase_receipts(tenant_id,id)
);
CREATE INDEX payables_tenant_due_idx ON payables(tenant_id,due_date,id);
CREATE TABLE payable_payments (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    payable_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('payment','reversal')),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999999),
    method text NOT NULL CHECK (method IN ('cash','bank_transfer','card','other')),
    reference text NOT NULL CHECK (char_length(btrim(reference)) BETWEEN 3 AND 200),
    occurred_on date NOT NULL,
    reverses_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(tenant_id,id),
    UNIQUE(tenant_id,reverses_id),
    FOREIGN KEY(tenant_id,payable_id) REFERENCES payables(tenant_id,id),
    FOREIGN KEY(tenant_id,reverses_id) REFERENCES payable_payments(tenant_id,id),
    CHECK ((kind='payment' AND reverses_id IS NULL) OR (kind='reversal' AND reverses_id IS NOT NULL))
);
ALTER TABLE payables ADD FOREIGN KEY(tenant_id,payment_id) REFERENCES payable_payments(tenant_id,id);
CREATE INDEX payable_payments_account_idx ON payable_payments(tenant_id,payable_id,created_at,id);

DO $$ DECLARE item text; BEGIN
    FOREACH item IN ARRAY ARRAY['purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','payables','payable_payments'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',item);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',item);
    END LOOP;
    FOREACH item IN ARRAY ARRAY['purchase_receipts','purchase_receipt_lines','payable_payments'] LOOP
        EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes()',item);
    END LOOP;
END $$;
INSERT INTO permissions(code,description) VALUES
    ('purchasing.orders.read','Consultar compras e recebimentos da empresa'),
    ('purchasing.orders.manage','Criar, editar e comandar pedidos de compra'),
    ('purchasing.receipts.create','Confirmar recebimento físico de compra'),
    ('finance.payables.originate','Originar obrigação por recebimento de compra'),
    ('finance.payables.read','Consultar contas a pagar'),
    ('finance.payables.manage','Registrar pagamentos e estornos declarados')
ON CONFLICT(code) DO NOTHING;
