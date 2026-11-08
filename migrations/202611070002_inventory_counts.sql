CREATE TABLE inventory_counts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','cancelled')),
    reference text NOT NULL CHECK (char_length(btrim(reference)) BETWEEN 2 AND 120),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by text NOT NULL,
    approved_by text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    approved_at timestamptz,
    cancelled_at timestamptz,
    UNIQUE (tenant_id,id),
    CHECK ((status='open' AND approved_at IS NULL AND cancelled_at IS NULL)
        OR (status='approved' AND approved_at IS NOT NULL AND cancelled_at IS NULL)
        OR (status='cancelled' AND cancelled_at IS NOT NULL AND approved_at IS NULL))
);
CREATE INDEX inventory_counts_tenant_created ON inventory_counts(tenant_id,created_at DESC,id DESC);

CREATE TABLE inventory_count_lines (
    tenant_id uuid NOT NULL,
    count_id uuid NOT NULL,
    product_id uuid NOT NULL,
    expected_quantity_micros bigint NOT NULL CHECK (expected_quantity_micros BETWEEN 0 AND 999999999999999999),
    counted_quantity_micros bigint CHECK (counted_quantity_micros BETWEEN 0 AND 999999999999999999),
    note text CHECK (note IS NULL OR char_length(note) <= 500),
    counted_at timestamptz,
    PRIMARY KEY (tenant_id,count_id,product_id),
    FOREIGN KEY (tenant_id,count_id) REFERENCES inventory_counts(tenant_id,id),
    FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE INDEX inventory_count_lines_product ON inventory_count_lines(tenant_id,product_id);

ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_counts FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_counts_isolation ON inventory_counts
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY inventory_count_lines_isolation ON inventory_count_lines
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
INSERT INTO permissions(code,description) VALUES
    ('inventory.counts.read','Consultar inventários físicos da empresa'),
    ('inventory.counts.manage','Criar, contar e aprovar inventários físicos da empresa')
ON CONFLICT(code) DO NOTHING;
