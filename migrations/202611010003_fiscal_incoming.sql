CREATE TABLE fiscal_distribution_cursors (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    environment smallint NOT NULL DEFAULT 2 CHECK(environment=2),
    last_nsu bigint NOT NULL DEFAULT 0 CHECK(last_nsu BETWEEN 0 AND 999999999999999),
    max_nsu bigint NOT NULL DEFAULT 0 CHECK(max_nsu >= last_nsu AND max_nsu <= 999999999999999),
    revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
    next_query_at timestamptz,
    lease_id uuid,
    lease_until timestamptz,
    last_code text,
    PRIMARY KEY(tenant_id,environment)
);
CREATE TABLE fiscal_distribution_runs (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    environment smallint NOT NULL CHECK(environment=2),
    auth_subject text NOT NULL,
    command_key uuid NOT NULL,
    requested_nsu bigint NOT NULL,
    status text NOT NULL CHECK(status IN ('running','completed','failed','unknown')),
    response jsonb,
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(tenant_id,auth_subject,command_key),
    UNIQUE(tenant_id,id)
);
CREATE TABLE fiscal_distribution_documents (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    environment smallint NOT NULL CHECK(environment=2),
    nsu bigint NOT NULL CHECK(nsu BETWEEN 1 AND 999999999999999),
    schema_name text NOT NULL CHECK(char_length(schema_name) BETWEEN 1 AND 120),
    kind text NOT NULL CHECK(kind IN ('summary','event','full')),
    access_key char(44) NOT NULL CHECK(access_key ~ '^[0-9]{44}$'),
    xml text NOT NULL CHECK(octet_length(xml) BETWEEN 1 AND 921600),
    xml_sha256 char(64) NOT NULL,
    metadata jsonb NOT NULL,
    received_nfe_id bigint,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(tenant_id,environment,nsu),
    FOREIGN KEY(tenant_id,received_nfe_id) REFERENCES fiscal_received_nfes(tenant_id,id)
);
CREATE TABLE fiscal_recipient_manifestations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    environment smallint NOT NULL CHECK(environment=2),
    access_key char(44) NOT NULL CHECK(access_key ~ '^[0-9]{44}$'),
    kind text NOT NULL CHECK(kind IN ('ciencia','confirmacao','desconhecimento','nao_realizada')),
    justification text,
    auth_subject text NOT NULL,
    command_key uuid NOT NULL,
    request jsonb NOT NULL,
    status text NOT NULL CHECK(status IN ('pending','accepted','rejected','unknown')),
    response jsonb,
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
    UNIQUE(tenant_id,environment,access_key,kind),
    UNIQUE(tenant_id,auth_subject,command_key),
    UNIQUE(tenant_id,id)
);
CREATE TABLE fiscal_received_purchase_links (
    tenant_id uuid NOT NULL,
    received_nfe_id bigint NOT NULL,
    purchase_order_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(tenant_id,received_nfe_id),
    UNIQUE(tenant_id,purchase_order_id),
    FOREIGN KEY(tenant_id,received_nfe_id) REFERENCES fiscal_received_nfes(tenant_id,id),
    FOREIGN KEY(tenant_id,purchase_order_id) REFERENCES purchase_orders(tenant_id,id),
    FOREIGN KEY(tenant_id,supplier_id) REFERENCES parties(tenant_id,id)
);
CREATE TABLE fiscal_received_item_costs (
    tenant_id uuid NOT NULL,
    received_nfe_id bigint NOT NULL,
    item_number integer NOT NULL CHECK(item_number BETWEEN 1 AND 990),
    product_id uuid NOT NULL,
    purchase_order_id uuid NOT NULL,
    unit text NOT NULL,
    quantity_micros bigint NOT NULL CHECK(quantity_micros>0),
    unit_cost_cents bigint NOT NULL CHECK(unit_cost_cents>=0),
    merchandise_cents bigint NOT NULL CHECK(merchandise_cents>=0),
    landed_cents bigint NOT NULL CHECK(landed_cents>=0),
    components jsonb NOT NULL,
    PRIMARY KEY(tenant_id,received_nfe_id,item_number),
    FOREIGN KEY(tenant_id,received_nfe_id) REFERENCES fiscal_received_nfes(tenant_id,id),
    FOREIGN KEY(tenant_id,purchase_order_id,product_id) REFERENCES purchase_order_lines(tenant_id,order_id,product_id) DEFERRABLE INITIALLY DEFERRED
);
DO $$ DECLARE item text; BEGIN
    FOREACH item IN ARRAY ARRAY['fiscal_distribution_cursors','fiscal_distribution_runs','fiscal_distribution_documents','fiscal_recipient_manifestations','fiscal_received_purchase_links','fiscal_received_item_costs'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',item);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',item);
    END LOOP;
    FOREACH item IN ARRAY ARRAY['fiscal_distribution_documents','fiscal_received_purchase_links','fiscal_received_item_costs'] LOOP
        EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes()',item);
    END LOOP;
END $$;
