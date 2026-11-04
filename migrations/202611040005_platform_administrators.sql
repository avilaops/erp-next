-- Platform authority is explicitly provisioned, never inferred from email.
CREATE TABLE platform_administrators (
    auth_subject text PRIMARY KEY REFERENCES identities(auth_subject),
    active boolean NOT NULL DEFAULT true,
    granted_by text NOT NULL CHECK (length(btrim(granted_by)) > 0),
    reason text NOT NULL CHECK (length(btrim(reason)) > 0),
    granted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_administrators ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_administrators FORCE ROW LEVEL SECURITY;
-- No runtime INSERT/UPDATE/DELETE policy, including when bootstrap grants DML.
CREATE POLICY platform_administrator_self ON platform_administrators FOR SELECT
    USING (auth_subject = nullif(current_setting('app.auth_subject', true), ''));

CREATE POLICY platform_tenant_directory ON tenants FOR SELECT
    USING (nullif(current_setting('app.tenant_id', true), '') IS NULL
        AND EXISTS (SELECT 1 FROM platform_administrators WHERE active));

COMMENT ON TABLE platform_administrators IS
    'Explicit ERP platform operators. Provision/revoke through audited administration; no automatic Auth role or email escalation.';

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp_next_app') THEN
        GRANT SELECT ON platform_administrators TO erp_next_app;
    END IF;
END $$;
