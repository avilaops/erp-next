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

#[sqlx::test(migrations = "../../migrations")]
async fn payroll_approval_idempotency_privacy_and_termination(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'finance.staff.%' OR code LIKE 'finance.payables.%' ON CONFLICT DO NOTHING; INSERT INTO role_permissions(role_id,permission_code) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,code FROM permissions WHERE code IN ('finance.staff.read','finance.staff.manage') ON CONFLICT DO NOTHING;").execute(&admin).await.unwrap();
    let created = call(
        &router,
        "POST",
        "/api/v1/staff",
        TENANT,
        "editor",
        None,
        Some(Uuid::now_v7()),
        input(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/staff/{id}/payroll");
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
    assert_eq!(
        call(
            &router,
            "GET",
            &uri,
            TENANT,
            "disabled",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let propose = format!("{uri}/requests");
    let settings = json!({"kind":"settings","baseRevision":0,"settings":{"salary":"2500.00","pixType":"email","pixKey":"maria@example.test","recurring":true,"businessDay":5,"startsOn":"2026-01-01","excludedDates":["2026-11-02"]}});
    let key = Uuid::now_v7();
    let a = call(
        &router,
        "POST",
        &propose,
        TENANT,
        "reader",
        None,
        Some(key),
        settings.clone(),
    )
    .await;
    assert_eq!(a.0, StatusCode::CREATED, "{}", a.2);
    let b = call(
        &router,
        "POST",
        &propose,
        TENANT,
        "reader",
        None,
        Some(key),
        settings.clone(),
    )
    .await;
    assert_eq!(a.2, b.2);
    let before = call(
        &router,
        "GET",
        &uri,
        TENANT,
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert!(before.2["settings"].is_null());
    assert_eq!(before.2["payments"].as_array().unwrap().len(), 0);
    let review = format!(
        "/api/v1/staff-payroll/requests/{}/review",
        a.2["id"].as_str().unwrap()
    );
    let decision = json!({"approve":true,"reason":"Dados conferidos"});
    let rkey = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "POST",
            &review,
            TENANT,
            "reader",
            Some("\"1\""),
            Some(rkey),
            decision.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let result = call(
        &router,
        "POST",
        &review,
        TENANT,
        "editor",
        Some("\"1\""),
        Some(rkey),
        decision.clone(),
    )
    .await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.2);
    assert_eq!(
        call(
            &router,
            "POST",
            &review,
            TENANT,
            "editor",
            Some("\"1\""),
            Some(rkey),
            decision
        )
        .await
        .2,
        result.2
    );
    let after = call(
        &router,
        "GET",
        &uri,
        TENANT,
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(after.2["settings"]["salary"], "2500.00");
    // Recurrence generation does not duplicate the liability even with a fresh command key.
    for _ in 0..2 {
        let r = call(
            &router,
            "POST",
            "/api/v1/staff-payroll/generate",
            TENANT,
            "editor",
            None,
            Some(Uuid::now_v7()),
            json!({"month":"2026-11"}),
        )
        .await;
        assert_eq!(r.0, StatusCode::OK, "{}", r.2);
    }
    let payment = json!({"kind":"payment","payment":{"amount":"100.00","dueDate":"2026-11-10","category":"Vale-transporte","note":"Novembro"}});
    let p = call(
        &router,
        "POST",
        &propose,
        TENANT,
        "reader",
        None,
        Some(Uuid::now_v7()),
        payment,
    )
    .await;
    assert_eq!(p.0, StatusCode::CREATED);
    let puri = format!(
        "/api/v1/staff-payroll/requests/{}/review",
        p.2["id"].as_str().unwrap()
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &puri,
            TENANT,
            "editor",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            json!({"approve":true,"reason":"Benefício confirmado"})
        )
        .await
        .0,
        StatusCode::OK
    );
    let details = call(
        &router,
        "GET",
        &uri,
        TENANT,
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    let p = details.2["payments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["kind"] == "one_off")
        .unwrap();
    let payable = format!("/api/v1/financial-payables/{}", p["id"].as_str().unwrap());
    let legacy = payable.replace("/financial-payables/", "/payables/");
    assert_eq!(
        call(
            &router,
            "GET",
            &legacy,
            TENANT,
            "editor",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let legacy_list = call(
        &router,
        "GET",
        "/api/v1/payables",
        TENANT,
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(legacy_list.2["total"], 0);
    let pay=call(&router,"POST",&format!("{payable}/payments"),TENANT,"editor",Some("\"1\""),Some(Uuid::now_v7()),json!({"amount":"100.00","method":"bank_transfer","reference":"Pagamento externo conferido","occurredOn":"2026-11-10"})).await;
    assert_eq!(pay.0, StatusCode::OK, "{}", pay.2);
    assert_eq!(pay.2["data"]["staffId"], id);
    assert!(pay.2["data"]["receiptId"].is_null());
    let batch = json!({"changes":[{"staffId":id,"baseRevision":1,"salary":"2600.00"}]});
    let bkey = Uuid::now_v7();
    let b = call(
        &router,
        "POST",
        "/api/v1/staff-payroll/salaries",
        TENANT,
        "reader",
        None,
        Some(bkey),
        batch.clone(),
    )
    .await;
    assert_eq!(b.0, StatusCode::CREATED, "{}", b.2);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/staff-payroll/salaries",
            TENANT,
            "reader",
            None,
            Some(bkey),
            batch
        )
        .await
        .2,
        b.2
    );
    let current = call(
        &router,
        "GET",
        &uri,
        TENANT,
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(current.2["settings"]["salary"], "2500.00");
    // Stale financial changes cannot overwrite a newer approved salary/Pix.
    let stale = call(
        &router,
        "POST",
        &propose,
        TENANT,
        "reader",
        None,
        Some(Uuid::now_v7()),
        settings,
    )
    .await;
    assert_eq!(stale.0, StatusCode::PRECONDITION_FAILED);
    let mut archived = input();
    archived["status"] = json!("archived");
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='finance.staff.approve'").execute(&admin).await.unwrap();
    let staff_uri = format!("/api/v1/staff/{id}");
    assert_eq!(
        call(
            &router,
            "PUT",
            &staff_uri,
            TENANT,
            "editor",
            Some("\"1\""),
            None,
            archived.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','finance.staff.approve')").execute(&admin).await.unwrap();
    let stopped = call(
        &router,
        "PUT",
        &staff_uri,
        TENANT,
        "editor",
        Some("\"1\""),
        None,
        archived,
    )
    .await;
    assert_eq!(stopped.0, StatusCode::OK, "{}", stopped.2);
    let final_state = call(
        &router,
        "GET",
        &uri,
        TENANT,
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(final_state.2["settings"]["recurring"], false);
    for p in final_state.2["payments"].as_array().unwrap() {
        assert_ne!(p["status"], "open");
    }
    let paid = call(
        &router,
        "GET",
        &payable,
        TENANT,
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(paid.2["data"]["status"], "paid");
    assert_eq!(paid.2["data"]["paidAmount"], "100.00");
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn payroll_refuses_unprivileged_read_invalid_values_and_rolls_back_audit_failure(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'finance.staff.%';").execute(&admin).await.unwrap();
    let c = call(
        &router,
        "POST",
        "/api/v1/staff",
        TENANT,
        "editor",
        None,
        Some(Uuid::now_v7()),
        input(),
    )
    .await;
    let id = c.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/staff/{id}/payroll");
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
        .0,
        StatusCode::FORBIDDEN
    );
    let p = json!({"kind":"payment","payment":{"amount":"-1.00","dueDate":"2026-11-10","category":"Adicional"}});
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/requests"),
            TENANT,
            "editor",
            None,
            Some(Uuid::now_v7()),
            p
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    sqlx::raw_sql("CREATE FUNCTION fail_payroll_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER fail_payroll_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_payroll_audit();").execute(&admin).await.unwrap();
    let p = json!({"kind":"payment","payment":{"amount":"10.00","dueDate":"2026-11-10","category":"Adicional"}});
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/requests"),
            TENANT,
            "editor",
            None,
            Some(Uuid::now_v7()),
            p
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM staff_payroll_requests")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn staff_profile_is_validated_persisted_and_preserved_for_older_clients(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    let mut v = input();
    v["profile"] = json!({"cpf":"52998224725","rg":"12345","birthDate":"1990-05-20","address":"Rua de teste, 10","emergencyPhone":"17999999999"});
    let c = call(
        &router,
        "POST",
        "/api/v1/staff",
        TENANT,
        "editor",
        None,
        Some(Uuid::now_v7()),
        v.clone(),
    )
    .await;
    assert_eq!(c.0, StatusCode::CREATED, "{}", c.2);
    let uri = format!("/api/v1/staff/{}", c.2["data"]["id"].as_str().unwrap());
    let updated = call(
        &router,
        "PUT",
        &uri,
        TENANT,
        "editor",
        Some("\"1\""),
        None,
        input(),
    )
    .await;
    assert_eq!(updated.0, StatusCode::OK, "{}", updated.2);
    assert_eq!(updated.2["data"]["profile"]["cpf"], "52998224725");
    v["profile"]["cpf"] = json!("11111111111");
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            Some("\"2\""),
            None,
            v
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = false)]
async fn payroll_migration_and_discovery_work_with_a_force_rls_owner(admin: PgPool) {
    let owner = format!("payroll_owner_{}", Uuid::new_v4().simple());
    let runtime = format!("payroll_app_{}", Uuid::new_v4().simple());
    let mut tx = admin.begin().await.unwrap();
    sqlx::raw_sql(&format!("CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE ROLE {owner} NOSUPERUSER NOBYPASSRLS; CREATE ROLE {runtime} NOSUPERUSER NOBYPASSRLS; GRANT CREATE ON SCHEMA public TO {owner}; SET LOCAL ROLE {owner};"))
        .execute(&mut *tx).await.unwrap();
    let migrator = sqlx::migrate!("../../migrations");
    for migration in migrator.iter().filter(|m| m.version < 202611030009) {
        sqlx::raw_sql(&migration.sql)
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    for tenant in [first, second] {
        sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
            .bind(tenant.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("INSERT INTO tenants(id,legal_name,tax_id) VALUES($1,'Fixture',$1::text)")
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO roles(id,tenant_id,code,name) VALUES($1,$2,'administrator','Admin')",
        )
        .bind(Uuid::new_v4())
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    sqlx::query("SELECT set_config('app.tenant_id','',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../migrations/202611030009_staff_payroll.sql"
    ))
    .execute(&mut *tx)
    .await
    .unwrap();
    for tenant in [first, second] {
        sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
            .bind(tenant.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM role_permissions WHERE permission_code LIKE 'finance.staff.%'",
        )
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(count, 3);
        let staff = Uuid::new_v4();
        sqlx::query("INSERT INTO staff(id,tenant_id,code,name,is_employee,is_seller,status) VALUES($1,$2,'EQ-001','Fixture',true,false,'active')").bind(staff).bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query(
            "INSERT INTO staff_payroll_profiles(tenant_id,staff_id,settings) VALUES($1,$2,$3)",
        )
        .bind(tenant)
        .bind(staff)
        .bind(json!({"recurring":tenant==first}))
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    sqlx::raw_sql(&format!("RESET ROLE; GRANT SELECT ON staff,staff_payroll_profiles TO {runtime}; GRANT EXECUTE ON FUNCTION erp_staff_payroll_due_tenants() TO {runtime}; SET LOCAL ROLE {runtime}; SET LOCAL app.tenant_id=''; SET LOCAL app.staff_payroll_discovery='on';"))
        .execute(&mut *tx).await.unwrap();
    for table in ["staff", "staff_payroll_profiles"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        assert_eq!(
            count, 0,
            "runtime cannot use the definer's discovery policy"
        );
    }
    let tenants: Vec<Uuid> = sqlx::query_scalar("SELECT * FROM erp_staff_payroll_due_tenants()")
        .fetch_all(&mut *tx)
        .await
        .unwrap();
    assert_eq!(tenants, vec![first]);
    let temporary_policy: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_policies WHERE policyname='staff_payroll_migration_scan'",
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(temporary_policy, 0);
    tx.rollback().await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn staff_permissions_migration_backfills_existing_administrators_with_force_rls(
    admin: PgPool,
) {
    let owner = format!("staff_permissions_owner_{}", Uuid::new_v4().simple());
    let mut tx = admin.begin().await.unwrap();
    sqlx::raw_sql(&format!(
        "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE ROLE {owner} NOSUPERUSER NOBYPASSRLS; GRANT CREATE ON SCHEMA public TO {owner};"
    ))
    .execute(&mut *tx)
    .await
    .unwrap();

    let migrator = sqlx::migrate!("../../migrations");
    for migration in migrator.iter().filter(|m| m.version < 202611050005) {
        sqlx::raw_sql(&migration.sql)
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    sqlx::raw_sql(&format!(
        "ALTER TABLE tenants OWNER TO {owner}; ALTER TABLE roles OWNER TO {owner}; ALTER TABLE role_permissions OWNER TO {owner}; ALTER TABLE permissions OWNER TO {owner}; SET LOCAL ROLE {owner};"
    ))
    .execute(&mut *tx)
    .await
    .unwrap();

    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    for (tenant, code) in [(first, "administrator"), (second, "admin")] {
        sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
            .bind(tenant.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("INSERT INTO tenants(id,legal_name,tax_id) VALUES($1,'Fixture',$1::text)")
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("INSERT INTO roles(id,tenant_id,code,name) VALUES($1,$2,$3,'Admin')")
            .bind(Uuid::new_v4())
            .bind(tenant)
            .bind(code)
            .execute(&mut *tx)
            .await
            .unwrap();
    }

    sqlx::query("SELECT set_config('app.tenant_id','',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../migrations/202611050005_staff_permissions.sql"
    ))
    .execute(&mut *tx)
    .await
    .unwrap();

    for tenant in [first, second] {
        sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
            .bind(tenant.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.tenant_id=$1 AND rp.permission_code LIKE 'catalog.staff.%'",
        )
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(count, 2);
    }

    let temporary_policy: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_policies WHERE policyname='staff_permissions_migration_scan'",
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(temporary_policy, 0);
    tx.rollback().await.unwrap();
}
