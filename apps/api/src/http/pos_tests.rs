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
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const CASH: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const BANK: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const PRODUCT: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    subject: &str,
    tenant: &str,
    key: Option<Uuid>,
    revision: Option<i64>,
    body: Value,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {subject}"))
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if let Some(key) = key {
        req = req.header("idempotency-key", key.to_string())
    }
    if let Some(revision) = revision {
        req = req.header("if-match", format!("\"{revision}\""))
    }
    let res = router
        .clone()
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 1_000_000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
#[sqlx::test(migrations = "../../migrations")]
async fn pos_checkout_refund_close_are_atomic_idempotent_and_tenant_isolated(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code LIKE 'sales.pos.%'; INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.pos.read');").execute(&admin).await.unwrap();
    sqlx::raw_sql(&format!("INSERT INTO financial_accounts(id,tenant_id,code,name,status,revision,account_type) VALUES('{CASH}','{TENANT}','POS-CASH','Caixa','active',1,'cash'),('{BANK}','{TENANT}','POS-BANK','Banco','active',1,'bank'); INSERT INTO financial_account_entries(id,tenant_id,account_id,direction,amount_cents,occurred_on,description) VALUES('{}','{TENANT}','{CASH}','credit',10000,CURRENT_DATE,'Saldo real conferido'),('{}','{TENANT}','{BANK}','credit',20000,CURRENT_DATE,'Saldo bancário real'); INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('{PRODUCT}','{TENANT}','POS-001','Produto PDV','UN',1000,'active'); INSERT INTO stock_balances(tenant_id,product_id,quantity_micros) VALUES('{TENANT}','{PRODUCT}',5000000);",Uuid::now_v7(),Uuid::now_v7())).execute(&admin).await.unwrap();
    let opening = json!({"register":"Balcão 1","cashAccountId":CASH,"openingAmount":"100.00"});
    let denied = call(
        &router,
        "POST",
        "/api/v1/pos/sessions",
        "reader",
        TENANT,
        Some(Uuid::now_v7()),
        None,
        opening.clone(),
    )
    .await;
    assert_eq!(denied.0, StatusCode::FORBIDDEN);
    let excess = call(
        &router,
        "POST",
        "/api/v1/pos/sessions",
        "editor",
        TENANT,
        Some(Uuid::now_v7()),
        None,
        json!({"register":"Caixa","cashAccountId":CASH,"openingAmount":"101.00"}),
    )
    .await;
    assert_eq!(excess.0, StatusCode::CONFLICT);
    let key = Uuid::now_v7();
    let first = call(
        &router,
        "POST",
        "/api/v1/pos/sessions",
        "editor",
        TENANT,
        Some(key),
        None,
        opening.clone(),
    )
    .await;
    assert_eq!(first.0, StatusCode::CREATED, "{}", first.1);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/pos/sessions",
            "editor",
            TENANT,
            Some(key),
            None,
            opening
        )
        .await,
        first
    );
    let session = first.1["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/pos/sessions/{session}");
    // Ordinary finance rights never permit bypassing the active POS session.
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code LIKE 'finance.account_entries.%' OR code LIKE 'finance.account_transfers.%' ON CONFLICT DO NOTHING;").execute(&admin).await.unwrap();
    for direction in ["credit", "debit"] {
        let blocked=call(&router,"POST","/api/v1/financial-account-entries","editor",TENANT,Some(Uuid::now_v7()),None,json!({"accountId":CASH,"direction":direction,"amount":"1.00","occurredOn":"2026-11-09","description":"Tentativa fora do caixa"})).await;
        assert_eq!(blocked.0, StatusCode::CONFLICT, "{}", blocked.1);
    }
    for (source, target) in [(CASH, BANK), (BANK, CASH)] {
        let blocked=call(&router,"POST","/api/v1/financial-account-transfers","editor",TENANT,Some(Uuid::now_v7()),None,json!({"sourceAccountId":source,"targetAccountId":target,"amount":"1.00","occurredOn":"2026-11-09","description":"Tentativa fora do caixa"})).await;
        assert_eq!(blocked.0, StatusCode::CONFLICT, "{}", blocked.1);
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM financial_account_entries WHERE tenant_id=$1"
        )
        .bind(Uuid::parse_str(TENANT).unwrap())
        .fetch_one(&admin)
        .await
        .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM financial_account_transfers WHERE tenant_id=$1"
        )
        .bind(Uuid::parse_str(TENANT).unwrap())
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    let unchanged = call(
        &router,
        "GET",
        &uri,
        "reader",
        TENANT,
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(unchanged.1["data"]["revision"], 1);
    assert_eq!(unchanged.1["data"]["totals"]["expectedCash"], "100.00");
    let duplicate = call(
        &router,
        "POST",
        "/api/v1/pos/sessions",
        "editor",
        TENANT,
        Some(Uuid::now_v7()),
        None,
        json!({"register":"Outro caixa","cashAccountId":CASH,"openingAmount":"0.00"}),
    )
    .await;
    assert_eq!(duplicate.0, StatusCode::CONFLICT);
    let body = json!({"items":[{"productId":PRODUCT,"quantity":"2.000000"}],"payments":[{"method":"cash","accountId":CASH,"amount":"12.00","tendered":"20.00"},{"method":"pix","accountId":BANK,"amount":"8.00"}],"expectedTotal":"20.00","destination":"SP","taxpayer":false});
    let mut changed = body.clone();
    changed["expectedTotal"] = json!("19.00");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/sales"),
            "editor",
            TENANT,
            Some(Uuid::now_v7()),
            Some(1),
            changed
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut oversell = body.clone();
    oversell["items"][0]["quantity"] = json!("6.000000");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/sales"),
            "editor",
            TENANT,
            Some(Uuid::now_v7()),
            Some(1),
            oversell
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let key = Uuid::now_v7();
    let sale_uri = format!("{uri}/sales");
    let (sold, concurrent_retry) = tokio::join!(
        call(
            &router,
            "POST",
            &sale_uri,
            "editor",
            TENANT,
            Some(key),
            Some(1),
            body.clone()
        ),
        call(
            &router,
            "POST",
            &sale_uri,
            "editor",
            TENANT,
            Some(key),
            Some(1),
            body.clone()
        )
    );
    assert_eq!(
        sold, concurrent_retry,
        "simultaneous checkout retries must create only one receipt"
    );
    assert_eq!(sold.0, StatusCode::CREATED, "{}", sold.1);
    assert_eq!(sold.1["session"]["totals"]["expectedCash"], "112.00");
    assert_eq!(sold.1["data"]["payments"][0]["change"], "8.00");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/sales"),
            "editor",
            TENANT,
            Some(key),
            Some(1),
            body
        )
        .await,
        sold
    );
    let sale = sold.1["data"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/v1/pos/sales/{sale}"),
            "editor",
            OTHER,
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let supply=call(&router,"POST",&format!("{uri}/movements"),"editor",TENANT,Some(Uuid::now_v7()),Some(2),json!({"direction":"supply","amount":"30.00","reason":"Reforço de troco","sourceAccountId":BANK})).await;
    assert_eq!(supply.0, StatusCode::OK, "{}", supply.1);
    assert_eq!(supply.1["data"]["totals"]["expectedCash"], "142.00");
    let withdrawal=call(&router,"POST",&format!("{uri}/movements"),"editor",TENANT,Some(Uuid::now_v7()),Some(3),json!({"direction":"withdrawal","amount":"10.00","reason":"Depósito de segurança","targetAccountId":BANK})).await;
    assert_eq!(withdrawal.0, StatusCode::OK, "{}", withdrawal.1);
    let key = Uuid::now_v7();
    let refund_body = json!({"reason":"Cliente devolveu todos os produtos"});
    let refunded = call(
        &router,
        "POST",
        &format!("/api/v1/pos/sales/{sale}/cancel"),
        "editor",
        TENANT,
        Some(key),
        Some(4),
        refund_body.clone(),
    )
    .await;
    assert_eq!(refunded.0, StatusCode::OK, "{}", refunded.1);
    assert_eq!(refunded.1["session"]["totals"]["expectedCash"], "120.00");
    assert_eq!(refunded.1["session"]["totals"]["refunds"], "12.00");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/pos/sales/{sale}/cancel"),
            "editor",
            TENANT,
            Some(key),
            Some(4),
            refund_body.clone()
        )
        .await,
        refunded
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/pos/sales/{sale}/cancel"),
            "editor",
            TENANT,
            Some(Uuid::now_v7()),
            Some(5),
            refund_body
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT quantity_micros FROM stock_balances WHERE product_id=$1"
        )
        .bind(Uuid::parse_str(PRODUCT).unwrap())
        .fetch_one(&admin)
        .await
        .unwrap(),
        5000000
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM stock_movements WHERE source_pos_sale_id=$1"
        )
        .bind(Uuid::parse_str(sale).unwrap())
        .fetch_one(&admin)
        .await
        .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM financial_account_entries WHERE tenant_id=$1"
        )
        .bind(Uuid::parse_str(TENANT).unwrap())
        .fetch_one(&admin)
        .await
        .unwrap(),
        10,
        "2 seeded entries + 2 sale + 4 transfer + 2 refund; replay creates none"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM financial_account_transfers WHERE tenant_id=$1"
        )
        .bind(Uuid::parse_str(TENANT).unwrap())
        .fetch_one(&admin)
        .await
        .unwrap(),
        2
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END)::bigint FROM financial_account_entries WHERE tenant_id=$1 AND account_id=$2").bind(Uuid::parse_str(TENANT).unwrap()).bind(Uuid::parse_str(CASH).unwrap()).fetch_one(&admin).await.unwrap(),12000);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM financial_account_entries WHERE tenant_id=$1 AND description LIKE 'PDV %' AND occurred_on<>(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date").bind(Uuid::parse_str(TENANT).unwrap()).fetch_one(&admin).await.unwrap(),0);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM financial_account_transfers WHERE tenant_id=$1 AND occurred_on<>(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date").bind(Uuid::parse_str(TENANT).unwrap()).fetch_one(&admin).await.unwrap(),0);
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{uri}/close"),
            "editor",
            TENANT,
            Some(Uuid::now_v7()),
            Some(5),
            json!({"countedCash":"119.00"})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let closed = call(
        &router,
        "POST",
        &format!("{uri}/close"),
        "editor",
        TENANT,
        Some(Uuid::now_v7()),
        Some(5),
        json!({"countedCash":"119.00","reason":"Diferença conferida pelo responsável"}),
    )
    .await;
    assert_eq!(closed.0, StatusCode::OK, "{}", closed.1);
    assert_eq!(closed.1["data"]["totals"]["difference"], "-1.00");
    assert_eq!(call(&router,"POST",&format!("{uri}/movements"),"editor",TENANT,Some(Uuid::now_v7()),Some(6),json!({"direction":"withdrawal","amount":"1.00","reason":"Tentativa tardia","targetAccountId":BANK})).await.0,StatusCode::CONFLICT);
    let history=call(&router,"GET","/api/v1/pos/sessions?status=closed&offset=0&limit=10&startDate=2000-01-01&endDate=2100-01-01","reader",TENANT,None,None,Value::Null).await;
    assert_eq!(history.0, StatusCode::OK);
    assert_eq!(history.1["total"], 1);
    let after_close=call(&router,"POST","/api/v1/financial-account-entries","editor",TENANT,Some(Uuid::now_v7()),None,json!({"accountId":CASH,"direction":"credit","amount":"1.00","occurredOn":"2026-11-09","description":"Após fechamento do caixa"})).await;
    assert_eq!(after_close.0, StatusCode::CREATED, "{}", after_close.1);
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(OTHER)
        .execute(&mut *tx)
        .await
        .unwrap();
    for table in [
        "pos_sessions",
        "pos_sales",
        "pos_sale_items",
        "pos_payments",
        "pos_cash_movements",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&mut *tx)
                .await
                .unwrap(),
            0
        );
    }
    tx.rollback().await.unwrap();
    cleanup(&admin, application, server, &role).await;
}
