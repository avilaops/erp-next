use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

use super::company_tests::{cleanup, setup_with_certificates};
use crate::domains::fiscal::certificate_crypto::tests::{fixture, vault};

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const URI: &str = "/api/v1/fiscal/certificate";

async fn call(
    router: &Router,
    method: &str,
    token: Option<&str>,
    tenant: &str,
    etag: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(URI)
        .header("x-tenant-id", tenant);
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if let Some(etag) = etag {
        request = request.header("if-match", etag);
    }
    let payload = if let Some(body) = body {
        request = request.header("content-type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    let response = router
        .clone()
        .oneshot(request.body(payload).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    (
        parts.status,
        parts.headers,
        serde_json::from_slice(&to_bytes(body, 40_000).await.unwrap()).unwrap(),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn certificate_lifecycle_encrypts_secrets_enforces_concurrency_and_keeps_tenants_isolated(
    admin: PgPool,
) {
    let (router, application, auth, role) = setup_with_certificates(&admin, vault()).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('fiscal.config.read','fiscal.config.manage'); INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fiscal.config.read');").execute(&admin).await.unwrap();
    let fixture = fixture();
    let input = json!({"pkcs12Base64":fixture["valid"],"password":fixture["password"]});
    let initial = call(&router, "GET", Some("editor"), TENANT, None, None).await;
    assert_eq!(initial.0, StatusCode::OK);
    assert_eq!(initial.1["etag"], "\"0\"");
    assert_eq!(initial.2["status"], "not_configured");
    assert_eq!(initial.2["uploadAvailable"], true);
    assert_eq!(
        call(
            &router,
            "PUT",
            Some("editor"),
            TENANT,
            None,
            Some(input.clone())
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            Some("reader"),
            TENANT,
            Some("\"0\""),
            Some(input.clone())
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&router, "GET", None, TENANT, None, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    for kind in ["otherCompany", "expired", "future"] {
        let rejected = call(
            &router,
            "PUT",
            Some("editor"),
            TENANT,
            Some("\"0\""),
            Some(json!({"pkcs12Base64":fixture[kind],"password":fixture["password"]})),
        )
        .await;
        assert_eq!(
            rejected.0,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{}",
            rejected.2
        );
    }
    let wrong_password = call(
        &router,
        "PUT",
        Some("editor"),
        TENANT,
        Some("\"0\""),
        Some(json!({"pkcs12Base64":fixture["valid"],"password":"wrong-secret-not-to-be-logged"})),
    )
    .await;
    assert_eq!(wrong_password.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(!wrong_password.2.to_string().contains("wrong-secret"));

    let saved = call(
        &router,
        "PUT",
        Some("editor"),
        TENANT,
        Some("\"0\""),
        Some(input.clone()),
    )
    .await;
    assert_eq!(saved.0, StatusCode::OK, "{}", saved.2);
    assert_eq!(saved.1["etag"], "\"1\"");
    assert_eq!(saved.2["status"], "active");
    assert_eq!(saved.2["data"]["chainVerified"], true);
    let serialized = saved.2.to_string();
    for secret in [
        fixture["password"].as_str().unwrap(),
        fixture["valid"].as_str().unwrap(),
        "ciphertext",
        "encryptionKeyId",
        "pkcs12",
    ] {
        assert!(!serialized.contains(secret));
    }
    let encrypted: (Vec<u8>, Value) = sqlx::query_as(
        "SELECT ciphertext,metadata FROM fiscal_a1_certificates WHERE tenant_id=$1::uuid",
    )
    .bind(TENANT)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert!(
        !encrypted
            .0
            .windows(fixture["password"].as_str().unwrap().len())
            .any(|value| value == fixture["password"].as_str().unwrap().as_bytes())
    );
    assert_ne!(
        encrypted.0,
        STANDARD.decode(fixture["valid"].as_str().unwrap()).unwrap()
    );
    assert!(
        !encrypted
            .1
            .to_string()
            .contains(fixture["password"].as_str().unwrap())
    );
    let audit: Value = sqlx::query_scalar("SELECT details FROM audit_log WHERE action='fiscal.certificate.connected' ORDER BY id DESC LIMIT 1").fetch_one(&admin).await.unwrap();
    assert!(
        !audit
            .to_string()
            .contains(fixture["password"].as_str().unwrap())
    );

    sqlx::raw_sql("INSERT INTO roles(id,tenant_id,code,name) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','fiscal','Fiscal'); INSERT INTO role_permissions(role_id,permission_code) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','fiscal.config.read'),('cccccccc-cccc-4ccc-8ccc-cccccccccccc','fiscal.config.manage'); INSERT INTO tenant_memberships(id,tenant_id,identity_id,status) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','active'); INSERT INTO membership_roles(membership_id,role_id) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc');").execute(&admin).await.unwrap();
    let other = call(&router, "GET", Some("editor"), OTHER, None, None).await;
    assert_eq!(other.0, StatusCode::OK);
    assert_eq!(other.2["revision"], 0);
    assert!(other.2["data"].is_null());
    assert_eq!(
        call(
            &router,
            "PUT",
            Some("editor"),
            TENANT,
            Some("\"0\""),
            Some(input.clone())
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let replaced = call(
        &router,
        "PUT",
        Some("editor"),
        TENANT,
        Some("\"1\""),
        Some(json!({"pkcs12Base64":fixture["legacy"],"password":fixture["password"]})),
    )
    .await;
    assert_eq!(replaced.0, StatusCode::OK);
    assert_eq!(replaced.1["etag"], "\"2\"");
    assert_ne!(
        replaced.2["data"]["fingerprint"],
        saved.2["data"]["fingerprint"]
    );
    assert_eq!(
        call(
            &router,
            "DELETE",
            Some("editor"),
            TENANT,
            Some("\"1\""),
            None
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let removed = call(
        &router,
        "DELETE",
        Some("editor"),
        TENANT,
        Some("\"2\""),
        None,
    )
    .await;
    assert_eq!(removed.0, StatusCode::OK);
    assert_eq!(removed.1["etag"], "\"3\"");
    assert!(removed.2["data"].is_null());
    assert_eq!(removed.2["status"], "not_configured");
    assert!(sqlx::query_scalar::<_, bool>("SELECT ciphertext IS NULL AND nonce IS NULL AND metadata IS NULL AND encryption_key_id IS NULL FROM fiscal_a1_certificates WHERE tenant_id=$1::uuid").bind(TENANT).fetch_one(&admin).await.unwrap());
    assert_eq!(
        call(
            &router,
            "PUT",
            Some("editor"),
            TENANT,
            Some("\"0\""),
            Some(input.clone())
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let restored = call(
        &router,
        "PUT",
        Some("editor"),
        TENANT,
        Some("\"3\""),
        Some(input),
    )
    .await;
    assert_eq!(restored.0, StatusCode::OK);
    assert_eq!(restored.1["etag"], "\"4\"");
    sqlx::query("UPDATE tenants SET tax_id='19131243000197' WHERE id=$1::uuid")
        .bind(TENANT)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(&router, "GET", Some("editor"), TENANT, None, None)
            .await
            .2["status"],
        "company_mismatch"
    );
    drop(router);
    cleanup(&admin, application, auth, &role).await;
}
