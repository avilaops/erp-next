CREATE TABLE product_import_jobs (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    source_name text NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 160),
    format text NOT NULL CHECK (format = 'csv'),
    status text NOT NULL CHECK (status IN ('previewed', 'imported', 'failed')),
    rows jsonb NOT NULL,
    result jsonb,
    created_by_identity_id uuid NOT NULL REFERENCES identities(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (tenant_id, source_sha256)
);
ALTER TABLE product_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_import_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY product_import_jobs_isolation ON product_import_jobs
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE INDEX product_import_jobs_tenant_created_idx ON product_import_jobs(tenant_id, created_at DESC, id DESC);
INSERT INTO permissions(code, description) VALUES
    ('catalog.products.import', 'Importar produtos por CSV com prévia e confirmação'),
    ('catalog.products.export', 'Exportar produtos autorizados da empresa')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
SELECT rp.role_id, new_permissions.permission_code
FROM role_permissions rp
CROSS JOIN (VALUES ('catalog.products.import'), ('catalog.products.export')) AS new_permissions(permission_code)
WHERE rp.permission_code = 'catalog.products.manage'
ON CONFLICT DO NOTHING;
