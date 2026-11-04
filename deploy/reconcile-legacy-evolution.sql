\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(174051, 4);
DO $reconcile$
DECLARE tenant uuid; previous_tenant text := coalesce(current_setting('app.tenant_id', true), '');
BEGIN
    EXECUTE format('CREATE POLICY legacy_evolution_scan ON public.tenants FOR SELECT TO %I USING (true)', current_user);
    FOR tenant IN SELECT id FROM public.tenants LOOP
        PERFORM set_config('app.tenant_id', tenant::text, true);

        INSERT INTO legacy_evolution.price_books(tenant_id,id,code,name,source_line_key)
        SELECT DISTINCT tenant, md5(tenant::text || ':legacy:price-book:' || coalesce(details->>'line_id','unclassified'))::uuid,
            'legacy-line-' || coalesce(details->>'line_id','unclassified'),
            'Tabela historica da linha ' || coalesce(details->>'line_id','sem classificacao'), details->>'line_id'
        FROM public.legacy_history WHERE tenant_id=tenant AND collection='price_table_versions'
        ON CONFLICT (tenant_id,id) DO NOTHING;

        INSERT INTO legacy_evolution.price_versions(tenant_id,id,book_id,version,status,currency_code,published_at,parameters,source_history_id)
        SELECT tenant,md5(tenant::text || ':legacy:price-version:' || (details->>'version'))::uuid,
            md5(tenant::text || ':legacy:price-book:' || coalesce(details->>'line_id','unclassified'))::uuid,
            (details->>'version')::bigint,'historical',NULL,(details->>'published_at')::timestamptz,details,id
        FROM public.legacy_history WHERE tenant_id=tenant AND collection='price_table_versions'
        ON CONFLICT (tenant_id,id) DO NOTHING;

        INSERT INTO legacy_evolution.price_items(tenant_id,version_id,product_id,price_cents,price_with_ipi_cents,source_history_id,snapshot)
        SELECT tenant,v.id,p.id,((h.details->>'table_price')::numeric * 100)::bigint,
            ((h.details->>'table_price_with_ipi')::numeric * 100)::bigint,h.id,h.details
        FROM public.legacy_history h
        JOIN legacy_evolution.price_versions v ON v.tenant_id=h.tenant_id
            AND v.id=md5(tenant::text || ':legacy:price-version:' || (h.details->>'version'))::uuid
        JOIN public.products p ON p.tenant_id=h.tenant_id AND p.id=md5('ludus:products:' || (h.details->>'product_id'))::uuid
        WHERE h.tenant_id=tenant AND h.collection='price_table_items'
            AND NOT EXISTS (SELECT 1 FROM legacy_evolution.price_items existing
                WHERE existing.tenant_id=tenant AND existing.source_history_id=h.id)
        ON CONFLICT (tenant_id,version_id,product_id) DO NOTHING;

        INSERT INTO legacy_evolution.product_cost_snapshots(tenant_id,id,product_id,source_history_id,advisory_cost_cents,packaging_cents,tax_credit,supplier_price_usd)
        SELECT tenant,md5(tenant::text || ':legacy:cost:' || h.id::text)::uuid,p.id,h.id,
            ((h.details->>'advisory_cost')::numeric * 100)::bigint,((h.details->>'packaging')::numeric * 100)::bigint,
            (h.details->>'tax_credit')::numeric,(h.details->>'supplier_price_usd')::numeric
        FROM public.legacy_history h JOIN public.products p ON p.tenant_id=h.tenant_id
            AND p.id=md5('ludus:products:' || (h.details->>'id'))::uuid
        WHERE h.tenant_id=tenant AND h.collection='products'
        ON CONFLICT (tenant_id,id) DO NOTHING;

        INSERT INTO legacy_evolution.product_attribute_snapshots(tenant_id,product_id,source_history_id,description,supplier_name,supplier_model,length_mm,width_mm,height_mm,weight_kg,source_line_key)
        SELECT tenant,p.id,h.id,h.details->>'description',h.details->>'supplier_name',h.details->>'supplier_model',
            (h.details->>'length_mm')::integer,(h.details->>'width_mm')::integer,(h.details->>'height_mm')::integer,
            (h.details->>'weight_kg')::numeric,h.details->>'line_id'
        FROM public.legacy_history h JOIN public.products p ON p.tenant_id=h.tenant_id
            AND p.id=md5('ludus:products:' || (h.details->>'id'))::uuid
        WHERE h.tenant_id=tenant AND h.collection='products'
        ON CONFLICT (tenant_id,product_id,source_history_id) DO NOTHING;

        INSERT INTO legacy_evolution.file_references(tenant_id,legacy_file_id,product_id,history_id)
        SELECT tenant,f.id,p.id,h.id FROM public.legacy_files f
        JOIN public.legacy_history h ON h.tenant_id=f.tenant_id AND h.id=f.history_id
        LEFT JOIN public.products p ON p.tenant_id=h.tenant_id AND h.collection='product_photos'
            AND p.id=md5('ludus:products:' || (h.details->>'product_id'))::uuid
        WHERE f.tenant_id=tenant ON CONFLICT (tenant_id,legacy_file_id) DO NOTHING;

        INSERT INTO legacy_evolution.record_links(tenant_id,history_id,source_schema,source_collection,source_key,
            source_sha256,rule_version,disposition,source_state,product_id,party_id,price_version_id,reason)
        SELECT tenant,h.id,'tenant_ludus',h.collection,
            jsonb_strip_nulls(jsonb_build_object('id',h.details->'id','version',h.details->'version',
                'product_id',h.details->'product_id','document',h.details->'document','history_id',h.id)),
            encode(sha256(convert_to(h.details::text,'UTF8')),'hex'),1,
            CASE WHEN num_nonnulls(p.id,party.id,v.id)>0 THEN 'linked'
                WHEN h.collection IN ('orders','order_items','order_closings','purchases','purchase_items','fiscal_invoices','fiscal_invoice_events')
                    THEN 'review_required' ELSE 'history_only' END,
            h.details->>'status',p.id,party.id,v.id,
            CASE WHEN num_nonnulls(p.id,party.id,v.id)>0 THEN 'Correspondencia deterministica com o importador original; sem efeitos comerciais.'
                ELSE 'Historico preservado; conversao operacional exige reconciliacao de estados e efeitos.' END
        FROM public.legacy_history h
        LEFT JOIN public.products p ON p.tenant_id=h.tenant_id AND h.collection IN ('products','product_photos','price_table_items')
            AND p.id=md5('ludus:products:' || CASE WHEN h.collection='products' THEN h.details->>'id' ELSE h.details->>'product_id' END)::uuid
        LEFT JOIN public.parties party ON party.tenant_id=h.tenant_id AND h.collection IN ('customers','suppliers')
            AND party.id=md5('ludus:party:' || (h.details->>'document'))::uuid
        LEFT JOIN legacy_evolution.price_versions v ON v.tenant_id=h.tenant_id
            AND h.collection IN ('price_table_versions','price_table_items')
            AND v.id=md5(tenant::text || ':legacy:price-version:' || (h.details->>'version'))::uuid
        WHERE h.tenant_id=tenant ON CONFLICT (tenant_id,history_id) DO NOTHING;

        -- Reject rounding, missing mappings, conflicting previous imports and corrupt binaries.
        IF EXISTS (SELECT 1 FROM public.legacy_history h LEFT JOIN legacy_evolution.record_links l
            ON l.tenant_id=h.tenant_id AND l.history_id=h.id WHERE h.tenant_id=tenant
            AND (l.history_id IS NULL OR l.source_sha256 <> encode(sha256(convert_to(h.details::text,'UTF8')),'hex')))
        OR EXISTS (SELECT 1 FROM public.legacy_history h LEFT JOIN legacy_evolution.price_items i
            ON i.tenant_id=h.tenant_id AND i.source_history_id=h.id
            WHERE h.tenant_id=tenant AND h.collection='price_table_items'
            AND (i.source_history_id IS NULL OR i.snapshot<>h.details OR i.price_cents::numeric <> (h.details->>'table_price')::numeric*100
                OR i.price_with_ipi_cents::numeric IS DISTINCT FROM (h.details->>'table_price_with_ipi')::numeric*100))
        OR EXISTS (SELECT 1 FROM public.legacy_history h LEFT JOIN legacy_evolution.price_versions v
            ON v.tenant_id=h.tenant_id AND v.source_history_id=h.id
            WHERE h.tenant_id=tenant AND h.collection='price_table_versions' AND (v.id IS NULL OR v.parameters<>h.details))
        OR EXISTS (SELECT 1 FROM public.legacy_history h LEFT JOIN legacy_evolution.product_cost_snapshots c
            ON c.tenant_id=h.tenant_id AND c.source_history_id=h.id
            LEFT JOIN legacy_evolution.product_attribute_snapshots a ON a.tenant_id=h.tenant_id AND a.source_history_id=h.id
            WHERE h.tenant_id=tenant AND h.collection='products' AND (c.id IS NULL OR a.source_history_id IS NULL
                OR c.advisory_cost_cents::numeric IS DISTINCT FROM (h.details->>'advisory_cost')::numeric*100
                OR c.packaging_cents::numeric IS DISTINCT FROM (h.details->>'packaging')::numeric*100))
        OR EXISTS (SELECT 1 FROM public.legacy_files f LEFT JOIN legacy_evolution.file_references r
            ON r.tenant_id=f.tenant_id AND r.legacy_file_id=f.id WHERE f.tenant_id=tenant
            AND (r.legacy_file_id IS NULL OR r.history_id<>f.history_id OR f.sha256<>encode(sha256(f.content),'hex'))) THEN
            RAISE EXCEPTION 'Legacy reconciliation failed; transaction rolled back';
        END IF;

        INSERT INTO legacy_evolution.price_version_seals(tenant_id,version_id,item_count)
        SELECT tenant,v.id,1 FROM legacy_evolution.price_versions v
        WHERE v.tenant_id=tenant AND v.status='historical'
            AND NOT EXISTS (SELECT 1 FROM legacy_evolution.price_version_seals s WHERE s.tenant_id=v.tenant_id AND s.version_id=v.id);
    END LOOP;
    PERFORM set_config('app.tenant_id', previous_tenant, true);
    DROP POLICY legacy_evolution_scan ON public.tenants;
END;
$reconcile$;
COMMIT;
