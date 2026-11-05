use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

async fn call(
    router: &Router,
    method: &str,
    subject: &str,
    tenant: &str,
    path: &str,
    etag: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-tenant-id", tenant)
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
async fn custom_fields_are_authorized_tenant_scoped_validated_and_revisioned(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql(&format!("GRANT USAGE ON SCHEMA system_config TO {role}; GRANT SELECT,INSERT,UPDATE ON system_config.custom_fields TO {role};"))
        .execute(&admin).await.unwrap();
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES ('99999999-9999-4999-8999-999999999999','system.custom_fields.read'),('99999999-9999-4999-8999-999999999999','system.custom_fields.manage');").execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "GET",
            "reader",
            TENANT,
            "/api/v1/system/custom-fields",
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let payload = json!({"entityType":"product","code":"internal_reference","label":"Referência interna","valueType":"choice","required":false,"choices":["B","A"],"status":"active"});
    let (status, created) = call(
        &router,
        "POST",
        "editor",
        TENANT,
        "/api/v1/system/custom-fields",
        None,
        payload.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["data"]["choices"], json!(["A", "B"]));
    let id = created["data"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            "editor",
            TENANT,
            "/api/v1/system/custom-fields",
            None,
            payload
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "GET",
            "editor",
            OTHER,
            "/api/v1/system/custom-fields",
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let update = json!({"entityType":"product","code":"internal_reference","label":"Referência interna do produto","valueType":"choice","required":true,"choices":["A","B"],"status":"active"});
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            TENANT,
            &format!("/api/v1/system/custom-fields/{id}"),
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
        TENANT,
        &format!("/api/v1/system/custom-fields/{id}"),
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
            TENANT,
            &format!("/api/v1/system/custom-fields/{id}"),
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
