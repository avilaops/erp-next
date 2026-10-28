CREATE TABLE staff (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    code text NOT NULL CHECK (code ~ '^[A-Z0-9._-]{1,40}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    job_title text CHECK (char_length(btrim(job_title)) BETWEEN 1 AND 120),
    email text CHECK (char_length(email) BETWEEN 3 AND 254),
    phone text CHECK (char_length(phone) BETWEEN 1 AND 40),
    is_employee boolean NOT NULL,
    is_seller boolean NOT NULL,
    status text NOT NULL CHECK (status IN ('active','archived')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (is_employee OR is_seller),
    UNIQUE(tenant_id,id),
    UNIQUE(tenant_id,code)
);
CREATE INDEX staff_tenant_name_idx ON staff(tenant_id,name,id);
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_isolation ON staff
    USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
INSERT INTO permissions(code,description) VALUES
    ('catalog.staff.read','Consultar funcionários e vendedores da empresa'),
    ('catalog.staff.manage','Criar e alterar funcionários e vendedores da empresa')
ON CONFLICT(code) DO NOTHING;
