CREATE TABLE logistics_checkout_packages (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    checkout_id uuid NOT NULL,
    package_number integer NOT NULL CHECK (package_number BETWEEN 1 AND 999),
    weight_grams bigint NOT NULL CHECK (weight_grams BETWEEN 1 AND 999999999),
    length_mm integer NOT NULL CHECK (length_mm BETWEEN 1 AND 99999),
    width_mm integer NOT NULL CHECK (width_mm BETWEEN 1 AND 99999),
    height_mm integer NOT NULL CHECK (height_mm BETWEEN 1 AND 99999),
    label_code text,
    status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'labelled', 'packed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, checkout_id, package_number),
    FOREIGN KEY (tenant_id, checkout_id) REFERENCES logistics_checkouts(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX logistics_checkout_packages_checkout_idx ON logistics_checkout_packages(tenant_id, checkout_id, package_number);

ALTER TABLE logistics_checkout_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_checkout_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY logistics_checkout_packages_isolation ON logistics_checkout_packages
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
