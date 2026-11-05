use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

use crate::platform::{auth::AuthClient, state::AppState};

#[tokio::test]
async fn registry_lookup_requires_authentication_before_any_provider_request() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@127.0.0.1:1/unused")
        .unwrap();
    let state = AppState::new(pool, AuthClient::new("http://127.0.0.1:1/userinfo".into()));
    let response = super::router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/registry-lookups")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"kind":"cep","value":"01001000","context":"company"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "../../migrations")]
async fn registration_lookup_authenticates_without_requiring_a_company(admin: sqlx::PgPool) {
    use super::company_tests::{cleanup, setup};
    use serde_json::json;
    let (router, application, server, role) = setup(&admin).await;
    for (subject, value, expected) in [
        ("", "04252011000110", StatusCode::UNAUTHORIZED),
        ("new-owner", "52998224725", StatusCode::UNPROCESSABLE_ENTITY),
        ("new-owner", "04252011000110", StatusCode::CONFLICT),
    ] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/v1/company-registration/lookup")
            .header("content-type", "application/json");
        if !subject.is_empty() {
            request = request.header("authorization", format!("Bearer {subject}"));
        }
        let response = router
            .clone()
            .oneshot(
                request
                    .body(Body::from(json!({"value":value}).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        // A valid identity reaches the disabled-provider response without tenant membership.
        assert_eq!(response.status(), expected);
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tenants")
            .fetch_one(&admin)
            .await
            .unwrap(),
        2
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn registry_context_permissions_and_tenant_membership_are_enforced(admin: sqlx::PgPool) {
    use super::company_tests::{cleanup, setup};
    use serde_json::{Value, json};
    let (router, application, server, role) = setup(&admin).await;
    let body = json!({"kind":"cep","value":"01001000","context":"company"});
    let call = |tenant: &str, subject: &str, body: Value| {
        let request = Request::builder()
            .method("POST")
            .uri("/api/v1/registry-lookups")
            .header("content-type", "application/json")
            .header("x-tenant-id", tenant)
            .header("authorization", format!("Bearer {subject}"))
            .body(Body::from(body.to_string()))
            .unwrap();
        let router = router.clone();
        async move { router.oneshot(request).await.unwrap().status() }
    };
    const TENANT: &str = "11111111-1111-4111-8111-111111111111";
    assert_eq!(
        call(
            "22222222-2222-4222-8222-222222222222",
            "editor",
            body.clone()
        )
        .await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(TENANT, "disabled", body.clone()).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            TENANT,
            "reader",
            json!({"kind":"cep","value":"01001000","context":"party"})
        )
        .await,
        StatusCode::FORBIDDEN
    );
    // The existing read permission is enough for a read-only lookup, but this test state has no provider.
    assert_eq!(call(TENANT, "reader", body).await, StatusCode::CONFLICT);
    assert_eq!(
        call(
            TENANT,
            "editor",
            json!({"kind":"cnpj","value":"52998224725","context":"company"})
        )
        .await,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    cleanup(&admin, application, server, &role).await;
}
