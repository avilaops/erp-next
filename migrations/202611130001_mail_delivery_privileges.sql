-- Bootstrap grants do not cover delivery tables created in later migrations.
-- Keep historical deliveries append/update-only and preserve forced tenant RLS.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_next_app') THEN
        REVOKE DELETE ON sales_order_email_deliveries, sales_proposal_email_deliveries FROM erp_next_app;
        GRANT SELECT, INSERT, UPDATE ON sales_order_email_deliveries, sales_proposal_email_deliveries TO erp_next_app;
    END IF;
END
$$;
