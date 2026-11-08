-- Custom commercial price lists never change catalog base prices or order snapshots.
CREATE TABLE price_lists (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    id uuid NOT NULL,
    code text NOT NULL CHECK (code ~ '^[A-Z0-9._-]{1,40}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status text NOT NULL CHECK (status IN ('active','archived')),
    valid_from date,
    valid_until date,
    notes text CHECK (char_length(notes) <= 1000),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,code),
    CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until)
);
CREATE TABLE price_list_items (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    price_list_id uuid NOT NULL,
    product_id uuid NOT NULL,
    price_cents bigint NOT NULL CHECK (price_cents BETWEEN 0 AND 99999999999999),
    PRIMARY KEY (tenant_id,price_list_id,product_id),
    FOREIGN KEY (tenant_id,price_list_id) REFERENCES price_lists(tenant_id,id),
    FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE INDEX price_lists_name_idx ON price_lists(tenant_id,name,id);
ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_lists FORCE ROW LEVEL SECURITY;
CREATE POLICY price_lists_isolation ON price_lists
    USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE price_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_list_items FORCE ROW LEVEL SECURITY;
CREATE POLICY price_list_items_isolation ON price_list_items
    USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
