CREATE TABLE warranty_approvals (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    case_id uuid NOT NULL,
    action text NOT NULL CHECK (action IN ('exchange','credit','refund')),
    decision text NOT NULL CHECK (decision IN ('approved','rejected')),
    amount_cents bigint CHECK (amount_cents IS NULL OR amount_cents BETWEEN 0 AND 99999999999999),
    notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, case_id, action),
    FOREIGN KEY (tenant_id, case_id) REFERENCES warranty_cases(tenant_id, id)
);
CREATE INDEX warranty_approvals_case_idx ON warranty_approvals(tenant_id, case_id, created_at, id);
ALTER TABLE warranty_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON warranty_approvals
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON warranty_approvals
    FOR EACH ROW EXECUTE FUNCTION reject_audit_log_changes();
