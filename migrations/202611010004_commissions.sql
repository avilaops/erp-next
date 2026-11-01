-- Explicit per-order commission terms. Percentages use 4 decimal places: 5%=50000.
CREATE TABLE order_commission_terms (
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    seller_staff_id uuid NOT NULL,
    seller_name text NOT NULL,
    commission_rate bigint NOT NULL CHECK (commission_rate BETWEEN 0 AND 1000000),
    ipi_rate bigint NOT NULL CHECK (ipi_rate BETWEEN 0 AND 1000000),
    payment_day smallint NOT NULL CHECK (payment_day BETWEEN 1 AND 28),
    PRIMARY KEY (tenant_id, order_id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id,id),
    FOREIGN KEY (tenant_id, seller_staff_id) REFERENCES staff(tenant_id,id)
);

-- Revisions protect a seller's entire outstanding ledger, including prior-month debits.
CREATE TABLE commission_accounts (
    tenant_id uuid NOT NULL,
    seller_staff_id uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    PRIMARY KEY (tenant_id,seller_staff_id),
    FOREIGN KEY (tenant_id,seller_staff_id) REFERENCES staff(tenant_id,id)
);
CREATE TABLE commission_entries (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    seller_staff_id uuid NOT NULL,
    seller_name text NOT NULL,
    order_id uuid,
    kind text NOT NULL CHECK (kind IN ('receipt','reversal','adjustment')),
    receipt_id uuid,
    reversal_id uuid,
    reverses_entry_id uuid,
    competence date NOT NULL CHECK (extract(day FROM competence)=1),
    payment_due date NOT NULL,
    base_cents bigint NOT NULL,
    commission_rate bigint CHECK (commission_rate BETWEEN 0 AND 1000000),
    ipi_rate bigint CHECK (ipi_rate BETWEEN 0 AND 1000000),
    payment_day smallint NOT NULL CHECK (payment_day BETWEEN 1 AND 28),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN -99999999999999 AND 99999999999999),
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 200),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,receipt_id),
    UNIQUE (tenant_id,reversal_id),
    UNIQUE (tenant_id,reverses_entry_id),
    UNIQUE (tenant_id,seller_staff_id,id),
    FOREIGN KEY (tenant_id,seller_staff_id) REFERENCES commission_accounts(tenant_id,seller_staff_id),
    FOREIGN KEY (tenant_id,order_id) REFERENCES sales_orders(tenant_id,id),
    FOREIGN KEY (tenant_id,receipt_id) REFERENCES receivable_payments(tenant_id,id),
    FOREIGN KEY (tenant_id,reversal_id) REFERENCES receivable_payments(tenant_id,id),
    FOREIGN KEY (tenant_id,seller_staff_id,reverses_entry_id) REFERENCES commission_entries(tenant_id,seller_staff_id,id),
    CHECK ((kind='receipt' AND receipt_id IS NOT NULL AND order_id IS NOT NULL AND reversal_id IS NULL AND reverses_entry_id IS NULL AND amount_cents>=0 AND base_cents>=0 AND commission_rate IS NOT NULL AND ipi_rate IS NOT NULL)
        OR (kind='reversal' AND receipt_id IS NULL AND order_id IS NOT NULL AND reversal_id IS NOT NULL AND reverses_entry_id IS NOT NULL AND amount_cents<=0 AND base_cents<=0 AND commission_rate IS NOT NULL AND ipi_rate IS NOT NULL)
        OR (kind='adjustment' AND receipt_id IS NULL AND reversal_id IS NULL AND reverses_entry_id IS NULL AND commission_rate IS NULL AND ipi_rate IS NULL AND base_cents=0 AND amount_cents<>0))
);
CREATE INDEX commission_entries_seller_month ON commission_entries(tenant_id,seller_staff_id,competence,id);
CREATE TABLE commission_payments (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    seller_staff_id uuid NOT NULL,
    through_competence date NOT NULL CHECK (extract(day FROM through_competence)=1),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999999),
    occurred_on date NOT NULL,
    reference text NOT NULL CHECK (char_length(btrim(reference)) BETWEEN 3 AND 200),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,seller_staff_id,id),
    FOREIGN KEY (tenant_id,seller_staff_id) REFERENCES commission_accounts(tenant_id,seller_staff_id)
);
CREATE TABLE commission_payment_entries (
    tenant_id uuid NOT NULL,
    seller_staff_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    PRIMARY KEY (tenant_id,entry_id),
    FOREIGN KEY (tenant_id,seller_staff_id,payment_id) REFERENCES commission_payments(tenant_id,seller_staff_id,id),
    FOREIGN KEY (tenant_id,seller_staff_id,entry_id) REFERENCES commission_entries(tenant_id,seller_staff_id,id)
);
DO $$
DECLARE item text;
BEGIN
    FOREACH item IN ARRAY ARRAY['order_commission_terms','commission_accounts','commission_entries','commission_payments','commission_payment_entries'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',item);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',item);
    END LOOP;
    FOREACH item IN ARRAY ARRAY['commission_entries','commission_payments','commission_payment_entries'] LOOP
        EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes()',item);
    END LOOP;
END $$;

-- The database also rejects accidental changes after commercial confirmation.
CREATE FUNCTION protect_order_commission_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sales_orders o WHERE o.tenant_id=NEW.tenant_id AND o.id=NEW.order_id AND o.status='draft')
       OR EXISTS (SELECT 1 FROM receivables r JOIN receivable_payments p ON p.tenant_id=r.tenant_id AND p.receivable_id=r.id WHERE r.tenant_id=NEW.tenant_id AND r.order_id=NEW.order_id) THEN
        RAISE EXCEPTION 'Commission terms require an unconfirmed order without receipts' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER immutable_confirmed_commission_terms BEFORE INSERT OR UPDATE ON order_commission_terms
    FOR EACH ROW EXECUTE FUNCTION protect_order_commission_terms();
CREATE TRIGGER commission_terms_preserve_delete BEFORE DELETE ON order_commission_terms
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();

INSERT INTO permissions(code,description) VALUES
    ('finance.commissions.read','Consultar livro e pagamentos de comissões'),
    ('finance.commissions.manage','Configurar comissões e declarar ajustes e pagamentos')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_code)
SELECT r.id,p.code FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','administrator') AND p.code IN ('finance.commissions.read','finance.commissions.manage')
ON CONFLICT DO NOTHING;
