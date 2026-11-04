\set ON_ERROR_STOP on
BEGIN;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA legacy_evolution TO evolution_test;
INSERT INTO products(tenant_id,id,sku,name,unit,price_cents,status) VALUES
('22222222-2222-4222-8222-222222222222','88888888-8888-4888-8888-888888888888','FOREIGN','Foreign','UN',1,'active');
SET LOCAL ROLE evolution_test;
SELECT set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true);
DO $$
BEGIN
    BEGIN
        UPDATE legacy_evolution.price_items SET price_cents=1;
        RAISE EXCEPTION 'FAILED: changed historical price';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        DELETE FROM legacy_evolution.record_links;
        RAISE EXCEPTION 'FAILED: deleted provenance';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        INSERT INTO legacy_evolution.price_items(tenant_id,version_id,product_id,price_cents,snapshot)
        SELECT tenant_id,id,md5('ludus:products:1')::uuid,1,'{}' FROM legacy_evolution.price_versions;
        RAISE EXCEPTION 'FAILED: inserted into sealed version';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
        INSERT INTO legacy_evolution.product_attribute_snapshots(tenant_id,product_id,source_history_id)
        VALUES ('11111111-1111-4111-8111-111111111111','88888888-8888-4888-8888-888888888888','00000000-0000-4000-8000-000000000004');
        RAISE EXCEPTION 'FAILED: cross-tenant product reference';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    BEGIN
        INSERT INTO legacy_evolution.order_price_versions(tenant_id,order_id,version_id)
        SELECT tenant_id,'99999999-9999-4999-8999-999999999999',id FROM legacy_evolution.price_versions;
        RAISE EXCEPTION 'FAILED: historical version accepted for a new order';
    EXCEPTION WHEN check_violation THEN NULL; END;
END;
$$;
ROLLBACK;
\echo 'Immutable prices, sealed versions, cross-tenant references and historical order protection passed.'
