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
const PARTY: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

pub(super) async fn seed(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','juridica','Cliente fornecedor','04252011000110',true,true,'active'); INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','RETURN-1','Produto','UN',100,'active'); INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'sales.%' OR code LIKE 'purchasing.%' OR code LIKE 'finance.%' OR code LIKE 'inventory.%' ON CONFLICT DO NOTHING;").execute(admin).await.unwrap();
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

pub(super) fn reversal() -> Value {
    json!({"reason":"Devolução integral conferida", "occurredOn":"2026-10-31"})
}
fn payment(amount: &str) -> Value {
    json!({"amount":amount,"method":"bank_transfer","reference":"Declaração teste","occurredOn":"2026-10-30"})
}

pub(super) async fn completed(router: &Router) -> (String, String) {
    let stock = call(router,"POST","/api/v1/stock/movements",None,Some(Uuid::now_v7()),json!({"productId":PRODUCT,"direction":"receipt","quantity":"3.000000","reason":"Saldo inicial","reversesId":null})).await;
    assert_eq!(stock.0, StatusCode::CREATED, "{}", stock.1);
    let created = call(router,"POST","/api/v1/orders",None,Some(Uuid::now_v7()),json!({"customerId":PARTY,"dueDate":"2026-11-01","items":[{"productId":PRODUCT,"quantity":"2.000000"}]})).await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    let id = created.1["data"]["id"].as_str().unwrap().to_owned();
    for (index, action) in ["confirm", "complete"].iter().enumerate() {
        let result = call(
            router,
            "POST",
            &format!("/api/v1/orders/{id}/{action}"),
            Some(index as i64 + 1),
            Some(Uuid::now_v7()),
            json!({}),
        )
        .await;
        assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    }
    let accounts = call(
        router,
        "GET",
        "/api/v1/receivables",
        None,
        None,
        Value::Null,
    )
    .await;
    (id, accounts.1["data"][0]["id"].as_str().unwrap().to_owned())
}

