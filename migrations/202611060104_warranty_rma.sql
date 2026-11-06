CREATE TABLE warranty_rmas (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    case_id uuid NOT NULL,
    supplier_id uuid,
    reference text NOT NULL,
    status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','authorized','in_transit','received','closed','cancelled')),
    carrier text,
    tracking_code text,
    notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, reference),
    FOREIGN KEY (tenant_id, case_id) REFERENCES warranty_cases(tenant_id, id),
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES parties(tenant_id, id)
);
CREATE INDEX warranty_rmas_case_idx ON warranty_rmas(tenant_id, case_id, updated_at DESC, id DESC);
ALTER TABLE warranty_rmas ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_rmas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warranty_rmas
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
