-- The document package is append/update-only from the API perspective.
-- Keep the delivery manifest readable for status reconciliation without
-- granting destructive access to the runtime role.
REVOKE DELETE ON commercial_contract_deliveries FROM erp_next_app;
GRANT SELECT, INSERT, UPDATE ON commercial_contract_deliveries TO erp_next_app;
