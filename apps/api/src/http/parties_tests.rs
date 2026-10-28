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
    json!({"personType":"juridica","legalName":" Indústria parceira ","tradeName":"Parceira","taxId":"04.252.011/0001-10","email":"contato@example.test","phone":null,"isCustomer":true,"isSupplier":false,"status":"active"})
}

async fn permissions(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'catalog.parties.%'; INSERT INTO role_permissions(role_id,permission_code) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','catalog.parties.read');").execute(admin).await.unwrap();
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
async fn parties_preserve_identity_permissions_roles_and_concurrent_revisions(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/parties",
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
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/parties",
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
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/parties",
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
    let key = Uuid::now_v7();
    let (first, second) = tokio::join!(
        call(
            &router,
            "POST",
            "/api/v1/parties",
            TENANT,
            "editor",
            None,
            Some(key),
            input()
        ),
        call(
            &router,
            "POST",
            "/api/v1/parties",
            TENANT,
            "editor",
            None,
            Some(key),
            input()
        )
    );
    assert_eq!(first.0, StatusCode::CREATED, "{}", first.2);
    assert_eq!(first.2, second.2);
    assert_eq!(first.1["etag"], "\"1\"");
    assert_eq!(first.2["data"]["taxId"], "04252011000110");
    let id = first.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/parties/{id}");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/parties",
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
    let mut changed = input();
    changed["isSupplier"] = json!(true);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/parties",
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
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "reader",
            Some("\"1\""),
            None,
            changed.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            None,
            None,
            changed.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let (a, b) = tokio::join!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            Some("\"1\""),
            None,
            changed.clone()
        ),
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
    );
    let mut statuses = vec![a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, vec![200, 412]);
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
    .await;
    assert_eq!(saved.2["canEdit"], false);
    assert_eq!(saved.2["data"]["revision"], 2);
    assert_eq!(saved.2["data"]["isCustomer"], true);
    assert_eq!(saved.2["data"]["isSupplier"], true);
    let page = call(
        &router,
        "GET",
        "/api/v1/parties?q=parceira&role=supplier&limit=1&offset=0",
        TENANT,
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(page.2["total"], 1);
    assert_eq!(page.2["data"].as_array().unwrap().len(), 1);
    let empty = call(
        &router,
        "GET",
        "/api/v1/parties?offset=1&limit=1",
        TENANT,
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(empty.2["total"], 1);
    assert!(empty.2["data"].as_array().unwrap().is_empty());
    for query in [
        "?role=admin",
        "?status=deleted",
        "?limit=101",
        "?unknown=value",
        "?role=customer&role=supplier",
    ] {
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("/api/v1/parties{query}"),
                TENANT,
                "reader",
                None,
                None,
                Value::Null
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let mut invalid = input();
    invalid["tenantId"] = json!(OTHER);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/parties",
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
    for table in [
        "audit_log WHERE entity_type='party'",
        "outbox_events WHERE aggregate_type='party'",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            2
        );
    }
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn party_document_uniqueness_is_per_tenant_and_rls_is_enforced(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    let other_id = Uuid::now_v7();
    sqlx::query("INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES($1,$2,'juridica','Pessoa da outra empresa','04252011000110',true,false,'active')")
        .bind(other_id).bind(Uuid::parse_str(OTHER).unwrap()).execute(&admin).await.unwrap();
    let own = call(
        &router,
        "POST",
        "/api/v1/parties",
        TENANT,
        "editor",
        None,
        Some(Uuid::now_v7()),
        input(),
    )
    .await;
    assert_eq!(own.0, StatusCode::CREATED, "{}", own.2);
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/v1/parties/{other_id}"),
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
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/parties",
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
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM parties")
            .fetch_one(&app)
            .await
            .unwrap(),
        0
    );
    let mut tx = app.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(TENANT)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM parties")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM parties WHERE tenant_id=$1")
            .bind(Uuid::parse_str(OTHER).unwrap())
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    let denied = sqlx::query("INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES($1,$2,'fisica','Tentativa externa','52998224725',true,false,'active')")
        .bind(Uuid::now_v7()).bind(Uuid::parse_str(OTHER).unwrap()).execute(&mut *tx).await;
    assert!(denied.is_err());
    tx.rollback().await.unwrap();
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn party_outbox_failure_rolls_back_record_audit_command_and_revision(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    sqlx::raw_sql("CREATE FUNCTION fail_party_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced party outbox failure'; END $$; CREATE TRIGGER fail_party_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_party_outbox();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/parties",
            TENANT,
            "editor",
            None,
            Some(key),
            input()
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    for table in ["parties", "audit_log", "domain_commands", "outbox_events"] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            0
        );
    }
    sqlx::query("DROP TRIGGER fail_party_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    let created = call(
        &router,
        "POST",
        "/api/v1/parties",
        TENANT,
        "editor",
        None,
        Some(key),
        input(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    sqlx::query("CREATE TRIGGER fail_party_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_party_outbox()").execute(&admin).await.unwrap();
    let mut changed = input();
    changed["legalName"] = json!("Não deve persistir");
    changed["contacts"] = json!([{"name":"Não deve persistir", "phone":"11999999999"}]);
    assert_eq!(
        call(
            &router,
            "PUT",
            &format!("/api/v1/parties/{id}"),
            TENANT,
            "editor",
            Some("\"1\""),
            None,
            changed
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let saved = call(
        &router,
        "GET",
        &format!("/api/v1/parties/{id}"),
        TENANT,
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(saved.2["data"]["revision"], 1);
    assert_eq!(saved.2["data"]["contacts"], json!([]));
    assert_eq!(saved.2["data"]["legalName"], "Indústria parceira");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn party_complements_roundtrip_preserve_omitted_fields_and_remove_explicitly(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    permissions(&admin).await;
    let mut body = input();
    body["addresses"] = json!([{"label":"Entrega","postalCode":"01001-000","state":"SP","city":"São Paulo","street":"Praça","number":"1","district":"Centro","complement":"Sala 2","primary":true}]);
    body["contacts"] = json!([{"name":" Maria ","role":"Compras","email":"maria@example.test","phone":null,"primary":true}]);
    let key = Uuid::now_v7();
    let (status, _, created) = call(
        &router,
        "POST",
        "/api/v1/parties",
        TENANT,
        "editor",
        None,
        Some(key),
        body.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["data"]["addresses"][0]["postalCode"], "01001000");
    assert_eq!(created["data"]["contacts"][0]["name"], "Maria");
    let uri = format!(
        "/api/v1/parties/{}",
        created["data"]["id"].as_str().unwrap()
    );
    let replayed = call(
        &router,
        "POST",
        "/api/v1/parties",
        TENANT,
        "editor",
        None,
        Some(key),
        body.clone(),
    )
    .await;
    assert_eq!(replayed.0, StatusCode::CREATED);
    assert_eq!(replayed.2, created);
    let (status, _, updated) = call(
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
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["data"]["contacts"], created["data"]["contacts"]);
    assert_eq!(updated["data"]["addresses"], created["data"]["addresses"]);
    body["addresses"] = json!([]);
    body["contacts"] = json!([]);
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "reader",
            Some("\"2\""),
            None,
            body.clone()
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
    let (status, _, removed) = call(
        &router,
        "PUT",
        &uri,
        TENANT,
        "editor",
        Some("\"2\""),
        None,
        body.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(removed["data"]["contacts"], json!([]));
    assert_eq!(removed["data"]["addresses"], json!([]));
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            TENANT,
            "editor",
            Some("\"2\""),
            None,
            body
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
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
        removed["data"]
    );
    cleanup(&admin, application, server, &role).await;
}
