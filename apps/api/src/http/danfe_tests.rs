use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;

use super::company_tests::{cleanup, setup_with_danfe};
use crate::domains::fiscal::{
    danfe::FIXTURE,
    danfe_test_support::{KEY, PDF, provider},
};
const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

async fn grant(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES ('99999999-9999-4999-8999-999999999999','fiscal.nfe.read');")
        .execute(admin).await.unwrap();
}
async fn call(
    router: &Router,
    subject: &str,
    tenant: &str,
    body: String,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut request = Request::builder()
        .method("POST")
        .uri("/api/v1/fiscal/danfe")
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    (
        parts.status,
        parts.headers,
        to_bytes(body, 9 * 1024 * 1024).await.unwrap().to_vec(),
    )
}
fn payload() -> String {
    json!({"xml":FIXTURE}).to_string()
}

#[sqlx::test(migrations = "../../migrations")]
async fn danfe_denies_missing_identity_inactive_membership_and_missing_fiscal_rights_before_mcp(
    admin: PgPool,
) {
    let (client, provider_task, calls) = provider("json").await;
    let (router, pool, auth, role) = setup_with_danfe(&admin, Some(client)).await;
    grant(&admin).await;
    for (subject, tenant, expected) in [
        ("", TENANT, StatusCode::UNAUTHORIZED),
        ("invalid", TENANT, StatusCode::UNAUTHORIZED),
        ("disabled", TENANT, StatusCode::FORBIDDEN),
        ("reader", TENANT, StatusCode::FORBIDDEN),
        ("editor", OTHER, StatusCode::FORBIDDEN),
    ] {
        let (status, headers, body) = call(&router, subject, tenant, payload()).await;
        assert_eq!(status, expected);
        assert_eq!(headers["cache-control"], "no-store");
        assert!(!String::from_utf8_lossy(&body).contains("EMITENTE DE TESTE"));
    }
    assert!(calls.lock().unwrap().is_empty());
    provider_task.abort();
    drop(router);
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn danfe_checks_document_company_even_when_the_operator_has_access_to_both_tenants(
    admin: PgPool,
) {
    let (client, provider_task, calls) = provider("json").await;
    let (router, pool, auth, role) = setup_with_danfe(&admin, Some(client)).await;
    grant(&admin).await;
    sqlx::raw_sql("INSERT INTO tenant_memberships(id,tenant_id,identity_id,status) VALUES ('12345678-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','active'); INSERT INTO roles(id,tenant_id,code,name) VALUES ('12345678-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','fiscal','Fiscal'); INSERT INTO role_permissions(role_id,permission_code) VALUES ('12345678-2222-4222-8222-222222222222','fiscal.nfe.read'); INSERT INTO membership_roles(membership_id,role_id) VALUES ('12345678-1111-4111-8111-111111111111','12345678-2222-4222-8222-222222222222');")
        .execute(&admin).await.unwrap();
    let (status, _, _) = call(&router, "editor", OTHER, payload()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for body in [
        json!({"xml":"<resNFe/>"}).to_string(),
        json!({"xml":FIXTURE,"extra":true}).to_string(),
    ] {
        assert_eq!(
            call(&router, "editor", TENANT, body).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(
        call(
            &router,
            "editor",
            TENANT,
            json!({"xml":"x".repeat(1024 * 1024 + 1)}).to_string()
        )
        .await
        .0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert!(calls.lock().unwrap().is_empty());
    provider_task.abort();
    drop(router);
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn danfe_returns_binary_pdf_with_hashes_without_creating_or_issuing_an_invoice(
    admin: PgPool,
) {
    let (client, provider_task, calls) = provider("json").await;
    let (router, pool, auth, role) = setup_with_danfe(&admin, Some(client)).await;
    grant(&admin).await;
    let (status, headers, body) = call(&router, "editor", TENANT, payload()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["content-type"], "application/pdf");
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(
        headers["content-disposition"],
        format!("attachment; filename=\"DANFE-{KEY}.pdf\"")
    );
    assert_eq!(
        headers["x-xml-sha256"],
        format!("{:x}", Sha256::digest(FIXTURE.as_bytes()))
    );
    assert_eq!(
        headers["x-pdf-sha256"],
        format!("{:x}", Sha256::digest(&body))
    );
    assert_eq!(headers["x-nfe-authorization-check"], "xml-protocol-only");
    assert_eq!(body, STANDARD.decode(PDF.trim()).unwrap());
    assert_eq!(
        calls.lock().unwrap().last().map(String::as_str),
        Some("DELETE")
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_nfe_drafts")
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
        0
    );
    provider_task.abort();
    drop(router);
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn danfe_unconfigured_service_is_not_a_successful_pdf_response(admin: PgPool) {
    let (router, pool, auth, role) = setup_with_danfe(&admin, None).await;
    grant(&admin).await;
    assert_eq!(
        call(&router, "editor", TENANT, payload()).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    drop(router);
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn danfe_signature_refusal_stops_before_pdf_generation(admin: PgPool) {
    let (client, provider_task, calls) = provider("signature-invalid").await;
    let (router, pool, auth, role) = setup_with_danfe(&admin, Some(client)).await;
    grant(&admin).await;
    let (status, headers, body) = call(&router, "editor", TENANT, payload()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(headers["content-type"], "application/problem+json");
    assert!(!String::from_utf8_lossy(&body).contains("EMITENTE DE TESTE"));
    assert!(
        !calls
            .lock()
            .unwrap()
            .contains(&"fiscal_gerar_danfe".to_owned())
    );
    provider_task.abort();
    drop(router);
    cleanup(&admin, pool, auth, &role).await;
}
