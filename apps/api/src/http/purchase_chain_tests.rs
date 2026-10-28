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
    call_as(router, method, uri, (TENANT, "editor"), revision, key, body).await
}

async fn call_as(
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
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn confirmed(router: &Router, input: Value) -> String {
    let (status, created) = call(
        router,
        "POST",
        "/api/v1/purchase-orders",
        None,
        Some(Uuid::now_v7()),
        input,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let uri = format!(
        "/api/v1/purchase-orders/{}",
        created["data"]["id"].as_str().unwrap()
    );
    let result = call(
        router,
        "POST",
        &format!("{uri}/confirm"),
        Some(1),
        Some(Uuid::now_v7()),
        json!({}),
    )
    .await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    uri
}

#[sqlx::test(migrations = "../../migrations")]
async fn receipt_failure_after_stock_and_finance_writes_rolls_back_the_whole_chain(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let uri = confirmed(&router, order()).await;
    sqlx::raw_sql("CREATE FUNCTION fail_payable_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='payable.created' THEN RAISE EXCEPTION 'fixture failure after inventory and finance writes'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_payable_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_payable_event();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    let failed = call(
        &router,
        "POST",
        &format!("{uri}/receipts"),
        Some(2),
        Some(key),
        receipt("FAIL-REC", "1"),
    )
    .await;
    assert_eq!(failed.0, StatusCode::INTERNAL_SERVER_ERROR, "{}", failed.1);
    for table in [
        "purchase_receipts",
        "purchase_receipt_lines",
        "stock_balances",
        "stock_movements",
        "payables",
        "payable_payments",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&admin)
            .await
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
    let saved = call(&router, "GET", &uri, None, None, Value::Null).await.1;
    assert_eq!(saved["data"]["revision"], 2);
    assert_eq!(saved["data"]["status"], "confirmed");
    assert_eq!(saved["items"][0]["receivedQuantity"], "0.000000");
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM domain_commands WHERE command_key=$1")
            .bind(key)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(count, 0);
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE entity_type IN ('stock_movement','payable','purchase_receipt')").fetch_one(&admin).await.unwrap();
    assert_eq!(count, 0);
    sqlx::query("DROP TRIGGER fail_payable_event ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/receipts"),
            Some(2),
            Some(key),
            receipt("FAIL-REC", "1")
        )
        .await
        .0,
        StatusCode::CREATED
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fractional_receipts_reconcile_exactly_and_zero_value_receipts_do_not_create_titles(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let mut input = order();
    input["items"][0]["quantity"] = json!("1.000000");
    input["items"][0]["unitCost"] = json!("0.01");
    let uri = confirmed(&router, input).await;
    let first_key = Uuid::now_v7();
    let mut first = None;
    for (index, (quantity, amount)) in [
        ("0.333333", "0.00"),
        ("0.333333", "0.01"),
        ("0.333334", "0.00"),
    ]
    .into_iter()
    .enumerate()
    {
        let key = if index == 0 {
            first_key
        } else {
            Uuid::now_v7()
        };
        let result = call(
            &router,
            "POST",
            &format!("{uri}/receipts"),
            Some(2 + index as i64),
            Some(key),
            receipt(&format!("ROUND-{index}"), quantity),
        )
        .await;
        assert_eq!(result.0, StatusCode::CREATED, "{}", result.1);
        assert_eq!(result.1["receipt"]["data"]["amount"], amount);
        assert_eq!(result.1["payableId"].is_null(), amount == "0.00");
        if index == 0 {
            first = Some(result);
        }
    }
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/receipts"),
            Some(2),
            Some(first_key),
            receipt("ROUND-0", "0.333333")
        )
        .await,
        first.unwrap()
    );
    let order = call(&router, "GET", &uri, None, None, Value::Null).await.1;
    assert_eq!(order["data"]["status"], "received");
    assert_eq!(order["receiptCount"], 3);
    let totals:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT sum(amount_cents)::bigint FROM purchase_receipts),(SELECT sum(amount_cents)::bigint FROM payables),(SELECT sum(quantity_micros)::bigint FROM stock_movements)").fetch_one(&admin).await.unwrap();
    assert_eq!(totals, (1, 1, 1000000));
    let list = call(
        &router,
        "GET",
        &format!("{uri}/receipts?limit=1&offset=1"),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(list.0, StatusCode::OK);
    assert_eq!(list.1["total"], 3);
    assert_eq!(list.1["data"].as_array().unwrap().len(), 1);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn concurrent_receipts_and_payments_never_duplicate_or_exceed_remaining_balances(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let uri = confirmed(&router, order()).await;
    let receipt_uri = format!("{uri}/receipts");
    let key = Uuid::now_v7();
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            &receipt_uri,
            Some(2),
            Some(key),
            receipt("CONCURRENT-1", "1")
        ),
        call(
            &router,
            "POST",
            &receipt_uri,
            Some(2),
            Some(key),
            receipt("CONCURRENT-1", "1")
        )
    );
    assert_eq!(a.0, StatusCode::CREATED, "{}", a.1);
    assert_eq!(a, b);
    let payable = format!("/api/v1/payables/{}", a.1["payableId"].as_str().unwrap());
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            &receipt_uri,
            Some(3),
            Some(Uuid::now_v7()),
            receipt("CONCURRENT-2", "1")
        ),
        call(
            &router,
            "POST",
            &receipt_uri,
            Some(3),
            Some(Uuid::now_v7()),
            receipt("CONCURRENT-3", "1")
        )
    );
    assert_eq!(
        [a.0, b.0]
            .iter()
            .filter(|s| **s == StatusCode::CREATED)
            .count(),
        1
    );
    assert_eq!(
        [a.0, b.0]
            .iter()
            .filter(|s| **s == StatusCode::PRECONDITION_FAILED)
            .count(),
        1
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &receipt_uri,
            Some(4),
            Some(Uuid::now_v7()),
            receipt("OVER", "2")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &receipt_uri,
            Some(4),
            Some(Uuid::now_v7()),
            receipt("CONCURRENT-1", "1")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let first_key = Uuid::now_v7();
    let second_key = Uuid::now_v7();
    let payment_uri = format!("{payable}/payments");
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            &payment_uri,
            Some(1),
            Some(first_key),
            payment("2.00")
        ),
        call(
            &router,
            "POST",
            &payment_uri,
            Some(1),
            Some(second_key),
            payment("2.00")
        )
    );
    assert_eq!(
        [a.0, b.0].iter().filter(|s| **s == StatusCode::OK).count(),
        1
    );
    assert_eq!(
        [a.0, b.0]
            .iter()
            .filter(|s| **s == StatusCode::PRECONDITION_FAILED)
            .count(),
        1
    );
    let (paid, key) = if a.0 == StatusCode::OK {
        (a, first_key)
    } else {
        (b, second_key)
    };
    assert_eq!(paid.1["data"]["outstandingAmount"], "1.33");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{payable}/payments"),
            Some(1),
            Some(key),
            payment("2.00")
        )
        .await,
        paid
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{payable}/payments"),
            Some(2),
            Some(Uuid::now_v7()),
            payment("1.34")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let payment_id = paid.1["payments"][0]["id"].clone();
    let reverse =
        json!({"paymentId":payment_id,"reason":"Correção de teste","occurredOn":"2026-10-28"});
    let reversed = call(
        &router,
        "POST",
        &format!("{payable}/reverse-payment"),
        Some(2),
        Some(Uuid::now_v7()),
        reverse.clone(),
    )
    .await;
    assert_eq!(reversed.0, StatusCode::OK, "{}", reversed.1);
    assert_eq!(reversed.1["data"]["outstandingAmount"], "3.33");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{payable}/reverse-payment"),
            Some(3),
            Some(Uuid::now_v7()),
            reverse
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let counts: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM purchase_receipts),(SELECT count(*) FROM payable_payments)",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(counts, (2, 2));
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cancellation_and_partial_closure_preserve_realized_effects(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let uri = confirmed(&router, order()).await;
    let cancelled = call(
        &router,
        "POST",
        &format!("{uri}/cancel"),
        Some(2),
        Some(Uuid::now_v7()),
        json!({"reason":"Compra cancelada antes de receber"}),
    )
    .await;
    assert_eq!(cancelled.0, StatusCode::OK);
    assert_eq!(cancelled.1["data"]["status"], "cancelled");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/receipts"),
            Some(3),
            Some(Uuid::now_v7()),
            receipt("CANCELLED", "1")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let uri = confirmed(&router, order()).await;
    let received = call(
        &router,
        "POST",
        &format!("{uri}/receipts"),
        Some(2),
        Some(Uuid::now_v7()),
        receipt("PARTIAL", "1"),
    )
    .await;
    assert_eq!(received.0, StatusCode::CREATED);
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/cancel"),
            Some(3),
            Some(Uuid::now_v7()),
            json!({"reason":"Não pode apagar recebimento"})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let closed = call(
        &router,
        "POST",
        &format!("{uri}/close"),
        Some(3),
        Some(Uuid::now_v7()),
        json!({"reason":"Fornecedor não entregará saldo restante"}),
    )
    .await;
    assert_eq!(closed.0, StatusCode::OK);
    assert_eq!(closed.1["data"]["status"], "closed");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/receipts"),
            Some(4),
            Some(Uuid::now_v7()),
            receipt("CLOSED", "1")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let movement: Uuid = sqlx::query_scalar("SELECT id FROM stock_movements LIMIT 1")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(call(&router,"POST","/api/v1/stock/movements",None,Some(Uuid::now_v7()),json!({"productId":PRODUCT,"direction":"issue","quantity":"1.000000","reason":"Não pode desfazer cadeia por fora","reversesId":movement})).await.0,StatusCode::CONFLICT);
    let totals:(i64,i64)=sqlx::query_as("SELECT (SELECT sum(quantity_micros)::bigint FROM stock_balances),(SELECT sum(amount_cents)::bigint FROM payables)").fetch_one(&admin).await.unwrap();
    assert_eq!(totals, (1000000, 333));
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn every_chain_effect_requires_its_permission_and_foreign_tenant_origins_are_inaccessible(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,code FROM permissions WHERE code IN ('purchasing.orders.read','finance.payables.read')").execute(&admin).await.unwrap();
    let uri = confirmed(&router, order()).await;
    let receipt_uri = format!("{uri}/receipts");
    let reader = (TENANT, "reader");
    assert_eq!(
        call_as(&router, "GET", &uri, reader, None, None, Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call_as(
            &router,
            "POST",
            &receipt_uri,
            reader,
            Some(2),
            Some(Uuid::now_v7()),
            receipt("NO-PERMISSION", "1")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='finance.payables.originate'").execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &receipt_uri,
            Some(2),
            Some(Uuid::now_v7()),
            receipt("NO-ORIGINATE", "1")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,code FROM permissions WHERE code IN ('purchasing.receipts.create','inventory.stock.manage','finance.payables.originate')").execute(&admin).await.unwrap();
    let received = call_as(
        &router,
        "POST",
        &receipt_uri,
        reader,
        Some(2),
        Some(Uuid::now_v7()),
        receipt("WAREHOUSE-ONLY", "1"),
    )
    .await;
    assert_eq!(received.0, StatusCode::CREATED, "{}", received.1);
    assert_eq!(received.1["order"]["canEdit"], false);
    let account = format!(
        "/api/v1/payables/{}",
        received.1["payableId"].as_str().unwrap()
    );
    assert_eq!(
        call_as(&router, "GET", &account, reader, None, None, Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call_as(
            &router,
            "POST",
            &format!("{account}/payments"),
            reader,
            Some(1),
            Some(Uuid::now_v7()),
            payment("1.00")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::raw_sql("INSERT INTO tenant_memberships(id,tenant_id,identity_id) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'); INSERT INTO roles(id,tenant_id,code,name) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222','buyer','Buyer'); INSERT INTO membership_roles(membership_id,role_id) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'); INSERT INTO role_permissions(role_id,permission_code) SELECT 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,code FROM permissions WHERE code LIKE 'purchasing.%' OR code LIKE 'finance.payables.%' OR code LIKE 'inventory.stock.%';").execute(&admin).await.unwrap();
    let other = ("22222222-2222-4222-8222-222222222222", "editor");
    assert_eq!(
        call_as(&router, "GET", &uri, other, None, None, Value::Null)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call_as(&router, "GET", &account, other, None, None, Value::Null)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call_as(
            &router,
            "POST",
            &receipt_uri,
            other,
            Some(3),
            Some(Uuid::now_v7()),
            receipt("FOREIGN-ORDER", "1")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call_as(
            &router,
            "POST",
            "/api/v1/purchase-orders",
            other,
            None,
            Some(Uuid::now_v7()),
            order()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut tx = app.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(other.0)
        .execute(&mut *tx)
        .await
        .unwrap();
    for table in [
        "purchase_orders",
        "purchase_order_lines",
        "purchase_receipts",
        "purchase_receipt_lines",
        "payables",
        "payable_payments",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
    tx.rollback().await.unwrap();
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn invalid_origins_units_and_payloads_do_not_leave_chain_effects(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/purchase-orders",
            None,
            None,
            order()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    for (field, value) in [
        ("dueDate", json!("2026-02-30")),
        ("items", json!([])),
        ("tenantId", json!(TENANT)),
    ] {
        let mut input = order();
        input[field] = value;
        assert_eq!(
            call(
                &router,
                "POST",
                "/api/v1/purchase-orders",
                None,
                Some(Uuid::now_v7()),
                input
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let mut duplicate = order();
    duplicate["items"] = json!([duplicate["items"][0], duplicate["items"][0]]);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/purchase-orders",
            None,
            Some(Uuid::now_v7()),
            duplicate
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let uri = confirmed(&router, order()).await;
    assert_eq!(
        call(&router, "PUT", &uri, Some(2), None, order()).await.0,
        StatusCode::CONFLICT
    );
    let mut duplicate = receipt("DUPLICATE-LINE", "1");
    duplicate["items"] = json!([duplicate["items"][0], duplicate["items"][0]]);
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/receipts"),
            Some(2),
            Some(Uuid::now_v7()),
            duplicate
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    sqlx::query("UPDATE products SET unit='KG' WHERE id=$1::uuid")
        .bind(PRODUCT)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/receipts"),
            Some(2),
            Some(Uuid::now_v7()),
            receipt("WRONG-UNIT", "1")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM purchase_receipts),(SELECT count(*) FROM stock_movements),(SELECT count(*) FROM payables)").fetch_one(&admin).await.unwrap();
    assert_eq!(counts, (0, 0, 0));
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code IN ('catalog.parties.read','catalog.parties.manage')").execute(&admin).await.unwrap();
    assert_eq!(call(&router,"PUT",&format!("/api/v1/parties/{SUPPLIER}"),Some(1),None,json!({"personType":"fisica","legalName":"Fornecedor","taxId":"11144477735","isCustomer":false,"isSupplier":true,"status":"active"})).await.0,StatusCode::CONFLICT);
    cleanup(&admin, app, server, &role).await;
}

fn order() -> Value {
    json!({"supplierId":SUPPLIER,"dueDate":"2026-11-30","items":[{"productId":PRODUCT,"quantity":"3.000000","unitCost":"3.33"}]})
}

fn receipt(reference: &str, quantity: &str) -> Value {
    let quantity = if quantity.contains('.') {
        quantity.to_owned()
    } else {
        format!("{quantity}.000000")
    };
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
