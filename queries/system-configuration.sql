-- Prepared statements for an authenticated application connection.
-- Before EXECUTE: BEGIN; SELECT set_config('app.tenant_id', validated_tenant_id, true);
-- Resolve tenant membership and feature permission in the existing API first.
-- COMMIT or ROLLBACK always clears the transaction-local context.

PREPARE list_system_files(uuid, integer) AS
SELECT id, original_name, media_type, byte_size, status, created_at
FROM system_config.files
WHERE tenant_id = $1
ORDER BY created_at DESC, id
LIMIT least(greatest($2, 1), 100);

PREPARE get_product_custom_fields(uuid, uuid) AS
SELECT f.code, f.label, f.value_type, f.required, f.choices, v.value
FROM system_config.custom_fields f
LEFT JOIN system_config.custom_field_values v
    ON v.tenant_id = f.tenant_id AND v.field_id = f.id AND v.entity_id = $2
WHERE f.tenant_id = $1 AND f.entity_type = 'product' AND f.status = 'active'
ORDER BY f.code;

PREPARE list_report_definitions(uuid, uuid) AS
SELECT id, name, dataset, columns, filters, revision
FROM system_config.report_definitions
WHERE tenant_id = $1 AND (visibility = 'tenant' OR owner_identity_id = $2)
ORDER BY name, id;

PREPARE list_published_workflow_transitions(uuid, text, text) AS
SELECT t.from_state, t.to_state, t.permission_code, t.requires_reason
FROM system_config.workflow_definitions w
JOIN system_config.workflow_transitions t ON t.tenant_id = w.tenant_id AND t.workflow_id = w.id
WHERE w.tenant_id = $1 AND w.code = $2 AND w.status = 'published' AND t.from_state = $3
ORDER BY t.to_state;

-- This reads candidate transitions; it does not authorize or execute an operation.
