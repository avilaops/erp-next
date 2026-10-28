-- Identity-scoped discovery is SELECT-only and applies before tenant selection.
CREATE POLICY memberships_self_discovery ON tenant_memberships FOR SELECT
    USING (nullif(current_setting('app.tenant_id', true), '') IS NULL
        AND status = 'active'
        AND identity_id IN (SELECT id FROM identities
            WHERE auth_subject = nullif(current_setting('app.auth_subject', true), '')));

CREATE POLICY tenants_self_discovery ON tenants FOR SELECT
    USING (nullif(current_setting('app.tenant_id', true), '') IS NULL
        AND status = 'active'
        AND id IN (SELECT tenant_id FROM tenant_memberships WHERE status = 'active'));

CREATE TABLE company_creation_commands (
    auth_subject text NOT NULL,
    command_key uuid NOT NULL,
    tenant_id uuid NOT NULL REFERENCES tenants (id),
    request jsonb NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (auth_subject, command_key)
);
ALTER TABLE company_creation_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_creation_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY company_creation_commands_identity ON company_creation_commands
    USING (auth_subject = nullif(current_setting('app.auth_subject', true), ''))
    WITH CHECK (auth_subject = nullif(current_setting('app.auth_subject', true), ''));
