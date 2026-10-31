CREATE TABLE personal_preferences (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    auth_subject text NOT NULL REFERENCES identities(auth_subject),
    product_page_size integer NOT NULL CHECK (product_page_size IN (10,25,50,100)),
    revision bigint NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id,auth_subject)
);
ALTER TABLE personal_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY personal_preferences_owner ON personal_preferences
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
        AND auth_subject=current_setting('app.auth_subject',true))
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
        AND auth_subject=current_setting('app.auth_subject',true));
