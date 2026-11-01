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
    revision: Option<&str>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, Value) {
    let (subject, tenant) = actor;
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(revision) = revision {
        request = request.header("if-match", revision);
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
    let body = to_bytes(response.into_body(), 100000).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

async fn configure(
    router: &Router,
    revision: i64,
    amount: &str,
    days: u16,
    contact: bool,
) -> Value {
    let response = call(router, "PUT", "/api/v1/sales-settings", ("editor", TENANT), Some(&format!("\"{revision}\"")), None, json!({"minimumOrderAmount":amount,"maximumPaymentTermDays":days,"requireCustomerContact":contact})).await;
    assert_eq!(response.0, StatusCode::OK, "{}", response.1);
    response.1
}

#[sqlx::test(migrations = "../../migrations")]
async fn sales_settings_are_explicit_authorized_isolated_and_enforced_before_reservation(
    admin: PgPool,
) {
    let (router, app, server, role) = super::company_tests::setup(&admin).await;
    let uri = "/api/v1/sales-settings";
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
    assert!(initial.1["data"].is_null());
    assert_eq!(initial.1["revision"], 1);
    assert_eq!(initial.1["canEdit"], false);
    sqlx::raw_sql("DELETE FROM role_permissions WHERE role_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND permission_code='platform.company.read'; INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read')").execute(&admin).await.unwrap();
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
    let input = json!({"minimumOrderAmount":"0.33","maximumPaymentTermDays":30,"requireCustomerContact":true});
    for ((subject, tenant), expected) in [
        (("", TENANT), 401),
        (("reader", TENANT), 403),
        (("disabled", TENANT), 403),
        (("editor", "22222222-2222-4222-8222-222222222222"), 403),
    ] {
        assert_eq!(
            call(
                &router,
                "PUT",
                uri,
                (subject, tenant),
                Some("\"1\""),
                None,
                input.clone()
            )
            .await
            .0
            .as_u16(),
            expected
        );
    }
    for invalid in [
        json!({"minimumOrderAmount":"0.33","maximumPaymentTermDays":30}),
        json!({"minimumOrderAmount":"-0.01","maximumPaymentTermDays":30,"requireCustomerContact":true}),
        json!({"minimumOrderAmount":"0.331","maximumPaymentTermDays":30,"requireCustomerContact":true}),
        json!({"minimumOrderAmount":"1e2","maximumPaymentTermDays":30,"requireCustomerContact":true}),
        json!({"minimumOrderAmount":"0.33","maximumPaymentTermDays":3651,"requireCustomerContact":true}),
        json!({"minimumOrderAmount":"0.33","maximumPaymentTermDays":30,"requireCustomerContact":null}),
    ] {
        assert_eq!(
            call(
                &router,
                "PUT",
                uri,
                ("editor", TENANT),
                Some("\"1\""),
                None,
                invalid
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
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
            input.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let saved = configure(&router, 1, "0.33", 30, true).await;
    assert_eq!(saved["data"], input);
    assert_eq!(saved["revision"], 2);
    assert_eq!(
        call(
            &router,
            "PUT",
            uri,
            ("editor", TENANT),
            Some("\"1\""),
            None,
            input.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let mut tx = app.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind("22222222-2222-4222-8222-222222222222")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sales_settings")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    tx.rollback().await.unwrap();

    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions ON CONFLICT DO NOTHING").execute(&admin).await.unwrap();
    let customer = call(&router, "POST", "/api/v1/parties", ("editor", TENANT), None, Some(Uuid::now_v7()), json!({"personType":"juridica","legalName":"Cliente da configuração","taxId":"04252011000110","email":null,"phone":null,"isCustomer":true,"isSupplier":false,"status":"active"})).await;
    assert_eq!(customer.0, StatusCode::CREATED, "{}", customer.1);
    let customer = customer.1["data"]["id"].as_str().unwrap();
    let product = call(&router, "POST", "/api/v1/products", ("editor", TENANT), None, Some(Uuid::now_v7()), json!({"sku":"SETTINGS-1","name":"Produto para validar regra","unit":"UN","ncm":null,"cest":null,"basePrice":"0.33","status":"active"})).await;
    assert_eq!(product.0, StatusCode::CREATED, "{}", product.1);
    let product = product.1["data"]["id"].as_str().unwrap();
    let stock = call(&router, "POST", "/api/v1/stock/movements", ("editor", TENANT), None, Some(Uuid::now_v7()), json!({"productId":product,"direction":"receipt","quantity":"10.000000","reason":"Saldo isolado para configuração","reversesId":null})).await;
    assert_eq!(stock.0, StatusCode::CREATED, "{}", stock.1);
    let due: String = sqlx::query_scalar(
        "SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date + 5)::text",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    let order = call(&router, "POST", "/api/v1/orders", ("editor", TENANT), None, Some(Uuid::now_v7()), json!({"customerId":customer,"dueDate":due,"items":[{"productId":product,"quantity":"1.000000"}]})).await;
    assert_eq!(order.0, StatusCode::CREATED, "{}", order.1);
    let order = order.1["data"]["id"].as_str().unwrap();
    let confirm_uri = format!("/api/v1/orders/{order}/confirm");
    for (revision, minimum, days, reason) in [
        (2, "1.00", 30, "mínimo"),
        (3, "0.33", 0, "prazo"),
        (4, "0.33", 30, "e-mail"),
    ] {
        configure(&router, revision, minimum, days, true).await;
        let blocked = call(
            &router,
            "POST",
            &confirm_uri,
            ("editor", TENANT),
            Some("\"1\""),
            Some(Uuid::now_v7()),
            json!({}),
        )
        .await;
        assert_eq!(blocked.0, StatusCode::CONFLICT, "{}", blocked.1);
        assert!(blocked.1["title"].as_str().unwrap().contains(reason));
        let status: (String, i64) =
            sqlx::query_as("SELECT status,revision FROM sales_orders WHERE id=$1")
                .bind(Uuid::parse_str(order).unwrap())
                .fetch_one(&admin)
                .await
                .unwrap();
        assert_eq!(status, ("draft".to_owned(), 1));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables")
                .fetch_one(&admin)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM stock_movements")
                .fetch_one(&admin)
                .await
                .unwrap(),
            1
        );
    }
    sqlx::query("UPDATE parties SET phone='11900000000' WHERE id=$1")
        .bind(Uuid::parse_str(customer).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "POST",
            &confirm_uri,
            ("editor", TENANT),
            Some("\"1\""),
            Some(key),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    // Explicit false permits a customer without contact, at the exact term limit.
    configure(&router, 5, "0.33", 30, false).await;
    sqlx::query("UPDATE parties SET phone=NULL WHERE id=$1")
        .bind(Uuid::parse_str(customer).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let boundary: String = sqlx::query_scalar(
        "SELECT ((statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date + 30)::text",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    let other = call(&router, "POST", "/api/v1/orders", ("editor", TENANT), None, Some(Uuid::now_v7()), json!({"customerId":customer,"dueDate":boundary,"items":[{"productId":product,"quantity":"1.000000"}]})).await;
    assert_eq!(other.0, StatusCode::CREATED, "{}", other.1);
    let other = other.1["data"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/orders/{other}/confirm"),
            ("editor", TENANT),
            Some("\"1\""),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    configure(&router, 6, "1000.00", 0, true).await;
    // Successful idempotent replay and completion preserve the confirmed agreement.
    assert_eq!(
        call(
            &router,
            "POST",
            &confirm_uri,
            ("editor", TENANT),
            Some("\"1\""),
            Some(key),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/orders/{order}/complete"),
            ("editor", TENANT),
            Some("\"2\""),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );

    sqlx::raw_sql("CREATE FUNCTION fail_sales_settings_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sales.settings.updated' THEN RAISE EXCEPTION 'isolated audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_sales_settings_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_sales_settings_audit()").execute(&admin).await.unwrap();
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM outbox_events")
        .fetch_one(&admin)
        .await
        .unwrap();
    let failure = call(
        &router,
        "PUT",
        uri,
        ("editor", TENANT),
        Some("\"7\""),
        None,
        input,
    )
    .await;
    assert_eq!(failure.0, StatusCode::INTERNAL_SERVER_ERROR);
    let read = call(
        &router,
        "GET",
        uri,
        ("editor", TENANT),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(read.1["revision"], 7);
    assert_eq!(read.1["data"]["minimumOrderAmount"], "1000.00");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox_events")
            .fetch_one(&admin)
            .await
            .unwrap(),
        before
    );
    super::company_tests::cleanup(&admin, app, server, &role).await;
}
