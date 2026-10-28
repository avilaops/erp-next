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
const SUPPLIER: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async fn seed(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','juridica','Fornecedor','04252011000110',false,true,'active'); INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','BUY-1','Produto comprado','UN',100,'active'); INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'purchasing.%' OR code LIKE 'finance.payables.%' OR code LIKE 'inventory.stock.%';").execute(admin).await.unwrap();
}

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    revision: Option<i64>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", "Bearer editor")
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
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn order() -> Value {
    json!({"supplierId":SUPPLIER,"dueDate":"2026-11-30","items":[{"productId":PRODUCT,"quantity":"3.000000","unitCost":"3.33"}]})
}

fn receipt(reference: &str, quantity: &str) -> Value {
    json!({"reference":reference,"occurredOn":"2026-10-28","items":[{"productId":PRODUCT,"quantity":quantity}]})
}

fn payment(amount: &str) -> Value {
    json!({"amount":amount,"method":"bank_transfer","reference":"Declaração de teste","occurredOn":"2026-10-28"})
}

#[sqlx::test(migrations = "../../migrations")]
async fn purchase_to_receipts_stock_payables_payments_and_reversal_is_one_chain(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let (status, created) = call(
        &router,
        "POST",
        "/api/v1/purchase-orders",
        None,
        Some(Uuid::now_v7()),
        order(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/purchase-orders/{id}");
    assert_eq!(created["data"]["amount"], "9.99");
    assert_eq!(
        call(&router, "PUT", &uri, Some(1), None, order()).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/confirm"),
            Some(2),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    let first_key = Uuid::now_v7();
    let first = call(
        &router,
        "POST",
        &format!("{uri}/receipts"),
        Some(3),
        Some(first_key),
        receipt("REC-001", "1.000000"),
    )
    .await;
    assert_eq!(first.0, StatusCode::CREATED, "{}", first.1);
    let repeated = call(
        &router,
        "POST",
        &format!("{uri}/receipts"),
        Some(3),
        Some(first_key),
        receipt("REC-001", "1.000000"),
    )
    .await;
    assert_eq!(repeated, first);
    let account = first.1["payableId"].as_str().unwrap();
    let account_uri = format!("/api/v1/payables/{account}");
    let snapshot = call(&router, "GET", &account_uri, None, None, Value::Null).await;
    assert_eq!(snapshot.0, StatusCode::OK);
    assert_eq!(snapshot.1["data"]["amount"], "3.33");
    let paid_part = call(
        &router,
        "POST",
        &format!("{account_uri}/payments"),
        Some(1),
        Some(Uuid::now_v7()),
        payment("1.11"),
    )
    .await;
    assert_eq!(paid_part.0, StatusCode::OK, "{}", paid_part.1);
    assert_eq!(paid_part.1["data"]["outstandingAmount"], "2.22");
    let original_payment = paid_part.1["payments"][0]["id"].clone();
    let paid = call(
        &router,
        "POST",
        &format!("{account_uri}/payments"),
        Some(2),
        Some(Uuid::now_v7()),
        payment("2.22"),
    )
    .await;
    assert_eq!(paid.0, StatusCode::OK);
    assert_eq!(paid.1["data"]["status"], "paid");
    let reversed = call(&router,"POST",&format!("{account_uri}/reverse-payment"),Some(3),Some(Uuid::now_v7()),json!({"paymentId":original_payment,"reason":"Correção declarada","occurredOn":"2026-10-28"})).await;
    assert_eq!(reversed.0, StatusCode::OK, "{}", reversed.1);
    assert_eq!(reversed.1["data"]["outstandingAmount"], "1.11");
    let second = call(
        &router,
        "POST",
        &format!("{uri}/receipts"),
        Some(4),
        Some(Uuid::now_v7()),
        receipt("REC-002", "2.000000"),
    )
    .await;
    assert_eq!(second.0, StatusCode::CREATED, "{}", second.1);
    assert_eq!(second.1["order"]["data"]["status"], "received");
    let stock = call(&router, "GET", "/api/v1/stock", None, None, Value::Null).await;
    assert_eq!(stock.1["data"][0]["quantity"], "3.000000");
    let total: i64 = sqlx::query_scalar("SELECT sum(amount_cents)::bigint FROM payables")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(total, 999);
    let movements: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM stock_movements WHERE source_purchase_receipt_id IS NOT NULL",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(movements, 2);
    cleanup(&admin, app, server, &role).await;
}
