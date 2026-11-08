//! Isolated SQLx test databases only; provider responses are synthetic validation doubles.
use super::company_tests::{cleanup, setup_with_danfe};
use crate::domains::fiscal::{danfe::FIXTURE, danfe_test_support::provider};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT: &str = "22222222-2222-4222-8222-222222222222";
async fn request(
    router: &Router,
    method: &str,
    uri: &str,
    bearer: Option<&str>,
    tenant: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = bearer {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if let Some(tenant) = tenant {
        builder = builder.header("x-tenant-id", tenant);
    }
    let payload = match body {
        Some(value) => {
            builder = builder.header("content-type", "application/json");
            Body::from(value.to_string())
        }
        None => Body::empty(),
    };
    let response = router
        .clone()
        .oneshot(builder.body(payload).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    (
        parts.status,
        parts.headers,
        to_bytes(body, 9 * 1024 * 1024).await.unwrap().to_vec(),
    )
}

fn json_body(body: &[u8]) -> Value {
    serde_json::from_slice(body).unwrap()
}

async fn grant(admin: &PgPool) {
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('fiscal.nfe.read','fiscal.nfe.manage') ON CONFLICT DO NOTHING")
        .execute(admin).await.unwrap();
}
async fn counts(admin: &PgPool) -> (i64, i64, i64, i64, i64) {
    sqlx::query_as("SELECT (SELECT count(*) FROM stock_movements),(SELECT count(*) FROM receivables),(SELECT count(*) FROM payables),(SELECT count(*) FROM fiscal_nfe_documents),(SELECT count(*) FROM outbox_events)")
        .fetch_one(admin).await.unwrap()
}
async fn import(router: &Router, xml: &str) -> (StatusCode, HeaderMap, Vec<u8>) {
    request(
        router,
        "POST",
        "/api/v1/fiscal/outgoing-imports/import",
        Some("editor"),
        Some(TENANT),
        Some(json!({"xml":xml})),
    )
    .await
}

#[sqlx::test(migrations = "../../migrations")]
async fn outbound_archive_is_tenant_bound_idempotent_and_has_no_operational_effects(admin: PgPool) {
    let (client, provider_task, _) = provider("structured").await;
    let (router, application, auth, role) = setup_with_danfe(&admin, Some(client)).await;
    grant(&admin).await;
    let before = counts(&admin).await;
    sqlx::query("UPDATE tenants SET tax_id='19131243000197' WHERE id=$1::uuid")
        .bind(TENANT)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(import(&router, FIXTURE).await.0, StatusCode::FORBIDDEN);
    sqlx::query("UPDATE tenants SET tax_id='04252011000110' WHERE id=$1::uuid")
        .bind(TENANT)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        import(
            &router,
            &FIXTURE.replace("<tpNF>1</tpNF>", "<tpNF>0</tpNF>")
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (first, concurrent) = tokio::join!(import(&router, FIXTURE), import(&router, FIXTURE));
    assert!(
        (first.0 == StatusCode::CREATED && concurrent.0 == StatusCode::OK)
            || (concurrent.0 == StatusCode::CREATED && first.0 == StatusCode::OK)
    );
    let saved = json_body(&first.2);
    let id = saved["id"].as_i64().unwrap();
    assert_eq!(
        saved["recipientName"],
        "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"
    );
    let replay = import(&router, FIXTURE).await;
    assert_eq!(replay.0, StatusCode::OK);
    assert_eq!(replay.1["idempotency-replayed"], "true");
    assert_eq!(json_body(&replay.2)["id"], id);
    assert_eq!(
        import(&router, &format!("{FIXTURE}\n")).await.0,
        StatusCode::CONFLICT
    );
    let downloaded = request(
        &router,
        "GET",
        &format!("/api/v1/fiscal/outgoing-imports/{id}/xml"),
        Some("editor"),
        Some(TENANT),
        None,
    )
    .await;
    assert_eq!(downloaded.0, StatusCode::OK);
    assert_eq!(downloaded.2, FIXTURE.as_bytes());
    let listing = request(
        &router,
        "GET",
        "/api/v1/fiscal/outgoing-imports?q=HOMOLOGACAO&from=2026-10-27&to=2026-10-27",
        Some("editor"),
        Some(TENANT),
        None,
    )
    .await;
    assert_eq!(listing.0, StatusCode::OK);
    assert_eq!(json_body(&listing.2)["total"], 1);
    assert_eq!(
        request(
            &router,
            "GET",
            &format!("/api/v1/fiscal/outgoing-imports/{id}"),
            Some("editor"),
            Some(OTHER_TENANT),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut isolated = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(OTHER_TENANT)
        .execute(&mut *isolated)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_outgoing_imports")
            .fetch_one(&mut *isolated)
            .await
            .unwrap(),
        0
    );
    isolated.commit().await.unwrap();
    assert_eq!(counts(&admin).await, before);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='fiscal.outgoing_import.imported'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        1
    );
    assert!(
        sqlx::query("DELETE FROM fiscal_outgoing_imports WHERE id=$1")
            .bind(id)
            .execute(&admin)
            .await
            .is_err()
    );
    provider_task.abort();
    drop(router);
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn invalid_signature_never_persists_an_outbound_archive(admin: PgPool) {
    let (client, provider_task, calls) = provider("signature-invalid").await;
    let (router, application, auth, role) = setup_with_danfe(&admin, Some(client)).await;
    grant(&admin).await;
    let before = counts(&admin).await;
    assert_eq!(
        import(&router, FIXTURE).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_outgoing_imports")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert!(
        calls
            .lock()
            .unwrap()
            .iter()
            .any(|n| n == "fiscal_validar_assinatura_nfe")
    );
    assert_eq!(counts(&admin).await, before);
    provider_task.abort();
    drop(router);
    cleanup(&admin, application, auth, &role).await;
}
