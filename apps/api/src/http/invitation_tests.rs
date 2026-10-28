use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request},
    routing::{get, post},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::platform::{auth::AuthClient, invitations::ProvisioningClient, state::AppState};

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const ADMIN_ROLE: &str = "99999999-9999-4999-8999-999999999999";

async fn call(
    router: &Router,
    method: &str,
    path: &str,
    actor: &str,
    command: Uuid,
    body: Value,
) -> (u16, Value) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("authorization", format!("Bearer {actor}"))
                .header("x-tenant-id", TENANT)
                .header("idempotency-key", command.to_string())
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    (
        status,
        serde_json::from_slice(&to_bytes(response.into_body(), 100_000).await.unwrap()).unwrap(),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn verified_invitee_can_manage_users_without_escalating_and_replay_does_not_resend(
    admin: PgPool,
) {
    let (_, pool, fixture_server, role) = super::company_tests::setup(&admin).await;
    sqlx::query("INSERT INTO role_permissions (role_id, permission_code) SELECT $1::uuid, code FROM permissions ON CONFLICT DO NOTHING")
        .bind(ADMIN_ROLE).execute(&admin).await.unwrap();
    let sent = Arc::new(AtomicUsize::new(0));
    let sent_counter = sent.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let auth = tokio::spawn(async move {
        axum::serve(listener, Router::new()
            .route("/userinfo", get(|headers: HeaderMap| async move {
                let actor = headers.get("authorization").unwrap().to_str().unwrap().strip_prefix("Bearer ").unwrap();
                Json(json!({"sub":actor,"email":if actor == "unverified" { "new-user@example.test".into() } else { format!("{actor}@example.test") },"name":actor,"email_verified":actor != "unverified"}))
            }))
            .route("/provision", post(move || { let counter = sent_counter.clone(); async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Json(json!({"envio":"enviado","convite":"secret-link-must-not-be-exposed"}))
            }}))).await.unwrap();
    });
    let router = super::router(
        AppState::new(
            pool.clone(),
            AuthClient::new(format!("http://{address}/userinfo")),
        )
        .with_invitations(Some(ProvisioningClient::for_test(
            format!("http://{address}/provision").parse().unwrap(),
        ))),
    );
    let key = Uuid::now_v7();
    let body = json!({"name":"Novo gestor", "email":"new-user@example.test", "roleIds":[], "manageUsers":true});
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/invitations",
            "reader",
            Uuid::now_v7(),
            body.clone()
        )
        .await
        .0,
        403
    );
    let (status, invitation) = call(
        &router,
        "POST",
        "/api/v1/invitations",
        "editor",
        key,
        body.clone(),
    )
    .await;
    assert_eq!(status, 200, "{invitation}");
    assert_eq!(invitation["delivery"], "sent");
    assert!(!invitation.to_string().contains("secret-link"));
    assert_eq!(
        call(&router, "POST", "/api/v1/invitations", "editor", key, body)
            .await
            .1["id"],
        invitation["id"]
    );
    assert_eq!(sent.load(Ordering::SeqCst), 1);
    let companies = call(
        &router,
        "GET",
        "/api/v1/companies",
        "unverified",
        Uuid::now_v7(),
        Value::Null,
    )
    .await;
    assert_eq!(companies.0, 200, "{}", companies.1);
    assert!(companies.1["data"].as_array().unwrap().is_empty());
    let companies = call(
        &router,
        "GET",
        "/api/v1/companies",
        "new-user",
        Uuid::now_v7(),
        Value::Null,
    )
    .await;
    assert_eq!(companies.0, 200, "{}", companies.1);
    assert_eq!(companies.1["data"].as_array().unwrap().len(), 1);
    let access = call(
        &router,
        "GET",
        "/api/v1/me",
        "new-user",
        Uuid::now_v7(),
        Value::Null,
    )
    .await;
    assert_eq!(access.0, 200);
    assert!(
        access.1["permissions"]
            .as_array()
            .unwrap()
            .contains(&json!("platform.users.manage"))
    );
    assert!(
        !access.1["permissions"]
            .as_array()
            .unwrap()
            .contains(&json!("platform.roles.manage"))
    );
    let next = call(
        &router,
        "POST",
        "/api/v1/invitations",
        "new-user",
        Uuid::now_v7(),
        json!({"name":"Equipe", "email":"team@example.test", "roleIds":[], "manageUsers":true}),
    )
    .await;
    assert_eq!(next.0, 200, "{}", next.1);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/invitations",
            "new-user",
            Uuid::now_v7(),
            json!({"name":"Escalação", "email":"escalation@example.test", "roleIds":[ADMIN_ROLE]})
        )
        .await
        .0,
        403
    );
    let path = format!(
        "/api/v1/invitations/{}/revoke",
        next.1["id"].as_str().unwrap()
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            "new-user",
            Uuid::now_v7(),
            json!({})
        )
        .await
        .0,
        200
    );
    let companies = call(
        &router,
        "GET",
        "/api/v1/companies",
        "team",
        Uuid::now_v7(),
        Value::Null,
    )
    .await;
    assert!(companies.1["data"].as_array().unwrap().is_empty());
    assert_eq!(sent.load(Ordering::SeqCst), 2);
    auth.abort();
    super::company_tests::cleanup(&admin, pool, fixture_server, &role).await;
}
