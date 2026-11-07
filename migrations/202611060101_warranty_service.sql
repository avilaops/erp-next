CREATE TABLE warranty_policies (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 120),
    coverage_type text NOT NULL CHECK (coverage_type IN ('legal','contractual','extended')),
    duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
    scope jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, name)
);

CREATE TABLE warranty_cases (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    protocol text NOT NULL,
    policy_id uuid,
    customer_id uuid,
    order_id uuid,
    product_id uuid,
    serial_number text,
    lot text,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 160),
    description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 15 AND 10000),
    criticality text NOT NULL CHECK (criticality IN ('low','normal','high','critical')),
    coverage_status text NOT NULL DEFAULT 'pending' CHECK (coverage_status IN ('pending','eligible','rejected','expired')),
    status text NOT NULL DEFAULT 'opened' CHECK (status IN ('opened','triage','diagnosis','treatment','resolved','closed','cancelled')),
    assigned_to uuid,
    sla_due_at timestamptz,
    resolution jsonb,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, protocol),
    FOREIGN KEY (tenant_id, policy_id) REFERENCES warranty_policies(tenant_id, id),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES parties(tenant_id, id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id, id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id)
);
CREATE INDEX warranty_cases_tenant_status_idx ON warranty_cases(tenant_id, status, updated_at DESC, id DESC);
CREATE INDEX warranty_cases_tenant_serial_idx ON warranty_cases(tenant_id, serial_number) WHERE serial_number IS NOT NULL;

CREATE TABLE warranty_case_events (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    case_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('opened','triaged','diagnosed','treated','resolved','closed','cancelled','note','attachment','approval')),
    status text,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, case_id) REFERENCES warranty_cases(tenant_id, id)
);
CREATE INDEX warranty_case_events_case_idx ON warranty_case_events(tenant_id, case_id, created_at, id);

CREATE TABLE warranty_service_orders (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    case_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','scheduled','in_repair','awaiting_parts','completed','cancelled')),
    diagnosis text,
    report jsonb NOT NULL DEFAULT '{}'::jsonb,
    scheduled_at timestamptz,
    completed_at timestamptz,
    labor_cents bigint NOT NULL DEFAULT 0 CHECK (labor_cents BETWEEN 0 AND 99999999999999),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, case_id),
    FOREIGN KEY (tenant_id, case_id) REFERENCES warranty_cases(tenant_id, id)
);

DO $$ DECLARE item text; BEGIN
    FOREACH item IN ARRAY ARRAY['warranty_policies','warranty_cases','warranty_case_events','warranty_service_orders'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', item);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', item);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)', item);
    END LOOP;
    EXECUTE 'CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON warranty_case_events FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes()';
END $$;

INSERT INTO permissions(code, description) VALUES
    ('service.warranties.read', 'Consultar garantias e assistência técnica da empresa'),
    ('service.warranties.manage', 'Gerenciar políticas, protocolos e tratativas de garantia'),
    ('service.warranties.approve', 'Aprovar troca, crédito ou reembolso de garantia')
ON CONFLICT(code) DO NOTHING;
