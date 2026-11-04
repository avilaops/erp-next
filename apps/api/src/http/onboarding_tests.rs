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
    assert_eq!(
        call(&router, "POST", "", None, company()).await.0,
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
    sqlx::query(
        "UPDATE tenants SET status = 'suspended' WHERE id = '11111111-1111-4111-8111-111111111111'",
    )
    .execute(&admin)
    .await
    .unwrap();
    let (status, body) = call(&router, "GET", "reader", None, Value::Null).await;
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
async fn platform_administrator_directory_selection_revocation_and_isolation(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    sqlx::query("INSERT INTO platform_administrators(auth_subject,granted_by,reason) VALUES ('reader','test-operator','Authorized platform administration')")
        .execute(&admin).await.unwrap();
    let (status, body) = call(&router, "GET", "reader", None, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["platformAdministrator"], true);
    assert_eq!(body["data"].as_array().unwrap().len(), 2);
    // Same email as reader, different verified subject: no platform authority.
    let (_, outsider) = call(&router, "GET", "new-owner", None, Value::Null).await;
    assert_eq!(outsider["platformAdministrator"], false);
    assert_eq!(outsider["data"], json!([]));

    let other = "22222222-2222-4222-8222-222222222222";
    let selection = |subject: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/company-selection")
            .header("authorization", format!("Bearer {subject}"))
            .header("x-tenant-id", other)
            .body(Body::empty())
            .unwrap()
    };
    assert_eq!(
        router
            .clone()
            .oneshot(selection("editor"))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        router
            .clone()
            .oneshot(selection("reader"))
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT
    );
    let audits: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE tenant_id=$1::uuid AND action='platform.tenant.selected' AND identity_id='44444444-4444-4444-8444-444444444444' AND details->>'platformAdministrator'='true'")
        .bind(other).fetch_one(&admin).await.unwrap();
    assert_eq!(audits, 1);

    // Even the platform administrator's data transaction sees only its selected tenant.
    let mut tx = application.begin().await.unwrap();
    sqlx::query(
        "SELECT set_config('app.auth_subject','reader',true),set_config('app.tenant_id',$1,true)",
    )
    .bind(other)
    .execute(&mut *tx)
    .await
    .unwrap();
    let visible: Vec<uuid::Uuid> = sqlx::query_scalar("SELECT id FROM tenants")
        .fetch_all(&mut *tx)
        .await
        .unwrap();
    assert_eq!(visible, vec![uuid::Uuid::parse_str(other).unwrap()]);
    let memberships: i64 = sqlx::query_scalar("SELECT count(*) FROM tenant_memberships")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(memberships, 0);
    tx.rollback().await.unwrap();

    // The test runtime has table DML grants, but cannot create a platform grant.
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.auth_subject','editor',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    let denied = sqlx::query("INSERT INTO platform_administrators(auth_subject,granted_by,reason) VALUES ('editor','self','escalation')")
        .execute(&mut *tx).await.unwrap_err();
    assert_eq!(
        denied.as_database_error().unwrap().code().as_deref(),
        Some("42501")
    );
    tx.rollback().await.unwrap();

    sqlx::query("UPDATE tenants SET status='suspended' WHERE id=$1::uuid")
        .bind(other)
        .execute(&admin)
        .await
        .unwrap();
    let (_, directory) = call(&router, "GET", "reader", None, Value::Null).await;
    assert_eq!(directory["data"].as_array().unwrap().len(), 2);
    assert!(
        directory["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["status"] == "suspended")
    );
    assert_eq!(
        router
            .clone()
            .oneshot(selection("reader"))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE tenants SET status='active' WHERE id=$1::uuid")
        .bind(other)
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query("UPDATE platform_administrators SET active=false WHERE auth_subject='reader'")
        .execute(&admin)
        .await
        .unwrap();
    let (_, revoked) = call(&router, "GET", "reader", None, Value::Null).await;
    assert_eq!(revoked["platformAdministrator"], false);
    assert_eq!(revoked["data"].as_array().unwrap().len(), 1);
    assert_eq!(
        router
            .clone()
            .oneshot(selection("reader"))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let audits_after: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action='platform.tenant.selected'",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(audits_after, 1);
    super::company_tests::cleanup(&admin, application, server, &role).await;
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
        !access["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|permission| matches!(
                permission.as_str(),
                Some(
                    "fiscal.cte.read"
                        | "fiscal.cte.query"
                        | "fiscal.cte.inspect"
                        | "fiscal.cte.link"
                        | "fiscal.nfse.read"
                        | "fiscal.nfse.import"
                )
            ))
    );
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
    let mut other_company = company();
    other_company["personType"] = json!("fisica");
    other_company["taxId"] = json!("11144477735");
    let (status, other) = call(&router, "POST", "editor", Some(key), other_company).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_ne!(other["tenantId"], result["tenantId"]);
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
