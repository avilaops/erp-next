-- Draft-only configuration; no legacy rate or commercial default is seeded.
CREATE TABLE commercial_settings (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    product_line text NOT NULL CHECK (product_line IN ('imported', 'national')),
    parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters) = 'object'),
    revision bigint NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, product_line)
);

ALTER TABLE commercial_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY commercial_settings_isolation ON commercial_settings
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
