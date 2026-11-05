\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA system_config TO erp_next_app;
GRANT EXECUTE ON FUNCTION system_config.has_permission(text) TO erp_next_app;
GRANT SELECT, UPDATE ON system_config.files TO erp_next_app;
GRANT SELECT ON system_config.file_versions TO erp_next_app;
GRANT SELECT, INSERT, UPDATE ON system_config.custom_fields TO erp_next_app;
GRANT SELECT, INSERT, UPDATE ON system_config.report_definitions TO erp_next_app;
GRANT SELECT, INSERT, UPDATE ON system_config.label_templates TO erp_next_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON system_config.workflow_definitions, system_config.workflow_states, system_config.workflow_transitions TO erp_next_app;
