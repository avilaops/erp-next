use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

async fn call(
    router: &Router,
    actor: &str,
    id: Uuid,
    key: Uuid,
    revision: Option<i64>,
    value: &Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/contract-template-drafts/{id}"))
        .header("authorization", format!("Bearer {actor}"))
        .header("x-tenant-id", "11111111-1111-4111-8111-111111111111")
        .header("content-type", "application/json")
        .header("idempotency-key", key.to_string());
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(value.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[sqlx::test(migrations = "../../migrations")]
async fn drafts_enforce_authorization_revisions_idempotency_and_private_pdf(admin: PgPool) {
    let (router, pool, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES ('99999999-9999-4999-8999-999999999999','sales.orders.read'),('99999999-9999-4999-8999-999999999999','platform.integrations.manage'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read') ON CONFLICT DO NOTHING;").execute(&admin).await.unwrap();
    let id = Uuid::now_v7();
    let key = Uuid::now_v7();
    let input = json!({"definition":{"name":"Modelo privado","pages":1,"roles":["Cliente"],"fields":[]},"pdfBase64":STANDARD.encode(b"%PDF-1.4\nfixture\n%%EOF")});
    assert_eq!(
        call(&router, "reader", id, key, None, &input).await.0,
        StatusCode::FORBIDDEN
    );
    let first = call(&router, "editor", id, key, None, &input).await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert_eq!(first.1["revision"], 1);
    assert_eq!(call(&router, "editor", id, key, None, &input).await, first);
    let mut changed = input.clone();
    changed["definition"]["name"] = json!("Outra revisão");
    changed["pdfBase64"] = Value::Null;
    assert_eq!(
        call(&router, "editor", id, key, Some(1), &changed).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&router, "editor", id, Uuid::now_v7(), None, &changed)
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(&router, "editor", id, Uuid::now_v7(), Some(1), &changed)
            .await
            .1["revision"],
        2
    );
    assert_eq!(
        call(&router, "editor", id, Uuid::now_v7(), Some(1), &changed)
            .await
            .0,
        StatusCode::PRECONDITION_FAILED
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE entity_type='contract_template_draft'",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(count, 2);
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    let leaked: i64 = sqlx::query_scalar("SELECT count(*) FROM commercial_template_drafts")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(leaked, 0);
    tx.rollback().await.unwrap();
    pool.close().await;
    server.abort();
    sqlx::query(&format!("DROP OWNED BY {role};"))
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query(&format!("DROP ROLE {role};"))
        .execute(&admin)
        .await
        .unwrap();
}
