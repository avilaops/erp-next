CREATE TABLE warranty_quarantines (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    case_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros BETWEEN 1 AND 999999999999999999),
    stock_movement_id uuid NOT NULL,
    release_movement_id uuid,
    status text NOT NULL DEFAULT 'quarantined' CHECK (status IN ('quarantined','released','disposed')),
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, stock_movement_id),
    UNIQUE (tenant_id, release_movement_id),
    FOREIGN KEY (tenant_id, case_id) REFERENCES warranty_cases(tenant_id, id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
    FOREIGN KEY (tenant_id, stock_movement_id) REFERENCES stock_movements(tenant_id, id),
    FOREIGN KEY (tenant_id, release_movement_id) REFERENCES stock_movements(tenant_id, id)
);
CREATE INDEX warranty_quarantines_case_idx ON warranty_quarantines(tenant_id, case_id, updated_at DESC, id DESC);
ALTER TABLE warranty_quarantines ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_quarantines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warranty_quarantines
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
