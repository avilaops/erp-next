use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

use crate::platform::{auth::AuthClient, state::AppState};

async fn call(pool: sqlx::PgPool, path: &str) -> (StatusCode, serde_json::Value) {
    let auth = AuthClient::new("http://127.0.0.1:1/userinfo".to_owned());
    let response = super::router(AppState::new(pool, auth))
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, value)
}

#[tokio::test]
async fn health_alias_uses_readiness() {
    let pool = PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_millis(100))
        .connect_lazy("postgres://postgres:postgres@127.0.0.1:1/erp_next")
        .unwrap();
    let (status, body) = call(pool.clone(), "/api/health").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["status"], "unavailable");
    assert_eq!(call(pool.clone(), "/health/ready").await.0, status);
    assert_eq!(call(pool, "/health/live").await.0, StatusCode::OK);
}

#[tokio::test]
async fn health_alias_returns_ready_for_existing_database() {
    let url = std::env::var("DATABASE_URL").expect("CI test database required");
    let pool = PgPoolOptions::new().connect(&url).await.unwrap();
    let (status, body) = call(pool, "/api/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ready");
}
