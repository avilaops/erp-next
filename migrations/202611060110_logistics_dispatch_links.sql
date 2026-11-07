ALTER TABLE logistics_checkout_packages
    ADD CONSTRAINT logistics_checkout_packages_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE logistics_label_jobs (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    checkout_id uuid NOT NULL,
    package_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'printed', 'failed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, package_id),
    FOREIGN KEY (tenant_id, checkout_id) REFERENCES logistics_checkouts(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, package_id) REFERENCES logistics_checkout_packages(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE logistics_posting_packages (
    tenant_id uuid NOT NULL,
    posting_id uuid NOT NULL,
    package_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, posting_id, package_id),
    UNIQUE (tenant_id, package_id),
    FOREIGN KEY (tenant_id, posting_id) REFERENCES logistics_postings(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, package_id) REFERENCES logistics_checkout_packages(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX logistics_label_jobs_checkout_idx ON logistics_label_jobs(tenant_id, checkout_id, status);
CREATE INDEX logistics_posting_packages_posting_idx ON logistics_posting_packages(tenant_id, posting_id);

ALTER TABLE logistics_label_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_label_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY logistics_label_jobs_isolation ON logistics_label_jobs USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE logistics_posting_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_posting_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY logistics_posting_packages_isolation ON logistics_posting_packages USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('logistics.labels.manage', 'Gerenciar fila de etiquetas da empresa')
ON CONFLICT (code) DO NOTHING;
