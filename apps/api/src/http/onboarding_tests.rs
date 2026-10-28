use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

async fn call(
    router: &Router,
    method: &str,
    subject: &str,
    key: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri("/api/v1/companies")
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(key) = key {
        request = request.header("idempotency-key", key);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn company_discovery_requires_auth_and_only_returns_active_memberships(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    assert_eq!(
        call(&router, "GET", "", None, Value::Null).await.0,
        StatusCode::UNAUTHORIZED
    );
    let (status, body) = call(&router, "GET", "reader", None, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(
        body["data"][0]["id"],
        "11111111-1111-4111-8111-111111111111"
    );
    let (status, body) = call(&router, "GET", "disabled", None, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"], json!([]));
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

fn company() -> Value {
    json!({"legalName":"Nova empresa","personType":"juridica","taxId":"12ABC34501DE35",
        "taxRegime":"simples","segments":["Serviços"],"postalCode":"01001000",
        "state":"SP","city":"São Paulo","street":"Praça","number":"1","district":"Centro"})
}

#[sqlx::test(migrations = "../../migrations")]
async fn creates_company_atomically_and_retries_without_duplicate_effects(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    let (status, initial) = call(&router, "GET", "new-owner", None, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    // Matching email does not inherit the existing reader's membership.
    assert_eq!(initial["data"], json!([]));
    let key = "aaaaaaaa-1111-4111-8111-111111111111";
    assert_eq!(
        call(&router, "POST", "new-owner", None, company()).await.0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(&router, "POST", "new-owner", Some("bad"), company())
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(&router, "POST", "new-owner", Some(key), json!({}))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let ((status, result), (retry_status, retry)) = tokio::join!(
        call(&router, "POST", "new-owner", Some(key), company()),
        call(&router, "POST", "new-owner", Some(key), company())
    );
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(retry_status, StatusCode::CREATED);
    assert_eq!(result, retry);
    let tenant = result["tenantId"].as_str().unwrap();
    let mut changed = company();
    changed["legalName"] = json!("Outra");
    assert_eq!(
        call(&router, "POST", "new-owner", Some(key), changed)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&router, "POST", "editor", Some(key), company())
            .await
            .0,
        StatusCode::CONFLICT
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tenants WHERE id = $1::uuid")
        .bind(tenant)
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(count, 1);
    for table in [
        "audit_log",
        "outbox_events",
        "company_profiles",
        "tenant_memberships",
        "roles",
    ] {
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM {table} WHERE tenant_id = $1::uuid"
        ))
        .bind(tenant)
        .fetch_one(&admin)
        .await
        .unwrap();
        assert_eq!(count, 1, "{table}");
    }
    let request = Request::builder()
        .uri("/api/v1/me")
        .header("authorization", "Bearer new-owner")
        .header("x-tenant-id", tenant)
        .body(Body::empty())
        .unwrap();
    let response = router.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let access: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 100_000).await.unwrap()).unwrap();
    assert_eq!(access["roles"], json!(["admin"]));
    assert!(
        access["permissions"]
            .as_array()
            .unwrap()
            .contains(&json!("platform.company.manage"))
    );
    let request = Request::builder()
        .uri("/api/v1/me")
        .header("authorization", "Bearer editor")
        .header("x-tenant-id", tenant)
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router.clone().oneshot(request).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    // No identity context survives the transaction on pooled connections.
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tenants")
        .fetch_one(&application)
        .await
        .unwrap();
    assert_eq!(count, 0);
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn onboarding_rolls_back_all_writes_when_an_effect_fails(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql("CREATE FUNCTION refuse_company_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END; $$; CREATE TRIGGER refuse_company_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION refuse_company_event();")
        .execute(&admin).await.unwrap();
    let key = "aaaaaaaa-1111-4111-8111-111111111111";
    assert_eq!(
        call(&router, "POST", "reader", Some(key), company())
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM tenants WHERE tax_id = '12ABC34501DE35'")
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(count, 0);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action = 'company.created'")
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(count, 0);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM company_creation_commands")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(count, 0);
    sqlx::query("DROP TRIGGER refuse_company_event ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(&router, "POST", "reader", Some(key), company())
            .await
            .0,
        StatusCode::CREATED
    );
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
