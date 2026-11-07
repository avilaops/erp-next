-- Run with the migration identity after schema application, never runtime credentials.
GRANT SELECT, INSERT, UPDATE ON warranty_policies, warranty_cases, warranty_service_orders, warranty_rmas, warranty_quarantines TO erp_next_app;
GRANT SELECT, INSERT ON warranty_case_events, warranty_service_order_parts, warranty_approvals TO erp_next_app;
