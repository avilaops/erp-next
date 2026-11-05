CREATE TABLE fixed_expenses (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 3 AND 200),
    category_id uuid NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 0 AND 1000000000000),
    frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency = 'monthly'),
    starts_on date NOT NULL,
    ends_on date,
    status text NOT NULL CHECK (status IN ('active','archived')),
    revision bigint NOT NULL CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id,id),
    CHECK (ends_on IS NULL OR ends_on >= starts_on),
    FOREIGN KEY (tenant_id,category_id) REFERENCES financial_categories(tenant_id,id)
);
CREATE INDEX fixed_expenses_monthly ON fixed_expenses(tenant_id,status,starts_on,ends_on);
ALTER TABLE fixed_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_expenses FORCE ROW LEVEL SECURITY;
CREATE POLICY fixed_expenses_isolation ON fixed_expenses
    USING (tenant_id=current_setting('app.tenant_id',true)::uuid)
    WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);
