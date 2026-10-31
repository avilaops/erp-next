use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

async fn call(router: &Router, subject: &str, tenant: &str, query: &str) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .uri(format!("/api/v1/audit{query}"))
        .header("x-tenant-id", tenant);
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    assert_eq!(response.headers()["cache-control"], "no-store");
    (
        status,
        serde_json::from_slice(&to_bytes(response.into_body(), 100000).await.unwrap()).unwrap(),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn audit_is_authorized_tenant_scoped_filtered_paginated_and_redacted(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql(r#"
      INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','platform.audit.read');
      INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,entity_id,request_id,occurred_at,details)
      SELECT '11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',
        'company.updated','company','PRIVATE-ENTITY','PRIVATE-REQUEST','2026-10-30T12:00:00Z','{"secret":"PRIVATE-DETAILS"}' FROM generate_series(1,26);
      INSERT INTO audit_log(tenant_id,action,entity_type,occurred_at) VALUES
        ('11111111-1111-4111-8111-111111111111','preferences.updated','personal_preferences','2026-10-31T23:59:59.999999Z'),
        ('22222222-2222-4222-8222-222222222222','OTHER-TENANT','company','2026-10-31T12:00:00Z');
    "#).execute(&admin).await.unwrap();
    for (subject, tenant, status) in [
        ("", TENANT, 401),
        ("reader", TENANT, 403),
        ("disabled", TENANT, 403),
        ("editor", OTHER, 403),
    ] {
        assert_eq!(call(&router, subject, tenant, "").await.0.as_u16(), status);
    }
    let (status, first) = call(&router, "editor", TENANT, "").await;
    assert_eq!(status, StatusCode::OK);
    let rows = first["data"].as_array().unwrap();
    assert_eq!(rows.len(), 25);
    assert_eq!(rows[0]["action"], "preferences.updated");
    assert!(rows[0]["actor"].is_null());
    assert!(!first.to_string().contains("PRIVATE"));
    assert!(!first.to_string().contains("OTHER-TENANT"));
    assert_eq!(rows[1].as_object().unwrap().len(), 5);
    let cursor = first["nextCursor"].as_str().unwrap();
    let (_, next) = call(&router, "editor", TENANT, &format!("?before={cursor}")).await;
    assert_eq!(next["data"].as_array().unwrap().len(), 2);
    assert!(next["nextCursor"].is_null());
    for row in next["data"].as_array().unwrap() {
        assert!(!rows.iter().any(|r| r["id"] == row["id"]));
    }
    for (query, count) in [
        ("?action=preferences.updated", 1),
        ("?entity=personal_preferences", 1),
        ("?q=EDITOR", 26),
        ("?startDate=2026-10-31&endDate=2026-10-31", 1),
        ("?q=%25", 0),
    ] {
        let (status, result) = call(&router, "editor", TENANT, query).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result["data"].as_array().unwrap().len(), count.min(25));
    }
    for query in [
        "?startDate=invalid",
        "?startDate=2026-11-01&endDate=2026-10-30",
        "?before=00000000-0000-4000-8000-000000000000",
        "?details=true",
        "?before=invalid",
    ] {
        assert_eq!(
            call(&router, "editor", TENANT, query).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let other_id: uuid::Uuid =
        sqlx::query_scalar("SELECT id FROM audit_log WHERE tenant_id=$1::uuid")
            .bind(OTHER)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(
        call(&router, "editor", TENANT, &format!("?before={other_id}"))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        28
    );
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
