use super::company_tests::{cleanup, setup};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;
const TENANT: &str = "11111111-1111-4111-8111-111111111111";

async fn permissions(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'catalog.%' OR code LIKE 'inventory.%' ON CONFLICT DO NOTHING; INSERT INTO role_permissions(role_id,permission_code) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','catalog.products.read'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','inventory.stock.read') ON CONFLICT DO NOTHING;").execute(admin).await.unwrap();
}
async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    subject: &str,
    etag: Option<&str>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(etag) = etag {
        request = request.header("if-match", etag);
    }
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    let bytes = to_bytes(body, 1_000_000).await.unwrap();
    (
        parts.status,
        parts.headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
fn product() -> Value {
    json!({"sku":"industrial-001","name":"Produto de teste","unit":"UN","ncm":null,"cest":null,"basePrice":"0.33","status":"active"})
}
async fn create(router: &Router) -> String {
    let result = call(
        router,
        "POST",
        "/api/v1/products",
        "editor",
        None,
        Some(Uuid::now_v7()),
        product(),
    )
    .await;
    assert_eq!(result.0, StatusCode::CREATED, "{}", result.2);
    result.2["data"]["id"].as_str().unwrap().to_owned()
}
fn movement(id: &str, direction: &str, quantity: &str) -> Value {
    json!({"productId":id,"direction":direction,"quantity":quantity,"reason":"Ajuste de teste","reversesId":null})
}

#[sqlx::test(migrations = "../../migrations")]
async fn catalog_profiles_preserve_prices_enforce_revisions_and_hide_other_tenants(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    sqlx::raw_sql(&format!("GRANT USAGE ON SCHEMA system_config TO {role}; GRANT SELECT ON system_config.files TO {role}"))
        .execute(&admin).await.unwrap();
    let id = create(&router).await;
    let tenant = Uuid::parse_str(TENANT).unwrap();
    let other = Uuid::parse_str("22222222-2222-4222-8222-222222222222").unwrap();
    let foreign_product = Uuid::now_v7();
    sqlx::query("INSERT INTO products(tenant_id,id,sku,name,unit,price_cents,status) VALUES($1,$2,'FOREIGN','Outro produto','UN',999,'active')")
        .bind(other).bind(foreign_product).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO tenant_memberships(id,tenant_id,identity_id,status) VALUES($1,$2,'33333333-3333-4333-8333-333333333333','active')")
        .bind(Uuid::now_v7()).bind(other).execute(&admin).await.unwrap();
    let main = Uuid::now_v7();
    let source = Uuid::now_v7();
    let foreign_media = Uuid::now_v7();
    for (owner, product_id, asset, variant) in [
        (tenant, Uuid::parse_str(&id).unwrap(), main, "webp"),
        (tenant, Uuid::parse_str(&id).unwrap(), source, "source"),
        (other, foreign_product, foreign_media, "webp"),
    ] {
        let file = Uuid::now_v7();
        sqlx::query("INSERT INTO system_config.files(tenant_id,id,storage_key,original_name,media_type,byte_size,sha256,status,created_by) VALUES($1,$2,$3,'photo.webp','image/webp',10,repeat('0',64),'available','33333333-3333-4333-8333-333333333333')")
            .bind(owner).bind(file).bind(format!("r2://ludus-equipamentos-midias/ludus/catalogo/v1/{asset}"))
            .execute(&admin).await.unwrap();
        sqlx::query("INSERT INTO product_media_assets(tenant_id,id,product_id,file_id,collection,variant,version,width_px,height_px) VALUES($1,$2,$3,$4,'core',$5,1,800,600)")
            .bind(owner).bind(asset).bind(product_id).bind(file).bind(variant).execute(&admin).await.unwrap();
        if variant == "webp" {
            sqlx::query("INSERT INTO product_catalog_profiles(tenant_id,product_id,collection,muscle_group,technical_category,dimensions_mm,description,public_path,main_media_id) VALUES($1,$2,'core','Costas','Articulado',ARRAY[1200,900,1800],'Descrição','/core/teste/',$3)")
                .bind(owner).bind(product_id).bind(asset).execute(&admin).await.unwrap();
        }
    }
    let uri = format!("/api/v1/products/{id}/catalog");
    let read = call(&router, "GET", &uri, "reader", None, None, Value::Null).await;
    assert_eq!(read.0, StatusCode::OK);
    assert_eq!(read.2["canEdit"], false);
    assert_eq!(read.2["assets"].as_array().unwrap().len(), 2);
    let mut input = json!({"collection":"premium","muscleGroup":"Peitoral","technicalCategory":"Peso livre","dimensionsMm":[1400,1000,1600],"description":"Atualizado","weight":"","weightStack":"","mainMediaId":main});
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "reader",
            Some("\"1\""),
            None,
            input.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for invalid in [source, foreign_media] {
        input["mainMediaId"] = json!(invalid);
        assert_eq!(
            call(
                &router,
                "PUT",
                &uri,
                "editor",
                Some("\"1\""),
                None,
                input.clone()
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    input["mainMediaId"] = json!(main);
    let mut without_media_field = input.clone();
    without_media_field
        .as_object_mut()
        .unwrap()
        .remove("mainMediaId");
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"1\""),
            None,
            without_media_field
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let unchanged = call(&router, "GET", &uri, "reader", None, None, Value::Null).await;
    assert_eq!(unchanged.2["data"]["mainMediaId"], json!(main));
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"1\""),
            None,
            input.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&router, "PUT", &uri, "editor", Some("\"1\""), None, input)
            .await
            .0,
        StatusCode::PRECONDITION_FAILED
    );
    let preview = call(
        &router,
        "GET",
        "/api/v1/catalog-publication",
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(preview.0, StatusCode::OK);
    assert_eq!(preview.2["products"].as_array().unwrap().len(), 1);
    assert_eq!(preview.2["products"][0]["colecao"], "premium");
    assert!(preview.2["products"][0].get("basePrice").is_none());
    assert!(preview.2["products"][0].get("ncm").is_none());
    assert_eq!(preview.2["previewHash"].as_str().unwrap().len(), 64);
    let product = call(
        &router,
        "GET",
        &format!("/api/v1/products/{id}"),
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(product.2["data"]["basePrice"], "0.33");
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/v1/products/{foreign_product}/catalog"),
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/v1/products/{id}/media/{foreign_media}"),
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    cleanup(&admin, app, server, &role).await;
}

fn technical_profile_input() -> Value {
    json!({"collection":"premium","muscleGroup":"Abdômen","technicalCategory":"Bateria de pesos","dimensionsMm":[1200,900,1800],"description":"Ficha original do equipamento","weight":"280 kg","weightStack":"95 kg","mainMediaId":null})
}

async fn technical_profile_permissions(admin: &PgPool, role: &str) {
    permissions(admin).await;
    sqlx::raw_sql(&format!("GRANT USAGE ON SCHEMA system_config TO {role}; GRANT SELECT ON system_config.files TO {role}"))
        .execute(admin).await.unwrap();
}

#[sqlx::test(migrations = "../../migrations")]
async fn technical_profile_creation_without_media_preserves_prices_and_metadata(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    technical_profile_permissions(&admin, &role).await;
    let id = create(&router).await;
    let uri = format!("/api/v1/products/{id}/catalog");
    let empty = call(&router, "GET", &uri, "reader", None, None, Value::Null).await;
    assert_eq!(empty.0, StatusCode::OK, "{}", empty.2);
    assert_eq!(empty.1["etag"], "\"0\"");
    assert!(empty.2["data"].is_null());
    assert_eq!(empty.2["defaultCollection"], "core");
    assert_eq!(empty.2["mediaConfigured"], false);

    let mut input = technical_profile_input();
    input["manufacturer"] = json!("DHZ Fitness");
    input["manufacturerModel"] = json!("SM5014");
    input["catalogProductName"] = json!("Abdominal Crunch");
    input["liveArea"] = json!("3.1 × 2.8 m");
    input["catalogSources"] = json!([{"title":"Hammer S-FORCE","url":"https://drive.google.com/file/d/source/view#page=6","pdfPage":6,"printedPage":10}]);
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "reader",
            Some("\"0\""),
            None,
            input.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&router, "PUT", &uri, "editor", None, None, input.clone())
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let saved = call(
        &router,
        "PUT",
        &uri,
        "editor",
        Some("\"0\""),
        None,
        input.clone(),
    )
    .await;
    assert_eq!(saved.0, StatusCode::OK, "{}", saved.2);
    assert_eq!(saved.2["revision"], 1);
    assert!(saved.2["mainMediaId"].is_null());
    assert_eq!(
        call(&router, "PUT", &uri, "editor", Some("\"0\""), None, input)
            .await
            .0,
        StatusCode::PRECONDITION_FAILED
    );
    let read = call(&router, "GET", &uri, "reader", None, None, Value::Null).await;
    assert_eq!(read.2["data"]["manufacturerModel"], "SM5014");
    assert_eq!(read.2["data"]["catalogSources"][0]["pdfPage"], 6);
    let path = read.2["data"]["publicPath"].as_str().unwrap();
    assert_eq!(path, format!("/loja/product-{id}/"));

    let mut legacy = technical_profile_input();
    legacy["description"] = json!("Descrição atualizada sem os novos campos");
    assert_eq!(
        call(&router, "PUT", &uri, "editor", Some("\"1\""), None, legacy)
            .await
            .0,
        StatusCode::OK
    );
    let read = call(&router, "GET", &uri, "reader", None, None, Value::Null).await;
    for (field, expected) in [
        ("manufacturer", "DHZ Fitness"),
        ("manufacturerModel", "SM5014"),
        ("catalogProductName", "Abdominal Crunch"),
        ("liveArea", "3.1 × 2.8 m"),
    ] {
        assert_eq!(read.2["data"][field], expected);
    }
    assert_eq!(read.2["data"]["catalogSources"][0]["printedPage"], 10);
    let product = call(
        &router,
        "GET",
        &format!("/api/v1/products/{id}"),
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(product.2["data"]["basePrice"], "0.33");
    assert_eq!(product.2["data"]["revision"], 1);
    assert_eq!(product.2["data"]["hasPhoto"], false);
    assert!(product.2["data"]["photoUrl"].is_null());
    let list = call(
        &router,
        "GET",
        "/api/v1/products?q=industrial-001",
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(list.2["data"][0]["hasPhoto"], false);
    let audits:i64=sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action IN ('catalog.profile.created','catalog.profile.updated')")
        .bind(Uuid::parse_str(TENANT).unwrap()).bind(&id).fetch_one(&admin).await.unwrap();
    assert_eq!(audits, 2);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn technical_profile_rejects_unsafe_sources_and_foreign_creation(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    technical_profile_permissions(&admin, &role).await;
    let id = create(&router).await;
    let uri = format!("/api/v1/products/{id}/catalog");
    let mut cases = Vec::new();
    for url in [
        "javascript:alert(1)",
        "http://example.test/catalog.pdf",
        "https://user:password@example.test/catalog.pdf",
    ] {
        cases.push(json!([{"title":"Catálogo","url":url,"pdfPage":1}]));
    }
    for page in [0, 10001] {
        cases.push(
            json!([{"title":"Catálogo","url":"https://example.test/catalog.pdf","pdfPage":page}]),
        );
    }
    cases.push(json!([{"title":"x".repeat(161),"url":"https://example.test/catalog.pdf"}]));
    cases.push(json!(vec![
        json!({"title":"Catálogo","url":"https://example.test/catalog.pdf"});
        11
    ]));
    for sources in cases {
        let mut input = technical_profile_input();
        input["catalogSources"] = sources;
        assert_eq!(
            call(&router, "PUT", &uri, "editor", Some("\"0\""), None, input)
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let foreign = Uuid::now_v7();
    sqlx::query("INSERT INTO products(tenant_id,id,sku,name,unit,price_cents,status) VALUES('22222222-2222-4222-8222-222222222222',$1,'FOREIGN-TECH','Outro produto','UN',999,'active')")
        .bind(foreign).execute(&admin).await.unwrap();
    let foreign_uri = format!("/api/v1/products/{foreign}/catalog");
    assert_eq!(
        call(
            &router,
            "PUT",
            &foreign_uri,
            "editor",
            Some("\"0\""),
            None,
            technical_profile_input()
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &router,
            "GET",
            &foreign_uri,
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let empty = call(&router, "GET", &uri, "reader", None, None, Value::Null).await;
    assert!(empty.2["data"].is_null());
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn technical_profile_without_media_keeps_existing_product_photo(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    technical_profile_permissions(&admin, &role).await;
    let mut input = product();
    let photo = "data:image/jpeg;base64,/9j/2Q==";
    input["photoDataUrl"] = json!(photo);
    let created = call(
        &router,
        "POST",
        "/api/v1/products",
        "editor",
        None,
        Some(Uuid::now_v7()),
        input,
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/products/{id}/catalog");
    let saved = call(
        &router,
        "PUT",
        &uri,
        "editor",
        Some("\"0\""),
        None,
        technical_profile_input(),
    )
    .await;
    assert_eq!(saved.0, StatusCode::OK, "{}", saved.2);
    let product = call(
        &router,
        "GET",
        &format!("/api/v1/products/{id}"),
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(product.2["data"]["photoDataUrl"], photo);
    assert_eq!(product.2["data"]["hasPhoto"], true);
    assert!(product.2["data"]["photoUrl"].is_null());
    let preview = call(
        &router,
        "GET",
        "/api/v1/catalog-publication",
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(preview.2["products"], json!([]));
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn product_categories_are_tenant_scoped_filterable_and_preserved_on_legacy_updates(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    let category = Uuid::now_v7();
    let foreign = Uuid::now_v7();
    for (tenant, id) in [
        (TENANT, category),
        ("22222222-2222-4222-8222-222222222222", foreign),
    ] {
        sqlx::query("INSERT INTO product_categories(tenant_id,id,code,name,status,revision,sort_order) VALUES($1,$2,'CORE','Core','active',1,0)")
            .bind(Uuid::parse_str(tenant).unwrap()).bind(id).execute(&admin).await.unwrap();
    }
    for invalid in [
        foreign.to_string(),
        Uuid::now_v7().to_string(),
        "not-a-uuid".to_owned(),
    ] {
        let mut input = product();
        input["categoryId"] = json!(invalid);
        let result = call(
            &router,
            "POST",
            "/api/v1/products",
            "editor",
            None,
            Some(Uuid::now_v7()),
            input,
        )
        .await;
        assert_eq!(result.0, StatusCode::UNPROCESSABLE_ENTITY, "{}", result.2);
    }
    let mut input = product();
    input["categoryId"] = json!(category);
    let created = call(
        &router,
        "POST",
        "/api/v1/products",
        "editor",
        None,
        Some(Uuid::now_v7()),
        input,
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/products/{id}");
    let etag = created.1.get("etag").unwrap().to_str().unwrap();
    let preserved = call(&router, "PUT", &uri, "editor", Some(etag), None, product()).await;
    assert_eq!(preserved.0, StatusCode::OK, "{}", preserved.2);
    assert_eq!(preserved.2["data"]["categoryId"], category.to_string());
    for (filter, total) in [(category, 1), (foreign, 0)] {
        let result = call(
            &router,
            "GET",
            &format!("/api/v1/products?category_id={filter}"),
            "reader",
            None,
            None,
            Value::Null,
        )
        .await;
        assert_eq!(result.0, StatusCode::OK);
        assert_eq!(result.2["total"], total);
        assert_eq!(result.2["data"].as_array().unwrap().len(), total as usize);
    }
    let mut input = product();
    input["categoryId"] = json!("");
    let etag = preserved.1.get("etag").unwrap().to_str().unwrap();
    let cleared = call(&router, "PUT", &uri, "editor", Some(etag), None, input).await;
    assert_eq!(cleared.0, StatusCode::OK, "{}", cleared.2);
    assert!(cleared.2["data"].get("categoryId").is_none());
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn products_persist_paginate_and_enforce_permissions_revisions_and_command_idempotency(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/products",
            "",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/products",
            "reader",
            None,
            Some(Uuid::now_v7()),
            product()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/products",
            "editor",
            None,
            None,
            product()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let key = Uuid::now_v7();
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            "/api/v1/products",
            "editor",
            None,
            Some(key),
            product()
        ),
        call(
            &router,
            "POST",
            "/api/v1/products",
            "editor",
            None,
            Some(key),
            product()
        )
    );
    assert_eq!(a.0, StatusCode::CREATED, "{}", a.2);
    assert_eq!(a.2, b.2);
    assert_eq!(a.1["etag"], "\"1\"");
    let id = a.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/products/{id}");
    assert_eq!(a.2["data"]["sku"], "INDUSTRIAL-001");
    assert_eq!(a.2["data"]["basePrice"], "0.33");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/products",
            "editor",
            None,
            Some(Uuid::now_v7()),
            product()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut changed = product();
    changed["name"] = json!("Nome alterado");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/products",
            "editor",
            None,
            Some(key),
            changed.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (a, b) = tokio::join!(
        call(&router, "PUT", &uri, "editor", Some("\"1\""), None, changed),
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"1\""),
            None,
            product()
        )
    );
    let mut statuses = vec![a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, vec![200, 412]);
    let current = call(&router, "GET", &uri, "reader", None, None, Value::Null).await;
    assert_eq!(current.2["data"]["revision"], 2);
    assert_eq!(current.2["canEdit"], false);
    let mut invalid = product();
    invalid["basePrice"] = json!(0.33);
    assert_eq!(
        call(&router, "PUT", &uri, "editor", Some("\"2\""), None, invalid)
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let page = call(
        &router,
        "GET",
        "/api/v1/products?q=industrial&limit=1&offset=0",
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(page.2["total"], 1);
    assert_eq!(page.2["data"].as_array().unwrap().len(), 1);
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/products?limit=0",
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let foreign = Uuid::now_v7();
    sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES($1,'22222222-2222-4222-8222-222222222222','INDUSTRIAL-001','Outra empresa','UN',33,'active')").bind(foreign).execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/v1/products/{foreign}"),
            "editor",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM products")
            .fetch_one(&app)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log WHERE entity_type='product'")
            .fetch_one(&admin)
            .await
            .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM outbox_events WHERE aggregate_type='product'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        2
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn stock_ledger_prevents_overselling_replays_and_destructive_changes(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    let id = create(&router).await;
    let key = Uuid::now_v7();
    let receipt = movement(&id, "receipt", "10.000001");
    let posted = call(
        &router,
        "POST",
        "/api/v1/stock/movements",
        "editor",
        None,
        Some(key),
        receipt.clone(),
    )
    .await;
    assert_eq!(posted.0, StatusCode::CREATED, "{}", posted.2);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(key),
            receipt
        )
        .await
        .2,
        posted.2
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "reader",
            None,
            Some(Uuid::now_v7()),
            movement(&id, "issue", "1.000000")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(Uuid::now_v7()),
            movement(&id, "issue", "2.000001")
        )
        .await
        .0,
        StatusCode::CREATED
    );
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(Uuid::now_v7()),
            movement(&id, "issue", "5.000000")
        ),
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(Uuid::now_v7()),
            movement(&id, "issue", "5.000000")
        )
    );
    let winner = if a.0 == StatusCode::CREATED {
        &a.2
    } else {
        &b.2
    };
    let mut statuses = vec![a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, vec![201, 409]);
    let mut reverse = movement(&id, "receipt", "5.000000");
    reverse["reversesId"] = winner["id"].clone();
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(Uuid::now_v7()),
            reverse.clone()
        )
        .await
        .0,
        StatusCode::CREATED
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(Uuid::now_v7()),
            reverse
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let balances = call(
        &router,
        "GET",
        "/api/v1/stock",
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(balances.2["data"][0]["quantity"], "8.000000");
    let history = call(
        &router,
        "GET",
        &format!("/api/v1/stock/movements?productId={id}"),
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(history.2["total"], 4);
    let mut unit = product();
    unit["unit"] = json!("KG");
    assert_eq!(
        call(
            &router,
            "PUT",
            &format!("/api/v1/products/{id}"),
            "editor",
            Some("\"1\""),
            None,
            unit
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut archive = product();
    archive["status"] = json!("archived");
    assert_eq!(
        call(
            &router,
            "PUT",
            &format!("/api/v1/products/{id}"),
            "editor",
            Some("\"1\""),
            None,
            archive
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert!(
        sqlx::query("DELETE FROM stock_movements")
            .execute(&admin)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE stock_movements SET reason='tampered'")
            .execute(&admin)
            .await
            .is_err()
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT sum(CASE direction WHEN 'receipt' THEN quantity_micros ELSE -quantity_micros END)::bigint FROM stock_movements").fetch_one(&admin).await.unwrap(),8_000_000);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM stock_balances")
            .fetch_one(&app)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn outbox_failure_rolls_back_product_movement_balance_and_command(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    sqlx::raw_sql("CREATE FUNCTION fail_catalog_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER fail_catalog_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_catalog_outbox();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/products",
            "editor",
            None,
            Some(key),
            product()
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    for table in ["products", "audit_log", "domain_commands"] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            0
        );
    }
    sqlx::query("DROP TRIGGER fail_catalog_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    let created = call(
        &router,
        "POST",
        "/api/v1/products",
        "editor",
        None,
        Some(key),
        product(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    let id = created.2["data"]["id"].as_str().unwrap();
    sqlx::query("CREATE TRIGGER fail_catalog_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_catalog_outbox()").execute(&admin).await.unwrap();
    let stock_key = Uuid::now_v7();
    let receipt = movement(id, "receipt", "1.000000");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(stock_key),
            receipt.clone()
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM stock_balances")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM stock_movements")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM domain_commands")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    sqlx::query("DROP TRIGGER fail_catalog_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(stock_key),
            receipt
        )
        .await
        .0,
        StatusCode::CREATED
    );
    cleanup(&admin, app, server, &role).await;
}
