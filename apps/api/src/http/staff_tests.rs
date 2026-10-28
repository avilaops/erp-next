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
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

fn input() -> Value {
    json!({"code":" eq-001 ","name":" Maria ","jobTitle":"Comercial","email":"maria@example.test","phone":null,"isEmployee":true,"isSeller":true,"status":"active"})
}

async fn permissions(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'catalog.staff.%'; INSERT INTO role_permissions(role_id,permission_code) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,code FROM permissions WHERE code='catalog.staff.read';").execute(admin).await.unwrap();
}

#[expect(
    clippy::too_many_arguments,
    reason = "HTTP isolation tests keep tenant, identity and preconditions explicit"
)]
async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    tenant: &str,
    subject: &str,
    etag: Option<&str>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(value) = etag {
        request = request.header("if-match", value);
    }
    if let Some(value) = key {
        request = request.header("idempotency-key", value.to_string());
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

#[sqlx::test(migrations = "../../migrations")]
async fn staff_roundtrip_functions_archive_reactivation_and_revisions(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    permissions(&admin).await;
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/staff",
            TENANT,
            "",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let key = Uuid::now_v7();
    let (status, _, created) = call(
        &router,
        "POST",
        "/api/v1/staff",
        TENANT,
        "editor",
        None,
        Some(key),
        input(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["data"]["code"], "EQ-001");
    assert_eq!(created["data"]["name"], "Maria");
    let uri = format!("/api/v1/staff/{}", created["data"]["id"].as_str().unwrap());
    let repeated = call(
        &router,
        "POST",
        "/api/v1/staff",
        TENANT,
        "editor",
        None,
        Some(key),
        input(),
    )
    .await;
    assert_eq!(repeated.0, StatusCode::CREATED);
    assert_eq!(repeated.2, created);
    for function in ["employee", "seller"] {
        let (_, _, listed) = call(
            &router,
            "GET",
            &format!("/api/v1/staff?role={function}&q=EQ-001&limit=1"),
            TENANT,
            "reader",
            None,
            None,
            Value::Null,
        )
        .await;
        assert_eq!(listed["total"], 1);
        assert_eq!(listed["data"][0]["id"], created["data"]["id"]);
    }
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "reader",
            Some("\"1\""),
            None,
            input()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "GET",
            &uri,
            OTHER,
            "editor",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut changed = input();
    changed["status"] = json!("archived");
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            Some("\"1\""),
            None,
            changed.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/staff",
            TENANT,
            "editor",
            None,
            Some(Uuid::now_v7()),
            input()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            Some("\"1\""),
            None,
            input()
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let (status, headers, restored) = call(
        &router,
        "PUT",
        &uri,
        TENANT,
        "editor",
        Some("\"2\""),
        None,
        input(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["etag"], "\"3\"");
    assert_eq!(
        call(
            &router,
            "GET",
            &uri,
            TENANT,
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .2["data"],
        restored["data"]
    );
    cleanup(&admin, application, server, &role).await;
}
