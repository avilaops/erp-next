CREATE TABLE warranty_service_order_parts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    service_order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name text NOT NULL,
    sku text NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros BETWEEN 1 AND 999999999999999999),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 0 AND 99999999999999),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, service_order_id) REFERENCES warranty_service_orders(tenant_id, id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);
CREATE INDEX warranty_service_order_parts_order_idx ON warranty_service_order_parts(tenant_id, service_order_id, created_at, id);
ALTER TABLE warranty_service_order_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_service_order_parts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warranty_service_order_parts
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON warranty_service_order_parts
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();
