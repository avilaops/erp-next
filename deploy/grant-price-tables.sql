\set ON_ERROR_STOP on
GRANT SELECT, INSERT ON price_table_versions,price_table_items TO erp_next_app;
GRANT SELECT, INSERT, UPDATE ON commercial_settings TO erp_next_app;

