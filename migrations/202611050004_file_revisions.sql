ALTER TABLE system_config.files
    ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
