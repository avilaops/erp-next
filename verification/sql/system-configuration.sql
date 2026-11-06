\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE system_configuration_test NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public, system_config TO system_configuration_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA system_config TO system_configuration_test;
GRANT SELECT ON public.tenants, public.platform_administrators,
    public.tenant_memberships, public.identities,
    public.membership_roles, public.roles, public.role_permissions TO system_configuration_test;
GRANT EXECUTE ON FUNCTION system_config.has_permission(text) TO system_configuration_test;

INSERT INTO public.tenants(id, legal_name, tax_id) VALUES
    ('11111111-1111-4111-8111-111111111111', 'Configuration test A', 'system-test-a'),
    ('22222222-2222-4222-8222-222222222222', 'Configuration test B', 'system-test-b');
INSERT INTO public.products(id, tenant_id, sku, name, unit, price_cents, status) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'TEST-A', 'A', 'UN', 100, 'active'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'TEST-B', 'B', 'UN', 100, 'active');
INSERT INTO public.identities(id, auth_subject, email, display_name) VALUES
    ('33333333-3333-4333-8333-333333333333', 'system-config-test', 'system-config@example.test', 'System configuration test');
INSERT INTO public.tenant_memberships(id, tenant_id, identity_id, status) VALUES
    ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'active');
INSERT INTO public.roles(id, tenant_id, code, name) VALUES
    ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'system-config-test', 'System configuration test');
INSERT INTO public.membership_roles(membership_id, role_id) VALUES
    ('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555');
INSERT INTO public.role_permissions(role_id, permission_code) VALUES
    ('55555555-5555-4555-8555-555555555555', 'system.custom_fields.read'),
    ('55555555-5555-4555-8555-555555555555', 'system.custom_fields.manage'),
    ('55555555-5555-4555-8555-555555555555', 'system.labels.manage'),
    ('55555555-5555-4555-8555-555555555555', 'system.workflows.manage');

SET LOCAL ROLE system_configuration_test;
SELECT set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);
SELECT set_config('app.auth_subject', 'system-config-test', true);
INSERT INTO system_config.custom_fields(tenant_id, id, entity_type, code, label, value_type) VALUES
    ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'product', 'weight', 'Weight', 'number');
INSERT INTO system_config.custom_field_values(tenant_id, field_id, entity_id, entity_type, product_id, value) VALUES
    ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'product', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '12.5');
SELECT set_config('app.auth_subject', '', true);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM system_config.custom_fields) THEN
        RAISE EXCEPTION 'FAILED: missing identity exposed configuration';
    END IF;
END $$;
SELECT set_config('app.auth_subject', 'system-config-test', true);

DO $$
BEGIN
    BEGIN
        UPDATE system_config.custom_field_values SET value = '"wrong type"';
        RAISE EXCEPTION 'FAILED: accepted wrong type';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        INSERT INTO system_config.custom_field_values(tenant_id, field_id, entity_id, entity_type, product_id, value) VALUES
            ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
             'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'product', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '10');
        RAISE EXCEPTION 'FAILED: accepted another tenant product';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
        UPDATE system_config.custom_fields SET value_type = 'text';
        RAISE EXCEPTION 'FAILED: changed field type';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        INSERT INTO system_config.label_templates(tenant_id, name, width_mm, height_mm, layout)
            VALUES ('22222222-2222-4222-8222-222222222222', 'Forbidden', 10, 10, '{}');
        RAISE EXCEPTION 'FAILED: inserted another tenant record';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        INSERT INTO system_config.label_templates(tenant_id, name, width_mm, height_mm, layout)
            VALUES ('11111111-1111-4111-8111-111111111111', 'Invalid', -1, 10, '{}');
        RAISE EXCEPTION 'FAILED: accepted negative label size';
    EXCEPTION WHEN check_violation THEN NULL; END;
END;
$$;

SELECT set_config('app.tenant_id', '22222222-2222-4222-8222-222222222222', true);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM system_config.custom_fields) OR EXISTS (SELECT 1 FROM system_config.custom_field_values) THEN
        RAISE EXCEPTION 'FAILED: tenant data leaked';
    END IF;
END $$;
SELECT set_config('app.tenant_id', '', true);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM system_config.custom_fields) THEN
        RAISE EXCEPTION 'FAILED: missing context exposed data';
    END IF;
END $$;

SELECT set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);
INSERT INTO system_config.workflow_definitions(tenant_id, id, code, version, name) VALUES
    ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'review', 1, 'Review');
DO $$ BEGIN
    BEGIN
        UPDATE system_config.workflow_definitions SET status = 'published';
        RAISE EXCEPTION 'FAILED: published empty workflow';
    EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO system_config.workflow_states(tenant_id, workflow_id, code, label, is_initial, is_terminal) VALUES
    ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'open', 'Open', true, false),
    ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'done', 'Done', false, true);
INSERT INTO system_config.workflow_transitions(tenant_id, workflow_id, from_state, to_state, permission_code) VALUES
    ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'open', 'done', 'system.workflows.manage');
UPDATE system_config.workflow_definitions SET status = 'published';
DO $$ BEGIN
    BEGIN
        DELETE FROM system_config.workflow_transitions;
        RAISE EXCEPTION 'FAILED: changed published workflow';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        UPDATE system_config.workflow_definitions SET status = 'draft';
        RAISE EXCEPTION 'FAILED: reopened published workflow';
    EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
    IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'system_config' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity) <> 9 THEN
        RAISE EXCEPTION 'FAILED: missing forced row security';
    END IF;
END $$;
ROLLBACK;
\echo 'system configuration isolation and validation tests passed'
