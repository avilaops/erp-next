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

fn payload(name: &str) -> Value {
    json!({
        "name": name,
        "widthMm": 100,
        "heightMm": 50,
        "source": "product",
        "elements": [
            {"kind":"text","field":"name","label":"Produto","xMm":2,"yMm":2,"widthMm":96,"heightMm":12,"fontSizePt":12},
            {"kind":"barcode","field":"code","label":"","xMm":2,"yMm":18,"widthMm":96,"heightMm":28,"fontSizePt":10}
        ]
    })
}

#[sqlx::test(migrations = "../../migrations")]
async fn label_templates_are_authorized_tenant_scoped_validated_and_revisioned(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql(&format!("GRANT USAGE ON SCHEMA system_config TO {role}; GRANT SELECT,INSERT,UPDATE ON system_config.label_templates TO {role};"))
        .execute(&admin).await.unwrap();
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES ('99999999-9999-4999-8999-999999999999','system.labels.manage');")
        .execute(&admin).await.unwrap();

    assert_eq!(
        call(
            &router,
            "GET",
            "reader",
            TENANT,
            "/api/v1/system/label-templates",
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, created) = call(
        &router,
        "POST",
        "editor",
        TENANT,
        "/api/v1/system/label-templates",
        None,
        payload("Etiqueta de produto"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["data"]["layout"]["source"], "product");
    let id = created["data"]["id"].as_str().unwrap();

    let invalid = json!({"name":"Inválida","widthMm":50,"heightMm":30,"source":"product","elements":[{"kind":"text","field":"document","label":"","xMm":0,"yMm":0,"widthMm":10,"heightMm":10,"fontSizePt":10}]});
    assert_eq!(
        call(
            &router,
            "POST",
            "editor",
            TENANT,
            "/api/v1/system/label-templates",
            None,
            invalid
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "editor",
            OTHER,
            "/api/v1/system/label-templates",
            None,
            payload("Outro tenant")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            TENANT,
            &format!("/api/v1/system/label-templates/{id}"),
            None,
            payload("Atualizada")
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
        &format!("/api/v1/system/label-templates/{id}"),
        Some("\"1\""),
        payload("Atualizada"),
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
            &format!("/api/v1/system/label-templates/{id}"),
            Some("\"1\""),
            payload("Conflito")
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
