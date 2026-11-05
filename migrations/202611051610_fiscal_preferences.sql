-- User-declared fiscal preferences, independently versioned from the catalog.
CREATE TABLE fiscal_preferences (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    section text NOT NULL CHECK (section IN ('nfce', 'operation-natures')),
    revision bigint NOT NULL CHECK (revision > 0),
    data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    secret_key_id text,
    secret_nonce bytea,
    secret_ciphertext bytea,
    secret_context text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, section),
    CHECK ((secret_key_id IS NULL AND secret_nonce IS NULL AND secret_ciphertext IS NULL AND secret_context IS NULL)
        OR (section = 'nfce' AND secret_key_id IS NOT NULL AND octet_length(secret_nonce) = 12
            AND secret_ciphertext IS NOT NULL AND secret_context IS NOT NULL))
);
ALTER TABLE fiscal_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_preferences_isolation ON fiscal_preferences
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
