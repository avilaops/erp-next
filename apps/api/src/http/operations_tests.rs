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

async fn completed_account(router: &Router, customer: &str, product: &str) -> String {
    let id = create(router, customer, product, "3.000000").await;
    assert_eq!(
        action(router, &id, "confirm", "\"1\"", Uuid::now_v7())
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        action(router, &id, "complete", "\"2\"", Uuid::now_v7())
            .await
            .0,
        StatusCode::OK
    );
    let list = call(
        router,
        "GET",
        "/api/v1/receivables",
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    list.2["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["orderId"] == id)
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn partial_receipt(amount: &str) -> Value {
    json!({"amount":amount,"method":"cash","reference":"Recebimento parcial de teste","occurredOn":"2026-10-27"})
}

#[sqlx::test(migrations = "../../migrations")]
async fn partial_receipts_and_specific_reversals_preserve_exact_remaining_balance(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let account = completed_account(&router, &customer, &product).await;
    let uri = format!("/api/v1/receivables/{account}");
    for (amount, expected) in [
        ("0.00", StatusCode::UNPROCESSABLE_ENTITY),
        ("-0.01", StatusCode::UNPROCESSABLE_ENTITY),
        ("1.00", StatusCode::CONFLICT),
    ] {
        assert_eq!(
            call(
                &router,
                "POST",
                &format!("{uri}/payments"),
                "editor",
                Some("\"1\""),
                Some(Uuid::now_v7()),
                partial_receipt(amount)
            )
            .await
            .0,
            expected
        );
    }
    let first_key = Uuid::now_v7();
    let first = call(
        &router,
        "POST",
        &format!("{uri}/payments"),
        "editor",
        Some("\"1\""),
        Some(first_key),
        partial_receipt("0.33"),
    )
    .await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.2);
    assert_eq!(first.2["data"]["receivedAmount"], "0.33");
    assert_eq!(first.2["data"]["outstandingAmount"], "0.66");
    assert_eq!(first.2["data"]["status"], "open");
    assert!(first.2["data"]["paymentId"].is_null());
    let first_id = first.2["payments"][0]["id"].clone();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/payments"),
            "editor",
            Some("\"2\""),
            Some(Uuid::now_v7()),
            partial_receipt("0.67")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let second = call(
        &router,
        "POST",
        &format!("{uri}/payments"),
        "editor",
        Some("\"2\""),
        Some(Uuid::now_v7()),
        partial_receipt("0.66"),
    )
    .await;
    assert_eq!(second.0, StatusCode::OK, "{}", second.2);
    assert_eq!(second.2["data"]["receivedAmount"], "0.99");
    assert_eq!(second.2["data"]["outstandingAmount"], "0.00");
    assert_eq!(second.2["data"]["status"], "paid");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/payments"),
            "editor",
            Some("\"1\""),
            Some(first_key),
            partial_receipt("0.33")
        )
        .await
        .2,
        first.2
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/payments"),
            "editor",
            Some("\"3\""),
            Some(Uuid::now_v7()),
            partial_receipt("0.01")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let reverse = json!({"paymentId":first_id,"reason":"Estorno do primeiro recebimento","occurredOn":"2026-10-28"});
    let key = Uuid::now_v7();
    let reversed = call(
        &router,
        "POST",
        &format!("{uri}/reverse-payment"),
        "editor",
        Some("\"3\""),
        Some(key),
        reverse.clone(),
    )
    .await;
    assert_eq!(reversed.0, StatusCode::OK, "{}", reversed.2);
    assert_eq!(reversed.2["data"]["receivedAmount"], "0.66");
    assert_eq!(reversed.2["data"]["outstandingAmount"], "0.33");
    assert_eq!(reversed.2["data"]["status"], "open");
    assert_eq!(reversed.2["payments"][2]["amount"], "0.33");
    assert_eq!(reversed.2["payments"][2]["reversesId"], first_id);
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/reverse-payment"),
            "editor",
            Some("\"3\""),
            Some(key),
            reverse.clone()
        )
        .await
        .2,
        reversed.2
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/reverse-payment"),
            "editor",
            Some("\"4\""),
            Some(Uuid::now_v7()),
            reverse
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let other = completed_account(&router, &customer, &product).await;
    assert_eq!(call(&router,"POST",&format!("/api/v1/receivables/{other}/reverse-payment"),"editor",Some("\"1\""),Some(Uuid::now_v7()),json!({"paymentId":second.2["payments"][1]["id"],"reason":"Tentativa sobre outra conta","occurredOn":"2026-10-28"})).await.0,StatusCode::CONFLICT);
    let last = call(&router,"POST",&format!("{uri}/reverse-payment"),"editor",Some("\"4\""),Some(Uuid::now_v7()),json!({"paymentId":second.2["payments"][1]["id"],"reason":"Estorno do segundo recebimento","occurredOn":"2026-10-28"})).await;
    assert_eq!(last.0, StatusCode::OK, "{}", last.2);
    assert_eq!(last.2["data"]["receivedAmount"], "0.00");
    assert_eq!(last.2["data"]["outstandingAmount"], "0.99");
    assert_eq!(last.2["payments"].as_array().unwrap().len(), 4);
    let list = call(
        &router,
        "GET",
        "/api/v1/receivables",
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    let listed = list.2["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == account)
        .unwrap();
    assert_eq!(listed["outstandingAmount"], "0.99");
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn concurrent_partial_receipts_and_reversals_require_the_current_revision(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let account = completed_account(&router, &customer, &product).await;
    let uri = format!("/api/v1/receivables/{account}");
    let pay_uri = format!("{uri}/payments");
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            &pay_uri,
            "editor",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            partial_receipt("0.66")
        ),
        call(
            &router,
            "POST",
            &pay_uri,
            "editor",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            partial_receipt("0.66")
        )
    );
    let mut statuses = [a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 412]);
    let current = call(&router, "GET", &uri, "reader", None, None, Value::Null).await;
    assert_eq!(current.2["data"]["outstandingAmount"], "0.33");
    assert_eq!(current.2["payments"].as_array().unwrap().len(), 1);
    let reverse_uri = format!("{uri}/reverse-payment");
    let reverse = json!({"paymentId":current.2["payments"][0]["id"],"reason":"Estorno concorrente de teste","occurredOn":"2026-10-28"});
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            &reverse_uri,
            "editor",
            Some("\"2\""),
            Some(Uuid::now_v7()),
            reverse.clone()
        ),
        call(
            &router,
            "POST",
            &reverse_uri,
            "editor",
            Some("\"2\""),
            Some(Uuid::now_v7()),
            reverse
        )
    );
    let mut statuses = [a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 412]);
    let current = call(&router, "GET", &uri, "reader", None, None, Value::Null).await;
    assert_eq!(current.2["data"]["outstandingAmount"], "0.99");
    assert_eq!(current.2["payments"].as_array().unwrap().len(), 2);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn partial_receipt_and_reversal_failures_do_not_leave_ledger_or_command_effects(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let account = completed_account(&router, &customer, &product).await;
    let uri = format!("/api/v1/receivables/{account}");
    sqlx::raw_sql("CREATE FUNCTION fail_partial_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type IN ('receivable.payment_recorded','receivable.payment_reversed') THEN RAISE EXCEPTION 'forced partial failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_partial_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_partial_outbox();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/payments"),
            "editor",
            Some("\"1\""),
            Some(key),
            partial_receipt("0.33")
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivable_payments")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_commands WHERE scope='receivable.pay'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    let before = call(&router, "GET", &uri, "reader", None, None, Value::Null).await;
    assert_eq!(before.2["data"]["revision"], 1);
    assert_eq!(before.2["data"]["outstandingAmount"], "0.99");
    sqlx::query("DROP TRIGGER fail_partial_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    let saved = call(
        &router,
        "POST",
        &format!("{uri}/payments"),
        "editor",
        Some("\"1\""),
        Some(key),
        partial_receipt("0.33"),
    )
    .await;
    assert_eq!(saved.0, StatusCode::OK, "{}", saved.2);
    sqlx::query("CREATE TRIGGER fail_partial_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_partial_outbox()").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    let body = json!({"paymentId":saved.2["payments"][0]["id"],"reason":"Estorno com falha simulada","occurredOn":"2026-10-28"});
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/reverse-payment"),
            "editor",
            Some("\"2\""),
            Some(key),
            body.clone()
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let unchanged = call(&router, "GET", &uri, "editor", None, None, Value::Null).await;
    assert_eq!(unchanged.2, saved.2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_commands WHERE scope='receivable.reverse'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    sqlx::query("DROP TRIGGER fail_partial_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/reverse-payment"),
            "editor",
            Some("\"2\""),
            Some(key),
            body
        )
        .await
        .0,
        StatusCode::OK
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn draft_edit_preserves_agreed_prices_and_customer_snapshot_without_operational_side_effects(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let id = create(&router, &customer, &product, "3.000000").await;
    let uri = format!("/api/v1/orders/{id}");
    let changed = json!({"sku":"OPER-001","name":"Nome e preço novos","unit":"UN","ncm":null,"cest":null,"basePrice":"100.00","status":"active"});
    assert_eq!(
        call(
            &router,
            "PUT",
            &format!("/api/v1/products/{product}"),
            "editor",
            Some("\"1\""),
            None,
            changed
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query("UPDATE parties SET legal_name='Nome cadastral novo' WHERE id=$1")
        .bind(Uuid::parse_str(&customer).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let added = call(&router,"POST","/api/v1/products","editor",None,Some(Uuid::now_v7()),json!({"sku":"OPER-NEW","name":"Item adicional","unit":"UN","ncm":null,"cest":null,"basePrice":"2.50","status":"active"})).await;
    assert_eq!(added.0, StatusCode::CREATED);
    let input = json!({"customerId":customer,"dueDate":"2026-12-30","items":[{"productId":product,"quantity":"4.500000"},{"productId":added.2["data"]["id"],"quantity":"2.000000"}]});
    let key = Uuid::now_v7();
    let edited = call(
        &router,
        "PUT",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        input.clone(),
    )
    .await;
    assert_eq!(edited.0, StatusCode::OK, "{}", edited.2);
    assert_eq!(edited.1["etag"], "\"2\"");
    assert_eq!(edited.2["data"]["amount"], "6.49");
    assert_eq!(edited.2["data"]["customerName"], "Cliente operacional");
    assert_eq!(edited.2["data"]["dueDate"], "2026-12-30");
    assert_eq!(edited.2["items"][0]["name"], "Produto operacional");
    assert_eq!(edited.2["items"][0]["unitPrice"], "0.33");
    assert_eq!(edited.2["items"][0]["amount"], "1.49");
    assert_eq!(edited.2["items"][1]["unitPrice"], "2.50");
    let replay = call(
        &router,
        "PUT",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        input.clone(),
    )
    .await;
    assert_eq!(replay.0, StatusCode::OK);
    assert_eq!(replay.2, edited.2);
    assert_eq!(replay.1["idempotency-replayed"], "true");
    let mut different = input.clone();
    different["dueDate"] = json!("2026-12-31");
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"1\""),
            Some(key),
            different
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
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(stock(&router).await["reserved"], "0.000000");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log WHERE action='order.updated'")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM outbox_events WHERE event_type='order.updated'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        1
    );
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='sales.orders.manage'").execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"1\""),
            Some(key),
            input
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn draft_edits_serialize_with_confirmation_and_reject_confirmed_or_cancelled_orders(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let id = create(&router, &customer, &product, "3.000000").await;
    let uri = format!("/api/v1/orders/{id}");
    let key_a = Uuid::now_v7();
    let key_b = Uuid::now_v7();
    let (a, b) = tokio::join!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"1\""),
            Some(key_a),
            order(&customer, &product, "4.000000")
        ),
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"1\""),
            Some(key_b),
            order(&customer, &product, "5.000000")
        ),
    );
    assert!([a.0, b.0].contains(&StatusCode::OK));
    assert!([a.0, b.0].contains(&StatusCode::PRECONDITION_FAILED));
    assert_eq!(
        action(&router, &id, "confirm", "\"1\"", Uuid::now_v7())
            .await
            .0,
        StatusCode::PRECONDITION_FAILED
    );
    assert_eq!(
        action(&router, &id, "confirm", "\"2\"", Uuid::now_v7())
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
            Some("\"3\""),
            Some(Uuid::now_v7()),
            order(&customer, &product, "1.000000")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        action(&router, &id, "cancel", "\"3\"", Uuid::now_v7())
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
            Some("\"4\""),
            Some(Uuid::now_v7()),
            order(&customer, &product, "1.000000")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let raced = create(&router, &customer, &product, "2.000000").await;
    let race_uri = format!("/api/v1/orders/{raced}");
    let (edit, confirm) = tokio::join!(
        call(
            &router,
            "PUT",
            &race_uri,
            "editor",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            order(&customer, &product, "4.000000")
        ),
        action(&router, &raced, "confirm", "\"1\"", Uuid::now_v7()),
    );
    assert!([edit.0, confirm.0].contains(&StatusCode::OK));
    assert!([edit.0, confirm.0].contains(&StatusCode::PRECONDITION_FAILED));
    let current = call(&router, "GET", &race_uri, "reader", None, None, Value::Null).await;
    if confirm.0 == StatusCode::OK {
        assert_eq!(current.2["items"][0]["quantity"], "2.000000");
        assert_eq!(stock(&router).await["reserved"], "2.000000");
    } else {
        assert_eq!(current.2["items"][0]["quantity"], "4.000000");
        assert_eq!(current.2["data"]["status"], "draft");
    }
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn failed_draft_edit_rolls_back_header_lines_audit_and_command_before_retry(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let id = create(&router, &customer, &product, "3.000000").await;
    let uri = format!("/api/v1/orders/{id}");
    let before = call(&router, "GET", &uri, "editor", None, None, Value::Null).await;
    sqlx::raw_sql("CREATE FUNCTION fail_draft_edit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='order.updated' THEN RAISE EXCEPTION 'synthetic edit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_draft_edit BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_draft_edit();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    let input = order(&customer, &product, "8.000000");
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"1\""),
            Some(key),
            input.clone()
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let after = call(&router, "GET", &uri, "editor", None, None, Value::Null).await;
    assert_eq!(after.2, before.2);
    assert_eq!(after.1["etag"], "\"1\"");
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_commands WHERE scope='order.update'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log WHERE action='order.updated'")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    sqlx::query("DROP TRIGGER fail_draft_edit ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"1\""),
            Some(key),
            input
        )
        .await
        .0,
        StatusCode::OK
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn draft_edit_validates_inputs_permissions_and_new_customer_without_partial_writes(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let id = create(&router, &customer, &product, "3.000000").await;
    let uri = format!("/api/v1/orders/{id}");
    let input = order(&customer, &product, "1.000000");
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "reader",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            input.clone()
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
            "editor",
            None,
            Some(Uuid::now_v7()),
            input.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"1\""),
            None,
            input.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    for invalid in [
        order(&customer, &product, "0.000000"),
        json!({"customerId":customer,"dueDate":"2026-11-27","items":[]}),
        json!({"customerId":customer,"dueDate":"2026-11-27","items":[{"productId":product,"quantity":"1.000000"},{"productId":product,"quantity":"2.000000"}]}),
    ] {
        assert_eq!(
            call(
                &router,
                "PUT",
                &uri,
                "editor",
                Some("\"1\""),
                Some(Uuid::now_v7()),
                invalid.clone()
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    for nested in [false, true] {
        let mut invalid = input.clone();
        if nested {
            invalid["items"][0]["unitPrice"] = json!("0.01");
        } else {
            invalid["unitPrice"] = json!("0.01");
        }
        assert_eq!(
            call(
                &router,
                "PUT",
                &uri,
                "editor",
                Some("\"1\""),
                Some(Uuid::now_v7()),
                invalid
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let other_customer=call(&router,"POST","/api/v1/parties","editor",None,Some(Uuid::now_v7()),json!({"personType":"juridica","legalName":"Outro cliente ativo","tradeName":null,"taxId":"11444777000161","email":null,"phone":null,"isCustomer":true,"isSupplier":false,"status":"active"})).await;
    assert_eq!(other_customer.0, StatusCode::CREATED);
    let customer_id = other_customer.2["data"]["id"].as_str().unwrap();
    let changed = call(
        &router,
        "PUT",
        &uri,
        "editor",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        order(customer_id, &product, "1.000000"),
    )
    .await;
    assert_eq!(changed.0, StatusCode::OK);
    assert_eq!(changed.2["data"]["customerName"], "Outro cliente ativo");
    assert_eq!(changed.2["items"].as_array().unwrap().len(), 1);
    sqlx::query("UPDATE products SET status='archived' WHERE id=$1")
        .bind(Uuid::parse_str(&product).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some("\"2\""),
            Some(Uuid::now_v7()),
            order(customer_id, &product, "1.000000")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&router, "GET", &uri, "editor", None, None, Value::Null)
            .await
            .2,
        changed.2
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn existing_foreign_orders_receivables_and_payments_are_not_visible_or_writable(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (local_customer, local_product) = seed(&router, &admin).await;
    let other = Uuid::parse_str("22222222-2222-4222-8222-222222222222").unwrap();
    let party = Uuid::now_v7();
    let product = Uuid::now_v7();
    let order = Uuid::now_v7();
    let receivable = Uuid::now_v7();
    let payment = Uuid::now_v7();
    // Administrative storage fixtures deliberately belong to the other tenant.
    sqlx::raw_sql(&format!(
        "INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES('{party}','{other}','fisica','Pessoa externa','52998224725',true,false,'active');
         INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('{product}','{other}','FOREIGN-001','Produto externo','UN',33,'active');
         INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES('{order}','{other}','{party}','Pessoa externa','52998224725','2026-11-27',33,'completed');
         INSERT INTO sales_order_lines(tenant_id,order_id,line_number,product_id,sku,name,unit,quantity_micros,price_cents,amount_cents) VALUES('{other}','{order}',1,'{product}','FOREIGN-001','Produto externo','UN',1000000,33,33);
         INSERT INTO receivables(id,tenant_id,order_id,customer_name,due_date,amount_cents,status) VALUES('{receivable}','{other}','{order}','Pessoa externa','2026-11-27',33,'open');
         INSERT INTO receivable_payments(id,tenant_id,receivable_id,kind,amount_cents,method,reference,occurred_on) VALUES('{payment}','{other}','{receivable}','receipt',33,'cash','Fixture de outro tenant','2026-10-27');
         UPDATE receivables SET status='paid',payment_id='{payment}' WHERE id='{receivable}';"
    )).execute(&admin).await.unwrap();
    for uri in [
        format!("/api/v1/orders/{order}"),
        format!("/api/v1/receivables/{receivable}"),
    ] {
        assert_eq!(
            call(&router, "GET", &uri, "reader", None, None, Value::Null)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(
        call(
            &router,
            "PUT",
            &format!("/api/v1/orders/{order}"),
            "editor",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            self::order(&local_customer, &local_product, "1.000000")
        )
        .await
        .0,
        StatusCode::NOT_FOUND,
    );
    assert_eq!(
        action(
            &router,
            &order.to_string(),
            "complete",
            "\"1\"",
            Uuid::now_v7()
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let paid = json!({"amount":"0.33","method":"cash","reference":"Tentativa entre empresas","occurredOn":"2026-10-27"});
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/receivables/{receivable}/payments"),
            "editor",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            paid
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let mut tx = app.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(TENANT)
        .execute(&mut *tx)
        .await
        .unwrap();
    for table in [
        "sales_orders",
        "sales_order_lines",
        "receivables",
        "receivable_payments",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!(
                "SELECT count(*) FROM {table} WHERE tenant_id=$1"
            ))
            .bind(other)
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
            0
        );
    }
    let denied = sqlx::query("INSERT INTO receivable_payments(id,tenant_id,receivable_id,kind,amount_cents,method,reference,occurred_on) VALUES($1,$2,$3,'receipt',33,'cash','Tentativa proibida','2026-10-27')")
        .bind(Uuid::now_v7()).bind(other).bind(receivable).execute(&mut *tx).await.unwrap_err();
    assert_eq!(
        denied.as_database_error().unwrap().code().as_deref(),
        Some("42501")
    );
    tx.rollback().await.unwrap();
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn order_line_rounding_has_explicit_boundaries_and_catalog_changes_do_not_reprice_snapshots(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let mut ids = Vec::new();
    for (quantity, expected) in [("1.500000", "0.50"), ("0.015152", "0.01")] {
        let created = call(
            &router,
            "POST",
            "/api/v1/orders",
            "editor",
            None,
            Some(Uuid::now_v7()),
            order(&customer, &product, quantity),
        )
        .await;
        assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
        assert_eq!(created.2["data"]["amount"], expected);
        assert_eq!(created.2["items"][0]["amount"], expected);
        ids.push(created.2["data"]["id"].as_str().unwrap().to_owned());
    }
    let zero = call(
        &router,
        "POST",
        "/api/v1/orders",
        "editor",
        None,
        Some(Uuid::now_v7()),
        order(&customer, &product, "0.015151"),
    )
    .await;
    assert_eq!(zero.0, StatusCode::UNPROCESSABLE_ENTITY);
    let changed = json!({"sku":"OPER-001","name":"Produto com preço novo","unit":"UN","ncm":null,"cest":null,"basePrice":"100.00","status":"active"});
    assert_eq!(
        call(
            &router,
            "PUT",
            &format!("/api/v1/products/{product}"),
            "editor",
            Some("\"1\""),
            None,
            changed
        )
        .await
        .0,
        StatusCode::OK
    );
    let original = call(
        &router,
        "GET",
        &format!("/api/v1/orders/{}", ids[0]),
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(original.2["items"][0]["unitPrice"], "0.33");
    assert_eq!(original.2["data"]["amount"], "0.50");
    cleanup(&admin, app, server, &role).await;
}

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    subject: &str,
    etag: Option<&str>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", TENANT)
        .header("authorization", format!("Bearer {subject}"))
        .header("content-type", "application/json");
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
async fn seed(router: &Router, admin: &PgPool) -> (String, String) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions ON CONFLICT DO NOTHING; INSERT INTO role_permissions(role_id,permission_code) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','finance.receivables.read'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','inventory.stock.read');").execute(admin).await.unwrap();
    let party=call(router,"POST","/api/v1/parties","editor",None,Some(Uuid::now_v7()),json!({"personType":"juridica","legalName":"Cliente operacional","tradeName":null,"taxId":"04252011000110","email":null,"phone":null,"isCustomer":true,"isSupplier":false,"status":"active"})).await;
    assert_eq!(party.0, StatusCode::CREATED, "{}", party.2);
    let product=call(router,"POST","/api/v1/products","editor",None,Some(Uuid::now_v7()),json!({"sku":"OPER-001","name":"Produto operacional","unit":"UN","ncm":null,"cest":null,"basePrice":"0.33","status":"active"})).await;
    assert_eq!(product.0, StatusCode::CREATED, "{}", product.2);
    let product = product.2["data"]["id"].as_str().unwrap().to_owned();
    let receipt=call(router,"POST","/api/v1/stock/movements","editor",None,Some(Uuid::now_v7()),json!({"productId":product,"direction":"receipt","quantity":"10.000000","reason":"Estoque inicial de teste","reversesId":null})).await;
    assert_eq!(receipt.0, StatusCode::CREATED, "{}", receipt.2);
    (party.2["data"]["id"].as_str().unwrap().to_owned(), product)
}
fn order(customer: &str, product: &str, quantity: &str) -> Value {
    json!({"customerId":customer,"dueDate":"2026-11-27","items":[{"productId":product,"quantity":quantity}]})
}
async fn create(router: &Router, customer: &str, product: &str, quantity: &str) -> String {
    let created = call(
        router,
        "POST",
        "/api/v1/orders",
        "editor",
        None,
        Some(Uuid::now_v7()),
        order(customer, product, quantity),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    created.2["data"]["id"].as_str().unwrap().to_owned()
}
async fn action(
    router: &Router,
    id: &str,
    operation: &str,
    revision: &str,
    key: Uuid,
) -> (StatusCode, HeaderMap, Value) {
    call(
        router,
        "POST",
        &format!("/api/v1/orders/{id}/{operation}"),
        "editor",
        Some(revision),
        Some(key),
        Value::Null,
    )
    .await
}
async fn stock(router: &Router) -> Value {
    call(
        router,
        "GET",
        "/api/v1/stock",
        "reader",
        None,
        None,
        Value::Null,
    )
    .await
    .2["data"][0]
        .clone()
}

#[sqlx::test(migrations = "../../migrations")]
async fn confirmed_orders_serialize_reservations_and_protect_manual_stock_outflow(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let a = create(&router, &customer, &product, "7.000000").await;
    let b = create(&router, &customer, &product, "7.000000").await;
    let (x, y) = tokio::join!(
        action(&router, &a, "confirm", "\"1\"", Uuid::now_v7()),
        action(&router, &b, "confirm", "\"1\"", Uuid::now_v7())
    );
    let mut statuses = vec![x.0.as_u16(), y.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, vec![200, 409]);
    let (winner, waiting) = if x.0 == StatusCode::OK {
        (&a, &b)
    } else {
        (&b, &a)
    };
    let balance = stock(&router).await;
    assert_eq!(balance["quantity"], "10.000000");
    assert_eq!(balance["reserved"], "7.000000");
    assert_eq!(balance["available"], "3.000000");
    let manual = |quantity| json!({"productId":product,"direction":"issue","quantity":quantity,"reason":"Saída manual de teste","reversesId":null});
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(Uuid::now_v7()),
            manual("4.000000")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(Uuid::now_v7()),
            manual("3.000000")
        )
        .await
        .0,
        StatusCode::CREATED
    );
    assert_eq!(
        action(&router, winner, "cancel", "\"2\"", Uuid::now_v7())
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(stock(&router).await["available"], "7.000000");
    assert_eq!(
        action(&router, waiting, "confirm", "\"1\"", Uuid::now_v7())
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        action(&router, waiting, "complete", "\"2\"", Uuid::now_v7())
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(stock(&router).await["quantity"], "0.000000");
    assert_eq!(stock(&router).await["reserved"], "0.000000");
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn commercial_completion_and_manual_payment_reversal_preserve_all_ledgers(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let id = create(&router, &customer, &product, "3.000000").await;
    let confirm_key = Uuid::now_v7();
    let confirmed = action(&router, &id, "confirm", "\"1\"", confirm_key).await;
    assert_eq!(confirmed.0, StatusCode::OK);
    assert_eq!(
        confirmed.2,
        action(&router, &id, "confirm", "\"1\"", confirm_key)
            .await
            .2
    );
    let complete_key = Uuid::now_v7();
    let completed = action(&router, &id, "complete", "\"2\"", complete_key).await;
    assert_eq!(completed.0, StatusCode::OK, "{}", completed.2);
    assert_eq!(completed.2["data"]["amount"], "0.99");
    assert_eq!(
        completed.2,
        action(&router, &id, "complete", "\"2\"", complete_key)
            .await
            .2
    );
    assert_eq!(
        action(&router, &id, "cancel", "\"3\"", Uuid::now_v7())
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(stock(&router).await["quantity"], "7.000000");
    let history = call(
        &router,
        "GET",
        &format!("/api/v1/stock/movements?productId={product}"),
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(history.2["total"], 2);
    let movement = &history.2["data"][0];
    assert_eq!(movement["sourceOrderId"], id);
    let reverse_stock = json!({"productId":product,"direction":"receipt","quantity":"3.000000","reason":"Tentativa sem devolução","reversesId":movement["id"]});
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/stock/movements",
            "editor",
            None,
            Some(Uuid::now_v7()),
            reverse_stock
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let list = call(
        &router,
        "GET",
        "/api/v1/receivables",
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(list.2["total"], 1);
    let receivable = list.2["data"][0]["id"].as_str().unwrap();
    let uri = format!("/api/v1/receivables/{receivable}/payments");
    let payment = json!({"amount":"0.99","method":"bank_transfer","reference":"Declaração manual de teste","occurredOn":"2026-10-27"});
    let mut wrong = payment.clone();
    wrong["amount"] = json!("1.00");
    assert_eq!(
        call(
            &router,
            "POST",
            &uri,
            "editor",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            wrong
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
            Some("\"1\""),
            Some(Uuid::now_v7()),
            payment.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let key = Uuid::now_v7();
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            &uri,
            "editor",
            Some("\"1\""),
            Some(key),
            payment.clone()
        ),
        call(
            &router,
            "POST",
            &uri,
            "editor",
            Some("\"1\""),
            Some(key),
            payment.clone()
        )
    );
    assert_eq!(a.0, StatusCode::OK, "{}", a.2);
    assert_eq!(a.2, b.2);
    assert_eq!(a.2["payments"].as_array().unwrap().len(), 1);
    let payment_id = a.2["data"]["paymentId"].as_str().unwrap();
    let reverse_uri = format!("/api/v1/receivables/{receivable}/reverse-payment");
    let reversal = json!({"paymentId":payment_id,"reason":"Correção da declaração de recebimento","occurredOn":"2026-10-28"});
    let mut wrong = reversal.clone();
    wrong["paymentId"] = json!(Uuid::now_v7());
    assert_eq!(
        call(
            &router,
            "POST",
            &reverse_uri,
            "editor",
            Some("\"2\""),
            Some(Uuid::now_v7()),
            wrong
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut early = reversal.clone();
    early["occurredOn"] = json!("2026-10-26");
    assert_eq!(
        call(
            &router,
            "POST",
            &reverse_uri,
            "editor",
            Some("\"2\""),
            Some(Uuid::now_v7()),
            early
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let key = Uuid::now_v7();
    let reversed = call(
        &router,
        "POST",
        &reverse_uri,
        "editor",
        Some("\"2\""),
        Some(key),
        reversal.clone(),
    )
    .await;
    assert_eq!(reversed.0, StatusCode::OK, "{}", reversed.2);
    assert_eq!(reversed.2["data"]["status"], "open");
    assert_eq!(reversed.2["data"]["revision"], 3);
    assert_eq!(reversed.2["payments"].as_array().unwrap().len(), 2);
    assert_eq!(reversed.2["payments"][1]["reversesId"], payment_id);
    assert_eq!(
        reversed.2,
        call(
            &router,
            "POST",
            &reverse_uri,
            "editor",
            Some("\"2\""),
            Some(key),
            reversal.clone()
        )
        .await
        .2
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &reverse_uri,
            "editor",
            Some("\"3\""),
            Some(Uuid::now_v7()),
            reversal
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
            "editor",
            Some("\"3\""),
            Some(Uuid::now_v7()),
            payment
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut tx = app.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(TENANT)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(
        sqlx::query("DELETE FROM receivable_payments")
            .execute(&mut *tx)
            .await
            .is_err()
    );
    tx.rollback().await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivable_payments")
            .fetch_one(&admin)
            .await
            .unwrap(),
        3
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn order_and_payment_outbox_failures_roll_back_cross_domain_effects(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let id = create(&router, &customer, &product, "3.000000").await;
    assert_eq!(
        action(&router, &id, "confirm", "\"1\"", Uuid::now_v7())
            .await
            .0,
        StatusCode::OK
    );
    sqlx::raw_sql("CREATE FUNCTION fail_operation_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='order.completed' THEN RAISE EXCEPTION 'forced operation failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_operation_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_operation_outbox();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        action(&router, &id, "complete", "\"2\"", key).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let balance = stock(&router).await;
    assert_eq!(balance["quantity"], "10.000000");
    assert_eq!(balance["reserved"], "3.000000");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM stock_movements WHERE source_order_id IS NOT NULL"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_commands WHERE scope='order.complete'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    sqlx::query("DROP TRIGGER fail_operation_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        action(&router, &id, "complete", "\"2\"", key).await.0,
        StatusCode::OK
    );
    let list = call(
        &router,
        "GET",
        "/api/v1/receivables",
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    let receivable = list.2["data"][0]["id"].as_str().unwrap();
    sqlx::raw_sql("CREATE OR REPLACE FUNCTION fail_operation_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='receivable.paid' THEN RAISE EXCEPTION 'forced payment failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_operation_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_operation_outbox();").execute(&admin).await.unwrap();
    let pay_uri = format!("/api/v1/receivables/{receivable}/payments");
    let payment = json!({"amount":"0.99","method":"cash","reference":"Recebimento declarado","occurredOn":"2026-10-27"});
    let key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "POST",
            &pay_uri,
            "editor",
            Some("\"1\""),
            Some(key),
            payment.clone()
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivable_payments")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    let saved = call(
        &router,
        "GET",
        &format!("/api/v1/receivables/{receivable}"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(saved.2["data"]["status"], "open");
    assert_eq!(saved.2["data"]["revision"], 1);
    sqlx::query("DROP TRIGGER fail_operation_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &pay_uri,
            "editor",
            Some("\"1\""),
            Some(key),
            payment
        )
        .await
        .0,
        StatusCode::OK
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn commercial_inputs_permissions_and_tenant_references_fail_closed(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    let (customer, product) = seed(&router, &admin).await;
    let input = order(&customer, &product, "1.000000");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/orders",
            "reader",
            None,
            Some(Uuid::now_v7()),
            input.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/orders",
            "editor",
            None,
            None,
            input.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    for quantity in ["1.2", "0.000000", "-1.000000", "1e2"] {
        assert_eq!(
            call(
                &router,
                "POST",
                "/api/v1/orders",
                "editor",
                None,
                Some(Uuid::now_v7()),
                order(&customer, &product, quantity)
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let mut invalid = input.clone();
    invalid["dueDate"] = json!("2026-02-29");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/orders",
            "editor",
            None,
            Some(Uuid::now_v7()),
            invalid
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut invalid = input.clone();
    invalid["amount"] = json!("0.01");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/orders",
            "editor",
            None,
            Some(Uuid::now_v7()),
            invalid
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/orders",
            "editor",
            None,
            Some(Uuid::now_v7()),
            order(&Uuid::now_v7().to_string(), &product, "1.000000")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let id = create(&router, &customer, &product, "1.000000").await;
    let changed_identity = json!({"personType":"juridica","legalName":"Cliente operacional","tradeName":null,"taxId":"11444777000161","email":null,"phone":null,"isCustomer":true,"isSupplier":false,"status":"active"});
    assert_eq!(
        call(
            &router,
            "PUT",
            &format!("/api/v1/parties/{customer}"),
            "editor",
            Some("\"1\""),
            None,
            changed_identity
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/orders/{id}/confirm"),
            "reader",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for uri in [
        format!("/api/v1/orders/{}", Uuid::now_v7()),
        format!("/api/v1/receivables/{}", Uuid::now_v7()),
    ] {
        assert_eq!(
            call(&router, "GET", &uri, "reader", None, None, Value::Null)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }
    for table in [
        "sales_orders",
        "sales_order_lines",
        "receivables",
        "receivable_payments",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&app)
                .await
                .unwrap(),
            0
        );
    }
    cleanup(&admin, app, server, &role).await;
}
