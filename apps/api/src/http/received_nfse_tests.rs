use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use sqlx::PgPool;
use tower::ServiceExt;

use super::company_tests::{cleanup, setup};

#[sqlx::test(migrations = "../../migrations")]
async fn received_nfse_import_requires_explicit_permission(admin: PgPool) {
    let (router, application, auth, role) = setup(&admin).await;
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/fiscal/received-nfses/import")
        .header("authorization", "Bearer editor")
        .header("x-tenant-id", "11111111-1111-4111-8111-111111111111")
        .header("content-type", "application/json")
        .header("idempotency-key", "019a4a82-7ad5-7aff-8afb-d014ef8bc532")
        .body(Body::from(r#"{"xml":"<NFSe/>"}"#))
        .unwrap();
    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    cleanup(&admin, application, auth, &role).await;
}
