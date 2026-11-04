-- Storage foundation only. Application endpoints must enforce feature permissions.
-- Existing identity, audit and business tables remain the sources of truth.
CREATE SCHEMA system_config;
REVOKE ALL ON SCHEMA system_config FROM PUBLIC;

CREATE TABLE system_config.files (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    storage_key text NOT NULL CHECK (char_length(storage_key) BETWEEN 1 AND 1000),
    original_name text NOT NULL CHECK (char_length(btrim(original_name)) BETWEEN 1 AND 255),
    media_type text NOT NULL CHECK (char_length(media_type) BETWEEN 1 AND 255),
    byte_size bigint NOT NULL CHECK (byte_size >= 0),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'quarantined', 'archived')),
    created_by uuid NOT NULL REFERENCES public.identities(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, storage_key),
    FOREIGN KEY (tenant_id, created_by) REFERENCES public.tenant_memberships(tenant_id, identity_id)
);
CREATE INDEX system_files_created_idx ON system_config.files(tenant_id, created_at DESC, id DESC);

CREATE TABLE system_config.file_versions (
    tenant_id uuid NOT NULL,
    file_id uuid NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    content_file_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, file_id, version),
    FOREIGN KEY (tenant_id, file_id) REFERENCES system_config.files(tenant_id, id),
    FOREIGN KEY (tenant_id, content_file_id) REFERENCES system_config.files(tenant_id, id)
);

CREATE TABLE system_config.custom_fields (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    entity_type text NOT NULL CHECK (entity_type IN ('product', 'party', 'sales_order')),
    code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,62}$'),
    label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
    value_type text NOT NULL CHECK (value_type IN ('text', 'number', 'boolean', 'date', 'choice')),
    required boolean NOT NULL DEFAULT false,
    choices jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(choices) = 'array'
        AND NOT jsonb_path_exists(choices, '$[*] ? (@.type() != "string")')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, entity_type, code),
    UNIQUE (tenant_id, id, entity_type),
    CHECK ((value_type = 'choice' AND jsonb_array_length(choices) > 0)
        OR (value_type <> 'choice' AND choices = '[]'::jsonb))
);

CREATE TABLE system_config.custom_field_values (
    tenant_id uuid NOT NULL,
    field_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    entity_type text NOT NULL,
    product_id uuid,
    party_id uuid,
    sales_order_id uuid,
    value jsonb NOT NULL CHECK (value <> 'null'::jsonb),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    PRIMARY KEY (tenant_id, field_id, entity_id),
    FOREIGN KEY (tenant_id, field_id, entity_type)
        REFERENCES system_config.custom_fields(tenant_id, id, entity_type),
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id),
    FOREIGN KEY (tenant_id, party_id) REFERENCES public.parties(tenant_id, id),
    FOREIGN KEY (tenant_id, sales_order_id) REFERENCES public.sales_orders(tenant_id, id),
    CHECK ((entity_type = 'product' AND product_id IS NOT NULL AND entity_id = product_id AND party_id IS NULL AND sales_order_id IS NULL)
        OR (entity_type = 'party' AND party_id IS NOT NULL AND entity_id = party_id AND product_id IS NULL AND sales_order_id IS NULL)
        OR (entity_type = 'sales_order' AND sales_order_id IS NOT NULL AND entity_id = sales_order_id AND product_id IS NULL AND party_id IS NULL))
);
CREATE INDEX custom_field_entity_idx ON system_config.custom_field_values(tenant_id, entity_type, entity_id);

