\set ON_ERROR_STOP on
BEGIN;
REVOKE DELETE ON logistics_postings,logistics_checkouts,logistics_checkout_lines,
    logistics_checkout_packages,logistics_label_jobs,logistics_posting_packages,
    commercial_contract_deliveries,inventory_counts,inventory_count_lines,
    price_lists,sales_proposal_email_deliveries,financial_account_entries,
    financial_account_transfers,fiscal_outgoing_imports FROM erp_next_app;
REVOKE UPDATE ON financial_account_entries,financial_account_transfers,
    fiscal_outgoing_imports FROM erp_next_app;
GRANT SELECT,INSERT,UPDATE ON logistics_postings,logistics_checkouts,
    logistics_checkout_lines,logistics_checkout_packages,logistics_label_jobs,
    logistics_posting_packages,commercial_contract_deliveries,inventory_counts,
    inventory_count_lines,price_lists,price_list_items,
    sales_proposal_email_deliveries TO erp_next_app;
GRANT DELETE ON price_list_items TO erp_next_app;
GRANT SELECT,INSERT ON financial_account_entries,financial_account_transfers,
    fiscal_outgoing_imports TO erp_next_app;
GRANT USAGE,SELECT ON SEQUENCE fiscal_outgoing_imports_id_seq TO erp_next_app;
GRANT SELECT,INSERT,UPDATE ON sales_opportunities,commercial_approval_settings,
    commercial_order_quotes TO erp_next_app;
GRANT SELECT,INSERT ON commercial_approval_decisions TO erp_next_app;
COMMIT;
