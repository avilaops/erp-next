\set ON_ERROR_STOP on
BEGIN;
INSERT INTO tenants(id,legal_name,tax_id) VALUES
('11111111-1111-4111-8111-111111111111','Evolution A','evolution-a'),
('22222222-2222-4222-8222-222222222222','Evolution B','evolution-b');
INSERT INTO identities(id,auth_subject,email,display_name) VALUES
('33333333-3333-4333-8333-333333333333','evolution-owner','owner@example.test','Owner'),
('44444444-4444-4444-8444-444444444444','evolution-peer','peer@example.test','Peer');
INSERT INTO tenant_memberships(id,tenant_id,identity_id,status) VALUES
('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','active'),
('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','active');
INSERT INTO roles(id,tenant_id,code,name) VALUES
('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','evolution','Evolution');
INSERT INTO membership_roles(membership_id,role_id) VALUES
('66666666-6666-4666-8666-666666666666','99999999-9999-4999-8999-999999999999'),
('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999');
INSERT INTO role_permissions(role_id,permission_code) VALUES
('99999999-9999-4999-8999-999999999999','system.files.read'),
('99999999-9999-4999-8999-999999999999','system.custom_fields.read'),
('99999999-9999-4999-8999-999999999999','system.reports.read'),
('99999999-9999-4999-8999-999999999999','catalog.products.read');
INSERT INTO products(tenant_id,id,sku,name,unit,price_cents,status) VALUES
('11111111-1111-4111-8111-111111111111',md5('ludus:products:1')::uuid,'EVOLUTION','Current product','UN',1234,'active');
INSERT INTO legacy_history(tenant_id,id,collection,title,details) VALUES
('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000001','products','Historical product',
 '{"id":1,"advisory_cost":10.25,"packaging":2,"tax_credit":0.1,"supplier_price_usd":3,"length_mm":100,"weight_kg":1.25,"line_id":1}'),
('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000002','price_table_versions','Version',
 '{"version":1,"line_id":1,"published_at":"2026-01-01T12:00:00Z","target_net_profit":0.2}'),
('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000003','price_table_items','Price',
 '{"version":1,"product_id":1,"table_price":20,"table_price_with_ipi":22}'),
('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000004','orders','Old order','{"id":12,"status":"closed"}'),
('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000005','product_photos','Photo','{"product_id":1}');
INSERT INTO legacy_files(tenant_id,id,history_id,filename,media_type,content,sha256) VALUES
('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000005',
 'fixture.txt','text/plain',convert_to('fixture','UTF8'),encode(sha256(convert_to('fixture','UTF8')),'hex'));
INSERT INTO system_config.files(tenant_id,id,storage_key,original_name,media_type,byte_size,sha256,status,created_by,created_at)
SELECT '11111111-1111-4111-8111-111111111111',('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
    'fixture/'||n,'File '||n,'text/plain',1,repeat('a',64),'available','33333333-3333-4333-8333-333333333333','2026-01-01T00:00:00Z'
FROM generate_series(1,120) n;
INSERT INTO system_config.report_definitions(tenant_id,id,name,dataset,columns,owner_identity_id,visibility) VALUES
('11111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000001','Private','products','["name"]','33333333-3333-4333-8333-333333333333','private'),
('11111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000002','Shared','products','["name"]','33333333-3333-4333-8333-333333333333','tenant'),
('11111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000003','Restricted dataset','audit_log','["action"]','33333333-3333-4333-8333-333333333333','tenant');
INSERT INTO system_config.custom_fields(tenant_id,id,entity_type,code,label,value_type)
VALUES ('11111111-1111-4111-8111-111111111111','30000000-0000-4000-8000-000000000001','product','test','Test','text');
CREATE ROLE evolution_test NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,system_config,legacy_evolution TO evolution_test;
GRANT SELECT ON ALL TABLES IN SCHEMA public,system_config,legacy_evolution TO evolution_test;
GRANT EXECUTE ON FUNCTION system_config.has_permission(text) TO evolution_test;
COMMIT;