CREATE FUNCTION system_config.validate_custom_field_value() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE definition system_config.custom_fields;
BEGIN
    SELECT * INTO STRICT definition FROM system_config.custom_fields
        WHERE tenant_id = NEW.tenant_id AND id = NEW.field_id FOR SHARE;
    IF definition.status <> 'active' THEN
        RAISE EXCEPTION 'Custom field is archived' USING ERRCODE = '23514';
    END IF;
    IF (definition.value_type IN ('text', 'date', 'choice') AND jsonb_typeof(NEW.value) <> 'string')
        OR (definition.value_type = 'number' AND jsonb_typeof(NEW.value) <> 'number')
        OR (definition.value_type = 'boolean' AND jsonb_typeof(NEW.value) <> 'boolean') THEN
        RAISE EXCEPTION 'Invalid custom field value type' USING ERRCODE = '23514';
    END IF;
    IF definition.value_type = 'date' THEN
        IF (NEW.value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RAISE EXCEPTION 'Invalid custom field date' USING ERRCODE = '23514';
        END IF;
        PERFORM (NEW.value #>> '{}')::date;
    END IF;
    IF definition.value_type = 'choice' AND NOT definition.choices @> jsonb_build_array(NEW.value) THEN
        RAISE EXCEPTION 'Invalid custom field choice' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER custom_field_value_validation BEFORE INSERT OR UPDATE ON system_config.custom_field_values
    FOR EACH ROW EXECUTE FUNCTION system_config.validate_custom_field_value();

-- Changing a populated definition could invalidate historical values.
CREATE FUNCTION system_config.protect_custom_field_definition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF (NEW.entity_type, NEW.value_type, NEW.choices) IS DISTINCT FROM (OLD.entity_type, OLD.value_type, OLD.choices) THEN
        RAISE EXCEPTION 'Create a new field for a different type, entity or choice set' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER custom_field_definition_guard BEFORE UPDATE ON system_config.custom_fields
    FOR EACH ROW EXECUTE FUNCTION system_config.protect_custom_field_definition();

CREATE TABLE system_config.report_definitions (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    dataset text NOT NULL CHECK (dataset IN ('products', 'parties', 'sales_orders', 'stock_movements', 'audit_log')),
    columns jsonb NOT NULL CHECK (jsonb_typeof(columns) = 'array' AND jsonb_array_length(columns) > 0),
    filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
    owner_identity_id uuid NOT NULL,
    visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'tenant')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, owner_identity_id) REFERENCES public.tenant_memberships(tenant_id, identity_id)
);
COMMENT ON TABLE system_config.report_definitions IS
    'Declarative definitions only. No SQL execution. API must allowlist columns and filters and enforce owner visibility and dataset permissions.';

CREATE TABLE system_config.label_templates (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    width_mm numeric(8,2) NOT NULL CHECK (width_mm > 0 AND width_mm <= 2000),
    height_mm numeric(8,2) NOT NULL CHECK (height_mm > 0 AND height_mm <= 2000),
    layout jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE system_config.workflow_definitions (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,62}$'),
    version integer NOT NULL CHECK (version > 0),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, code, version)
);
CREATE UNIQUE INDEX workflow_published_idx ON system_config.workflow_definitions(tenant_id, code) WHERE status = 'published';

CREATE TABLE system_config.workflow_states (
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,62}$'),
    label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
    is_initial boolean NOT NULL DEFAULT false,
    is_terminal boolean NOT NULL DEFAULT false,
    PRIMARY KEY (tenant_id, workflow_id, code),
    FOREIGN KEY (tenant_id, workflow_id) REFERENCES system_config.workflow_definitions(tenant_id, id)
);
CREATE UNIQUE INDEX workflow_initial_idx ON system_config.workflow_states(tenant_id, workflow_id) WHERE is_initial;

CREATE TABLE system_config.workflow_transitions (
    tenant_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    from_state text NOT NULL,
    to_state text NOT NULL,
    permission_code text NOT NULL REFERENCES public.permissions(code),
    requires_reason boolean NOT NULL DEFAULT true,
    PRIMARY KEY (tenant_id, workflow_id, from_state, to_state),
    FOREIGN KEY (tenant_id, workflow_id, from_state) REFERENCES system_config.workflow_states(tenant_id, workflow_id, code),
    FOREIGN KEY (tenant_id, workflow_id, to_state) REFERENCES system_config.workflow_states(tenant_id, workflow_id, code),
    CHECK (from_state <> to_state)
);
COMMENT ON TABLE system_config.workflow_transitions IS
    'Configuration only; existing sales, fiscal, stock and payment state machines are not changed.';

