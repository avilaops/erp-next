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
const PRODUCT: &str = "11111111-2222-4333-8444-555555555555";
const CUSTOMER: &str = "11111111-2222-4333-8444-666666666666";
const VERSION: &str = "11111111-2222-4333-8444-777777777777";

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    actor: (&str, &str),
    revision: Option<&str>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", actor.1)
        .header("content-type", "application/json");
    if !actor.0.is_empty() {
        request = request.header("authorization", format!("Bearer {}", actor.0));
    }
    if let Some(revision) = revision {
        request = request.header("if-match", revision);
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
    (status, serde_json::from_slice(&bytes).unwrap())
}
async fn seed(admin: &PgPool) {
    sqlx::raw_sql(&format!("
        INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE p.code IN ('sales.orders.read','sales.orders.manage');
        INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status,structure_colors) VALUES('{PRODUCT}','{TENANT}','TEST','Equipamento publicado','UN',1999,'active',ARRAY['Preto']);
        INSERT INTO stock_balances(tenant_id,product_id,quantity_micros) VALUES('{TENANT}','{PRODUCT}',100000000);
        INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES('{CUSTOMER}','{TENANT}','fisica','Cliente real','52998224725',true,false,'active');
    ")).execute(admin).await.unwrap();
    let policy = json!(crate::platform::commercial_settings_model::tests::example());
    sqlx::query("INSERT INTO commercial_settings(tenant_id,product_line,parameters,revision) VALUES($1,'imported',$2,1)")
        .bind(Uuid::parse_str(TENANT).unwrap()).bind(&policy).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO price_table_versions(id,tenant_id,product_line,version,settings_revision,policy_snapshot,calculator_version,digest,published_by) VALUES($1,$2,'imported',1,1,$3,'test-published-v1',$4,'33333333-3333-4333-8333-333333333333')")
        .bind(Uuid::parse_str(VERSION).unwrap()).bind(Uuid::parse_str(TENANT).unwrap()).bind(policy).bind("a".repeat(64)).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO price_table_items(tenant_id,version_id,product_id,product_snapshot,cost_revision,cost_snapshot,price_without_ipi_cents,ipi_bps,price_with_ipi_cents) VALUES($1,$2,$3,$4,1,$5,30000,1300,33900)")
        .bind(Uuid::parse_str(TENANT).unwrap()).bind(Uuid::parse_str(VERSION).unwrap()).bind(Uuid::parse_str(PRODUCT).unwrap())
        .bind(json!({"sku":"TEST","name":"Equipamento publicado","unit":"UN","revision":1}))
        .bind(json!({"purchaseCostCents":10000,"taxCreditBps":1000,"packagingCents":100})).execute(admin).await.unwrap();
    sqlx::query("UPDATE commercial_settings SET active_price_version_id=$2 WHERE tenant_id=$1")
        .bind(Uuid::parse_str(TENANT).unwrap())
        .bind(Uuid::parse_str(VERSION).unwrap())
        .execute(admin)
        .await
        .unwrap();
}
fn input(discount: u32) -> Value {
    json!({"versionId":VERSION,"productId":PRODUCT,"quantity":2,"destination":"SP","taxpayer":false,"discount":{"kind":"percent","value":discount},"freightCents":0})
}
#[sqlx::test(migrations = "../../migrations")]
async fn simulator_preserves_versions_redacts_costs_and_approves_atomically(admin: PgPool) {
    let (router, app, server, role) = super::company_tests::setup(&admin).await;
    seed(&admin).await;
    let base = "/api/v1/sales-simulator/imported";
    for (subject, tenant, status) in [
        ("", TENANT, 401),
        ("disabled", TENANT, 403),
        ("editor", "22222222-2222-4222-8222-222222222222", 403),
    ] {
        assert_eq!(
            call(
                &router,
                "GET",
                base,
                (subject, tenant),
                None,
                None,
                Value::Null
            )
            .await
            .0
            .as_u16(),
            status
        );
    }
    let options = call(
        &router,
        "GET",
        base,
        ("reader", TENANT),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(options.0, StatusCode::OK, "{}", options.1);
    assert_eq!(options.1["data"]["items"][0]["priceWithIpiCents"], 33900);
    let raw = options.1.to_string();
    for secret in ["purchaseCostCents", "costSnapshot", "netMarginBps"] {
        assert!(!raw.contains(secret));
    }
    let quote_uri = format!("{base}/quote");
    let seller = call(
        &router,
        "POST",
        &quote_uri,
        ("reader", TENANT),
        None,
        None,
        input(3000),
    )
    .await;
    assert_eq!(seller.0, StatusCode::OK, "{}", seller.1);
    assert!(seller.1.get("director").is_none());
    assert_eq!(seller.1["sale"]["needsApproval"], true);
    let director = call(
        &router,
        "POST",
        &quote_uri,
        ("editor", TENANT),
        None,
        None,
        input(3000),
    )
    .await;
    assert_eq!(director.0, StatusCode::OK);
    assert!(director.1["director"]["equipmentCostCents"].is_i64());
    assert_eq!(director.1["digest"], seller.1["digest"]);
    let mut foreign = input(0);
    foreign["versionId"] = json!(Uuid::nil());
    assert_eq!(
        call(
            &router,
            "POST",
            &quote_uri,
            ("reader", TENANT),
            None,
            None,
            foreign
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let mut invalid = input(0);
    invalid["quantity"] = json!(0);
    assert_eq!(
        call(
            &router,
            "POST",
            &quote_uri,
            ("reader", TENANT),
            None,
            None,
            invalid
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let create_uri = format!("{base}/orders");
    let body = json!({"quote":input(3000),"digest":seller.1["digest"],"customerId":CUSTOMER,"dueDate":"2026-12-30","structureColor":"Preto","upholsteryColor":null});
    let mut tampered = body.clone();
    tampered["quote"]["discount"]["value"] = json!(0);
    assert_eq!(
        call(
            &router,
            "POST",
            &create_uri,
            ("reader", TENANT),
            None,
            Some(Uuid::now_v7()),
            tampered
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let key = Uuid::now_v7();
    let first = call(
        &router,
        "POST",
        &create_uri,
        ("reader", TENANT),
        None,
        Some(key),
        body.clone(),
    )
    .await;
    assert_eq!(first.0, StatusCode::CREATED, "{}", first.1);
    assert_eq!(
        call(
            &router,
            "POST",
            &create_uri,
            ("reader", TENANT),
            None,
            Some(key),
            body
        )
        .await
        .1,
        first.1
    );
    let id = first.1["id"].as_str().unwrap();
    let order_uri = format!("/api/v1/orders/{id}");
    let order = call(
        &router,
        "GET",
        &order_uri,
        ("reader", TENANT),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(order.1["pricingOrigin"], true);
    let expected_total = seller.1["sale"]["invoiceTotalCents"].as_i64().unwrap();
    assert_eq!(
        crate::domains::fixed(order.1["data"]["amount"].as_str().unwrap(), 2).unwrap(),
        expected_total
    );
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM sales_orders")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(before, 1);
    let confirm = format!("{order_uri}/confirm");
    assert_eq!(
        call(
            &router,
            "POST",
            &confirm,
            ("reader", TENANT),
            Some("\"1\""),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let pricing = format!("{order_uri}/pricing");
    let seller_snapshot = call(
        &router,
        "GET",
        &pricing,
        ("reader", TENANT),
        None,
        None,
        Value::Null,
    )
    .await;
    assert!(
        seller_snapshot.1["data"]["snapshot"]
            .get("director")
            .is_none()
    );
    let approve = format!("{pricing}/approve");
    assert_eq!(
        call(
            &router,
            "POST",
            &approve,
            ("reader", TENANT),
            Some("\"1\""),
            Some(Uuid::now_v7()),
            json!({"reason":"Negociação autorizada"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let approval_key = Uuid::now_v7();
    let approved = call(
        &router,
        "POST",
        &approve,
        ("editor", TENANT),
        Some("\"1\""),
        Some(approval_key),
        json!({"reason":"Negociação autorizada"}),
    )
    .await;
    assert_eq!(approved.0, StatusCode::OK, "{}", approved.1);
    assert_eq!(
        call(
            &router,
            "POST",
            &approve,
            ("editor", TENANT),
            Some("\"1\""),
            Some(approval_key),
            json!({"reason":"Negociação autorizada"})
        )
        .await
        .1,
        approved.1
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &confirm,
            ("reader", TENANT),
            Some("\"1\""),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let edit = json!({"customerId":CUSTOMER,"dueDate":"2027-01-01","items":[{"productId":PRODUCT,"quantity":"2","structureColor":"Preto","upholsteryColor":null}]});
    let edit_after_approval = call(
        &router,
        "PUT",
        &order_uri,
        ("reader", TENANT),
        Some("\"2\""),
        Some(Uuid::now_v7()),
        edit,
    )
    .await;
    assert_eq!(
        edit_after_approval.0,
        StatusCode::CONFLICT,
        "{}",
        edit_after_approval.1
    );
    // Changed live policy and catalog prices must never change the stored agreement.
    sqlx::raw_sql("UPDATE commercial_settings SET parameters=jsonb_set(parameters,'{ipiBps}','0'); UPDATE products SET price_cents=1;").execute(&admin).await.unwrap();
    let preserved = call(
        &router,
        "GET",
        &pricing,
        ("editor", TENANT),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(
        preserved.1["data"]["snapshot"]["sale"]["invoiceTotalCents"],
        expected_total
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &confirm,
            ("reader", TENANT),
            Some("\"2\""),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('fiscal.nfe.read','catalog.products.read','catalog.parties.read') ON CONFLICT DO NOTHING").execute(&admin).await.unwrap();
    let fiscal = call(
        &router,
        "GET",
        &format!("/api/v1/fiscal/order-preparations/{id}"),
        ("editor", TENANT),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(fiscal.0, StatusCode::OK, "{}", fiscal.1);
    let expected_net = seller.1["sale"]["netSaleCents"].as_i64().unwrap();
    assert_eq!(
        crate::domains::fixed(fiscal.1["productsTotal"].as_str().unwrap(), 2).unwrap(),
        expected_net
    );
    assert_eq!(
        crate::domains::fixed(fiscal.1["items"][0]["unitPrice"].as_str().unwrap(), 2).unwrap(),
        seller.1["sale"]["unitWithoutIpiCents"].as_i64().unwrap()
    );
    assert!(fiscal.1.get("taxDeclaration").is_none());
    let final_state: (String, i64) = sqlx::query_as("SELECT status,amount_cents FROM sales_orders")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(final_state, ("confirmed".into(), expected_total));
    let mut tx = app.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM order_pricing_snapshots")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    tx.rollback().await.unwrap();
    assert!(
        sqlx::query("UPDATE order_pricing_snapshots SET snapshot='{}'")
            .execute(&admin)
            .await
            .is_err()
    );
    server.abort();
    app.close().await;
    sqlx::raw_sql(&format!("DROP OWNED BY {role}; DROP ROLE {role}"))
        .execute(&admin)
        .await
        .unwrap();
}
