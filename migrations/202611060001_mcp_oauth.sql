-- Issuer-owned OAuth storage. No business rows or tenant permissions are granted.
CREATE TABLE mcp_oauth_clients (
    id text PRIMARY KEY,
    name text NOT NULL,
    redirects jsonb NOT NULL,
    auth_method text NOT NULL CHECK (auth_method IN ('none','client_secret_post','client_secret_basic')),
    secret_hash text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_oauth_clients_created ON mcp_oauth_clients(created_at);
CREATE TABLE mcp_oauth_grants (
    id uuid PRIMARY KEY,
    client_id text NOT NULL REFERENCES mcp_oauth_clients(id),
    subject text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    verified_email boolean NOT NULL,
    scope text NOT NULL,
    resource text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
    revoked_at timestamptz
);
CREATE INDEX mcp_oauth_grants_subject ON mcp_oauth_grants(subject);
CREATE TABLE mcp_oauth_codes (
    hash text PRIMARY KEY,
    grant_id uuid NOT NULL REFERENCES mcp_oauth_grants(id),
    redirect_uri text NOT NULL,
    challenge text NOT NULL,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
    consumed_at timestamptz
);
CREATE TABLE mcp_oauth_tokens (
    hash text PRIMARY KEY,
    grant_id uuid NOT NULL REFERENCES mcp_oauth_grants(id),
    kind text NOT NULL CHECK (kind IN ('access','refresh')),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);
CREATE INDEX mcp_oauth_tokens_grant ON mcp_oauth_tokens(grant_id);
