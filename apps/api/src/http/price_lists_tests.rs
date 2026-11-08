use super::company_tests::{cleanup, setup};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const PRODUCT: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    subject: &str,
    key: Uuid,
    etag: &str,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json")
        .header("idempotency-key", key.to_string());
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if !etag.is_empty() {
        request = request.header("if-match", etag);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn price_lists_roundtrip_isolation_replay_and_revisions(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'catalog.products.%' ON CONFLICT DO NOTHING; INSERT INTO role_permissions(role_id,permission_code) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','catalog.products.read') ON CONFLICT DO NOTHING; INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','P-1','Produto','UN',500,'active');").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    let input = json!({"code":" varejo ","name":"Varejo","status":"active","validFrom":"2026-11-01","validUntil":"2026-12-31","notes":null,"items":[{"productId":PRODUCT,"price":"100.50"}]});
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/price-lists",
            "",
            key,
            "",
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, created) = call(
        &router,
        "POST",
        "/api/v1/price-lists",
        "editor",
        key,
        "",
        input.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["data"]["code"], "VAREJO");
    let id = created["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/price-lists/{id}");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/price-lists",
            "editor",
            key,
            "",
            input.clone()
        )
        .await
        .1,
        created
    );
    assert_eq!(
        call(&router, "GET", &uri, "reader", key, "", Value::Null)
            .await
            .1["data"]["items"][0]["price"],
        "100.50"
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "reader",
            Uuid::now_v7(),
            "\"1\"",
            input.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut changed = input.clone();
    changed["items"][0]["price"] = json!("90.00");
    let update_key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            update_key,
            "\"1\"",
            changed.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            update_key,
            "\"1\"",
            changed.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Uuid::now_v7(),
            "\"1\"",
            input.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    changed["code"] = json!("OUTRA");
    changed["items"][0]["productId"] = json!("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/price-lists",
            "editor",
            Uuid::now_v7(),
            "",
            changed
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, lists) = call(
        &router,
        "GET",
        "/api/v1/price-lists?q=varejo",
        "reader",
        key,
        "",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(lists["total"], 1);
    assert_eq!(lists["data"][0]["itemCount"], 1);
    let base: i64 = sqlx::query_scalar("SELECT price_cents FROM products WHERE id=$1")
        .bind(Uuid::parse_str(PRODUCT).unwrap())
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(base, 500);
    let mut archived = input.clone();
    archived["status"] = json!("archived");
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Uuid::now_v7(),
            "\"2\"",
            archived.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/price-lists?status=archived",
            "reader",
            key,
            "",
            Value::Null
        )
        .await
        .1["total"],
        1
    );
    sqlx::query("UPDATE products SET status='archived' WHERE id=$1")
        .bind(Uuid::parse_str(PRODUCT).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    archived["notes"] = json!("Mantém produto arquivado já incluído");
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Uuid::now_v7(),
            "\"3\"",
            archived.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    archived["code"] = json!("NEW");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/price-lists",
            "editor",
            Uuid::now_v7(),
            "",
            archived
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut invalid = input.clone();
    invalid["code"] = json!("DUPLICATE");
    invalid["items"] =
        json!([{"productId":PRODUCT,"price":"1.00"},{"productId":PRODUCT,"price":"2.00"}]);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/price-lists",
            "editor",
            Uuid::now_v7(),
            "",
            invalid
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut reused = input.clone();
    reused["name"] = json!("Outro nome");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/price-lists",
            "editor",
            key,
            "",
            reused
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    cleanup(&admin, application, server, &role).await;
}
