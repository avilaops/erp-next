ALTER TABLE system_config.workflow_definitions
    ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
