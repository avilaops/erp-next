\getenv admin_sub ERP_BOOTSTRAP_SUB
\getenv admin_email ERP_BOOTSTRAP_EMAIL
\getenv tenant ERP_BOOTSTRAP_TENANT
BEGIN;
SELECT set_config('app.tenant_id', :'tenant', true);
INSERT INTO tenants (id, legal_name, tax_id)
VALUES (:'tenant'::uuid, 'Ávila Ops', '') ON CONFLICT (id) DO NOTHING;
INSERT INTO company_profiles (tenant_id, revision, details)
VALUES (:'tenant'::uuid, 1, '{"legalName":"Ávila Ops","tradeName":"Ávila Ops","taxId":""}')
ON CONFLICT (tenant_id) DO NOTHING;
INSERT INTO identities (auth_subject, email, display_name)
VALUES (:'admin_sub', :'admin_email', 'Nicolas Rosa') ON CONFLICT (auth_subject) DO NOTHING;
INSERT INTO tenant_memberships (tenant_id, identity_id)
SELECT :'tenant'::uuid, id FROM identities WHERE auth_subject = :'admin_sub'
ON CONFLICT (tenant_id, identity_id) DO NOTHING;
INSERT INTO roles (tenant_id, code, name)
VALUES (:'tenant'::uuid, 'administrator', 'Administrador') ON CONFLICT (tenant_id, code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.tenant_id = :'tenant'::uuid AND r.code = 'administrator'
ON CONFLICT DO NOTHING;
INSERT INTO membership_roles (membership_id, role_id)
SELECT m.id, r.id FROM tenant_memberships m
JOIN identities i ON i.id = m.identity_id
JOIN roles r ON r.tenant_id = m.tenant_id AND r.code = 'administrator'
WHERE m.tenant_id = :'tenant'::uuid AND i.auth_subject = :'admin_sub'
ON CONFLICT DO NOTHING;
INSERT INTO audit_log (tenant_id, identity_id, action, entity_type, entity_id, details)
SELECT :'tenant'::uuid, id, 'platform.bootstrap', 'tenant', :'tenant',
       '{"source":"github-ci","fiscalRegistration":"pending"}'::jsonb
FROM identities WHERE auth_subject = :'admin_sub';
GRANT USAGE ON SCHEMA public TO erp_next_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_next_app;
REVOKE ALL ON TABLE _sqlx_migrations FROM erp_next_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_next_app;
COMMIT;
