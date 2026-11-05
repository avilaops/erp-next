-- Existing administrators need the staff permissions when the feature is added
-- after their tenant was created. New tenants already receive these permissions
-- through onboarding, so this backfill only touches existing administrator roles.
DO $migration$
DECLARE
    tenant uuid;
    previous_tenant text := coalesce(current_setting('app.tenant_id', true), '');
    added integer;
BEGIN
    -- The migration owner also obeys FORCE RLS. Tenant discovery is scoped to
    -- this transaction and is not available to the runtime application role.
    EXECUTE format(
        'CREATE POLICY staff_permissions_migration_scan ON tenants FOR SELECT TO %I USING (true)',
        current_user
    );

    FOR tenant IN SELECT id FROM tenants LOOP
        PERFORM set_config('app.tenant_id', tenant::text, true);

        INSERT INTO role_permissions (role_id, permission_code)
        SELECT r.id, p.code
        FROM roles r
        CROSS JOIN permissions p
        WHERE r.code IN ('admin', 'administrator')
          AND p.code IN ('catalog.staff.read', 'catalog.staff.manage')
        ON CONFLICT DO NOTHING;

        GET DIAGNOSTICS added = ROW_COUNT;
        IF added > 0 THEN
            UPDATE roles
            SET revision = revision + 1
            WHERE code IN ('admin', 'administrator');
        END IF;
    END LOOP;

    PERFORM set_config('app.tenant_id', previous_tenant, true);
    DROP POLICY staff_permissions_migration_scan ON tenants;
END
$migration$;
