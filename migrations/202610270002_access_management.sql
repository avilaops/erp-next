ALTER TABLE tenant_memberships
    ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE roles
    ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    ADD COLUMN description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000);

CREATE TABLE role_creation_commands (
    tenant_id uuid NOT NULL REFERENCES tenants (id),
    auth_subject text NOT NULL,
    command_key uuid NOT NULL,
    request jsonb NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, auth_subject, command_key)
);
ALTER TABLE role_creation_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_creation_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY role_creation_commands_isolation ON role_creation_commands
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
