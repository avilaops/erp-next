ALTER TABLE products ADD COLUMN category_id uuid;
ALTER TABLE products ADD CONSTRAINT products_category_tenant_fk
    FOREIGN KEY (tenant_id, category_id) REFERENCES product_categories(tenant_id, id);
CREATE INDEX products_category_idx ON products(tenant_id, category_id, name, id);

CREATE TABLE product_media_assets (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL,
    file_id uuid NOT NULL,
    collection text NOT NULL CHECK (collection ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    variant text NOT NULL CHECK (variant IN ('source', 'black', 'webp', 'thumbnail')),
    version integer NOT NULL CHECK (version > 0),
    width_px integer NOT NULL CHECK (width_px > 0),
    height_px integer NOT NULL CHECK (height_px > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
    FOREIGN KEY (tenant_id, file_id) REFERENCES system_config.files(tenant_id, id),
    UNIQUE (tenant_id, product_id, variant, version)
);
CREATE INDEX product_media_assets_lookup_idx ON product_media_assets(tenant_id, collection, product_id, variant, version DESC);
ALTER TABLE product_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_media_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY product_media_assets_isolation ON product_media_assets
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE TRIGGER product_media_assets_immutable BEFORE UPDATE OR DELETE ON product_media_assets
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();
