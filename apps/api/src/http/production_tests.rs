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
const COMPONENT: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async fn call(
    router: &Router,
    uri: &str,
    revision: Option<i64>,
    key: Uuid,
    input: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method("POST")
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
        .oneshot(request.body(Body::from(input.to_string())).unwrap())
        .await
        .unwrap();
    let status = reply.status();
    let bytes = to_bytes(reply.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn prepare(admin: &PgPool, router: &Router) -> (String, String) {
    super::returns_tests::seed(admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'production.%'; INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','COMP-1','Componente de produção','KG',250,'active'); INSERT INTO stock_balances(tenant_id,product_id,quantity_micros) VALUES('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',10000000);").execute(admin).await.unwrap();
    let (sale, _) = super::returns_tests::completed(router).await;
    let made = call(
        router,
        "/api/v1/production/orders",
        Some(3),
        Uuid::now_v7(),
        json!({"orderId":sale}),
    )
    .await;
    assert_eq!(made.0, StatusCode::CREATED, "{}", made.1);
    (sale, made.1["data"][0]["id"].as_str().unwrap().to_owned())
}

#[sqlx::test(migrations = "../../migrations")]
async fn production_cancellation_reverses_only_active_components_and_preserves_finished_stock(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (sale, job) = prepare(&admin, &router).await;
    let key = Uuid::now_v7();
    let input = json!({"productId":COMPONENT,"quantity":"2.500000","unitCost":"1.25","reason":"Consumo conferido na fábrica"});
    let consume = call(
        &router,
        &format!("/api/v1/production/orders/{job}/consumptions"),
        Some(1),
        key,
        input.clone(),
    )
    .await;
    assert_eq!(consume.0, StatusCode::OK, "{}", consume.1);
    let replay = call(
        &router,
        &format!("/api/v1/production/orders/{job}/consumptions"),
        Some(1),
        key,
        input,
    )
    .await;
    assert_eq!(replay, consume);
    sqlx::query("DELETE FROM role_permissions WHERE permission_code='inventory.stock.manage'")
        .execute(&admin)
        .await
        .unwrap();
    let revoked=call(&router,&format!("/api/v1/production/orders/{job}/consumptions"),Some(1),key,json!({"productId":COMPONENT,"quantity":"2.500000","unitCost":"1.25","reason":"Consumo conferido na fábrica"})).await;
    assert_eq!(revoked.0, StatusCode::FORBIDDEN);
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','inventory.stock.manage')").execute(&admin).await.unwrap();
    let manual=call(&router,"/api/v1/stock/movements",None,Uuid::now_v7(),json!({"productId":COMPONENT,"direction":"receipt","quantity":"2.500000","reason":"Estorno manual indevido de produção","reversesId":consume.1["stockMovementIds"][0]})).await;
    assert_eq!(manual.0, StatusCode::CONFLICT);
    let cancelled = call(
        &router,
        &format!("/api/v1/orders/{sale}/cancel-completed"),
        Some(3),
        Uuid::now_v7(),
        super::returns_tests::reversal(),
    )
    .await;
    assert_eq!(cancelled.0, StatusCode::OK, "{}", cancelled.1);
    assert_eq!(
        cancelled.1["data"]["reconciliation"]["production"]["status"],
        "applied"
    );
    let stock: i64 =
        sqlx::query_scalar("SELECT quantity_micros FROM stock_balances WHERE product_id=$1")
            .bind(Uuid::parse_str(COMPONENT).unwrap())
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(stock, 10_000_000);
    let state: (String, i64) =
        sqlx::query_as("SELECT status,revision FROM production_orders WHERE id=$1")
            .bind(Uuid::parse_str(&job).unwrap())
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(state, ("cancelled".to_owned(), 3));
    let blocked = call(&router, &format!("/api/v1/production/orders/{job}/consumptions"), Some(3), Uuid::now_v7(), json!({"productId":COMPONENT,"quantity":"1.000000","unitCost":"1.00","reason":"Consumo após cancelamento"})).await;
    assert_eq!(blocked.0, StatusCode::CONFLICT);
    let finished: i64 = sqlx::query_scalar("SELECT quantity_micros FROM stock_balances WHERE product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'").fetch_one(&admin).await.unwrap();
    assert_eq!(finished, 3_000_000);
    let reversals: i64 = sqlx::query_scalar("SELECT count(*) FROM stock_movements WHERE production_order_id=$1 AND reverses_id IS NOT NULL").bind(Uuid::parse_str(&job).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(reversals, 1);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn production_reopening_returns_exact_components_once_and_rechecks_rights_on_replay(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (_, job) = prepare(&admin, &router).await;
    let stages: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id,kind FROM production_stages WHERE tenant_id=$1 ORDER BY position,id",
    )
    .bind(Uuid::parse_str(TENANT).unwrap())
    .fetch_all(&admin)
    .await
    .unwrap();
    let ready = stages.iter().find(|s| s.1 == "pronta").unwrap().0;
    let open = stages.iter().find(|s| s.1 == "andamento").unwrap().0;
    let consumed = call(&router,&format!("/api/v1/production/orders/{job}/consumptions"),Some(1),Uuid::now_v7(),json!({"productId":COMPONENT,"quantity":"1.250000","unitCost":"1.23","reason":"Consumo real declarado"})).await;
    assert_eq!(consumed.0, StatusCode::OK, "{}", consumed.1);
    for (revision, stage) in [(2, ready), (3, open)] {
        let moved = call(
            &router,
            &format!("/api/v1/production/orders/{job}/stage"),
            Some(revision),
            Uuid::now_v7(),
            json!({"stageId":stage}),
        )
        .await;
        assert_eq!(moved.0, StatusCode::OK, "{}", moved.1);
    }
    let balance: i64 =
        sqlx::query_scalar("SELECT quantity_micros FROM stock_balances WHERE product_id=$1")
            .bind(Uuid::parse_str(COMPONENT).unwrap())
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(balance, 10_000_000);
    let exact_cost:(i64,i64,i64)=sqlx::query_as("SELECT quantity_micros,unit_cost_cents,amount_cents FROM production_consumptions WHERE production_order_id=$1")
        .bind(Uuid::parse_str(&job).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(exact_cost, (1_250_000, 123, 154));
    let reversals:i64=sqlx::query_scalar("SELECT count(*) FROM stock_movements WHERE production_order_id=$1 AND reverses_id IS NOT NULL")
        .bind(Uuid::parse_str(&job).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(reversals, 1);
    let key = Uuid::now_v7();
    let moved = call(
        &router,
        &format!("/api/v1/production/orders/{job}/stage"),
        Some(4),
        key,
        json!({"stageId":ready}),
    )
    .await;
    assert_eq!(moved.0, StatusCode::OK);
    sqlx::query("DELETE FROM role_permissions WHERE permission_code='production.manage'")
        .execute(&admin)
        .await
        .unwrap();
    let replay = call(
        &router,
        &format!("/api/v1/production/orders/{job}/stage"),
        Some(4),
        key,
        json!({"stageId":ready}),
    )
    .await;
    assert_eq!(replay.0, StatusCode::FORBIDDEN);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn production_rejects_shortage_foreign_ids_and_concurrent_stale_consumption_atomically(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (_, job) = prepare(&admin, &router).await;
    let uri = format!("/api/v1/production/orders/{job}/consumptions");
    let short = call(&router,&uri,Some(1),Uuid::now_v7(),json!({"productId":COMPONENT,"quantity":"10.000001","unitCost":"1.00","reason":"Quantidade além do saldo"})).await;
    assert_eq!(short.0, StatusCode::CONFLICT);
    let foreign_product = Uuid::now_v7();
    sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES($1,'22222222-2222-4222-8222-222222222222','FOREIGN-1','Componente de outra empresa','UN',100,'active')")
        .bind(foreign_product).execute(&admin).await.unwrap();
    let foreign = call(&router,&uri,Some(1),Uuid::now_v7(),json!({"productId":foreign_product,"quantity":"1.000000","unitCost":"1.00","reason":"Componente de outra empresa"})).await;
    assert_eq!(foreign.0, StatusCode::NOT_FOUND);
    let input = json!({"productId":COMPONENT,"quantity":"1.000000","unitCost":"1.00","reason":"Consumo concorrente da fábrica"});
    let (first, second) = tokio::join!(
        call(&router, &uri, Some(1), Uuid::now_v7(), input.clone()),
        call(&router, &uri, Some(1), Uuid::now_v7(), input)
    );
    let mut statuses = [first.0.as_u16(), second.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 412]);
    let state: (i64,i64) = sqlx::query_as("SELECT (SELECT quantity_micros FROM stock_balances WHERE product_id=$1),(SELECT count(*) FROM production_consumptions WHERE production_order_id=$2)").bind(Uuid::parse_str(COMPONENT).unwrap()).bind(Uuid::parse_str(&job).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(state, (9_000_000, 1));
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn production_consumption_respects_other_sales_reservations(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    let (_, job) = prepare(&admin, &router).await;
    let created = call(&router,"/api/v1/orders",None,Uuid::now_v7(),json!({"customerId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","dueDate":"2026-11-01","items":[{"productId":COMPONENT,"quantity":"9.000000"}]})).await;
    assert_eq!(created.0, StatusCode::CREATED);
    let sale = created.1["data"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &router,
            &format!("/api/v1/orders/{sale}/confirm"),
            Some(1),
            Uuid::now_v7(),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    let consumed = call(&router,&format!("/api/v1/production/orders/{job}/consumptions"),Some(1),Uuid::now_v7(),json!({"productId":COMPONENT,"quantity":"2.000000","unitCost":"1.00","reason":"Consumir componente já reservado"})).await;
    assert_eq!(consumed.0, StatusCode::CONFLICT);
    let state: (i64,i64) = sqlx::query_as("SELECT (SELECT quantity_micros FROM stock_balances WHERE product_id=$1),(SELECT revision FROM production_orders WHERE id=$2)").bind(Uuid::parse_str(COMPONENT).unwrap()).bind(Uuid::parse_str(&job).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(state, (10_000_000, 1));
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn production_cancellation_permissions_are_current_and_failures_roll_back_all_domains(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (sale, job) = prepare(&admin, &router).await;
    let consumed=call(&router,&format!("/api/v1/production/orders/{job}/consumptions"),Some(1),Uuid::now_v7(),json!({"productId":COMPONENT,"quantity":"1.000000","unitCost":"0.00","reason":"Consumo real para conciliar"})).await;
    assert_eq!(consumed.0, StatusCode::OK);
    sqlx::query("DELETE FROM role_permissions WHERE permission_code='production.manage'")
        .execute(&admin)
        .await
        .unwrap();
    let uri = format!("/api/v1/orders/{sale}/cancel-completed");
    let key = Uuid::now_v7();
    let blocked = call(
        &router,
        &uri,
        Some(3),
        key,
        super::returns_tests::reversal(),
    )
    .await;
    assert_eq!(blocked.0, StatusCode::FORBIDDEN);
    let unchanged:(String,i64,i64)=sqlx::query_as("SELECT s.status,o.revision,b.quantity_micros FROM sales_orders s JOIN production_orders o ON o.tenant_id=s.tenant_id AND o.order_id=s.id JOIN stock_balances b ON b.tenant_id=s.tenant_id AND b.product_id=$2 WHERE s.id=$1")
        .bind(Uuid::parse_str(&sale).unwrap()).bind(Uuid::parse_str(COMPONENT).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(unchanged, ("completed".to_owned(), 2, 9_000_000));
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','production.manage')").execute(&admin).await.unwrap();
    let cancelled = call(
        &router,
        &uri,
        Some(3),
        key,
        super::returns_tests::reversal(),
    )
    .await;
    assert_eq!(cancelled.0, StatusCode::OK, "{}", cancelled.1);
    sqlx::query("DELETE FROM role_permissions WHERE permission_code='production.manage'")
        .execute(&admin)
        .await
        .unwrap();
    let replay = call(
        &router,
        &uri,
        Some(3),
        key,
        super::returns_tests::reversal(),
    )
    .await;
    assert_eq!(replay.0, StatusCode::FORBIDDEN);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn production_reversal_failure_rolls_back_finished_stock_receivable_and_cancellation(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (sale, job) = prepare(&admin, &router).await;
    let consumed=call(&router,&format!("/api/v1/production/orders/{job}/consumptions"),Some(1),Uuid::now_v7(),json!({"productId":COMPONENT,"quantity":"1.000000","unitCost":"1.00","reason":"Consumo antes de falha atômica"})).await;
    assert_eq!(consumed.0, StatusCode::OK);
    sqlx::query("UPDATE stock_balances SET quantity_micros=999999999999999999 WHERE product_id=$1")
        .bind(Uuid::parse_str(COMPONENT).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let cancelled = call(
        &router,
        &format!("/api/v1/orders/{sale}/cancel-completed"),
        Some(3),
        Uuid::now_v7(),
        super::returns_tests::reversal(),
    )
    .await;
    assert_eq!(cancelled.0, StatusCode::CONFLICT, "{}", cancelled.1);
    let unchanged:(String,String,i64,i64)=sqlx::query_as("SELECT s.status,r.status,b.quantity_micros,(SELECT count(*) FROM sales_order_cancellations c WHERE c.order_id=s.id) FROM sales_orders s JOIN receivables r ON r.tenant_id=s.tenant_id AND r.order_id=s.id JOIN stock_balances b ON b.tenant_id=s.tenant_id AND b.product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' WHERE s.id=$1")
        .bind(Uuid::parse_str(&sale).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(
        unchanged,
        ("completed".to_owned(), "open".to_owned(), 1_000_000, 0)
    );
    let reversals:i64=sqlx::query_scalar("SELECT count(*) FROM stock_movements WHERE production_order_id=$1 AND reverses_id IS NOT NULL").bind(Uuid::parse_str(&job).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(reversals, 0);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn production_requires_active_sale_and_confirmed_cancellation_returns_consumed_components(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (_, _) = prepare(&admin, &router).await;
    let created=call(&router,"/api/v1/orders",None,Uuid::now_v7(),json!({"customerId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","dueDate":"2026-11-01","items":[{"productId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","quantity":"1.000000"}]})).await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    let sale = created.1["data"]["id"].as_str().unwrap();
    let draft = call(
        &router,
        "/api/v1/production/orders",
        Some(1),
        Uuid::now_v7(),
        json!({"orderId":sale}),
    )
    .await;
    assert_eq!(draft.0, StatusCode::CONFLICT);
    let confirmed = call(
        &router,
        &format!("/api/v1/orders/{sale}/confirm"),
        Some(1),
        Uuid::now_v7(),
        json!({}),
    )
    .await;
    assert_eq!(confirmed.0, StatusCode::OK, "{}", confirmed.1);
    let made = call(
        &router,
        "/api/v1/production/orders",
        Some(2),
        Uuid::now_v7(),
        json!({"orderId":sale}),
    )
    .await;
    assert_eq!(made.0, StatusCode::CREATED, "{}", made.1);
    let job = made.1["data"][0]["id"].as_str().unwrap();
    let duplicate = call(
        &router,
        "/api/v1/production/orders",
        Some(2),
        Uuid::now_v7(),
        json!({"orderId":sale}),
    )
    .await;
    assert_eq!(duplicate.0, StatusCode::CONFLICT);
    let consumed=call(&router,&format!("/api/v1/production/orders/{job}/consumptions"),Some(1),Uuid::now_v7(),json!({"productId":COMPONENT,"quantity":"1.000000","unitCost":"0.00","reason":"Componente de venda confirmada"})).await;
    assert_eq!(consumed.0, StatusCode::OK, "{}", consumed.1);
    let cancelled = call(
        &router,
        &format!("/api/v1/orders/{sale}/cancel"),
        Some(2),
        Uuid::now_v7(),
        json!({}),
    )
    .await;
    assert_eq!(cancelled.0, StatusCode::OK, "{}", cancelled.1);
    let state:(String,i64)=sqlx::query_as("SELECT o.status,b.quantity_micros FROM production_orders o JOIN stock_balances b ON b.tenant_id=o.tenant_id AND b.product_id=$2 WHERE o.id=$1")
        .bind(Uuid::parse_str(job).unwrap()).bind(Uuid::parse_str(COMPONENT).unwrap()).fetch_one(&admin).await.unwrap();
    assert_eq!(state, ("cancelled".to_owned(), 10_000_000));
    cleanup(&admin, app, server, &role).await;
}
