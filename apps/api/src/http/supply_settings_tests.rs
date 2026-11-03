use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    actor: (&str, &str),
    revision: Option<i64>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", actor.1)
        .header("content-type", "application/json");
    if !actor.0.is_empty() {
        request = request.header("authorization", format!("Bearer {}", actor.0));
    }
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
    let status = response.status();
    let etag = response.headers().get("etag").cloned();
    let bytes = to_bytes(response.into_body(), 100000).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    if status == StatusCode::OK
        && let Some(revision) = body["revision"].as_i64()
    {
        assert_eq!(etag.unwrap().to_str().unwrap(), format!("\"{revision}\""));
    }
    (status, body)
}

#[sqlx::test(migrations = "../../migrations")]
async fn supply_settings_authorize_validate_isolate_and_rollback(admin: PgPool) {
    let (router, app, server, role) = super::company_tests::setup(&admin).await;
    for (uri, table, permission, valid, invalid) in [
        (
            "/api/v1/inventory-settings",
            "inventory_settings",
            "inventory.stock.read",
            json!({"allowManualMovements":true,"minimumReasonLength":200}),
            json!({"allowManualMovements":true,"minimumReasonLength":201}),
        ),
        (
            "/api/v1/purchase-settings",
            "purchase_settings",
            "purchasing.orders.read",
            json!({"minimumOrderAmount":"0.00","maximumPaymentTermDays":3650,"requireSupplierContact":false}),
            json!({"minimumOrderAmount":"0.001","maximumPaymentTermDays":3650,"requireSupplierContact":false}),
        ),
    ] {
        let initial = call(
            &router,
            "GET",
            uri,
            ("reader", TENANT),
            None,
            None,
            Value::Null,
        )
        .await;
        assert_eq!(initial.0, StatusCode::OK);
        assert_eq!(initial.1["revision"], 1);
        assert_eq!(initial.1["canEdit"], false);
        assert!(initial.1["data"].is_null());
        sqlx::query(
            "DELETE FROM role_permissions WHERE role_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'",
        )
        .execute(&admin)
        .await
        .unwrap();
        sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$1)").bind(permission).execute(&admin).await.unwrap();
        assert_eq!(
            call(
                &router,
                "GET",
                uri,
                ("reader", TENANT),
                None,
                None,
                Value::Null
            )
            .await
            .0,
            StatusCode::OK
        );
        for (actor, status) in [
            (("", TENANT), 401),
            (("reader", TENANT), 403),
            (("disabled", TENANT), 403),
            (("editor", "22222222-2222-4222-8222-222222222222"), 403),
        ] {
            assert_eq!(
                call(&router, "PUT", uri, actor, Some(1), None, valid.clone())
                    .await
                    .0
                    .as_u16(),
                status
            );
        }
        assert_eq!(
            call(
                &router,
                "PUT",
                uri,
                ("editor", TENANT),
                None,
                None,
                valid.clone()
            )
            .await
            .0,
            StatusCode::PRECONDITION_REQUIRED
        );
        let additional_invalid = if uri == "/api/v1/inventory-settings" {
            json!({"allowManualMovements":true,"minimumReasonLength":2})
        } else {
            json!({"minimumOrderAmount":"0.00","maximumPaymentTermDays":3651,"requireSupplierContact":false})
        };
        let mut unknown = valid.clone();
        unknown["unknown"] = json!(true);
        for input in [invalid, additional_invalid, unknown, json!({})] {
            assert_eq!(
                call(
                    &router,
                    "PUT",
                    uri,
                    ("editor", TENANT),
                    Some(1),
                    None,
                    input
                )
                .await
                .0,
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        let saved = call(
            &router,
            "PUT",
            uri,
            ("editor", TENANT),
            Some(1),
            None,
            valid.clone(),
        )
        .await;
        assert_eq!(saved.0, StatusCode::OK, "{}", saved.1);
        assert_eq!(saved.1["data"], valid);
        assert_eq!(saved.1["revision"], 2);
        assert_eq!(
            call(
                &router,
                "PUT",
                uri,
                ("editor", TENANT),
                Some(1),
                None,
                valid
            )
            .await
            .0,
            StatusCode::PRECONDITION_FAILED
        );
        let mut tx = app.begin().await.unwrap();
        sqlx::query(
            "SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)",
        )
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
        sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','platform.company.read') ON CONFLICT DO NOTHING").execute(&admin).await.unwrap();
    }
    sqlx::raw_sql("CREATE FUNCTION fail_supply_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('inventory.settings.updated','purchase.settings.updated') THEN RAISE EXCEPTION 'isolated audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_supply_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_supply_audit()").execute(&admin).await.unwrap();
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM outbox_events")
        .fetch_one(&admin)
        .await
        .unwrap();
    for (uri, input) in [
        (
            "/api/v1/inventory-settings",
            json!({"allowManualMovements":false,"minimumReasonLength":3}),
        ),
        (
            "/api/v1/purchase-settings",
            json!({"minimumOrderAmount":"10.00","maximumPaymentTermDays":0,"requireSupplierContact":true}),
        ),
    ] {
        assert_eq!(
            call(
                &router,
                "PUT",
                uri,
                ("editor", TENANT),
                Some(2),
                None,
                input
            )
            .await
            .0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            call(
                &router,
                "GET",
                uri,
                ("editor", TENANT),
                None,
                None,
                Value::Null
            )
            .await
            .1["revision"],
            2
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox_events")
            .fetch_one(&admin)
            .await
            .unwrap(),
        before
    );
    super::company_tests::cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn supply_rules_apply_before_mutation_and_preserve_successful_replays(admin: PgPool) {
    let (router, app, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions ON CONFLICT DO NOTHING").execute(&admin).await.unwrap();
    let actor = ("editor", TENANT);
    let product = call(&router,"POST","/api/v1/products",actor,None,Some(Uuid::now_v7()),json!({"sku":"SUPPLY-1","name":"Produto","unit":"UN","ncm":null,"cest":null,"basePrice":"1.00","status":"active"})).await;
    assert_eq!(product.0, StatusCode::CREATED, "{}", product.1);
    let product = product.1["data"]["id"].as_str().unwrap();
    let movement = json!({"productId":product,"direction":"receipt","quantity":"1.000000","reason":"abc","reversesId":null});
    let movement_key = Uuid::now_v7();
    let created = call(
        &router,
        "POST",
        "/api/v1/stock/movements",
        actor,
        None,
        Some(movement_key),
        movement.clone(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    let movement_id = created.1["id"].clone();
    for (revision, allowed, length, status) in [
        (1, true, 4, StatusCode::UNPROCESSABLE_ENTITY),
        (2, false, 3, StatusCode::CONFLICT),
    ] {
        assert_eq!(
            call(
                &router,
                "PUT",
                "/api/v1/inventory-settings",
                actor,
                Some(revision),
                None,
                json!({"allowManualMovements":allowed,"minimumReasonLength":length})
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            call(
                &router,
                "POST",
                "/api/v1/stock/movements",
                actor,
                None,
                Some(Uuid::now_v7()),
                movement.clone()
            )
            .await
            .0,
            status
        );
        assert_eq!(
            call(
                &router,
                "POST",
                "/api/v1/stock/movements",
                actor,
                None,
                Some(movement_key),
                movement.clone()
            )
            .await
            .0,
            StatusCode::CREATED
        );
    }
    let reversal = json!({"productId":product,"direction":"issue","quantity":"1.000000","reason":"estorno","reversesId":movement_id});
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            actor,
            None,
            Some(Uuid::now_v7()),
            reversal
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM stock_movements")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    let supplier = call(&router,"POST","/api/v1/parties",actor,None,Some(Uuid::now_v7()),json!({"personType":"juridica","legalName":"Fornecedor","taxId":"04252011000110","email":null,"phone":null,"isCustomer":false,"isSupplier":true,"status":"active"})).await;
    assert_eq!(supplier.0, StatusCode::CREATED, "{}", supplier.1);
    let supplier = supplier.1["data"]["id"].as_str().unwrap();
    // Unconfigured preferences retain existing behavior, even beyond the configured term limit.
    let unrestricted_due: String = sqlx::query_scalar(
        "SELECT ((statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date + 3651)::text",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    let unrestricted = call(&router,"POST","/api/v1/purchase-orders",actor,None,Some(Uuid::now_v7()),json!({"supplierId":supplier,"dueDate":unrestricted_due,"items":[{"productId":product,"quantity":"1.000000","unitCost":"1.00"}]})).await;
    assert_eq!(unrestricted.0, StatusCode::CREATED, "{}", unrestricted.1);
    let unrestricted_uri = format!(
        "/api/v1/purchase-orders/{}/confirm",
        unrestricted.1["data"]["id"].as_str().unwrap()
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &unrestricted_uri,
            actor,
            Some(1),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    let due: String = sqlx::query_scalar(
        "SELECT ((statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date + 5)::text",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    let order = call(&router,"POST","/api/v1/purchase-orders",actor,None,Some(Uuid::now_v7()),json!({"supplierId":supplier,"dueDate":due,"items":[{"productId":product,"quantity":"1.000000","unitCost":"1.00"}]})).await;
    assert_eq!(order.0, StatusCode::CREATED, "{}", order.1);
    let order_id = order.1["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/purchase-orders/{order_id}/confirm");
    for (revision, minimum, days, contact, reason) in [
        (1, "2.00", 5, false, "mínimo"),
        (2, "1.00", 4, false, "prazo"),
        (3, "1.00", 5, true, "e-mail"),
    ] {
        assert_eq!(call(&router,"PUT","/api/v1/purchase-settings",actor,Some(revision),None,json!({"minimumOrderAmount":minimum,"maximumPaymentTermDays":days,"requireSupplierContact":contact})).await.0,StatusCode::OK);
        let blocked = call(
            &router,
            "POST",
            &uri,
            actor,
            Some(1),
            Some(Uuid::now_v7()),
            json!({}),
        )
        .await;
        assert_eq!(blocked.0, StatusCode::CONFLICT, "{}", blocked.1);
        assert!(blocked.1["title"].as_str().unwrap().contains(reason));
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM purchase_orders WHERE id=$1")
                .bind(Uuid::parse_str(order_id).unwrap())
                .fetch_one(&admin)
                .await
                .unwrap(),
            "draft"
        );
    }
    sqlx::query("UPDATE parties SET phone='11900000000' WHERE id=$1")
        .bind(Uuid::parse_str(supplier).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        call(&router, "POST", &uri, actor, Some(1), Some(key), json!({}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(call(&router,"PUT","/api/v1/purchase-settings",actor,Some(4),None,json!({"minimumOrderAmount":"1000.00","maximumPaymentTermDays":0,"requireSupplierContact":true})).await.0,StatusCode::OK);
    assert_eq!(
        call(&router, "POST", &uri, actor, Some(1), Some(key), json!({}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM payables")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    super::company_tests::cleanup(&admin, app, server, &role).await;
}
