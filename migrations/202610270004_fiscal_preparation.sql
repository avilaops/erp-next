-- Preparation only. An unvalidated draft never owns an NF-e number or protocol.
CREATE TABLE fiscal_profiles (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
    revision bigint NOT NULL CHECK (revision > 0),
    environment text NOT NULL CHECK (environment = 'homologation'),
    details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fiscal_nfe_drafts (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    id uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    environment text NOT NULL CHECK (environment = 'homologation'),
    model smallint NOT NULL CHECK (model = 55),
    status text NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
    profile_revision bigint NOT NULL CHECK (profile_revision > 0),
    company_revision bigint NOT NULL CHECK (company_revision > 0),
    issuer_snapshot jsonb NOT NULL CHECK (jsonb_typeof(issuer_snapshot) = 'object'),
    details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
    products_total_cents bigint NOT NULL CHECK (products_total_cents BETWEEN 1 AND 999999999999999),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);
CREATE INDEX fiscal_nfe_drafts_page_idx ON fiscal_nfe_drafts(tenant_id, id DESC);

ALTER TABLE fiscal_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_profiles_isolation ON fiscal_profiles
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE fiscal_nfe_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_nfe_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_nfe_drafts_isolation ON fiscal_nfe_drafts
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('fiscal.config.read', 'Consultar preparação fiscal da empresa'),
    ('fiscal.config.manage', 'Configurar preparação fiscal da empresa'),
    ('fiscal.nfe.read', 'Consultar rascunhos de NF-e da empresa'),
    ('fiscal.nfe.manage', 'Criar e alterar rascunhos de NF-e da empresa'),
    ('fiscal.nfe.issue', 'Solicitar emissão de NF-e em homologação; transmissão bloqueada nesta versão')
ON CONFLICT (code) DO NOTHING;
