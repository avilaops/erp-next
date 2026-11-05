\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA system_config TO erp_next_app;
GRANT SELECT, INSERT, UPDATE ON system_config.custom_fields TO erp_next_app;
GRANT SELECT, INSERT, UPDATE ON system_config.report_definitions TO erp_next_app;
GRANT SELECT, INSERT, UPDATE ON system_config.label_templates TO erp_next_app;
