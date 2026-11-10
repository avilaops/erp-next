-- Internal receipts only. No fiscal transmission or external payment processing.
CREATE TABLE pos_sessions (
 tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
 register text NOT NULL CHECK (char_length(btrim(register)) BETWEEN 1 AND 80),
 cash_account_id uuid NOT NULL, opening_cents bigint NOT NULL CHECK(opening_cents BETWEEN 0 AND 99999999999999),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), opened_by text NOT NULL,
 opened_at timestamptz NOT NULL DEFAULT clock_timestamp(), closed_at timestamptz,
 counted_cents bigint CHECK(counted_cents BETWEEN 0 AND 99999999999999), close_reason text,
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,cash_account_id) REFERENCES financial_accounts(tenant_id,id),
 CHECK((status='open' AND closed_at IS NULL AND counted_cents IS NULL) OR (status='closed' AND closed_at IS NOT NULL AND counted_cents IS NOT NULL))
);
CREATE UNIQUE INDEX pos_register_open ON pos_sessions(tenant_id,lower(register)) WHERE status='open';
CREATE UNIQUE INDEX pos_cash_account_open ON pos_sessions(tenant_id,cash_account_id) WHERE status='open';
CREATE TABLE pos_sales (
 tenant_id uuid NOT NULL, id uuid NOT NULL, session_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','cancelled')),
 total_cents bigint NOT NULL CHECK(total_cents BETWEEN 1 AND 99999999999999),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by text NOT NULL,
 cancelled_at timestamptz, cancel_reason text, revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,session_id) REFERENCES pos_sessions(tenant_id,id)
);
CREATE INDEX pos_sales_history ON pos_sales(tenant_id,created_at DESC,id DESC);
CREATE INDEX pos_sales_session_history ON pos_sales(tenant_id,session_id,created_at DESC,id DESC);
ALTER TABLE stock_movements ADD COLUMN source_pos_sale_id uuid;
ALTER TABLE stock_movements ADD FOREIGN KEY(tenant_id,source_pos_sale_id) REFERENCES pos_sales(tenant_id,id);
CREATE TABLE pos_sale_items (
 tenant_id uuid NOT NULL, sale_id uuid NOT NULL, product_id uuid NOT NULL,
 quantity_micros bigint NOT NULL CHECK(quantity_micros BETWEEN 1 AND 999999999999999999),
 movement_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,sale_id,product_id),
 FOREIGN KEY(tenant_id,sale_id) REFERENCES pos_sales(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(tenant_id,movement_id) REFERENCES stock_movements(tenant_id,id)
);
CREATE TABLE pos_payments (
 tenant_id uuid NOT NULL,id uuid NOT NULL,sale_id uuid NOT NULL,account_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN ('cash','pix','debit','credit')),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 99999999999999),
 tendered_cents bigint NOT NULL CHECK(tendered_cents>=amount_cents),entry_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,sale_id) REFERENCES pos_sales(tenant_id,id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES financial_accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,entry_id) REFERENCES financial_account_entries(tenant_id,id),
 CHECK(method='cash' OR tendered_cents=amount_cents)
);
CREATE TABLE pos_cash_movements (
 tenant_id uuid NOT NULL,id uuid NOT NULL,session_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('supply','withdrawal')),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 99999999999999),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 200),transfer_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,session_id) REFERENCES pos_sessions(tenant_id,id),
 FOREIGN KEY(tenant_id,transfer_id) REFERENCES financial_account_transfers(tenant_id,id)
);
CREATE INDEX pos_payments_sale ON pos_payments(tenant_id,sale_id);
CREATE INDEX pos_cash_movements_session ON pos_cash_movements(tenant_id,session_id,created_at DESC,id DESC);
CREATE FUNCTION guard_pos_sale_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'POS receipts cannot be deleted'; END IF;
 IF OLD.status<>'completed' OR NEW.status<>'cancelled'
    OR NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.session_id<>OLD.session_id
    OR NEW.receipt<>OLD.receipt OR NEW.total_cents<>OLD.total_cents
    OR NEW.created_at<>OLD.created_at OR NEW.created_by<>OLD.created_by
    OR NEW.revision<>OLD.revision+1 OR NEW.cancelled_at IS NULL
    OR COALESCE(char_length(btrim(NEW.cancel_reason)),0)<3 THEN
   RAISE EXCEPTION 'POS receipt may only be cancelled once with a reason';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_sale_guard BEFORE UPDATE OR DELETE ON pos_sales
 FOR EACH ROW EXECUTE FUNCTION guard_pos_sale_update();
CREATE FUNCTION guard_closed_pos_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status='closed' THEN RAISE EXCEPTION 'Closed POS sessions are immutable'; END IF;
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.id<>OLD.id OR NEW.register<>OLD.register
    OR NEW.cash_account_id<>OLD.cash_account_id OR NEW.opening_cents<>OLD.opening_cents
    OR NEW.opened_at<>OLD.opened_at OR NEW.opened_by<>OLD.opened_by
    OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'POS session identity and opening are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_session_guard BEFORE UPDATE OR DELETE ON pos_sessions
 FOR EACH ROW EXECUTE FUNCTION guard_closed_pos_session();
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['pos_sessions','pos_sales','pos_sale_items','pos_payments','pos_cash_movements'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',tbl);
 END LOOP;
 FOREACH tbl IN ARRAY ARRAY['pos_sale_items','pos_payments','pos_cash_movements'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_pos_records BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes()',tbl);
 END LOOP;
END $$;
INSERT INTO permissions(code,description) VALUES
 ('sales.pos.read','Consultar caixa e cupons internos de PDV'),
 ('sales.pos.manage','Abrir caixa, vender e movimentar PDV'),
 ('sales.pos.close','Conferir e fechar caixa de PDV'),
 ('sales.pos.cancel','Cancelar venda de PDV com estorno') ON CONFLICT(code) DO NOTHING;
