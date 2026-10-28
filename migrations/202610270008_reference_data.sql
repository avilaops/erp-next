-- Reference data has no balances, bank connections or settlement side effects.
CREATE TABLE product_categories (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    notes text CHECK (char_length(notes) <= 1000),
    revision bigint NOT NULL CHECK (revision > 0),
    parent_id uuid,
    sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 999999),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    CHECK (parent_id IS DISTINCT FROM id),
    FOREIGN KEY (tenant_id, parent_id) REFERENCES product_categories(tenant_id, id)
);
CREATE INDEX product_categories_parent_idx ON product_categories(tenant_id, parent_id);
CREATE INDEX product_categories_name_idx ON product_categories(tenant_id, name, id);

CREATE TABLE financial_categories (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    notes text CHECK (char_length(notes) <= 1000),
    revision bigint NOT NULL CHECK (revision > 0),
    parent_id uuid,
    direction text NOT NULL CHECK (direction IN ('income', 'expense')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    CHECK (parent_id IS DISTINCT FROM id),
    FOREIGN KEY (tenant_id, parent_id) REFERENCES financial_categories(tenant_id, id)
);
CREATE INDEX financial_categories_parent_idx ON financial_categories(tenant_id, parent_id);
CREATE INDEX financial_categories_name_idx ON financial_categories(tenant_id, name, id);

CREATE TABLE financial_accounts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    notes text CHECK (char_length(notes) <= 1000),
    revision bigint NOT NULL CHECK (revision > 0),
    account_type text NOT NULL CHECK (account_type IN ('bank', 'cash', 'internal')),
    bank text CHECK (char_length(bank) <= 100),
    branch text CHECK (char_length(branch) <= 30),
    account_number text CHECK (char_length(account_number) <= 50),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    CHECK (account_type = 'bank' OR (bank IS NULL AND branch IS NULL AND account_number IS NULL))
);
CREATE INDEX financial_accounts_name_idx ON financial_accounts(tenant_id, name, id);

CREATE TABLE payment_methods (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    notes text CHECK (char_length(notes) <= 1000),
    revision bigint NOT NULL CHECK (revision > 0),
    modality text NOT NULL CHECK (modality IN ('pix', 'cash', 'bank_transfer', 'credit_card', 'debit_card', 'boleto', 'other')),
    settlement_days integer NOT NULL CHECK (settlement_days BETWEEN 0 AND 365),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);
CREATE INDEX payment_methods_name_idx ON payment_methods(tenant_id, name, id);

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['product_categories', 'financial_categories', 'financial_accounts', 'payment_methods'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name);
    END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
    ('catalog.categories.read', 'Consultar categorias de produtos'),
    ('catalog.categories.manage', 'Criar e alterar categorias de produtos'),
    ('finance.categories.read', 'Consultar categorias financeiras'),
    ('finance.categories.manage', 'Criar e alterar categorias financeiras'),
    ('finance.accounts.read', 'Consultar cadastros de contas financeiras'),
    ('finance.accounts.manage', 'Criar e alterar cadastros de contas financeiras'),
    ('finance.payment_methods.read', 'Consultar formas de pagamento'),
    ('finance.payment_methods.manage', 'Criar e alterar formas de pagamento')
ON CONFLICT (code) DO NOTHING;
