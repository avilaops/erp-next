-- Negotiated schedules are plans. Creating a title never declares receipt of money.
CREATE TABLE sales_order_checkouts (
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    customer_snapshot jsonb NOT NULL CHECK (jsonb_typeof(customer_snapshot)='object'),
    entry_amount_cents bigint NOT NULL CHECK (entry_amount_cents BETWEEN 0 AND 99999999999999),
    entry_payment_method_id uuid,
    entry_payment_method jsonb,
    entry_due_on date,
    manufacturing_days integer CHECK (manufacturing_days BETWEEN 0 AND 3650),
    delivery_notes text NOT NULL CHECK (char_length(delivery_notes)<=2000),
    payment_notes text NOT NULL CHECK (char_length(payment_notes)<=2000),
    notes text NOT NULL CHECK (char_length(notes)<=10000),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id,order_id),
    FOREIGN KEY (tenant_id,order_id) REFERENCES sales_orders(tenant_id,id),
    FOREIGN KEY (tenant_id,entry_payment_method_id) REFERENCES payment_methods(tenant_id,id),
    CHECK (entry_amount_cents=0 OR entry_payment_method_id IS NOT NULL)
);
CREATE TABLE sales_order_installments (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    number integer NOT NULL CHECK (number BETWEEN 0 AND 120),
    kind text NOT NULL CHECK (kind IN ('entry','balance')),
    payment_method_id uuid NOT NULL,
    payment_method jsonb NOT NULL CHECK (jsonb_typeof(payment_method)='object'),
    due_on date,
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999999),
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,order_id,id),
    UNIQUE (tenant_id,order_id,number),
    FOREIGN KEY (tenant_id,order_id) REFERENCES sales_order_checkouts(tenant_id,order_id),
    FOREIGN KEY (tenant_id,payment_method_id) REFERENCES payment_methods(tenant_id,id),
    CHECK ((kind='entry' AND number=0) OR (kind='balance' AND number>0 AND due_on IS NOT NULL))
);
CREATE TRIGGER sales_checkout_immutable BEFORE UPDATE OR DELETE ON sales_order_checkouts
    FOR EACH ROW EXECUTE FUNCTION reject_price_history_changes();
CREATE FUNCTION preserve_sales_order_installment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Negotiated payment schedules are immutable';
    END IF;
    IF NOT (OLD.kind='entry' AND OLD.due_on IS NULL AND NEW.due_on IS NOT NULL
        AND (to_jsonb(NEW)-'due_on')=(to_jsonb(OLD)-'due_on')) THEN
        RAISE EXCEPTION 'Negotiated payment schedules are immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER sales_installment_immutable BEFORE UPDATE OR DELETE ON sales_order_installments
    FOR EACH ROW EXECUTE FUNCTION preserve_sales_order_installment();

ALTER TABLE sales_order_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_checkouts FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_checkout_isolation ON sales_order_checkouts
    USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE sales_order_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_installments FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_installment_isolation ON sales_order_installments
    USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE receivables ADD COLUMN order_installment_id uuid;
ALTER TABLE receivables ADD CONSTRAINT receivables_order_installment_fk
    FOREIGN KEY (tenant_id,order_id,order_installment_id)
    REFERENCES sales_order_installments(tenant_id,order_id,id);
ALTER TABLE receivables DROP CONSTRAINT receivables_tenant_id_order_id_key;
CREATE UNIQUE INDEX receivables_legacy_order_unique ON receivables(tenant_id,order_id)
    WHERE order_installment_id IS NULL;
CREATE UNIQUE INDEX receivables_installment_unique ON receivables(tenant_id,order_installment_id)
    WHERE order_installment_id IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp_next_app') THEN
        GRANT SELECT, INSERT ON sales_order_checkouts TO erp_next_app;
        GRANT SELECT, INSERT, UPDATE ON sales_order_installments TO erp_next_app;
    END IF;
END;
$$;
