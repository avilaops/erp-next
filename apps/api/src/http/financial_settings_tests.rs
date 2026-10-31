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
    tenant: &str,
    etag: Option<&str>,
    value: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri("/api/v1/financial-settings")
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(etag) = etag {
        request = request.header("if-match", etag);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(value.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    (
        status,
        serde_json::from_slice(&to_bytes(response.into_body(), 100000).await.unwrap()).unwrap(),
    )
}
#[sqlx::test(migrations = "../../migrations")]
async fn financial_settings_persist_authorize_isolate_and_rollback_audit_failure(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    let (status, initial) = call(&router, "GET", "reader", TENANT, None, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(initial["canEdit"], false);
    assert_eq!(initial["data"]["defaultPaymentMethod"], "bank_transfer");
    let input = json!({"defaultPaymentMethod":"cash"});
    for (subject, tenant, status) in [
        ("", TENANT, 401),
        ("disabled", TENANT, 403),
        ("reader", TENANT, 403),
        ("editor", "22222222-2222-4222-8222-222222222222", 403),
    ] {
        assert_eq!(
            call(
                &router,
                "PUT",
                subject,
                tenant,
                Some("\"1\""),
                input.clone()
            )
            .await
            .0
            .as_u16(),
            status
        );
    }
    assert_eq!(
        call(&router, "PUT", "editor", TENANT, None, input.clone())
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            TENANT,
            Some("\"1\""),
            json!({"defaultPaymentMethod":"pix"})
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
            Some("\"1\""),
            json!({"defaultPaymentMethod":"cash","tenantId":TENANT})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, saved) = call(
        &router,
        "PUT",
        "editor",
        TENANT,
        Some("\"1\""),
        input.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["revision"], 2);
    assert_eq!(
        call(&router, "GET", "reader", TENANT, None, Value::Null)
            .await
            .1["data"],
        input
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            TENANT,
            Some("\"1\""),
            json!({"defaultPaymentMethod":"other"})
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    sqlx::raw_sql("CREATE FUNCTION fail_settings_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='financial_settings.updated' THEN RAISE EXCEPTION 'isolated audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_settings_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_settings_audit();").execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            TENANT,
            Some("\"2\""),
            json!({"defaultPaymentMethod":"card"})
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        call(&router, "GET", "editor", TENANT, None, Value::Null)
            .await
            .1,
        saved
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='financial_settings.updated'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        1
    );
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind("22222222-2222-4222-8222-222222222222")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM financial_settings")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    tx.rollback().await.unwrap();
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
