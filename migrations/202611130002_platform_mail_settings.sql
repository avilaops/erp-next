-- One encrypted SMTP configuration for the whole platform. Runtime reads are
-- needed by tenant senders; SQL writes additionally require a platform admin.
CREATE TABLE platform_mail_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    revision bigint NOT NULL CHECK (revision > 0),
    secret_context text,
    secret_key_id text,
    secret_nonce bytea,
    secret_ciphertext bytea,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((secret_context IS NULL AND secret_key_id IS NULL AND secret_nonce IS NULL AND secret_ciphertext IS NULL)
        OR (secret_context IS NOT NULL AND secret_key_id IS NOT NULL AND secret_nonce IS NOT NULL
            AND octet_length(secret_nonce) = 12 AND secret_ciphertext IS NOT NULL AND octet_length(secret_ciphertext) >= 16))
);
ALTER TABLE platform_mail_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_mail_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_mail_runtime_read ON platform_mail_settings FOR SELECT USING (true);
CREATE POLICY platform_mail_admin_insert ON platform_mail_settings FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM platform_administrators
        WHERE active AND auth_subject = nullif(current_setting('app.auth_subject', true), '')));
CREATE POLICY platform_mail_admin_update ON platform_mail_settings FOR UPDATE
    USING (EXISTS (SELECT 1 FROM platform_administrators
        WHERE active AND auth_subject = nullif(current_setting('app.auth_subject', true), '')))
    WITH CHECK (EXISTS (SELECT 1 FROM platform_administrators
        WHERE active AND auth_subject = nullif(current_setting('app.auth_subject', true), '')));
REVOKE ALL ON platform_mail_settings FROM PUBLIC;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_next_app') THEN
        GRANT SELECT, INSERT, UPDATE ON platform_mail_settings TO erp_next_app;
    END IF;
END $$;
