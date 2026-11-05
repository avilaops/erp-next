GRANT USAGE ON SCHEMA system_config TO erp_next_app;
GRANT SELECT, INSERT ON system_config.files, system_config.file_versions TO erp_next_app;
GRANT SELECT ON product_media_assets TO erp_next_app;
GRANT SELECT, INSERT, UPDATE ON product_catalog_profiles, catalog_publications TO erp_next_app;
GRANT USAGE, SELECT ON SEQUENCE catalog_publications_sequence_seq TO erp_next_app;
