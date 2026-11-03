-- Auxiliary supply catalogs preserve history; warehouses do not redistribute stock.
CREATE TABLE warehouses (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    notes text CHECK (char_length(notes) <= 1000),
    location text CHECK (char_length(location) <= 200),
    revision bigint NOT NULL CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);
CREATE TABLE product_groups (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    notes text CHECK (char_length(notes) <= 1000),
    revision bigint NOT NULL CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);
CREATE TABLE tag_groups (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    notes text CHECK (char_length(notes) <= 1000),
    revision bigint NOT NULL CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);
CREATE TABLE tags (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    notes text CHECK (char_length(notes) <= 1000),
    group_id uuid,
    revision bigint NOT NULL CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, group_id) REFERENCES tag_groups(tenant_id, id)
);
CREATE INDEX tags_group_idx ON tags(tenant_id, group_id);

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['warehouses', 'product_groups', 'tag_groups', 'tags'] LOOP
        EXECUTE format('CREATE INDEX %I ON %I(tenant_id, name, id)', table_name || '_name_idx', table_name);
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name);
    END LOOP;
END $$;
