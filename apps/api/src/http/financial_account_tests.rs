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
const SOURCE: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const TARGET: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";

async fn grant(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code LIKE 'finance.account_entries.%' OR code LIKE 'finance.account_transfers.%'; INSERT INTO role_permissions(role_id,permission_code) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',code FROM permissions WHERE code LIKE 'finance.account_entries.%' OR code LIKE 'finance.account_transfers.%';")
        .execute(admin).await.unwrap();
}

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    subject: &str,
    tenant: &str,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {subject}"))
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
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

#[sqlx::test(migrations = "../../migrations")]
async fn financial_account_ledger_is_idempotent_atomic_and_tenant_isolated(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    grant(&admin).await;
    sqlx::raw_sql(&format!("INSERT INTO financial_accounts(id,tenant_id,code,name,status,revision,account_type) VALUES('{SOURCE}','{TENANT}','CAIXA-A','Caixa origem','active',1,'cash'),('{TARGET}','{TENANT}','BANCO-B','Banco destino','active',1,'bank');")).execute(&admin).await.unwrap();

    let key = Uuid::now_v7();
    let entry = json!({"accountId":SOURCE,"direction":"credit","amount":"100.00","occurredOn":"2026-11-07","description":"Saldo inicial conferido","reference":"Abertura"});
    let first = call(
        &router,
        "POST",
        "/api/v1/financial-account-entries",
        "editor",
        TENANT,
        Some(key),
        entry.clone(),
    )
    .await;
    assert_eq!(first.0, StatusCode::CREATED, "{}", first.1);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/financial-account-entries",
            "editor",
            TENANT,
            Some(key),
            entry
        )
        .await,
        first
    );

    let transfer = call(&router, "POST", "/api/v1/financial-account-transfers", "editor", TENANT, Some(Uuid::now_v7()), json!({"sourceAccountId":SOURCE,"targetAccountId":TARGET,"amount":"30.00","occurredOn":"2026-11-07","description":"Transferência de teste","reference":"Movimentação interna"})).await;
    assert_eq!(transfer.0, StatusCode::CREATED, "{}", transfer.1);
    let source = call(
        &router,
        "GET",
        &format!("/api/v1/financial-account-entries?accountId={SOURCE}"),
        "reader",
        TENANT,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(source.0, StatusCode::OK);
    assert_eq!(source.1["data"]["credit"], "100.00");
    assert_eq!(source.1["data"]["debit"], "30.00");
    assert_eq!(source.1["data"]["balance"], "70.00");
    assert_eq!(source.1["data"]["entries"].as_array().unwrap().len(), 2);
    let target = call(
        &router,
        "GET",
        &format!("/api/v1/financial-account-entries?accountId={TARGET}"),
        "reader",
        TENANT,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(target.1["data"]["balance"], "30.00");
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM financial_account_entries WHERE tenant_id=$1"
        )
        .bind(TENANT)
        .fetch_one(&admin)
        .await
        .unwrap(),
        3
    );

    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(OTHER)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM financial_account_entries")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM financial_account_transfers")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    tx.rollback().await.unwrap();
    cleanup(&admin, application, server, &role).await;
}
