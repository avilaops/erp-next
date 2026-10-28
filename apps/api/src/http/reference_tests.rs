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
const RESOURCES: [&str; 4] = [
    "product-categories",
    "financial-categories",
    "financial-accounts",
    "payment-methods",
];

fn input(resource: &str, code: &str) -> Value {
    let mut value =
        json!({"code":code,"name":format!("Cadastro {code}"),"status":"active","notes":null});
    let extra = match resource {
        "product-categories" => json!({"parentId":null,"sortOrder":0}),
        "financial-categories" => json!({"parentId":null,"direction":"income"}),
        "financial-accounts" => {
            json!({"accountType":"bank","bank":"Banco declarado","branch":"0001","accountNumber":"123-4"})
        }
        "payment-methods" => json!({"modality":"pix","settlementDays":0}),
        _ => panic!("unknown test resource"),
    };
    value
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    value
}
async fn grant(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code LIKE 'catalog.categories.%' OR code LIKE 'finance.categories.%' OR code LIKE 'finance.accounts.%' OR code LIKE 'finance.payment_methods.%'; INSERT INTO role_permissions(role_id,permission_code) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',code FROM permissions WHERE code IN ('catalog.categories.read','finance.categories.read','finance.accounts.read','finance.payment_methods.read');").execute(admin).await.unwrap();
}
async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    subject: &str,
    revision: Option<i64>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {subject}"))
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json");
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
    }
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    (
        parts.status,
        parts.headers,
        serde_json::from_slice(&to_bytes(body, 100000).await.unwrap()).unwrap(),
    )
}
async fn create(router: &Router, resource: &str, value: Value) -> String {
    let response = call(
        router,
        "POST",
        &format!("/api/v1/{resource}"),
        "editor",
        None,
        Some(Uuid::now_v7()),
        value,
    )
    .await;
    assert_eq!(response.0, StatusCode::CREATED, "{}", response.2);
    response.2["data"]["id"].as_str().unwrap().to_owned()
}

