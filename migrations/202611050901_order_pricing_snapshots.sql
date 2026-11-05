CREATE TABLE order_pricing_snapshots (
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    version_id uuid NOT NULL,
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
    needs_approval boolean NOT NULL,
    approved_by text,
    approved_at timestamptz,
    approval_reason text,
    PRIMARY KEY (tenant_id,order_id),
    FOREIGN KEY (tenant_id,order_id) REFERENCES sales_orders(tenant_id,id),
    FOREIGN KEY (tenant_id,version_id) REFERENCES price_table_versions(tenant_id,id),
    CHECK ((approved_by IS NULL AND approved_at IS NULL AND approval_reason IS NULL)
        OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(approval_reason) BETWEEN 3 AND 2000))
);
ALTER TABLE order_pricing_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_pricing_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY order_pricing_snapshots_isolation ON order_pricing_snapshots
    USING (tenant_id=current_setting('app.tenant_id',true)::uuid)
    WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);
CREATE FUNCTION protect_order_pricing_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.order_id IS DISTINCT FROM OLD.order_id
        OR NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
        OR NEW.needs_approval IS DISTINCT FROM OLD.needs_approval OR OLD.approved_by IS NOT NULL THEN
        RAISE EXCEPTION 'Order pricing snapshots and completed approvals are immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER order_pricing_snapshot_immutable BEFORE UPDATE ON order_pricing_snapshots
    FOR EACH ROW EXECUTE FUNCTION protect_order_pricing_snapshot();
