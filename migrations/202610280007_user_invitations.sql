CREATE TABLE user_invitations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    email text NOT NULL CHECK (email = lower(btrim(email))),
    name text NOT NULL,
    invited_by text NOT NULL,
    role_ids uuid[] NOT NULL,
    permission_ceiling text[] NOT NULL,
    command_key uuid NOT NULL,
    request jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
    delivery text NOT NULL DEFAULT 'sending' CHECK (delivery IN ('sending', 'sent', 'failed', 'unknown', 'limited')),
    delivery_key uuid NOT NULL,
    last_delivery_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
    accepted_at timestamptz,
    accepted_subject text,
    UNIQUE (tenant_id, command_key)
);
CREATE UNIQUE INDEX user_invitations_pending_email ON user_invitations(tenant_id, email)
    WHERE status = 'pending';
CREATE INDEX user_invitations_email ON user_invitations(email) WHERE status = 'pending';
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY user_invitations_tenant ON user_invitations
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- The API sets this context only from a verified claim of the trusted Auth issuer.
-- Discovery cannot insert, accept or change invitations across companies.
CREATE POLICY user_invitations_discovery ON user_invitations FOR SELECT
    USING (nullif(current_setting('app.tenant_id', true), '') IS NULL
        AND email = nullif(current_setting('app.invitation_email', true), '')
        AND status = 'pending' AND expires_at > now());
