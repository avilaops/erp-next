\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('app.tenant_id', :'tenant', true);
-- Original schemas include encrypted credentials. They are deliberately inaccessible
-- to the HTTP runtime. All original columns and binary data remain intact.
REVOKE ALL ON SCHEMA erp_control, tenant_ludus FROM PUBLIC;
REVOKE ALL ON SCHEMA erp_control, tenant_ludus FROM erp_next_app;
REVOKE ALL ON ALL TABLES IN SCHEMA erp_control, tenant_ludus FROM erp_next_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA erp_control, tenant_ludus FROM erp_next_app;

UPDATE tenants SET legal_name=c.legal_name, tax_id=regexp_replace(c.cnpj,'[^A-Za-z0-9]','','g')
FROM tenant_ludus.company_settings c WHERE tenants.id=:'tenant'::uuid;
UPDATE company_profiles SET details=jsonb_build_object(
    'legalName',c.legal_name,'tradeName','Ludus','personType','juridica',
    'taxId',regexp_replace(c.cnpj,'[^A-Za-z0-9]','','g'),'stateRegistration',c.state_registration,
    'taxRegime',CASE c.tax_regime WHEN 1 THEN 'simples' WHEN 2 THEN 'simples' ELSE '' END,
    'postalCode',c.cep,'state',c.uf,'city',c.city,'street',c.street,'number',c.street_number,
    'district',c.district,'segments',jsonb_build_array('comercio'))
FROM tenant_ludus.company_settings c WHERE tenant_id=:'tenant'::uuid;

-- Price snapshots are preserved separately. Unpublished products are imported as
-- archived until a real selling price is supplied; no cost is relabeled as revenue.
INSERT INTO products(id,tenant_id,sku,name,unit,ncm,cest,price_cents,status,created_at,updated_at)
SELECT md5('ludus:products:'||p.id)::uuid,:'tenant'::uuid,p.code,p.name,p.unit,
nullif(p.ncm,''),nullif(p.cest,''),coalesce(round(price.table_price*100)::bigint,0),
CASE WHEN p.active AND price.table_price IS NOT NULL THEN 'active' ELSE 'archived' END,p.created_at,p.updated_at
FROM tenant_ludus.products p LEFT JOIN LATERAL (
    SELECT i.table_price FROM tenant_ludus.price_table_items i WHERE i.product_id=p.id ORDER BY i.version DESC LIMIT 1
) price ON true;

INSERT INTO parties(id,tenant_id,person_type,legal_name,trade_name,tax_id,email,phone,is_customer,is_supplier,status,created_at,updated_at)
SELECT md5('ludus:party:'||document)::uuid,:'tenant'::uuid,CASE kind WHEN 'PF' THEN 'fisica' ELSE 'juridica' END,
name,nullif(trade_name,''),document,nullif(email,''),nullif(phone,''),true,false,'active',created_at,updated_at FROM tenant_ludus.customers;
INSERT INTO parties(id,tenant_id,person_type,legal_name,trade_name,tax_id,email,phone,is_customer,is_supplier,status,created_at,updated_at)
SELECT md5('ludus:party:'||document)::uuid,:'tenant'::uuid,CASE kind WHEN 'PF' THEN 'fisica' ELSE 'juridica' END,
name,nullif(trade_name,''),document,nullif(email,''),nullif(phone,''),false,true,CASE WHEN active THEN 'active' ELSE 'archived' END,created_at,updated_at FROM tenant_ludus.suppliers
ON CONFLICT (tenant_id,tax_id) DO UPDATE SET is_supplier=true;

UPDATE parties p SET addresses=jsonb_build_array(jsonb_build_object(
    'label','Principal','postalCode',coalesce(c.cep,''),'state',coalesce(c.uf,''),
    'city',coalesce(c.city,''),'street',coalesce(c.street,''),'number',coalesce(c.street_number,''),
    'district',coalesce(c.district,''),'complement',c.complement,'primary',true))
FROM tenant_ludus.customers c WHERE p.tenant_id=:'tenant'::uuid AND p.tax_id=c.document
AND nullif(c.street,'') IS NOT NULL;
UPDATE parties p SET contacts=jsonb_build_array(jsonb_build_object(
    'name',c.contact_name,'role',null,'email',nullif(c.email,''),'phone',nullif(c.phone,''),'primary',true))
FROM tenant_ludus.customers c WHERE p.tenant_id=:'tenant'::uuid AND p.tax_id=c.document
AND nullif(c.contact_name,'') IS NOT NULL;