CREATE FUNCTION system_config.guard_workflow_children() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE parent_status text;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.workflow_id) IS DISTINCT FROM (OLD.tenant_id, OLD.workflow_id) THEN
        RAISE EXCEPTION 'Workflow children cannot be reassigned' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        SELECT status INTO STRICT parent_status FROM system_config.workflow_definitions
            WHERE tenant_id = OLD.tenant_id AND id = OLD.workflow_id FOR UPDATE;
    ELSE
        SELECT status INTO STRICT parent_status FROM system_config.workflow_definitions
            WHERE tenant_id = NEW.tenant_id AND id = NEW.workflow_id FOR UPDATE;
    END IF;
    IF parent_status <> 'draft' THEN
        RAISE EXCEPTION 'Only draft workflows may be edited' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER workflow_states_guard BEFORE INSERT OR UPDATE OR DELETE ON system_config.workflow_states
    FOR EACH ROW EXECUTE FUNCTION system_config.guard_workflow_children();
CREATE TRIGGER workflow_transitions_guard BEFORE INSERT OR UPDATE OR DELETE ON system_config.workflow_transitions
    FOR EACH ROW EXECUTE FUNCTION system_config.guard_workflow_children();

CREATE FUNCTION system_config.validate_workflow_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' THEN
            RAISE EXCEPTION 'A workflow must start as a draft' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status <> 'draft' AND (NEW.code, NEW.version, NEW.name, NEW.tenant_id, NEW.id)
        IS DISTINCT FROM (OLD.code, OLD.version, OLD.name, OLD.tenant_id, OLD.id) THEN
        RAISE EXCEPTION 'Published workflow definitions are immutable' USING ERRCODE = '23514';
    END IF;
    IF (OLD.status = 'archived' AND NEW.status <> 'archived') OR (OLD.status = 'published' AND NEW.status = 'draft') THEN
        RAISE EXCEPTION 'Create a new workflow version' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'published' AND OLD.status <> 'published' THEN
        IF NOT EXISTS (SELECT 1 FROM system_config.workflow_states WHERE tenant_id = NEW.tenant_id AND workflow_id = NEW.id AND is_initial)
            OR NOT EXISTS (SELECT 1 FROM system_config.workflow_states WHERE tenant_id = NEW.tenant_id AND workflow_id = NEW.id AND is_terminal)
            OR EXISTS (SELECT 1 FROM system_config.workflow_transitions t JOIN system_config.workflow_states s
                ON (s.tenant_id, s.workflow_id, s.code) = (t.tenant_id, t.workflow_id, t.from_state)
                WHERE t.tenant_id = NEW.tenant_id AND t.workflow_id = NEW.id AND s.is_terminal) THEN
            RAISE EXCEPTION 'Workflow requires an initial state, a terminal state and no outgoing terminal transitions' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER workflow_publication_guard BEFORE INSERT OR UPDATE ON system_config.workflow_definitions
    FOR EACH ROW EXECUTE FUNCTION system_config.validate_workflow_publication();

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['files', 'file_versions', 'custom_fields', 'custom_field_values',
        'report_definitions', 'label_templates', 'workflow_definitions', 'workflow_states', 'workflow_transitions'] LOOP
        EXECUTE format('ALTER TABLE system_config.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE system_config.%I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('CREATE POLICY tenant_isolation ON system_config.%I USING
            (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)
            WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name);
    END LOOP;
END;
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA system_config FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA system_config FROM PUBLIC;

INSERT INTO public.permissions(code, description) VALUES
    ('system.files.read', 'Consultar arquivos da empresa'),
    ('system.files.manage', 'Gerenciar arquivos da empresa'),
    ('system.custom_fields.read', 'Consultar campos personalizados da empresa'),
    ('system.custom_fields.manage', 'Configurar campos personalizados da empresa'),
    ('system.reports.read', 'Consultar definicoes de relatorios autorizados'),
    ('system.reports.manage', 'Gerenciar definicoes de relatorios'),
    ('system.labels.manage', 'Configurar modelos de etiquetas'),
    ('system.workflows.manage', 'Configurar definicoes de fluxos')
ON CONFLICT (code) DO NOTHING;
