use axum::{body::Body, http::Request};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

use super::router;
use crate::platform::{auth::AuthClient, state::AppState};

fn app() -> axum::Router {
    let database = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@127.0.0.1:1/erp_next")
        .unwrap();
    router(AppState::new(
        database,
        AuthClient::new("http://127.0.0.1:1/oauth/userinfo".to_owned()),
    ))
}

#[tokio::test]
async fn mcp_challenges_anonymous_clients_before_database_access() {
    let response = app()
        .oneshot(Request::builder().method("POST").uri("/mcp")
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .body(Body::from(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}"#)).unwrap())
        .await.unwrap();
    assert_eq!(response.status(), 401);
    assert!(
        response.headers()["www-authenticate"]
            .to_str()
            .unwrap()
            .contains("resource_metadata=")
    );
}

#[tokio::test]
async fn mcp_resource_discovery_is_public_without_database_access() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/.well-known/oauth-protected-resource/mcp")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let bytes = axum::body::to_bytes(response.into_body(), 16384)
        .await
        .unwrap();
    let document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(document["resource"], "https://erp.avilaops.com/mcp");
    assert_eq!(
        document["authorization_servers"][0],
        "https://erp.avilaops.com"
    );
}

#[tokio::test]
async fn mcp_rejects_cross_origin_requests_before_authentication() {
    let response = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("origin", "https://attacker.invalid")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
}

#[tokio::test]
async fn mcp_authorization_discovery_requires_s256_and_announces_registration() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/.well-known/oauth-authorization-server")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let bytes = axum::body::to_bytes(response.into_body(), 16384)
        .await
        .unwrap();
    let document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        document["code_challenge_methods_supported"],
        serde_json::json!(["S256"])
    );
    assert_eq!(
        document["registration_endpoint"],
        "https://erp.avilaops.com/mcp/oauth/register"
    );
}
