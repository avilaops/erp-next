use super::company_tests::{cleanup, setup};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

async fn request(
    router: &Router,
    path: &str,
    subject: &str,
    tenant: &str,
) -> (StatusCode, Vec<u8>) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .header("authorization", format!("Bearer {subject}"))
                .header("x-tenant-id", tenant)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    (
        status,
        to_bytes(response.into_body(), 1_000_000)
            .await
            .unwrap()
            .to_vec(),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn legacy_history_requires_permission_and_isolates_files(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions VALUES ('99999999-9999-4999-8999-999999999999','platform.legacy.read'); INSERT INTO legacy_history(tenant_id,id,collection,title,details) VALUES ('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000001','orders','Pedido original','{\"discount\":0.1}'),('22222222-2222-4222-8222-222222222222','00000000-0000-4000-8000-000000000002','orders','Outra empresa','{}'); INSERT INTO legacy_files(tenant_id,id,history_id,filename,media_type,content,sha256) VALUES ('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','nota.xml','application/xml',decode('3c612f3e','hex'),'test'),('22222222-2222-4222-8222-222222222222','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','outra.xml','application/xml',decode('3c622f3e','hex'),'test');").execute(&admin).await.unwrap();
    let tenant = "11111111-1111-4111-8111-111111111111";
    assert_eq!(
        request(&router, "/api/v1/legacy-history", "reader", tenant)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status, body) = request(&router, "/api/v1/legacy-history", "editor", tenant).await;
    assert_eq!(status, StatusCode::OK);
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["total"], 1);
    assert_eq!(payload["data"][0]["details"]["discount"], 0.1);
    assert_eq!(
        request(
            &router,
            "/api/v1/legacy-history/files/00000000-0000-4000-8000-000000000004",
            "editor",
            tenant
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (status, bytes) = request(
        &router,
        "/api/v1/legacy-history/files/00000000-0000-4000-8000-000000000003",
        "editor",
        tenant,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, b"<a/>");
    assert_eq!(
        request(
            &router,
            "/api/v1/legacy-history?offset=-1",
            "editor",
            tenant
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert!(
        sqlx::query("DELETE FROM legacy_history")
            .execute(&admin)
            .await
            .is_err()
    );
    cleanup(&admin, app, server, &role).await;
}
