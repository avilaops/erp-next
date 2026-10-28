CREATE TABLE parties (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    person_type text NOT NULL CHECK (person_type IN ('fisica', 'juridica')),
    legal_name text NOT NULL CHECK (char_length(btrim(legal_name)) BETWEEN 1 AND 200),
    trade_name text CHECK (char_length(btrim(trade_name)) BETWEEN 1 AND 200),
    tax_id text NOT NULL,
    email text CHECK (char_length(email) BETWEEN 3 AND 254),
    phone text CHECK (char_length(phone) BETWEEN 1 AND 40),
    is_customer boolean NOT NULL,
    is_supplier boolean NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (is_customer OR is_supplier),
    CHECK ((person_type = 'fisica' AND tax_id ~ '^[0-9]{11}$')
        OR (person_type = 'juridica' AND tax_id ~ '^[A-Z0-9]{12}[0-9]{2}$')),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, tax_id)
);
CREATE INDEX parties_tenant_name_idx ON parties(tenant_id, legal_name, id);

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties FORCE ROW LEVEL SECURITY;
CREATE POLICY parties_isolation ON parties
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('catalog.parties.read', 'Consultar clientes e fornecedores da empresa'),
    ('catalog.parties.manage', 'Criar e alterar clientes e fornecedores da empresa')
ON CONFLICT (code) DO NOTHING;
