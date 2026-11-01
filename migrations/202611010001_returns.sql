-- Commercial reversals preserve the original physical and financial ledgers.
ALTER TABLE receivables DROP CONSTRAINT receivables_status_check;
ALTER TABLE receivables DROP CONSTRAINT receivables_check;
ALTER TABLE receivables ADD CONSTRAINT receivables_status_check
    CHECK (status IN ('open', 'paid', 'cancelled'));
ALTER TABLE receivables ADD CONSTRAINT receivables_payment_state_check
    CHECK ((status IN ('open', 'cancelled') AND payment_id IS NULL)
        OR (status = 'paid' AND payment_id IS NOT NULL));
ALTER TABLE payables DROP CONSTRAINT payables_status_check;
ALTER TABLE payables ADD CONSTRAINT payables_status_check
    CHECK (status IN ('open', 'paid', 'cancelled'));
ALTER TABLE payables ADD CONSTRAINT payables_payment_state_check
    CHECK ((status IN ('open', 'cancelled') AND payment_id IS NULL)
        OR (status = 'paid' AND payment_id IS NOT NULL));

CREATE TABLE sales_order_cancellations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    order_id uuid NOT NULL,
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 15 AND 200),
    occurred_on date NOT NULL,
    order_revision bigint NOT NULL CHECK (order_revision > 1),
    summary jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, order_id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id, id)
);
CREATE TABLE purchase_receipt_reversals (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    receipt_id uuid NOT NULL,
    order_id uuid NOT NULL,
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 15 AND 200),
    occurred_on date NOT NULL,
    order_revision bigint NOT NULL CHECK (order_revision > 1),
    summary jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, receipt_id),
    FOREIGN KEY (tenant_id, receipt_id) REFERENCES purchase_receipts(tenant_id, id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES purchase_orders(tenant_id, id)
);

DO $$ DECLARE item text; BEGIN
    FOREACH item IN ARRAY ARRAY['sales_order_cancellations','purchase_receipt_reversals'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', item);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', item);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)', item);
        EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes()', item);
    END LOOP;
END $$;
