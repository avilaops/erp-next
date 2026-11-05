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
        serde_json::from_slice(&to_bytes(response.into_body(), 200_000).await.unwrap()).unwrap();
    (status, value)
}

fn payload(name: &str) -> Value {
    json!({
        "code":"approval_flow","version":1,"name":name,
        "states":[
            {"code":"draft","label":"Rascunho","isInitial":true,"isTerminal":false},
            {"code":"approved","label":"Aprovado","isInitial":false,"isTerminal":true}
        ],
        "transitions":[{"fromState":"draft","toState":"approved","permissionCode":"system.workflows.manage","requiresReason":true}]
    })
}

#[sqlx::test(migrations = "../../migrations")]
async fn workflows_are_tenant_scoped_revisioned_validated_published_and_archived(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql(&format!("GRANT USAGE ON SCHEMA system_config TO {role}; GRANT SELECT,INSERT,UPDATE,DELETE ON system_config.workflow_definitions,system_config.workflow_states,system_config.workflow_transitions TO {role};" )).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','system.workflows.manage')").execute(&admin).await.unwrap();

    assert_eq!(
        call(
            &router,
            "GET",
            "reader",
            TENANT,
            "/api/v1/system/workflows",
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
        "/api/v1/system/workflows",
        None,
        payload("Aprovação"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["data"]["revision"], 1);
    assert_eq!(created["data"]["states"].as_array().unwrap().len(), 2);
    let id = created["data"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            "editor",
            OTHER,
            "/api/v1/system/workflows",
            None,
            payload("Outro")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let invalid = json!({"code":"bad","version":1,"name":"Inválido","states":[{"code":"a","label":"A","isInitial":true,"isTerminal":true},{"code":"b","label":"B","isInitial":false,"isTerminal":false}],"transitions":[{"fromState":"a","toState":"b","permissionCode":"system.workflows.manage"}]});
    assert_eq!(
        call(
            &router,
            "POST",
            "editor",
            TENANT,
            "/api/v1/system/workflows",
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
            "PUT",
            "editor",
            TENANT,
            &format!("/api/v1/system/workflows/{id}"),
            None,
            payload("Atualizado")
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
        &format!("/api/v1/system/workflows/{id}"),
        Some("\"1\""),
        payload("Atualizado"),
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
            &format!("/api/v1/system/workflows/{id}"),
            Some("\"1\""),
            payload("Conflito")
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let (status, published) = call(
        &router,
        "POST",
        "editor",
        TENANT,
        &format!("/api/v1/system/workflows/{id}/publish"),
        Some("\"2\""),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{published}");
    assert_eq!(published["data"]["status"], "published");
    assert_eq!(published["data"]["revision"], 3);
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            TENANT,
            &format!("/api/v1/system/workflows/{id}"),
            Some("\"3\""),
            payload("Imutável")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (status, archived) = call(
        &router,
        "POST",
        "editor",
        TENANT,
        &format!("/api/v1/system/workflows/{id}/archive"),
        Some("\"3\""),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{archived}");
    assert_eq!(archived["data"]["status"], "archived");
    let audit: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE tenant_id=$1::uuid AND entity_id=$2",
    )
    .bind(TENANT)
    .bind(id)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(audit, 4);
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
