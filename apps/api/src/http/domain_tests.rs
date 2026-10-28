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
