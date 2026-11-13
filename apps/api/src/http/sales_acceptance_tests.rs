use super::company_tests::{cleanup, setup};
use crate::domains::sales::checkout::{self, CheckoutInput};
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
const CUSTOMER: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const METHOD: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async fn seed(admin: &PgPool) {
    super::returns_tests::seed(admin).await;
    sqlx::raw_sql("UPDATE products SET price_cents=10000000 WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'; INSERT INTO payment_methods(id,tenant_id,code,name,status,revision,modality,settlement_days) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','ACCEPT-PIX','Pix sintético','active',1,'pix',0); INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read') ON CONFLICT DO NOTHING;")
        .execute(admin).await.unwrap();
}

async fn call(
    router: &Router,
    actor: (&str, &str),
    method: &str,
    uri: &str,
    revision: Option<i64>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {}", actor.1))
        .header("x-tenant-id", actor.0)
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
    let bytes = to_bytes(body, 1_000_000).await.unwrap();
    (
        parts.status,
        parts.headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn draft(router: &Router) -> Uuid {
    let result = call(router, (TENANT, "editor"), "POST", "/api/v1/orders", None, Some(Uuid::now_v7()), json!({"customerId":CUSTOMER,"dueDate":"2027-01-30","items":[{"productId":PRODUCT,"quantity":"1.000000"}]})).await;
    assert_eq!(result.0, StatusCode::CREATED, "{}", result.2);
    Uuid::parse_str(result.2["data"]["id"].as_str().unwrap()).unwrap()
}

async fn save(application: &PgPool, order: Uuid) {
    let input: CheckoutInput = serde_json::from_value(json!({"entry":{"paymentMethodId":METHOD,"dueOn":null},"installments":[{"paymentMethodId":METHOD,"dueOn":"2027-01-30","amountCents":5000000}],"manufacturingDays":45,"deliveryNotes":"Entrega após chegada real","paymentNotes":"Entrada e saldo","notes":"Acordo preservado"})).unwrap();
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(TENANT)
        .execute(&mut *tx)
        .await
        .unwrap();
    checkout::save(
        &mut tx,
        Uuid::parse_str(TENANT).unwrap(),
        order,
        Uuid::parse_str(CUSTOMER).unwrap(),
        10000000,
        5000000,
        &input,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

async fn accept(
    router: &Router,
    order: Uuid,
    revision: i64,
    key: Uuid,
) -> (StatusCode, HeaderMap, Value) {
    call(
        router,
        (TENANT, "editor"),
        "POST",
        &format!("/api/v1/orders/{order}/accept"),
        Some(revision),
        Some(key),
        json!({}),
    )
    .await
}

async fn unchanged(admin: &PgPool, order: Uuid) {
    let state: (String, i64) =
        sqlx::query_as("SELECT status,revision FROM sales_orders WHERE id=$1")
            .bind(order)
            .fetch_one(admin)
            .await
            .unwrap();
    assert_eq!(state, ("draft".into(), 1));
    let titles: i64 = sqlx::query_scalar("SELECT count(*) FROM receivables WHERE order_id=$1")
        .bind(order)
        .fetch_one(admin)
        .await
        .unwrap();
    assert_eq!(titles, 0);
    let commands: i64 =
        sqlx::query_scalar("SELECT count(*) FROM domain_commands WHERE scope='order.accept'")
            .fetch_one(admin)
            .await
            .unwrap();
    assert_eq!(commands, 0);
}

// Catches acceptance incorrectly requiring stock, leaving an editable obligation,
// duplicating titles on replay, or treating planned entry as received money.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_zero_stock_freezes_checkout_and_originates_all_titles_once(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    save(&application, order).await;
    let before = call(
        &router,
        (TENANT, "editor"),
        "GET",
        &format!("/api/v1/orders/{order}"),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(before.0, StatusCode::OK);
    assert_eq!(before.2["data"]["amount"], "100000.00");
    assert!(before.2["checkout"]["entry"]["dueOn"].is_null());
    let key = Uuid::now_v7();
    let accepted = accept(&router, order, 1, key).await;
    assert_eq!(accepted.0, StatusCode::OK, "{}", accepted.2);
    assert_eq!(accepted.1["etag"], "\"2\"");
    assert_eq!(accepted.2["data"]["status"], "accepted");
    assert_eq!(accepted.2["data"]["revision"], 2);
    assert_eq!(
        accepted.2["checkout"]["confirmationCreatesReceivables"],
        false
    );
    assert_eq!(
        accepted.2["checkout"]["customer"],
        before.2["checkout"]["customer"]
    );
    let local_date: String = sqlx::query_scalar(
        "SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date::text",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(accepted.2["checkout"]["entry"]["dueOn"], local_date);
    let replayed = accept(&router, order, 1, key).await;
    assert_eq!((replayed.0, replayed.2), (accepted.0, accepted.2.clone()));
    let titles: Vec<(i32,i64,String,String)> = sqlx::query_as("SELECT i.number,r.amount_cents,r.due_date::text,r.status FROM receivables r JOIN sales_order_installments i ON i.tenant_id=r.tenant_id AND i.id=r.order_installment_id WHERE r.order_id=$1 ORDER BY i.number").bind(order).fetch_all(&admin).await.unwrap();
    assert_eq!(
        titles,
        vec![
            (0, 5000000, local_date, "open".into()),
            (1, 5000000, "2027-01-30".into(), "open".into())
        ]
    );
    let physical: (i64,i64,i64,i64) = sqlx::query_as("SELECT (SELECT count(*) FROM stock_balances),(SELECT count(*) FROM stock_movements),(SELECT count(*) FROM receivable_payments),(SELECT count(*) FROM sales_orders WHERE status='confirmed')").fetch_one(&admin).await.unwrap();
    assert_eq!(physical, (0, 0, 0, 0));
    let command: (String, Value) =
        sqlx::query_as("SELECT scope,request FROM domain_commands WHERE command_key=$1")
            .bind(key)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(
        command,
        ("order.accept".into(), json!({"id":order,"revision":1}))
    );
    assert_eq!(accept(&router, order, 2, key).await.0, StatusCode::CONFLICT);
    assert_eq!(
        accept(&router, order, 2, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    let edit = call(&router,(TENANT,"editor"),"PUT",&format!("/api/v1/orders/{order}"),Some(2),Some(Uuid::now_v7()),json!({"customerId":CUSTOMER,"dueDate":"2027-02-20","items":[{"productId":PRODUCT,"quantity":"2.000000"}]})).await;
    assert_eq!(edit.0, StatusCode::CONFLICT);
    let event: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM outbox_events WHERE event_type='order.accepted' AND aggregate_id=$1",
    )
    .bind(order.to_string())
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(event, 1);
    let origin: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action='receivable.created' AND details->>'source'='accepted_order_schedule'").fetch_one(&admin).await.unwrap();
    assert_eq!(origin, 2);
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='sales.orders.manage'").execute(&admin).await.unwrap();
    assert_eq!(
        accept(&router, order, 1, key).await.0,
        StatusCode::FORBIDDEN
    );
    cleanup(&admin, application, server, &role).await;
}

// Catches missing commercial/auth/revision validation before any obligation exists.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_rejects_missing_checkout_pending_approval_foreign_or_unmanaged_order(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    unchanged(&admin, order).await;
    save(&application, order).await;
    for (actor, revision, status) in [
        ((TENANT, "reader"), 1, StatusCode::FORBIDDEN),
        ((OTHER, "editor"), 1, StatusCode::FORBIDDEN),
        ((TENANT, "disabled"), 1, StatusCode::FORBIDDEN),
        ((TENANT, "editor"), 2, StatusCode::PRECONDITION_FAILED),
    ] {
        let result = call(
            &router,
            actor,
            "POST",
            &format!("/api/v1/orders/{order}/accept"),
            Some(revision),
            Some(Uuid::now_v7()),
            json!({}),
        )
        .await;
        assert_eq!(result.0, status, "{}", result.2);
        unchanged(&admin, order).await;
    }
    for (mutation, restore) in [
        (
            "UPDATE sales_orders SET amount_cents=10000001",
            "UPDATE sales_orders SET amount_cents=10000000",
        ),
        (
            "UPDATE parties SET status='archived'",
            "UPDATE parties SET status='active'",
        ),
        (
            "UPDATE parties SET is_customer=false",
            "UPDATE parties SET is_customer=true",
        ),
        (
            "UPDATE products SET status='archived'",
            "UPDATE products SET status='active'",
        ),
        (
            "UPDATE products SET unit='KG'",
            "UPDATE products SET unit='UN'",
        ),
    ] {
        sqlx::query(mutation).execute(&admin).await.unwrap();
        let result = accept(&router, order, 1, Uuid::now_v7()).await;
        assert_eq!(result.0, StatusCode::CONFLICT, "{mutation}: {}", result.2);
        unchanged(&admin, order).await;
        sqlx::query(restore).execute(&admin).await.unwrap();
    }
    // A real quote with a pending management decision must keep blocking acceptance.
    sqlx::raw_sql("INSERT INTO commercial_settings(tenant_id,product_line,parameters,revision) VALUES('11111111-1111-4111-8111-111111111111','imported','{}',1); INSERT INTO price_table_versions(id,tenant_id,product_line,version,settings_revision,policy_snapshot,calculator_version,digest,published_by) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','imported',1,1,'{}','acceptance-test',repeat('a',64),'33333333-3333-4333-8333-333333333333')").execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO commercial_order_quotes(tenant_id,order_id,price_version_id,public_snapshot,private_snapshot,approval_rules,approval_status,requires_director,created_by) VALUES($1::uuid,$2,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','{}','{}','{}','pending',false,'33333333-3333-4333-8333-333333333333')").bind(TENANT).bind(order).execute(&admin).await.unwrap();
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    unchanged(&admin, order).await;
    cleanup(&admin, application, server, &role).await;
}

// Catches partial transaction commits when publishing the accepted event fails.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_outbox_failure_rolls_back_order_due_date_titles_audit_and_command(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    save(&application, order).await;
    let audits: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log")
        .fetch_one(&admin)
        .await
        .unwrap();
    let events: i64 = sqlx::query_scalar("SELECT count(*) FROM outbox_events")
        .fetch_one(&admin)
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION fail_acceptance_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='order.accepted' THEN RAISE EXCEPTION 'synthetic acceptance failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_acceptance_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_acceptance_outbox();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        accept(&router, order, 1, key).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    unchanged(&admin, order).await;
    let due: Option<String> = sqlx::query_scalar(
        "SELECT due_on::text FROM sales_order_installments WHERE order_id=$1 AND kind='entry'",
    )
    .bind(order)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert!(due.is_none());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        audits
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox_events")
            .fetch_one(&admin)
            .await
            .unwrap(),
        events
    );
    sqlx::query("DROP TRIGGER fail_acceptance_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(accept(&router, order, 1, key).await.0, StatusCode::OK);
    cleanup(&admin, application, server, &role).await;
}

// Catches an acceptance/confirmation race bypassing revision or double origin.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_competes_with_confirmation_and_repeated_acceptance(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let stock = call(&router,(TENANT,"editor"),"POST","/api/v1/stock/movements",None,Some(Uuid::now_v7()),json!({"productId":PRODUCT,"direction":"receipt","quantity":"1.000000","reason":"Entrada física sintética","reversesId":null})).await;
    assert_eq!(stock.0, StatusCode::CREATED, "{}", stock.2);
    let order = draft(&router).await;
    save(&application, order).await;
    let accept_key = Uuid::now_v7();
    let confirm_path = format!("/api/v1/orders/{order}/confirm");
    let (accepted, confirmed) = tokio::join!(
        accept(&router, order, 1, accept_key),
        call(
            &router,
            (TENANT, "editor"),
            "POST",
            &confirm_path,
            Some(1),
            Some(Uuid::now_v7()),
            json!({})
        )
    );
    assert!(
        (accepted.0 == StatusCode::OK && confirmed.0 == StatusCode::PRECONDITION_FAILED)
            || (confirmed.0 == StatusCode::OK && accepted.0 == StatusCode::PRECONDITION_FAILED),
        "accept {} confirm {}",
        accepted.2,
        confirmed.2
    );
    let titles: (i64, i64) = sqlx::query_as(
        "SELECT count(*),sum(amount_cents)::bigint FROM receivables WHERE order_id=$1",
    )
    .bind(order)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(titles, (2, 10000000));
    let order2 = draft(&router).await;
    save(&application, order2).await;
    let key = Uuid::now_v7();
    let (first, second) = tokio::join!(
        accept(&router, order2, 1, key),
        accept(&router, order2, 1, key)
    );
    assert_eq!(first.0, StatusCode::OK, "{}", first.2);
    assert_eq!((second.0, second.2), (first.0, first.2));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables WHERE order_id=$1")
            .bind(order2)
            .fetch_one(&admin)
            .await
            .unwrap(),
        2
    );
    cleanup(&admin, application, server, &role).await;
}
