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
    path: &str,
    actor: &str,
    tenant: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("authorization", format!("Bearer {actor}"))
                .header("x-tenant-id", tenant)
                .header("content-type", "application/json")
                .header("idempotency-key", Uuid::now_v7().to_string())
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn dashboard_aggregates_real_tenant_records_and_never_turns_denied_access_into_zero(
    admin: PgPool,
) {
    let (router, pool, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions ON CONFLICT DO NOTHING").execute(&admin).await.unwrap();
    let customer = call(&router,"POST","/api/v1/parties","editor",TENANT,json!({"personType":"juridica","legalName":"Cliente do painel","taxId":"04252011000110","email":null,"phone":null,"tradeName":null,"isCustomer":true,"isSupplier":false,"status":"active"})).await;
    assert_eq!(customer.0, StatusCode::CREATED, "{}", customer.1);
    let product = call(&router,"POST","/api/v1/products","editor",TENANT,json!({"sku":"REAL-1","name":"Produto do painel","unit":"UN","basePrice":"50.00","ncm":null,"cest":null,"status":"active"})).await;
    assert_eq!(product.0, StatusCode::CREATED, "{}", product.1);
    let input = json!({"customerId":customer.1["data"]["id"],"dueDate":"2026-12-01","items":[{"productId":product.1["data"]["id"],"quantity":"2.000000"}]});
    let order = call(
        &router,
        "POST",
        "/api/v1/orders",
        "editor",
        TENANT,
        input.clone(),
    )
    .await;
    assert_eq!(order.0, StatusCode::CREATED, "{}", order.1);
    let old = call(&router, "POST", "/api/v1/orders", "editor", TENANT, input).await;
    assert_eq!(old.0, StatusCode::CREATED, "{}", old.1);
    let order_id: Uuid = order.1["data"]["id"].as_str().unwrap().parse().unwrap();
    let old_id: Uuid = old.1["data"]["id"].as_str().unwrap().parse().unwrap();
    sqlx::query("UPDATE sales_orders SET created_at=now()-interval '2 years' WHERE id=$1")
        .bind(old_id)
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES($1,'22222222-2222-4222-8222-222222222222','OTHER','Produto de outra empresa','UN',100,'active')").bind(Uuid::now_v7()).execute(&admin).await.unwrap();
    let receivable = Uuid::now_v7();
    sqlx::query("INSERT INTO receivables(id,tenant_id,order_id,customer_name,due_date,amount_cents,status) VALUES($1,$2,$3,'Cliente do painel','2026-12-01',10000,'open')").bind(receivable).bind(Uuid::parse_str(TENANT).unwrap()).bind(order_id).execute(&admin).await.unwrap();
    let receipt = Uuid::now_v7();
    sqlx::query("INSERT INTO receivable_payments(id,tenant_id,receivable_id,kind,amount_cents,method,reference,occurred_on) VALUES($1,$2,$3,'receipt',2500,'bank_transfer','Pagamento parcial',CURRENT_DATE)").bind(receipt).bind(Uuid::parse_str(TENANT).unwrap()).bind(receivable).execute(&admin).await.unwrap();
    let actual = call(
        &router,
        "GET",
        "/api/v1/dashboard?period=30D",
        "editor",
        TENANT,
        Value::Null,
    )
    .await;
    assert_eq!(actual.0, StatusCode::OK, "{}", actual.1);
    assert_eq!(actual.1["sales"]["orders"], 1);
    assert_eq!(actual.1["sales"]["amount"], "100.00");
    assert_eq!(actual.1["sales"]["average"], "100.00");
    assert_eq!(actual.1["receivables"], "75.00");
    assert_eq!(actual.1["purchasePayables"], "0.00");
    assert_eq!(actual.1["products"], 1);
    assert_eq!(actual.1["customers"], 1);
    assert_eq!(actual.1["salesSeries"][0]["orders"], 1);
    sqlx::query("INSERT INTO receivable_payments(id,tenant_id,receivable_id,kind,amount_cents,method,reference,occurred_on,reverses_id) VALUES($1,$2,$3,'reversal',2500,'bank_transfer','Estorno parcial',CURRENT_DATE,$4)").bind(Uuid::now_v7()).bind(Uuid::parse_str(TENANT).unwrap()).bind(receivable).bind(receipt).execute(&admin).await.unwrap();
    let reversed = call(
        &router,
        "GET",
        "/api/v1/dashboard",
        "editor",
        TENANT,
        Value::Null,
    )
    .await;
    assert_eq!(reversed.1["receivables"], "100.00");
    let denied = call(
        &router,
        "GET",
        "/api/v1/dashboard",
        "reader",
        TENANT,
        Value::Null,
    )
    .await;
    assert_eq!(denied.0, StatusCode::OK);
    for field in [
        "sales",
        "salesSeries",
        "receivables",
        "purchasePayables",
        "products",
        "customers",
    ] {
        assert!(
            denied.1[field].is_null(),
            "Denied metric {field} must not become a zero"
        );
    }
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/dashboard",
            "editor",
            "22222222-2222-4222-8222-222222222222",
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/dashboard?period=invalid",
            "editor",
            TENANT,
            Value::Null
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    super::company_tests::cleanup(&admin, pool, server, &role).await;
}
