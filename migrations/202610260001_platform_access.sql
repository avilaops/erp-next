ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

INSERT INTO permissions (code, description)
VALUES
    ('platform.users.read', 'Consultar usuários e acessos da empresa'),
    ('platform.users.manage', 'Criar, editar, bloquear e convidar usuários'),
    ('platform.roles.read', 'Consultar papéis e permissões'),
    ('platform.roles.manage', 'Criar e editar papéis e suas permissões'),
    ('platform.audit.read', 'Consultar a trilha de auditoria da empresa')
ON CONFLICT (code) DO UPDATE
SET description = EXCLUDED.description;
