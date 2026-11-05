CREATE TABLE price_table_versions (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    product_line text NOT NULL CHECK (product_line IN ('imported','national')),
    version bigint NOT NULL CHECK (version > 0),
    settings_revision bigint NOT NULL CHECK (settings_revision > 0),
    policy_snapshot jsonb NOT NULL CHECK (jsonb_typeof(policy_snapshot) = 'object'),
    calculator_version text NOT NULL,
    digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
    published_by uuid NOT NULL REFERENCES identities(id),
    published_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id,id),
    UNIQUE (tenant_id,product_line,id),
    UNIQUE (tenant_id,product_line,version),
    UNIQUE (tenant_id,product_line,digest),
    FOREIGN KEY (tenant_id,product_line) REFERENCES commercial_settings(tenant_id,product_line)
);
CREATE TABLE price_table_items (
    tenant_id uuid NOT NULL,
    version_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_snapshot jsonb NOT NULL CHECK (jsonb_typeof(product_snapshot)='object'),
    cost_revision bigint NOT NULL CHECK (cost_revision > 0),
    cost_snapshot jsonb NOT NULL CHECK (jsonb_typeof(cost_snapshot)='object'),
    price_without_ipi_cents bigint NOT NULL CHECK (price_without_ipi_cents BETWEEN 1 AND 1000000000000),
    ipi_bps integer NOT NULL CHECK (ipi_bps BETWEEN 0 AND 10000),
    price_with_ipi_cents bigint NOT NULL CHECK (price_with_ipi_cents BETWEEN 1 AND 1000000000000),
    PRIMARY KEY (tenant_id,version_id,product_id),
    FOREIGN KEY (tenant_id,version_id) REFERENCES price_table_versions(tenant_id,id),
    FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id)
);
ALTER TABLE commercial_settings ADD COLUMN active_price_version_id uuid;
ALTER TABLE commercial_settings ADD FOREIGN KEY (tenant_id,product_line,active_price_version_id)
    REFERENCES price_table_versions(tenant_id,product_line,id);
CREATE FUNCTION reject_price_history_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Published prices are immutable';
END;
$$;
CREATE TRIGGER price_versions_immutable BEFORE UPDATE OR DELETE ON price_table_versions
    FOR EACH ROW EXECUTE FUNCTION reject_price_history_changes();
CREATE TRIGGER price_items_immutable BEFORE UPDATE OR DELETE ON price_table_items
    FOR EACH ROW EXECUTE FUNCTION reject_price_history_changes();
ALTER TABLE price_table_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_table_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY price_table_versions_isolation ON price_table_versions
    USING (tenant_id=current_setting('app.tenant_id',true)::uuid)
    WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);
ALTER TABLE price_table_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_table_items FORCE ROW LEVEL SECURITY;
CREATE POLICY price_table_items_isolation ON price_table_items
    USING (tenant_id=current_setting('app.tenant_id',true)::uuid)
    WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);