#[sqlx::test(migrations = "../../migrations")]
async fn all_reference_catalogs_persist_search_revision_and_authorize_replays(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    for resource in RESOURCES {
        let uri = format!("/api/v1/{resource}");
        let mut value = input(resource, " base ");
        value["name"] = json!(" Nome normalizado ");
        value["notes"] = json!(" Observação ");
        let key = Uuid::now_v7();
        let created = call(
            &router,
            "POST",
            &uri,
            "editor",
            None,
            Some(key),
            value.clone(),
        )
        .await;
        assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
        assert_eq!(created.1["etag"], "\"1\"");
        assert_eq!(created.2["data"]["code"], "BASE");
        assert_eq!(created.2["data"]["name"], "Nome normalizado");
        assert_eq!(created.2["data"]["notes"], "Observação");
        assert_eq!(created.1["cache-control"], "no-store");
        let replay = call(
            &router,
            "POST",
            &uri,
            "editor",
            None,
            Some(key),
            value.clone(),
        )
        .await;
        assert_eq!(replay.2, created.2);
        assert_eq!(replay.1["idempotency-replayed"], "true");
        assert_eq!(
            call(
                &router,
                "POST",
                &uri,
                "editor",
                None,
                Some(Uuid::now_v7()),
                value.clone()
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            call(
                &router,
                "POST",
                &uri,
                "reader",
                None,
                Some(Uuid::now_v7()),
                value.clone()
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(&router, "POST", &uri, "editor", None, None, value.clone())
                .await
                .0,
            StatusCode::PRECONDITION_REQUIRED
        );
        let item = format!("{uri}/{}", created.2["data"]["id"].as_str().unwrap());
        value["name"] = json!("Nome alterado");
        value["status"] = json!("archived");
        assert_eq!(
            call(
                &router,
                "PUT",
                &item,
                "editor",
                None,
                Some(Uuid::now_v7()),
                value.clone()
            )
            .await
            .0,
            StatusCode::PRECONDITION_REQUIRED
        );
        assert_eq!(
            call(
                &router,
                "PUT",
                &item,
                "reader",
                Some(1),
                Some(Uuid::now_v7()),
                value.clone()
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        let key = Uuid::now_v7();
        let saved = call(
            &router,
            "PUT",
            &item,
            "editor",
            Some(1),
            Some(key),
            value.clone(),
        )
        .await;
        assert_eq!(saved.0, StatusCode::OK, "{}", saved.2);
        assert_eq!(saved.1["etag"], "\"2\"");
        assert_eq!(
            call(
                &router,
                "PUT",
                &item,
                "editor",
                Some(1),
                Some(key),
                value.clone()
            )
            .await
            .2,
            saved.2
        );
        assert_eq!(
            call(
                &router,
                "PUT",
                &item,
                "editor",
                Some(1),
                Some(Uuid::now_v7()),
                value.clone()
            )
            .await
            .0,
            StatusCode::PRECONDITION_FAILED
        );
        assert_eq!(
            call(&router, "GET", &item, "reader", None, None, Value::Null)
                .await
                .2["data"],
            saved.2["data"]
        );
        let list = call(
            &router,
            "GET",
            &format!("{uri}?q=BASE&status=archived&limit=1&offset=0"),
            "reader",
            None,
            None,
            Value::Null,
        )
        .await;
        assert_eq!(list.0, StatusCode::OK);
        assert_eq!(list.2["total"], 1);
        assert_eq!(list.2["canEdit"], false);
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("{uri}?status=active"),
                "reader",
                None,
                None,
                Value::Null
            )
            .await
            .2["total"],
            0
        );
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("{uri}?limit=0"),
                "editor",
                None,
                None,
                Value::Null
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("{uri}?tenantId={OTHER}"),
                "editor",
                None,
                None,
                Value::Null
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        value["balance"] = json!("999.99");
        assert_eq!(
            call(
                &router,
                "PUT",
                &item,
                "editor",
                Some(2),
                Some(Uuid::now_v7()),
                value.clone()
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        value.as_object_mut().unwrap().remove("balance");
        sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code=ANY($1)")
            .bind(vec!["catalog.categories.manage","finance.categories.manage","finance.accounts.manage","finance.payment_methods.manage"])
            .execute(&admin).await.unwrap();
        assert_eq!(
            call(&router, "PUT", &item, "editor", Some(1), Some(key), value)
                .await
                .0,
            StatusCode::FORBIDDEN
        );
        sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code=ANY($1) ON CONFLICT DO NOTHING")
            .bind(vec!["catalog.categories.manage","finance.categories.manage","finance.accounts.manage","finance.payment_methods.manage"]).execute(&admin).await.unwrap();
    }
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM audit_log WHERE entity_type IN ('product_categories','financial_categories','financial_accounts','payment_methods')").fetch_one(&admin).await.unwrap(),8);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn category_hierarchies_prevent_cycles_inactive_ancestors_and_mixed_financial_natures(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    for resource in ["product-categories", "financial-categories"] {
        let root = create(&router, resource, input(resource, "ROOT")).await;
        let mut child_input = input(resource, "CHILD");
        child_input["parentId"] = json!(root);
        let child = create(&router, resource, child_input.clone()).await;
        let uri = format!("/api/v1/{resource}/{root}");
        let mut changed = input(resource, "ROOT");
        changed["parentId"] = json!(child);
        assert_eq!(
            call(
                &router,
                "PUT",
                &uri,
                "editor",
                Some(1),
                Some(Uuid::now_v7()),
                changed.clone()
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        changed["parentId"] = json!(root);
        assert_eq!(
            call(
                &router,
                "PUT",
                &uri,
                "editor",
                Some(1),
                Some(Uuid::now_v7()),
                changed.clone()
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        changed["parentId"] = Value::Null;
        changed["status"] = json!("archived");
        assert_eq!(
            call(
                &router,
                "PUT",
                &uri,
                "editor",
                Some(1),
                Some(Uuid::now_v7()),
                changed.clone()
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        if resource == "financial-categories" {
            let mut mixed = child_input.clone();
            mixed["direction"] = json!("expense");
            assert_eq!(
                call(
                    &router,
                    "PUT",
                    &format!("/api/v1/{resource}/{child}"),
                    "editor",
                    Some(1),
                    Some(Uuid::now_v7()),
                    mixed
                )
                .await
                .0,
                StatusCode::CONFLICT
            );
            let mut mixed = input(resource, "ROOT");
            mixed["direction"] = json!("expense");
            assert_eq!(
                call(
                    &router,
                    "PUT",
                    &uri,
                    "editor",
                    Some(1),
                    Some(Uuid::now_v7()),
                    mixed
                )
                .await
                .0,
                StatusCode::CONFLICT
            );
        }
        child_input["status"] = json!("archived");
        assert_eq!(
            call(
                &router,
                "PUT",
                &format!("/api/v1/{resource}/{child}"),
                "editor",
                Some(1),
                Some(Uuid::now_v7()),
                child_input.clone()
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            call(
                &router,
                "PUT",
                &uri,
                "editor",
                Some(1),
                Some(Uuid::now_v7()),
                changed
            )
            .await
            .0,
            StatusCode::OK
        );
        child_input["status"] = json!("active");
        assert_eq!(
            call(
                &router,
                "PUT",
                &format!("/api/v1/{resource}/{child}"),
                "editor",
                Some(2),
                Some(Uuid::now_v7()),
                child_input
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
    }
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn concurrent_category_reparenting_and_writes_preserve_tree_and_revision(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    let resource = "product-categories";
    let a = create(&router, resource, input(resource, "A")).await;
    let b = create(&router, resource, input(resource, "B")).await;
    let mut first = input(resource, "A");
    first["parentId"] = json!(b);
    let mut second = input(resource, "B");
    second["parentId"] = json!(a);
    let a_uri = format!("/api/v1/{resource}/{a}");
    let b_uri = format!("/api/v1/{resource}/{b}");
    let (x, y) = tokio::join!(
        call(
            &router,
            "PUT",
            &a_uri,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            first
        ),
        call(
            &router,
            "PUT",
            &b_uri,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            second
        )
    );
    assert!([x.0, y.0].contains(&StatusCode::OK));
    assert!([x.0, y.0].contains(&StatusCode::CONFLICT));
    let current = call(&router, "GET", &a_uri, "editor", None, None, Value::Null).await;
    let revision = current.2["data"]["revision"].as_i64().unwrap();
    let mut next = input(resource, "A");
    next["name"] = json!("Concurrent A");
    let (x, y) = tokio::join!(
        call(
            &router,
            "PUT",
            &a_uri,
            "editor",
            Some(revision),
            Some(Uuid::now_v7()),
            next.clone()
        ),
        call(
            &router,
            "PUT",
            &a_uri,
            "editor",
            Some(revision),
            Some(Uuid::now_v7()),
            next
        )
    );
    assert!([x.0, y.0].contains(&StatusCode::OK));
    assert!([x.0, y.0].contains(&StatusCode::PRECONDITION_FAILED));
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn reference_tables_and_routes_isolate_existing_foreign_records(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    for (resource, table, columns, extra) in [
        (
            "product-categories",
            "product_categories",
            "sort_order",
            "0",
        ),
        (
            "financial-categories",
            "financial_categories",
            "direction",
            "'income'",
        ),
        (
            "financial-accounts",
            "financial_accounts",
            "account_type",
            "'cash'",
        ),
        (
            "payment-methods",
            "payment_methods",
            "modality,settlement_days",
            "'cash',0",
        ),
    ] {
        let id = Uuid::now_v7();
        sqlx::query(&format!("INSERT INTO {table}(id,tenant_id,code,name,status,revision,{columns}) VALUES($1,$2,'FOREIGN','Estrangeiro','active',1,{extra})"))
            .bind(id).bind(Uuid::parse_str(OTHER).unwrap()).execute(&admin).await.unwrap();
        let uri = format!("/api/v1/{resource}/{id}");
        assert_eq!(
            call(&router, "GET", &uri, "editor", None, None, Value::Null)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            call(
                &router,
                "PUT",
                &uri,
                "editor",
                Some(1),
                Some(Uuid::now_v7()),
                input(resource, "FOREIGN")
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("/api/v1/{resource}?q=FOREIGN"),
                "editor",
                None,
                None,
                Value::Null
            )
            .await
            .2["total"],
            0
        );
        let mut tx = app.begin().await.unwrap();
        sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
            .bind(TENANT)
            .execute(&mut *tx)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&mut *tx)
                .await
                .unwrap(),
            0
        );
        tx.rollback().await.unwrap();
        if resource.ends_with("categories") {
            let mut value = input(resource, "LOCAL");
            value["parentId"] = json!(id);
            assert_eq!(
                call(
                    &router,
                    "POST",
                    &format!("/api/v1/{resource}"),
                    "editor",
                    None,
                    Some(Uuid::now_v7()),
                    value
                )
                .await
                .0,
                StatusCode::CONFLICT
            );
        }
        create(&router, resource, input(resource, "FOREIGN")).await;
    }
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn reference_outbox_failure_rolls_back_creation_update_audit_and_idempotency(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    let resource = "financial-accounts";
    let uri = "/api/v1/financial-accounts";
    let value = input(resource, "ROLLBACK");
    let key = Uuid::now_v7();
    sqlx::raw_sql("CREATE FUNCTION fail_reference_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic reference failure'; END $$; CREATE TRIGGER fail_reference_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_reference_event();").execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            uri,
            "editor",
            None,
            Some(key),
            value.clone()
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    for table in ["financial_accounts", "domain_commands", "audit_log"] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            0
        );
    }
    sqlx::query("ALTER TABLE outbox_events DISABLE TRIGGER fail_reference_event")
        .execute(&admin)
        .await
        .unwrap();
    let created = call(
        &router,
        "POST",
        uri,
        "editor",
        None,
        Some(key),
        value.clone(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    let item = format!("{uri}/{}", created.2["data"]["id"].as_str().unwrap());
    sqlx::query("ALTER TABLE outbox_events ENABLE TRIGGER fail_reference_event")
        .execute(&admin)
        .await
        .unwrap();
    let key = Uuid::now_v7();
    let mut changed = value;
    changed["name"] = json!("Não pode vazar");
    assert_eq!(
        call(
            &router,
            "PUT",
            &item,
            "editor",
            Some(1),
            Some(key),
            changed.clone()
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        call(&router, "GET", &item, "editor", None, None, Value::Null)
            .await
            .2,
        created.2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM domain_commands")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    sqlx::query("ALTER TABLE outbox_events DISABLE TRIGGER fail_reference_event")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(&router, "PUT", &item, "editor", Some(1), Some(key), changed)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM stock_movements")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn reference_validation_rejects_bad_codes_ranges_and_incompatible_bank_fields(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    for (resource, field, value) in [
        ("product-categories", "sortOrder", json!(-1)),
        ("product-categories", "sortOrder", json!(1000000)),
        ("financial-categories", "direction", json!("both")),
        ("payment-methods", "settlementDays", json!(366)),
        ("payment-methods", "settlementDays", json!(1.5)),
        ("payment-methods", "modality", json!("crypto")),
        ("financial-accounts", "accountType", json!("cash")),
        ("financial-accounts", "accountType", json!("unknown")),
        ("financial-accounts", "code", json!("INVALID CODE")),
        ("product-categories", "name", json!("\n")),
        ("financial-categories", "notes", json!("x".repeat(1001))),
    ] {
        let mut payload = input(resource, "INVALID");
        payload[field] = value;
        assert_eq!(
            call(
                &router,
                "POST",
                &format!("/api/v1/{resource}"),
                "editor",
                None,
                Some(Uuid::now_v7()),
                payload
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{resource} {field}"
        );
    }
    cleanup(&admin, app, server, &role).await;
}
