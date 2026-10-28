\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT count(*) AS successful_migrations FROM public._sqlx_migrations WHERE success;
SELECT count(*) AS verified_imports FROM public.legacy_imports;
SELECT count(*) AS original_tables
FROM pg_tables WHERE schemaname IN ('erp_control', 'tenant_ludus');
SELECT
    (SELECT count(*) FROM tenant_ludus.products) AS source_products,
    (SELECT count(*) FROM public.products) AS destination_products,
    (SELECT count(*) FROM tenant_ludus.customers) AS source_customers,
    (SELECT count(*) FROM public.parties WHERE is_customer) AS destination_customers,
    (SELECT count(*) FROM tenant_ludus.suppliers) AS source_suppliers,
    (SELECT count(*) FROM public.parties WHERE is_supplier) AS destination_suppliers;
SELECT count(*) AS history_records FROM public.legacy_history;
SELECT count(*) AS files,
       count(*) FILTER (WHERE sha256 <> encode(sha256(content), 'hex')) AS damaged_files
FROM public.legacy_files;
SELECT count(*) AS orphan_files
FROM public.legacy_files f
LEFT JOIN public.legacy_history h ON h.id = f.history_id AND h.tenant_id = f.tenant_id
WHERE h.id IS NULL;
SELECT collection, count(*) AS records
FROM public.legacy_history
WHERE collection IN ('orders', 'fiscal_invoices', 'product_photos', 'price_table_versions')
GROUP BY collection ORDER BY collection;
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'erp_next_app';
SELECT has_schema_privilege('erp_next_app', 'tenant_ludus', 'USAGE') AS runtime_can_read_original_schema;
SELECT count(*) AS active_memberships FROM public.tenant_memberships;
COMMIT;