INSERT INTO payment_methods(id,tenant_id,code,name,status,notes,revision,modality,settlement_days,updated_at)
SELECT md5('ludus:payment:'||id)::uuid,:'tenant'::uuid,'LEGACY-'||id,label,
CASE WHEN active THEN 'active' ELSE 'archived' END,
'Importado do ERP anterior. Condições originais disponíveis no histórico.',1,
CASE nfe_code WHEN '01' THEN 'cash' WHEN '03' THEN 'credit_card' WHEN '04' THEN 'debit_card'
WHEN '15' THEN 'boleto' WHEN '17' THEN 'pix' WHEN '18' THEN 'bank_transfer' ELSE 'other' END,0,updated_at
FROM tenant_ludus.payment_methods;

-- Do not turn historic orders into new stock movements, receipts or fiscal jobs.
-- An explicit allowlist publishes business history, never integration credentials.
DO $$ DECLARE name text; BEGIN
    FOREACH name IN ARRAY ARRAY[
        'company_settings','customers','suppliers','products','product_lines',
        'product_photos','supplier_items','orders','order_items','order_closings',
        'price_table_versions','price_table_items','price_table_state_rates','pricing_params',
        'state_tax_rates','fiscal_invoices','fiscal_invoice_events','fiscal_rules',
        'purchases','purchase_items','payment_methods','payable_categories','equipment_colors',
        'pipeline_stages','production_stages','opportunity_activities'
    ] LOOP
        IF to_regclass('tenant_ludus.'||name) IS NOT NULL THEN
            EXECUTE format($q$
                INSERT INTO public.legacy_history(tenant_id,id,collection,title,details)
                SELECT current_setting('app.tenant_id')::uuid,
                    md5('ludus:history:'||%L||':'||md5(to_jsonb(t)::text))::uuid,%L,
                    coalesce(to_jsonb(t)->>'name',to_jsonb(t)->>'label',to_jsonb(t)->>'number',to_jsonb(t)->>'code',to_jsonb(t)->>'id',%L),
                    to_jsonb(t)-ARRAY['bytes','photo','logo','signed_xml','authorized_xml']
                FROM tenant_ludus.%I t
            $q$,name,name,name,name);
        END IF;
    END LOOP;
END $$;

INSERT INTO legacy_files(tenant_id,id,history_id,filename,media_type,content,sha256)
SELECT :'tenant'::uuid,md5('ludus:photo:'||p.product_id)::uuid,
md5('ludus:history:product_photos:'||md5(to_jsonb(p)::text))::uuid,
'produto-'||p.product_id||CASE p.mime_type WHEN 'image/png' THEN '.png' WHEN 'image/webp' THEN '.webp' ELSE '.jpg' END,
p.mime_type,p.bytes,encode(sha256(p.bytes),'hex') FROM tenant_ludus.product_photos p;
INSERT INTO legacy_files(tenant_id,id,history_id,filename,media_type,content,sha256)
SELECT :'tenant'::uuid,md5('ludus:supplier-photo:'||p.id)::uuid,
md5('ludus:history:supplier_items:'||md5(to_jsonb(p)::text))::uuid,
'catalogo-fornecedor-'||p.id||'.bin','application/octet-stream',p.photo,encode(sha256(p.photo),'hex')
FROM tenant_ludus.supplier_items p WHERE p.photo IS NOT NULL;
INSERT INTO legacy_files(tenant_id,id,history_id,filename,media_type,content,sha256)
SELECT :'tenant'::uuid,md5('ludus:xml:'||p.id||':'||x.kind)::uuid,
md5('ludus:history:fiscal_invoices:'||md5(to_jsonb(p)::text))::uuid,
'nfe-'||p.id||'-'||x.kind||'.xml','application/xml',convert_to(x.xml,'UTF8'),encode(sha256(convert_to(x.xml,'UTF8')),'hex')
FROM tenant_ludus.fiscal_invoices p CROSS JOIN LATERAL (VALUES ('assinado',p.signed_xml),('autorizado',p.authorized_xml)) x(kind,xml) WHERE x.xml IS NOT NULL;

INSERT INTO legacy_imports(tenant_id,source,manifest) VALUES (:'tenant'::uuid,'ERP legado / tenant_ludus',:'manifest'::jsonb);
INSERT INTO role_permissions(role_id,permission_code)
SELECT id,'platform.legacy.read' FROM roles WHERE tenant_id=:'tenant'::uuid AND code='administrator' ON CONFLICT DO NOTHING;
INSERT INTO audit_log(tenant_id,action,entity_type,entity_id,details)
VALUES (:'tenant'::uuid,'platform.legacy.import','tenant',:'tenant','{"originalSchemasPreserved":true,"externalEventsDispatched":false}'::jsonb);
COMMIT;
