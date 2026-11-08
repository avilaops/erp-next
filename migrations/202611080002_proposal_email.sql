CREATE TABLE sales_proposal_email_deliveries (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    proposal_id uuid NOT NULL,
    version integer NOT NULL,
    proposal_revision bigint NOT NULL CHECK (proposal_revision > 0),
    result_revision bigint NOT NULL CHECK (result_revision > 0),
    subject_id text NOT NULL,
    command_key uuid NOT NULL,
    recipient text NOT NULL CHECK (char_length(recipient) BETWEEN 3 AND 254),
    snapshot_html text NOT NULL,
    status text NOT NULL CHECK (status IN ('uncertain', 'sent', 'failed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    UNIQUE (tenant_id, subject_id, command_key),
    FOREIGN KEY (tenant_id, proposal_id, version)
        REFERENCES sales_proposal_versions(tenant_id, proposal_id, version),
    CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);
CREATE INDEX sales_proposal_email_history_idx
    ON sales_proposal_email_deliveries(tenant_id, proposal_id, created_at DESC, id DESC);
ALTER TABLE sales_proposal_email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_proposal_email_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_proposal_email_deliveries_isolation ON sales_proposal_email_deliveries
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
