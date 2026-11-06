-- Tenant RLS remains permissive; feature authorization is additionally restrictive.
-- Runtime requests must set app.auth_subject locally after authenticating.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('custom_fields', 'system.custom_fields.read', 'system.custom_fields.manage'),
    ('custom_field_values', 'system.custom_fields.read', 'system.custom_fields.manage'),
    ('report_definitions', 'system.reports.read', 'system.reports.manage'),
    ('label_templates', 'system.labels.manage', 'system.labels.manage'),
    ('workflow_definitions', 'system.workflows.manage', 'system.workflows.manage'),
    ('workflow_states', 'system.workflows.manage', 'system.workflows.manage'),
    ('workflow_transitions', 'system.workflows.manage', 'system.workflows.manage')
  ) AS entries(table_name, read_permission, write_permission)
  LOOP
    EXECUTE format('CREATE POLICY feature_read_authorization ON system_config.%I AS RESTRICTIVE FOR SELECT USING (system_config.has_permission(%L))',
      item.table_name, item.read_permission);
    EXECUTE format('CREATE POLICY feature_insert_authorization ON system_config.%I AS RESTRICTIVE FOR INSERT WITH CHECK (system_config.has_permission(%L))',
      item.table_name, item.write_permission);
    EXECUTE format('CREATE POLICY feature_update_authorization ON system_config.%I AS RESTRICTIVE FOR UPDATE USING (system_config.has_permission(%L)) WITH CHECK (system_config.has_permission(%L))',
      item.table_name, item.write_permission, item.write_permission);
    EXECUTE format('CREATE POLICY feature_delete_authorization ON system_config.%I AS RESTRICTIVE FOR DELETE USING (system_config.has_permission(%L))',
      item.table_name, item.write_permission);
  END LOOP;
END;
$$;

-- File metadata is shared by the system file manager and the product catalogue.
-- Catalogue access remains limited to catalogue-authorized API operations, while
-- destructive file lifecycle changes stay exclusive to system file managers.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['files', 'file_versions']
  LOOP
    EXECUTE format(
      'CREATE POLICY feature_read_authorization ON system_config.%I AS RESTRICTIVE FOR SELECT USING (system_config.has_permission(''system.files.read'') OR system_config.has_permission(''catalog.products.read''))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY feature_insert_authorization ON system_config.%I AS RESTRICTIVE FOR INSERT WITH CHECK (system_config.has_permission(''system.files.manage'') OR system_config.has_permission(''catalog.products.manage''))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY feature_update_authorization ON system_config.%I AS RESTRICTIVE FOR UPDATE USING (system_config.has_permission(''system.files.manage'')) WITH CHECK (system_config.has_permission(''system.files.manage''))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY feature_delete_authorization ON system_config.%I AS RESTRICTIVE FOR DELETE USING (system_config.has_permission(''system.files.manage''))',
      table_name
    );
  END LOOP;
END;
$$;
-- This migration deliberately does not grant runtime table access or assign roles.
-- Endpoint-specific grants accompany implementation of each authenticated operation.
