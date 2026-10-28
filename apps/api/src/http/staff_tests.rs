use super::company_tests::{cleanup, setup};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

fn input() -> Value {
    json!({"code":" eq-001 ","name":" Maria ","jobTitle":"Comercial","email":"maria@example.test","phone":null,"isEmployee":true,"isSeller":true,"status":"active"})
}

async fn permissions(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'catalog.staff.%'; INSERT INTO role_permissions(role_id,permission_code) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,code FROM permissions WHERE code='catalog.staff.read';").execute(admin).await.unwrap();
}

#[expect(
    clippy::too_many_arguments,
    reason = "HTTP isolation tests keep tenant, identity and preconditions explicit"
)]
async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    tenant: &str,
    subject: &str,
    etag: Option<&str>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(value) = etag {
        request = request.header("if-match", value);
    }
    if let Some(value) = key {
        request = request.header("idempotency-key", value.to_string());
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    let bytes = to_bytes(body, 1_000_000).await.unwrap();
    (
        parts.status,
        parts.headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn staff_roundtrip_functions_archive_reactivation_and_revisions(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    permissions(&admin).await;
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/staff",
            TENANT,
            "",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let key = Uuid::now_v7();
    let (status, _, created) = call(
        &router,
        "POST",
        "/api/v1/staff",
        TENANT,
        "editor",
        None,
        Some(key),
        input(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["data"]["code"], "EQ-001");
    assert_eq!(created["data"]["name"], "Maria");
    let uri = format!("/api/v1/staff/{}", created["data"]["id"].as_str().unwrap());
    let repeated = call(
        &router,
        "POST",
        "/api/v1/staff",
        TENANT,
        "editor",
        None,
        Some(key),
        input(),
    )
    .await;
    assert_eq!(repeated.0, StatusCode::CREATED);
    assert_eq!(repeated.2, created);
    for function in ["employee", "seller"] {
        let (_, _, listed) = call(
            &router,
            "GET",
            &format!("/api/v1/staff?role={function}&q=EQ-001&limit=1"),
            TENANT,
            "reader",
            None,
            None,
            Value::Null,
        )
        .await;
        assert_eq!(listed["total"], 1);
        assert_eq!(listed["data"][0]["id"], created["data"]["id"]);
    }
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "reader",
            Some("\"1\""),
            None,
            input()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "GET",
            &uri,
            OTHER,
            "editor",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut changed = input();
    changed["status"] = json!("archived");
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            Some("\"1\""),
            None,
            changed.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/staff",
            TENANT,
            "editor",
            None,
            Some(Uuid::now_v7()),
            input()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            Some("\"1\""),
            None,
            input()
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let (status, headers, restored) = call(
        &router,
        "PUT",
        &uri,
        TENANT,
        "editor",
        Some("\"2\""),
        None,
        input(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["etag"], "\"3\"");
    assert_eq!(
        call(
            &router,
            "GET",
            &uri,
            TENANT,
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .2["data"],
        restored["data"]
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn staff_concurrent_commands_and_edits_are_isolated_and_atomic(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    permissions(&admin).await;
    let key = Uuid::now_v7();
    let (first, second) = tokio::join!(
        call(
            &router,
            "POST",
            "/api/v1/staff",
            TENANT,
            "editor",
            None,
            Some(key),
            input()
        ),
        call(
            &router,
            "POST",
            "/api/v1/staff",
            TENANT,
            "editor",
            None,
            Some(key),
            input()
        )
    );
    assert_eq!(first.0, StatusCode::CREATED);
    assert_eq!(second.0, StatusCode::CREATED);
    assert_eq!(first.2, second.2);
    for table in [
        "staff",
        "audit_log WHERE entity_type='staff'",
        "outbox_events WHERE aggregate_type='staff'",
        "domain_commands WHERE scope='staff.create'",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&admin)
            .await
            .unwrap();
        assert_eq!(count, 1, "{table}");
    }
    let mut changed = input();
    changed["name"] = json!("Outra pessoa");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/staff",
            TENANT,
            "editor",
            None,
            Some(key),
            changed.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let uri = format!("/api/v1/staff/{}", first.2["data"]["id"].as_str().unwrap());
    let (first_edit, second_edit) = tokio::join!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            Some("\"1\""),
            None,
            changed
        ),
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            Some("\"1\""),
            None,
            input()
        )
    );
    let statuses = [first_edit.0, second_edit.0];
    assert_eq!(statuses.iter().filter(|s| **s == StatusCode::OK).count(), 1);
    assert_eq!(
        statuses
            .iter()
            .filter(|s| **s == StatusCode::PRECONDITION_FAILED)
            .count(),
        1
    );
    sqlx::raw_sql("CREATE FUNCTION fail_staff_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fail_staff_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_staff_outbox();").execute(&admin).await.unwrap();
    let mut failed = input();
    failed["name"] = json!("Não deve persistir");
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            Some("\"2\""),
            None,
            failed.clone()
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let saved = call(
        &router,
        "GET",
        &uri,
        TENANT,
        "reader",
        None,
        None,
        Value::Null,
    )
    .await
    .2;
    assert_eq!(saved["data"]["revision"], 2);
    assert_ne!(saved["data"]["name"], json!("Não deve persistir"));
    failed["code"] = json!("EQ-FAILED");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/staff",
            TENANT,
            "editor",
            None,
            Some(Uuid::now_v7()),
            failed
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM staff")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(OTHER)
        .execute(&mut *tx)
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM staff")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(count, 0);
    sqlx::query("INSERT INTO staff(id,tenant_id,code,name,is_employee,is_seller,status) VALUES($1,$2::uuid,'EQ-001','Outra empresa',true,false,'active')").bind(Uuid::now_v7()).bind(OTHER).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    let identities: i64 = sqlx::query_scalar("SELECT count(*) FROM identities")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(identities, 3);
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn staff_refuses_invalid_payloads_filters_and_missing_preconditions(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    permissions(&admin).await;
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/staff",
            TENANT,
            "editor",
            None,
            None,
            input()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/staff",
            TENANT,
            "reader",
            None,
            Some(Uuid::now_v7()),
            input()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for query in [
        "limit=0",
        "offset=100001",
        "role=admin",
        "status=unknown",
        "unknown=x",
    ] {
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("/api/v1/staff?{query}"),
                TENANT,
                "editor",
                None,
                None,
                Value::Null
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    for (field, value) in [
        ("code", json!("bad/code")),
        ("name", json!("")),
        ("email", json!("bad@@example.test")),
        ("tenantId", json!(OTHER)),
    ] {
        let mut invalid = input();
        invalid[field] = value;
        assert_eq!(
            call(
                &router,
                "POST",
                "/api/v1/staff",
                TENANT,
                "editor",
                None,
                Some(Uuid::now_v7()),
                invalid
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM staff")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(count, 0);
    cleanup(&admin, application, server, &role).await;
}
