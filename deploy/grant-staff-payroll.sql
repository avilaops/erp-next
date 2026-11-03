-- Run with the migration identity after schema application, never runtime credentials.
GRANT SELECT, INSERT, UPDATE ON staff_payroll_profiles, staff_payroll_requests TO erp_next_app;
GRANT SELECT, INSERT ON staff_payroll_obligations TO erp_next_app;
GRANT EXECUTE ON FUNCTION erp_staff_payroll_due_tenants() TO erp_next_app;
