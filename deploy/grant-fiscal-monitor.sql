-- Existing installations run schema-only migrations without replaying bootstrap.
-- Keep the runtime role restricted: original distributed XML is append-only.
BEGIN;
GRANT SELECT, INSERT, UPDATE ON
    fiscal_monitor_state,
    fiscal_monitor_runs,
    fiscal_monitor_manifestations
TO erp_next_app;
GRANT SELECT, INSERT ON fiscal_monitor_documents TO erp_next_app;
GRANT USAGE, SELECT ON SEQUENCE fiscal_monitor_documents_id_seq TO erp_next_app;
COMMIT;