async fn received(router: &Router) -> (String, String, String) {
    let created=call(router,"POST","/api/v1/purchase-orders",None,Some(Uuid::now_v7()),json!({"supplierId":PARTY,"dueDate":"2026-11-01","items":[{"productId":PRODUCT,"quantity":"2.000000","unitCost":"1.00"}]})).await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    let order = created.1["data"]["id"].as_str().unwrap().to_owned();
    let result = call(
        router,
        "POST",
        &format!("/api/v1/purchase-orders/{order}/confirm"),
        Some(1),
        Some(Uuid::now_v7()),
        json!({}),
    )
    .await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    let result=call(router,"POST",&format!("/api/v1/purchase-orders/{order}/receipts"),Some(2),Some(Uuid::now_v7()),json!({"reference":"Compra recebida","occurredOn":"2026-10-30","items":[{"productId":PRODUCT,"quantity":"2.000000"}]})).await;
    assert_eq!(result.0, StatusCode::CREATED, "{}", result.1);
    (
        order,
        result.1["receipt"]["data"]["id"]
            .as_str()
            .unwrap()
            .to_owned(),
        result.1["payableId"].as_str().unwrap().to_owned(),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn completed_sale_cancellation_compensates_stock_and_active_receipts_once(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let (order, account) = completed(&router).await;
    let account_uri = format!("/api/v1/receivables/{account}");
    let paid = call(
        &router,
        "POST",
        &format!("{account_uri}/payments"),
        Some(1),
        Some(Uuid::now_v7()),
        payment("1.00"),
    )
    .await;
    assert_eq!(paid.0, StatusCode::OK, "{}", paid.1);
    let uri = format!("/api/v1/orders/{order}/cancel-completed");
    let key = Uuid::now_v7();
    let result = call(&router, "POST", &uri, Some(3), Some(key), reversal()).await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    assert_eq!(
        call(&router, "POST", &uri, Some(3), Some(key), reversal()).await,
        result
    );
    let mut changed = reversal();
    changed["reason"] = json!("Motivo alterado");
    assert_eq!(
        call(&router, "POST", &uri, Some(3), Some(key), changed)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let title = call(&router, "GET", &account_uri, None, None, Value::Null)
        .await
        .1;
    assert_eq!(title["data"]["status"], "cancelled");
    assert_eq!(title["data"]["outstandingAmount"], "0.00");
    assert_eq!(title["data"]["receivedAmount"], "0.00");
    assert_eq!(title["payments"].as_array().unwrap().len(), 2);
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{account_uri}/payments"),
            Some(3),
            Some(Uuid::now_v7()),
            payment("1.00")
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
            Some(4),
            Some(Uuid::now_v7()),
            reversal()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let counts:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT quantity_micros FROM stock_balances),(SELECT count(*) FROM stock_movements WHERE reverses_id IS NOT NULL),(SELECT count(*) FROM outbox_events WHERE event_type='sales.order.cancelled_completed')").fetch_one(&admin).await.unwrap();
    assert_eq!(counts, (3_000_000, 1, 1));
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn purchase_receipt_reversal_cancels_paid_title_and_reopens_purchase(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let (order, receipt, account) = received(&router).await;
    let account_uri = format!("/api/v1/payables/{account}");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{account_uri}/payments"),
            Some(1),
            Some(Uuid::now_v7()),
            payment("2.00")
        )
        .await
        .0,
        StatusCode::OK
    );
    let uri = format!("/api/v1/purchase-receipts/{receipt}/reverse");
    let key = Uuid::now_v7();
    let result = call(&router, "POST", &uri, Some(3), Some(key), reversal()).await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    assert_eq!(
        call(&router, "POST", &uri, Some(3), Some(key), reversal()).await,
        result
    );
    let title = call(&router, "GET", &account_uri, None, None, Value::Null)
        .await
        .1;
    assert_eq!(title["data"]["status"], "cancelled");
    assert_eq!(title["data"]["paidAmount"], "0.00");
    assert_eq!(title["data"]["outstandingAmount"], "0.00");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{account_uri}/payments"),
            Some(3),
            Some(Uuid::now_v7()),
            payment("1.00")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let saved = call(
        &router,
        "GET",
        &format!("/api/v1/purchase-orders/{order}"),
        None,
        None,
        Value::Null,
    )
    .await
    .1;
    assert_eq!(saved["data"]["status"], "confirmed");
    assert_eq!(saved["data"]["revision"], 4);
    assert_eq!(saved["items"][0]["receivedQuantity"], "0.000000");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT quantity_micros FROM stock_balances")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn returns_enforce_current_permissions_revision_reservations_and_rollback(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let (_order, receipt, _account) = received(&router).await;
    let uri = format!("/api/v1/purchase-receipts/{receipt}/reverse");
    assert_eq!(
        call(
            &router,
            "POST",
            &uri,
            None,
            Some(Uuid::now_v7()),
            reversal()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &uri,
            Some(2),
            Some(Uuid::now_v7()),
            reversal()
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='finance.payables.manage'").execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &uri,
            Some(3),
            Some(Uuid::now_v7()),
            reversal()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','finance.payables.manage')").execute(&admin).await.unwrap();
    let sale=call(&router,"POST","/api/v1/orders",None,Some(Uuid::now_v7()),json!({"customerId":PARTY,"dueDate":"2026-11-01","items":[{"productId":PRODUCT,"quantity":"1.000000"}]})).await.1;
    let sales_uri = format!("/api/v1/orders/{}", sale["data"]["id"].as_str().unwrap());
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{sales_uri}/confirm"),
            Some(1),
            Some(Uuid::now_v7()),
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
            &uri,
            Some(3),
            Some(Uuid::now_v7()),
            reversal()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{sales_uri}/cancel"),
            Some(2),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::raw_sql("CREATE FUNCTION fail_returns_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='purchase.receipt.reversed' THEN RAISE EXCEPTION 'failure after compensation'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_returns_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_returns_event();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        call(&router, "POST", &uri, Some(3), Some(key), reversal())
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let state:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT quantity_micros FROM stock_balances),(SELECT count(*) FROM stock_movements WHERE reverses_id IS NOT NULL),(SELECT count(*) FROM domain_commands WHERE command_key=$1)").bind(key).fetch_one(&admin).await.unwrap();
    assert_eq!(state, (2_000_000, 0, 0));
    sqlx::query("DROP TRIGGER fail_returns_event ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(&router, "POST", &uri, Some(3), Some(key), reversal())
            .await
            .0,
        StatusCode::OK
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn receipt_reversal_preserves_cumulative_fractional_cost_rounding(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let created=call(&router,"POST","/api/v1/purchase-orders",None,Some(Uuid::now_v7()),json!({"supplierId":PARTY,"dueDate":"2026-11-01","items":[{"productId":PRODUCT,"quantity":"1.000000","unitCost":"0.01"}]})).await.1;
    let order = created["data"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/purchase-orders/{order}/confirm"),
            Some(1),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut receipts = Vec::new();
    for index in 0..2 {
        let result=call(&router,"POST",&format!("/api/v1/purchase-orders/{order}/receipts"),Some(2+index),Some(Uuid::now_v7()),json!({"reference":format!("Fração {index}"),"occurredOn":"2026-10-30","items":[{"productId":PRODUCT,"quantity":"0.333333"}]})).await;
        assert_eq!(result.0, StatusCode::CREATED, "{}", result.1);
        receipts.push(
            result.1["receipt"]["data"]["id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    let first = format!("/api/v1/purchase-receipts/{}/reverse", receipts[0]);
    let refused = call(
        &router,
        "POST",
        &first,
        Some(4),
        Some(Uuid::now_v7()),
        reversal(),
    )
    .await;
    assert_eq!(refused.0, StatusCode::CONFLICT, "{}", refused.1);
    assert!(refused.1["title"].as_str().unwrap().contains("posteriores"));
    let second = format!("/api/v1/purchase-receipts/{}/reverse", receipts[1]);
    assert_eq!(
        call(
            &router,
            "POST",
            &second,
            Some(4),
            Some(Uuid::now_v7()),
            reversal()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &first,
            Some(5),
            Some(Uuid::now_v7()),
            reversal()
        )
        .await
        .0,
        StatusCode::OK
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn sale_cancellation_serializes_concurrent_commands_and_rechecks_replay_rights(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let (order, _account) = completed(&router).await;
    let uri = format!("/api/v1/orders/{order}/cancel-completed");
    let key = Uuid::now_v7();
    let (left, right) = tokio::join!(
        call(&router, "POST", &uri, Some(3), Some(key), reversal()),
        call(&router, "POST", &uri, Some(3), Some(key), reversal())
    );
    assert_eq!(left.0, StatusCode::OK, "{}", left.1);
    assert_eq!(left, right);
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='inventory.stock.manage'").execute(&admin).await.unwrap();
    assert_eq!(
        call(&router, "POST", &uri, Some(3), Some(key), reversal())
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    sqlx::raw_sql("INSERT INTO tenant_memberships(id,tenant_id,identity_id,status) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','active'); INSERT INTO roles(id,tenant_id,code,name) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','22222222-2222-4222-8222-222222222222','returns','Returns'); INSERT INTO membership_roles(membership_id,role_id) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff'); INSERT INTO role_permissions(role_id,permission_code) SELECT 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid,code FROM permissions WHERE code LIKE 'sales.%' OR code LIKE 'inventory.%' OR code LIKE 'finance.%';").execute(&admin).await.unwrap();
    assert_eq!(
        call_as(
            &router,
            "POST",
            &uri,
            ("22222222-2222-4222-8222-222222222222", "editor"),
            Some(3),
            Some(Uuid::now_v7()),
            reversal()
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn sale_cancellation_reverses_only_active_receipts_and_rolls_back_all_effects(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let (order, account) = completed(&router).await;
    let account_uri = format!("/api/v1/receivables/{account}");
    let paid = call(
        &router,
        "POST",
        &format!("{account_uri}/payments"),
        Some(1),
        Some(Uuid::now_v7()),
        payment("0.50"),
    )
    .await;
    assert_eq!(paid.0, StatusCode::OK, "{}", paid.1);
    let prior = paid.1["payments"][0]["id"].as_str().unwrap();
    let reversed = call(
        &router,
        "POST",
        &format!("{account_uri}/reverse-payment"),
        Some(2),
        Some(Uuid::now_v7()),
        json!({"paymentId":prior,"reason":"Estorno anterior","occurredOn":"2026-10-30"}),
    )
    .await;
    assert_eq!(reversed.0, StatusCode::OK, "{}", reversed.1);
    let paid = call(
        &router,
        "POST",
        &format!("{account_uri}/payments"),
        Some(3),
        Some(Uuid::now_v7()),
        payment("2.00"),
    )
    .await;
    assert_eq!(paid.0, StatusCode::OK, "{}", paid.1);
    sqlx::raw_sql("CREATE FUNCTION fail_sale_return_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='sales.order.cancelled_completed' THEN RAISE EXCEPTION 'failure after full cancellation'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_sale_return_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_sale_return_event();").execute(&admin).await.unwrap();
    let uri = format!("/api/v1/orders/{order}/cancel-completed");
    let key = Uuid::now_v7();
    assert_eq!(
        call(&router, "POST", &uri, Some(3), Some(key), reversal())
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let state:(i64,i64,i64,i64)=sqlx::query_as("SELECT (SELECT quantity_micros FROM stock_balances),(SELECT count(*) FROM stock_movements WHERE reverses_id IS NOT NULL),(SELECT count(*) FROM receivable_payments),(SELECT count(*) FROM sales_order_cancellations)").fetch_one(&admin).await.unwrap();
    assert_eq!(state, (1_000_000, 0, 3, 0));
    let title = call(&router, "GET", &account_uri, None, None, Value::Null)
        .await
        .1;
    assert_eq!(title["data"]["status"], "paid");
    assert_eq!(title["data"]["revision"], 4);
    sqlx::query("DROP TRIGGER fail_sale_return_event ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    let result = call(&router, "POST", &uri, Some(3), Some(key), reversal()).await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    assert_eq!(
        result.1["data"]["paymentReversalIds"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let title = call(&router, "GET", &account_uri, None, None, Value::Null)
        .await
        .1;
    assert_eq!(title["data"]["status"], "cancelled");
    assert_eq!(title["payments"].as_array().unwrap().len(), 4);
    assert_eq!(call(&router,"POST",&format!("{account_uri}/reverse-payment"),Some(5),Some(Uuid::now_v7()),json!({"paymentId":prior,"reason":"Não reabrir título cancelado","occurredOn":"2026-10-31"})).await.0,StatusCode::CONFLICT);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn sale_cancellation_requires_reconciliation_of_uncertain_fiscal_transmission(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let (order, _account) = completed(&router).await;
    let draft = Uuid::now_v7();
    let tenant = Uuid::parse_str(TENANT).unwrap();
    sqlx::query("INSERT INTO fiscal_nfe_drafts(tenant_id,id,environment,model,profile_revision,company_revision,issuer_snapshot,details,products_total_cents) VALUES($1,$2,'homologation',55,1,1,'{}','{}',200)").bind(tenant).bind(draft).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO fiscal_nfe_documents(tenant_id,id,source_order_id,status,series,number,issued_at,random_code) VALUES($1,$2,$3,'unknown',1,1,'2026-10-31T12:00:00-03:00','12345678')").bind(tenant).bind(draft).bind(Uuid::parse_str(&order).unwrap()).execute(&admin).await.unwrap();
    let uri = format!("/api/v1/orders/{order}/cancel-completed");
    let key = Uuid::now_v7();
    assert_eq!(
        call(&router, "POST", &uri, Some(3), Some(key), reversal())
            .await
            .0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE fiscal_nfe_documents SET status='rejected' WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(draft)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(&router, "POST", &uri, Some(3), Some(key), reversal())
            .await
            .0,
        StatusCode::OK
    );
    cleanup(&admin, app, server, &role).await;
}
