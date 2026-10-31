-- Editable source models are separate from immutable issued contracts.
CREATE TABLE commercial_template_drafts (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    id uuid NOT NULL,
    definition jsonb NOT NULL,
    pdf bytea NOT NULL CHECK (octet_length(pdf) BETWEEN 5 AND 5242880),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);
ALTER TABLE commercial_template_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_template_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_template_drafts_isolation ON commercial_template_drafts
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
