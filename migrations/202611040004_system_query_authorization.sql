CREATE FUNCTION system_config.has_permission(required_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenant_memberships m
        JOIN public.tenants t ON t.id=m.tenant_id AND t.status='active'
        JOIN public.identities i ON i.id=m.identity_id
        JOIN public.membership_roles mr ON mr.membership_id=m.id
        JOIN public.roles r ON r.id=mr.role_id AND r.tenant_id=m.tenant_id
        JOIN public.role_permissions rp ON rp.role_id=r.id
        WHERE m.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
          AND m.status='active'
          AND i.auth_subject=nullif(current_setting('app.auth_subject',true),'')
          AND rp.permission_code=required_permission
    );
$$;
REVOKE ALL ON FUNCTION system_config.has_permission(text) FROM PUBLIC;

CREATE POLICY report_reader_authorization ON system_config.report_definitions
AS RESTRICTIVE FOR SELECT USING (
    system_config.has_permission('system.reports.read')
    AND system_config.has_permission(CASE dataset
        WHEN 'products' THEN 'catalog.products.read'
        WHEN 'parties' THEN 'catalog.parties.read'
        WHEN 'sales_orders' THEN 'sales.orders.read'
        WHEN 'stock_movements' THEN 'inventory.stock.read'
        WHEN 'audit_log' THEN 'platform.audit.read' END)
    AND (visibility='tenant' OR EXISTS (
        SELECT 1 FROM public.identities i WHERE i.id=owner_identity_id
            AND i.auth_subject=nullif(current_setting('app.auth_subject',true),'')
    ))
);
CREATE INDEX reports_tenant_name_idx ON system_config.report_definitions(tenant_id,name,id);
