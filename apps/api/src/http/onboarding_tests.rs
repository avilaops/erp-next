use axum::{Router, body::{Body, to_bytes}, http::{Request, StatusCode}};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

async fn call(router: &Router, method: &str, subject: &str, key: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method).uri("/api/v1/companies").header("content-type", "application/json");
    if !subject.is_empty() { request = request.header("authorization", format!("Bearer {subject}")); }
    if let Some(key) = key { request = request.header("idempotency-key", key); }
    let response = router.clone().oneshot(request.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[sqlx::test(migrations = "../../migrations")]
async fn company_discovery_requires_auth_and_only_returns_active_memberships(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    assert_eq!(call(&router, "GET", "", None, Value::Null).await.0, StatusCode::UNAUTHORIZED);
    let (status, body) = call(&router, "GET", "reader", None, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(body["data"][0]["id"], "11111111-1111-4111-8111-111111111111");
    let (status, body) = call(&router, "GET", "disabled", None, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"], json!([]));
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
