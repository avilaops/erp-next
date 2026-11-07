CREATE TABLE logistics_postings (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    code text NOT NULL,
    order_id uuid,
    recipient_name text NOT NULL CHECK (char_length(btrim(recipient_name)) BETWEEN 2 AND 200),
    carrier text,
    service text NOT NULL CHECK (char_length(btrim(service)) BETWEEN 2 AND 80),
    tracking_code text,
    destination_city text NOT NULL CHECK (char_length(btrim(destination_city)) BETWEEN 2 AND 120),
    destination_state text NOT NULL CHECK (destination_state ~ '^[A-Z]{2}$'),
    package_count integer NOT NULL CHECK (package_count BETWEEN 1 AND 999),
    weight_grams bigint NOT NULL CHECK (weight_grams BETWEEN 1 AND 999999999),
    declared_value_cents bigint NOT NULL CHECK (declared_value_cents BETWEEN 0 AND 99999999999999),
    status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'posted', 'in_transit', 'delivered', 'cancelled')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id, id)
);
CREATE INDEX logistics_postings_tenant_created_idx ON logistics_postings(tenant_id, created_at DESC, id DESC);
CREATE INDEX logistics_postings_tenant_status_idx ON logistics_postings(tenant_id, status, created_at DESC);

ALTER TABLE logistics_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_postings FORCE ROW LEVEL SECURITY;
CREATE POLICY logistics_postings_isolation ON logistics_postings
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('logistics.postings.read', 'Consultar objetos de postagem da empresa'),
    ('logistics.postings.manage', 'Criar e alterar objetos de postagem da empresa')
ON CONFLICT (code) DO NOTHING;
