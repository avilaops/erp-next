-- Execute on the same connection inside a transaction, after authenticating:
-- SELECT set_config('app.tenant_id', validated_tenant_id, true);
-- SELECT set_config('app.auth_subject', authenticated_subject, true);
-- Settings come from validated server identity, never caller-supplied claims.
-- Named PREPARE is per physical connection. SQLx consumers should use
-- query(...).bind(...) with this SQL, not issue global PREPARE through a pool.

PREPARE list_system_files(uuid, integer) AS
SELECT id, original_name, media_type, byte_size, status, created_at
FROM system_config.files
WHERE tenant_id=$1 AND system_config.has_permission('system.files.read')
ORDER BY created_at DESC,id DESC
LIMIT least(greatest(coalesce($2,25),1),100);

PREPARE list_system_files_after(uuid, timestamptz, uuid, integer) AS
SELECT id, original_name, media_type, byte_size, status, created_at
FROM system_config.files
WHERE tenant_id=$1 AND (created_at,id)<($2,$3)
    AND system_config.has_permission('system.files.read')
ORDER BY created_at DESC,id DESC
LIMIT least(greatest(coalesce($4,25),1),100);

PREPARE get_product_custom_fields(uuid, uuid, integer) AS
SELECT f.code, f.label, f.value_type, f.required, f.choices, v.value
FROM system_config.custom_fields f
JOIN public.products p ON p.tenant_id=f.tenant_id AND p.id=$2
LEFT JOIN system_config.custom_field_values v
    ON v.tenant_id = f.tenant_id AND v.field_id = f.id AND v.entity_id = $2
WHERE f.tenant_id = $1 AND f.entity_type = 'product' AND f.status = 'active'
    AND system_config.has_permission('catalog.products.read')
    AND system_config.has_permission('system.custom_fields.read')
ORDER BY f.code
LIMIT least(greatest(coalesce($3,25),1),100);

PREPARE get_product_custom_fields_after(uuid, uuid, text, integer) AS
SELECT f.code, f.label, f.value_type, f.required, f.choices, v.value
FROM system_config.custom_fields f
JOIN public.products p ON p.tenant_id=f.tenant_id AND p.id=$2
LEFT JOIN system_config.custom_field_values v
    ON v.tenant_id=f.tenant_id AND v.field_id=f.id AND v.entity_id=p.id
WHERE f.tenant_id=$1 AND f.entity_type='product' AND f.status='active' AND f.code>$3
    AND system_config.has_permission('catalog.products.read')
    AND system_config.has_permission('system.custom_fields.read')
ORDER BY f.code
LIMIT least(greatest(coalesce($4,25),1),100);

-- Private ownership and dataset permissions are enforced by restrictive RLS.
-- There is no caller-supplied owner identity parameter.
PREPARE list_report_definitions(uuid, integer) AS
SELECT id, name, dataset, columns, filters, revision
FROM system_config.report_definitions
WHERE tenant_id = $1
ORDER BY name,id
LIMIT least(greatest(coalesce($2,25),1),100);

PREPARE list_report_definitions_after(uuid, text, uuid, integer) AS
SELECT id, name, dataset, columns, filters, revision
FROM system_config.report_definitions WHERE tenant_id=$1 AND (name,id)>($2,$3)
ORDER BY name,id
LIMIT least(greatest(coalesce($4,25),1),100);

PREPARE list_published_workflow_transitions(uuid, text, text) AS
SELECT t.from_state, t.to_state, t.permission_code, t.requires_reason
FROM system_config.workflow_definitions w
JOIN system_config.workflow_transitions t ON t.tenant_id = w.tenant_id AND t.workflow_id = w.id
WHERE w.tenant_id = $1 AND w.code = $2 AND w.status = 'published' AND t.from_state = $3
    AND system_config.has_permission('system.workflows.manage')
    AND system_config.has_permission(t.permission_code)
ORDER BY t.to_state;

-- This configuration read does not execute a command. A future engine must
-- lock the business aggregate and recheck state and permission atomically.
