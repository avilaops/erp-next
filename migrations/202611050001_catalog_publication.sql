CREATE TABLE product_catalog_profiles (
    tenant_id uuid NOT NULL,
    product_id uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    collection text NOT NULL CHECK (collection IN ('core','premium')),
    muscle_group text NOT NULL CHECK (char_length(muscle_group) BETWEEN 1 AND 80),
    technical_category text NOT NULL CHECK (char_length(technical_category) BETWEEN 1 AND 80),
    dimensions_mm integer[] NOT NULL CHECK (array_length(dimensions_mm,1)=3 AND 0 < ALL(dimensions_mm) AND 50000 >= ALL(dimensions_mm)),
    description text NOT NULL CHECK (char_length(description)<=4000),
    weight text NOT NULL DEFAULT '' CHECK (char_length(weight)<=80),
    weight_stack text NOT NULL DEFAULT '' CHECK (char_length(weight_stack)<=80),
    public_path text NOT NULL CHECK (public_path ~ '^/(core|loja)/[a-z0-9-]+/$'),
    main_media_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(tenant_id,product_id),
    UNIQUE(tenant_id,public_path),
    FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
    FOREIGN KEY(tenant_id,main_media_id) REFERENCES product_media_assets(tenant_id,id)
);
CREATE TABLE catalog_publications (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    id uuid NOT NULL,
    sequence bigint GENERATED ALWAYS AS IDENTITY,
    snapshot jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published')),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    PRIMARY KEY(tenant_id,id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['product_catalog_profiles','catalog_publications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  END LOOP;
END $$;
