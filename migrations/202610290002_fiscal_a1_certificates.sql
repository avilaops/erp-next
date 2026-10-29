CREATE TABLE fiscal_a1_certificates (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
    revision bigint NOT NULL CHECK (revision > 0),
    metadata jsonb,
    encryption_key_id text,
    nonce bytea,
    ciphertext bytea,
    updated_by_identity_id uuid NOT NULL REFERENCES identities(id),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (metadata IS NULL AND encryption_key_id IS NULL AND nonce IS NULL AND ciphertext IS NULL)
        OR
        (metadata IS NOT NULL AND jsonb_typeof(metadata) = 'object' AND encryption_key_id IS NOT NULL
         AND nonce IS NOT NULL AND ciphertext IS NOT NULL
         AND octet_length(nonce) = 12 AND octet_length(ciphertext) BETWEEN 17 AND 400000)
    )
);

ALTER TABLE fiscal_a1_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_a1_certificates FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_a1_certificates_isolation ON fiscal_a1_certificates
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
