-- Partial receipts derive totals from the immutable payment ledger.
-- Keep the tenant/account lookup indexed without introducing a mutable balance.
CREATE INDEX receivable_payments_account_idx
    ON receivable_payments(tenant_id, receivable_id, created_at, id);
