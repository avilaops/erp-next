-- No company policy or commercial authority is inferred from the legacy screenshots.
INSERT INTO permissions(code,description) VALUES
 ('sales.approvals.manage','Aprovar negociações dentro da alçada gerencial'),
 ('sales.approvals.director','Aprovar negociações reservadas à diretoria')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE commercial_approval_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 revision bigint NOT NULL CHECK(revision > 0),
 rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commercial_order_quotes (
 tenant_id uuid NOT NULL,
 order_id uuid NOT NULL,
 price_version_id uuid NOT NULL,
 public_snapshot jsonb NOT NULL CHECK(jsonb_typeof(public_snapshot)='object'),
 private_snapshot jsonb NOT NULL CHECK(jsonb_typeof(private_snapshot)='object'),
 approval_rules jsonb NOT NULL CHECK(jsonb_typeof(approval_rules)='object'),
 approval_status text NOT NULL CHECK(approval_status IN ('not_required','pending','approved','rejected')),
 requires_director boolean NOT NULL,
 created_by uuid NOT NULL REFERENCES identities(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,order_id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES sales_orders(tenant_id,id),
 FOREIGN KEY(tenant_id,price_version_id) REFERENCES price_table_versions(tenant_id,id)
);
CREATE TABLE commercial_approval_decisions (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 order_id uuid NOT NULL,
 order_revision bigint NOT NULL CHECK(order_revision > 0),
 decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 decided_by uuid NOT NULL REFERENCES identities(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,order_id) REFERENCES commercial_order_quotes(tenant_id,order_id)
);
CREATE TRIGGER commercial_decisions_immutable BEFORE UPDATE OR DELETE ON commercial_approval_decisions
 FOR EACH ROW EXECUTE FUNCTION reject_price_history_changes();
CREATE FUNCTION preserve_commercial_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'approval_status') IS DISTINCT FROM (to_jsonb(OLD)-'approval_status') THEN
  RAISE EXCEPTION 'Commercial agreement snapshots are immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER commercial_quote_immutable BEFORE UPDATE ON commercial_order_quotes
 FOR EACH ROW EXECUTE FUNCTION preserve_commercial_quote();

ALTER TABLE commercial_approval_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_approval_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY approval_settings_isolation ON commercial_approval_settings
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE commercial_order_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_order_quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_quotes_isolation ON commercial_order_quotes
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE commercial_approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_approval_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_decisions_isolation ON commercial_approval_decisions
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
