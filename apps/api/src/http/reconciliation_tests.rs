use super::company_tests::{cleanup, setup};
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
const SELLER: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COMPONENT: &str = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    revision: Option<i64>,
    key: Uuid,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", "Bearer editor")
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json")
        .header("idempotency-key", key.to_string());
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
    }
    let reply = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = reply.status();
    let bytes = to_bytes(reply.into_body(), 1_000_000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[sqlx::test(migrations = "../../migrations")]
async fn reconciliation_cancellation_rolls_back_every_domain_then_replays_one_compensation(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    super::returns_tests::seed(&admin).await;
    sqlx::raw_sql("INSERT INTO staff(id,tenant_id,code,name,is_employee,is_seller,status) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','SALESPERSON','Vendedora',true,true,'active'); INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','COMPONENT','Componente','KG',123,'active'); INSERT INTO stock_balances(tenant_id,product_id,quantity_micros) VALUES('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',10000000); INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'production.%' ON CONFLICT DO NOTHING;").execute(&admin).await.unwrap();
    let stock = call(&router,"POST","/api/v1/stock/movements",None,Uuid::now_v7(),json!({"productId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","direction":"receipt","quantity":"3.000000","reason":"Saldo inicial conferido","reversesId":null})).await;
    assert_eq!(stock.0, StatusCode::CREATED, "{}", stock.1);
    let made = call(&router,"POST","/api/v1/orders",None,Uuid::now_v7(),json!({"customerId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","dueDate":"2026-11-01","items":[{"productId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","quantity":"2.000000"}]})).await;
    assert_eq!(made.0, StatusCode::CREATED, "{}", made.1);
    let order = made.1["data"]["id"].as_str().unwrap();
    let terms = call(&router,"PUT",&format!("/api/v1/orders/{order}/commission"),Some(1),Uuid::now_v7(),json!({"sellerStaffId":SELLER,"commissionRate":"10.0000","ipiRate":"0.0000","paymentDay":10})).await;
    assert_eq!(terms.0, StatusCode::OK, "{}", terms.1);
    for (revision, action) in [(2, "confirm"), (3, "complete")] {
        let result = call(
            &router,
            "POST",
            &format!("/api/v1/orders/{order}/{action}"),
            Some(revision),
            Uuid::now_v7(),
            json!({}),
        )
        .await;
        assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    }
    let order_id = Uuid::parse_str(order).unwrap();
    let account: Uuid = sqlx::query_scalar("SELECT id FROM receivables WHERE order_id=$1")
        .bind(order_id)
        .fetch_one(&admin)
        .await
        .unwrap();
    let received=call(&router,"POST",&format!("/api/v1/receivables/{account}/payments"),Some(1),Uuid::now_v7(),json!({"amount":"1.00","method":"bank_transfer","reference":"Recebimento parcial","occurredOn":"2026-10-30"})).await;
    assert_eq!(received.0, StatusCode::OK, "{}", received.1);
    let book = call(
        &router,
        "GET",
        &format!("/api/v1/commissions/{SELLER}"),
        None,
        Uuid::now_v7(),
        Value::Null,
    )
    .await;
    assert_eq!(book.0, StatusCode::OK, "{}", book.1);
    let paid=call(&router,"POST",&format!("/api/v1/commissions/{SELLER}/payments"),book.1["data"]["revision"].as_i64(),Uuid::now_v7(),json!({"throughCompetence":"2026-10","occurredOn":"2026-10-31","reference":"Comissão já paga"})).await;
    assert_eq!(paid.0, StatusCode::OK, "{}", paid.1);
    assert_eq!(paid.1["data"]["paidAmount"], "0.10");
    let jobs = call(
        &router,
        "POST",
        "/api/v1/production/orders",
        Some(4),
        Uuid::now_v7(),
        json!({"orderId":order}),
    )
    .await;
    assert_eq!(jobs.0, StatusCode::CREATED, "{}", jobs.1);
    let job = jobs.1["data"][0]["id"].as_str().unwrap();
    let consumed=call(&router,"POST",&format!("/api/v1/production/orders/{job}/consumptions"),Some(1),Uuid::now_v7(),json!({"productId":COMPONENT,"quantity":"1.250000","unitCost":"1.23","reason":"Consumo físico conferido"})).await;
    assert_eq!(consumed.0, StatusCode::OK, "{}", consumed.1);
    sqlx::raw_sql("CREATE FUNCTION fail_reconciliation_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='production.cancelled' THEN RAISE EXCEPTION 'isolated test rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_reconciliation_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_reconciliation_outbox();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    let uri = format!("/api/v1/orders/{order}/cancel-completed");
    let input = super::returns_tests::reversal();
    let failed = call(&router, "POST", &uri, Some(4), key, input.clone()).await;
    assert_eq!(failed.0, StatusCode::INTERNAL_SERVER_ERROR, "{}", failed.1);
    let state:(String,i64,i64,i64,i64)=sqlx::query_as("SELECT o.status,o.revision,(SELECT quantity_micros FROM stock_balances WHERE product_id=$2),(SELECT count(*) FROM commission_entries WHERE order_id=o.id),(SELECT count(*) FROM sales_order_cancellations WHERE order_id=o.id) FROM sales_orders o WHERE o.id=$1").bind(order_id).bind(Uuid::parse_str(COMPONENT).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(state, ("completed".into(), 4, 8_750_000, 1, 0));
    sqlx::query("DROP TRIGGER fail_reconciliation_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    let cancelled = call(&router, "POST", &uri, Some(4), key, input.clone()).await;
    assert_eq!(cancelled.0, StatusCode::OK, "{}", cancelled.1);
    assert_eq!(
        cancelled.1["data"]["reconciliation"]["commission"]["status"],
        "applied"
    );
    assert_eq!(
        cancelled.1["data"]["reconciliation"]["production"]["status"],
        "applied"
    );
    assert_eq!(
        call(&router, "POST", &uri, Some(4), key, input).await,
        cancelled
    );
    let book = call(
        &router,
        "GET",
        &format!("/api/v1/commissions/{SELLER}"),
        None,
        Uuid::now_v7(),
        Value::Null,
    )
    .await;
    assert_eq!(book.1["data"]["openAmount"], "-0.10");
    assert_eq!(book.1["data"]["paidAmount"], "0.10");
    assert_eq!(book.1["entries"].as_array().unwrap().len(), 2);
    let state:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT quantity_micros FROM stock_balances WHERE product_id=$1),(SELECT count(*) FROM commission_payments),(SELECT count(*) FROM stock_movements WHERE production_order_id=$2 AND reverses_id IS NOT NULL)").bind(Uuid::parse_str(COMPONENT).unwrap()).bind(Uuid::parse_str(job).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(state, (10_000_000, 1, 1));
    cleanup(&admin, app, server, &role).await;
}
