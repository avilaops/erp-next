CREATE TABLE commercial_template_versions (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    id uuid NOT NULL,
    draft_id uuid NOT NULL,
    draft_revision bigint NOT NULL,
    definition_json text NOT NULL,
    pdf bytea NOT NULL CHECK (octet_length(pdf) BETWEEN 5 AND 5242880),
    request_hash text NOT NULL,
    external_id bigint,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,draft_id,draft_revision),
    FOREIGN KEY (tenant_id,draft_id) REFERENCES commercial_template_drafts(tenant_id,id),
    CHECK ((external_id IS NULL) = (published_at IS NULL))
);
ALTER TABLE commercial_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_template_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY commercial_template_versions_isolation ON commercial_template_versions
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION protect_commercial_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.tenant_id,NEW.id,NEW.draft_id,NEW.draft_revision,NEW.definition_json,NEW.pdf,NEW.request_hash)
        IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.draft_id,OLD.draft_revision,OLD.definition_json,OLD.pdf,OLD.request_hash)
        OR (OLD.external_id IS NOT NULL AND (NEW.external_id,NEW.published_at) IS DISTINCT FROM (OLD.external_id,OLD.published_at)) THEN
        RAISE EXCEPTION 'Published template snapshot is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER commercial_template_version_immutable BEFORE UPDATE ON commercial_template_versions
    FOR EACH ROW EXECUTE FUNCTION protect_commercial_template_version();
