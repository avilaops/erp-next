-- Production records the work on sold products. Components are explicitly declared
-- per order against the existing inventory; there is no implicit BOM, finished-stock
-- receipt, financial posting or industrial-cost allocation in this domain.
CREATE TABLE production_stages (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 40),
    kind text NOT NULL CHECK (kind IN ('andamento','pronta')),
    position integer NOT NULL CHECK (position BETWEEN 1 AND 10000),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    UNIQUE (tenant_id,id)
);
CREATE UNIQUE INDEX production_stage_name ON production_stages(tenant_id,lower(btrim(name)));
CREATE UNIQUE INDEX production_stage_ready ON production_stages(tenant_id) WHERE kind='pronta';

CREATE TABLE production_orders (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros BETWEEN 1 AND 999999999999999999),
    stage_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','ready','cancelled')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    finished_at timestamptz,
    cancelled_at timestamptz,
    cancellation_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id,id),
    UNIQUE (tenant_id,order_id,product_id),
    FOREIGN KEY (tenant_id,order_id) REFERENCES sales_orders(tenant_id,id),
    FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id),
    FOREIGN KEY (tenant_id,stage_id) REFERENCES production_stages(tenant_id,id),
    FOREIGN KEY (tenant_id,cancellation_id) REFERENCES sales_order_cancellations(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
    CHECK ((status='open' AND finished_at IS NULL AND cancelled_at IS NULL AND cancellation_id IS NULL)
        OR (status='ready' AND finished_at IS NOT NULL AND cancelled_at IS NULL AND cancellation_id IS NULL)
        OR (status='cancelled' AND cancelled_at IS NOT NULL AND cancellation_id IS NOT NULL))
);
CREATE INDEX production_order_sale ON production_orders(tenant_id,order_id,id);

ALTER TABLE stock_movements ADD COLUMN production_order_id uuid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_production_order_fk
    FOREIGN KEY (tenant_id,production_order_id) REFERENCES production_orders(tenant_id,id);
ALTER TABLE stock_movements ADD CONSTRAINT stock_production_source
    CHECK (production_order_id IS NULL OR (source_order_id IS NULL AND source_purchase_receipt_id IS NULL
        AND ((direction='issue' AND reverses_id IS NULL) OR (direction='receipt' AND reverses_id IS NOT NULL))));
CREATE INDEX stock_production_order ON stock_movements(tenant_id,production_order_id,id) WHERE production_order_id IS NOT NULL;

CREATE TABLE production_consumptions (
    tenant_id uuid NOT NULL,
    production_order_id uuid NOT NULL,
    stock_movement_id uuid NOT NULL,
    product_id uuid NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros BETWEEN 1 AND 999999999999999999),
    unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents BETWEEN 0 AND 99999999999999),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 0 AND 99999999999999),
    CHECK (amount_cents = floor((quantity_micros::numeric * unit_cost_cents + 500000)/1000000)),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id,stock_movement_id),
    FOREIGN KEY (tenant_id,production_order_id) REFERENCES production_orders(tenant_id,id),
    FOREIGN KEY (tenant_id,stock_movement_id) REFERENCES stock_movements(tenant_id,id),
    FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id)
);

-- Work/stage history survives reopening, cancellation and stage renaming.
CREATE TABLE production_history (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    production_order_id uuid NOT NULL,
    action text NOT NULL,
    stage_id uuid NOT NULL,
    stage_name text NOT NULL,
    actor_subject text NOT NULL,
    details jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (tenant_id,production_order_id) REFERENCES production_orders(tenant_id,id),
    FOREIGN KEY (tenant_id,stage_id) REFERENCES production_stages(tenant_id,id)
);

DO $$ DECLARE item text; BEGIN
    FOREACH item IN ARRAY ARRAY['production_stages','production_orders','production_consumptions','production_history'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',item);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',item);
    END LOOP;
    FOREACH item IN ARRAY ARRAY['production_consumptions','production_history'] LOOP
        EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes()',item);
    END LOOP;
END $$;
INSERT INTO permissions(code,description) VALUES
    ('production.read','Consultar ordens, etapas e histórico da produção'),
    ('production.manage','Criar e movimentar ordens, etapas e consumos de produção')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','administrator') AND p.code IN ('production.read','production.manage')
ON CONFLICT DO NOTHING;
