ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY role_permissions_isolation ON role_permissions
    USING (
        EXISTS (
            SELECT 1
            FROM roles
            WHERE roles.id = role_permissions.role_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM roles
            WHERE roles.id = role_permissions.role_id
        )
    );

ALTER TABLE membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_roles_isolation ON membership_roles
    USING (
        EXISTS (
            SELECT 1
            FROM tenant_memberships membership
            JOIN roles role ON role.tenant_id = membership.tenant_id
            WHERE membership.id = membership_roles.membership_id
              AND role.id = membership_roles.role_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM tenant_memberships membership
            JOIN roles role ON role.tenant_id = membership.tenant_id
            WHERE membership.id = membership_roles.membership_id
              AND role.id = membership_roles.role_id
        )
    );
