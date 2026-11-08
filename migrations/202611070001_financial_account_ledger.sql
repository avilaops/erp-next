CREATE TABLE financial_account_transfers (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    source_account_id uuid NOT NULL,
    target_account_id uuid NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000000000),
    occurred_on date NOT NULL,
    description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 3 AND 200),
    reference text CHECK (reference IS NULL OR char_length(reference) <= 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (source_account_id <> target_account_id),
    FOREIGN KEY (tenant_id, source_account_id) REFERENCES financial_accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, target_account_id) REFERENCES financial_accounts(tenant_id, id)
);
CREATE INDEX financial_account_transfers_date_idx ON financial_account_transfers(tenant_id, occurred_on, id);

CREATE TABLE financial_account_entries (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    account_id uuid NOT NULL,
    transfer_id uuid,
    category_id uuid,
    direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000000000),
    occurred_on date NOT NULL,
    description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 3 AND 200),
    reference text CHECK (reference IS NULL OR char_length(reference) <= 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, account_id) REFERENCES financial_accounts(tenant_id, id),
    FOREIGN KEY (tenant_id, transfer_id) REFERENCES financial_account_transfers(tenant_id, id),
    FOREIGN KEY (tenant_id, category_id) REFERENCES financial_categories(tenant_id, id)
);
CREATE INDEX financial_account_entries_account_date_idx ON financial_account_entries(tenant_id, account_id, occurred_on, id);
CREATE INDEX financial_account_entries_category_idx ON financial_account_entries(tenant_id, category_id, occurred_on, id);
CREATE INDEX financial_account_entries_transfer_idx ON financial_account_entries(tenant_id, transfer_id);

ALTER TABLE financial_account_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_account_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_account_entries_isolation ON financial_account_entries
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE financial_account_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_account_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_account_transfers_isolation ON financial_account_transfers
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
    ('finance.account_entries.read', 'Consultar lançamentos de contas financeiras'),
    ('finance.account_entries.manage', 'Criar lançamentos de contas financeiras'),
    ('finance.account_transfers.read', 'Consultar transferências entre contas financeiras'),
    ('finance.account_transfers.manage', 'Criar transferências entre contas financeiras')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE receivable_payments ADD COLUMN financial_account_id uuid;
ALTER TABLE payable_payments ADD COLUMN financial_account_id uuid;
ALTER TABLE receivable_payments ADD CONSTRAINT receivable_payments_financial_account_fk
    FOREIGN KEY (tenant_id, financial_account_id) REFERENCES financial_accounts(tenant_id, id);
ALTER TABLE payable_payments ADD CONSTRAINT payable_payments_financial_account_fk
    FOREIGN KEY (tenant_id, financial_account_id) REFERENCES financial_accounts(tenant_id, id);
CREATE INDEX receivable_payments_financial_account_idx ON receivable_payments(tenant_id, financial_account_id, occurred_on, id);
CREATE INDEX payable_payments_financial_account_idx ON payable_payments(tenant_id, financial_account_id, occurred_on, id);
