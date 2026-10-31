-- Explicit operator provisioning for one existing administrator role.
-- psql variables: tenant_id and actor_id (both UUIDs).
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_id', true);
SELECT set_config('app.operator_identity_id', :'actor_id', true);
DO $$
DECLARE
    tenant uuid := current_setting('app.tenant_id')::uuid;
    actor uuid := current_setting('app.operator_identity_id')::uuid;
    target_role uuid;
    next_revision bigint;
    added integer;
    codes text[] := ARRAY['fiscal.monitor.read', 'fiscal.monitor.manage', 'fiscal.monitor.manifest'];
    details jsonb;
BEGIN
    PERFORM 1 FROM tenants WHERE id = tenant AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active company not found'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tenant_memberships m
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN roles r ON r.id = mr.role_id AND r.tenant_id = m.tenant_id
        JOIN role_permissions rp ON rp.role_id = r.id
        WHERE m.tenant_id = tenant AND m.identity_id = actor AND m.status = 'active'
            AND rp.permission_code = 'platform.roles.manage'
    ) THEN
        RAISE EXCEPTION 'Responsible operator has no active role management permission';
    END IF;
    IF (SELECT count(*) FROM permissions WHERE code = ANY(codes)) <> cardinality(codes) THEN
        RAISE EXCEPTION 'Fiscal monitor permissions are not installed';
    END IF;
    SELECT id INTO STRICT target_role FROM roles
        WHERE tenant_id = tenant AND code = 'administrator' FOR UPDATE;
    IF NOT EXISTS (
        SELECT 1 FROM role_permissions WHERE role_id = target_role
            AND permission_code = 'fiscal.config.manage'
    ) THEN
        RAISE EXCEPTION 'Administrator role has no fiscal configuration authority';
    END IF;
    INSERT INTO role_permissions(role_id, permission_code)
        SELECT target_role, unnest(codes) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS added = ROW_COUNT;
    IF added = 0 THEN RETURN; END IF;
    UPDATE roles SET revision = revision + 1 WHERE id = target_role
        RETURNING revision INTO next_revision;
    details := jsonb_build_object(
        'revision', next_revision, 'permissionsGranted', codes,
        'source', 'fiscal_monitor_operator_provisioning'
    );
    INSERT INTO audit_log(tenant_id, identity_id, action, entity_type, entity_id, details)
        VALUES (tenant, actor, 'role.updated', 'role', target_role::text, details);
    INSERT INTO outbox_events(tenant_id, aggregate_type, aggregate_id, event_type, payload)
        VALUES (tenant, 'role', target_role::text, 'role.updated', details);
END;
$$;
COMMIT;
