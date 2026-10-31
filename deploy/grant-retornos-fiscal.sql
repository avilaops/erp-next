\set ON_ERROR_STOP on
BEGIN;
GRANT SELECT, INSERT ON sales_order_cancellations, purchase_receipt_reversals,
    fiscal_received_purchase_links, fiscal_received_item_costs TO erp_next_app;
GRANT SELECT, INSERT, UPDATE ON fiscal_number_sequences, fiscal_nfe_documents,
    fiscal_nfe_events, fiscal_distribution_cursors, fiscal_distribution_runs,
    fiscal_recipient_manifestations TO erp_next_app;
GRANT SELECT, INSERT ON fiscal_distribution_documents TO erp_next_app;
GRANT SELECT, INSERT, UPDATE ON order_commission_terms, commission_accounts,
    production_stages, production_orders TO erp_next_app;
GRANT SELECT, INSERT ON commission_entries, commission_payments,
    commission_payment_entries, production_consumptions, production_history TO erp_next_app;
COMMIT;
