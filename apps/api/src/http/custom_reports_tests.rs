use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";

async fn call(
    router: &Router,
    method: &str,
    subject: &str,
    path: &str,
    etag: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(value) = etag {
        request = request.header("if-match", value);
    }
    let response = router
        .clone()
        .oneshot(
            request
                .body(Body::from(if body.is_null() {
                    String::new()
                } else {
                    body.to_string()
                }))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let value =
        serde_json::from_slice(&to_bytes(response.into_body(), 100_000).await.unwrap()).unwrap();
    (status, value)
}

#[sqlx::test(migrations = "../../migrations")]
async fn custom_reports_are_declarative_authorized_scoped_and_revisioned(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql(&format!("GRANT USAGE ON SCHEMA system_config TO {role}; GRANT EXECUTE ON FUNCTION system_config.has_permission(text) TO {role}; GRANT SELECT,INSERT,UPDATE ON system_config.report_definitions TO {role};"))
        .execute(&admin).await.unwrap();
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES ('99999999-9999-4999-8999-999999999999','system.reports.read'),('99999999-9999-4999-8999-999999999999','system.reports.manage'),('99999999-9999-4999-8999-999999999999','catalog.products.read') ON CONFLICT DO NOTHING;").execute(&admin).await.unwrap();

    assert_eq!(
        call(
            &router,
            "GET",
            "reader",
            "/api/v1/system/custom-reports",
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let invalid = json!({"name":"Produtos","dataset":"products","columns":["name","raw_sql"],"filters":{},"visibility":"private"});
    assert_eq!(
        call(
            &router,
            "POST",
            "editor",
            "/api/v1/system/custom-reports",
            None,
            invalid
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let payload = json!({"name":"Produtos ativos","dataset":"products","columns":["name","code"],"filters":{"status":"active"},"visibility":"private"});
    let (status, created) = call(
        &router,
        "POST",
        "editor",
        "/api/v1/system/custom-reports",
        None,
        payload,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["data"]["columns"], json!(["name", "code"]));
    let id = created["data"]["id"].as_str().unwrap();

    let update = json!({"name":"Produtos da empresa","dataset":"products","columns":["code","name","status"],"filters":{},"visibility":"tenant"});
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            &format!("/api/v1/system/custom-reports/{id}"),
            None,
            update.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let (status, updated) = call(
        &router,
        "PUT",
        "editor",
        &format!("/api/v1/system/custom-reports/{id}"),
        Some("\"1\""),
        update.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["data"]["revision"], 2);
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            &format!("/api/v1/system/custom-reports/{id}"),
            Some("\"1\""),
            update
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );

    let audit: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE tenant_id=$1::uuid AND entity_id=$2",
    )
    .bind(TENANT)
    .bind(id)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(audit, 2);
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
