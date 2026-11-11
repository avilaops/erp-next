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

async fn call(
    router: &Router,
    uri: &str,
    subject: &str,
    tenant: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(if body.is_some() { "POST" } else { "GET" })
        .uri(uri)
        .header("x-tenant-id", tenant)
        .header("authorization", format!("Bearer {subject}"))
        .header("content-type", "application/json")
        .body(Body::from(
            body.map_or_else(String::new, |body| body.to_string()),
        ))
        .unwrap();
    let reply = router.clone().oneshot(request).await.unwrap();
    let status = reply.status();
    let raw = to_bytes(reply.into_body(), 1_000_000).await.unwrap();
    (status, serde_json::from_slice(&raw).unwrap())
}

async fn seed(admin: &PgPool) -> (Uuid, Vec<Uuid>, Uuid) {
    let tenant = Uuid::parse_str(TENANT).unwrap();
    let version = Uuid::now_v7();
    let products = vec![Uuid::now_v7(), Uuid::now_v7()];
    let method = Uuid::now_v7();
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE p.code='sales.orders.read' OR (r.code='editor' AND p.code='sales.orders.manage') ON CONFLICT DO NOTHING").execute(admin).await.unwrap();
    let mut policy = crate::platform::commercial_settings_model::tests::example();
    policy
        .state_rates
        .iter_mut()
        .find(|rate| rate.state == "MG")
        .unwrap()
        .outgoing_bps = Some(0);
    sqlx::query("INSERT INTO commercial_settings(tenant_id,product_line,parameters,revision) VALUES($1,'imported',$2,1)")
        .bind(tenant).bind(json!(policy)).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO commercial_approval_settings(tenant_id,revision,rules) VALUES($1,1,$2)")
        .bind(tenant).bind(json!({"belowTarget":true,"freight":false,"directorAutoApproval":false,"managerLimit":"target"})).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO price_table_versions(id,tenant_id,product_line,version,settings_revision,policy_snapshot,calculator_version,digest,published_by) VALUES($1,$2,'imported',1,1,$3,'test',$4,'33333333-3333-4333-8333-333333333333')")
        .bind(version).bind(tenant).bind(json!(policy)).bind("e".repeat(64)).execute(admin).await.unwrap();
    for (index, product) in products.iter().enumerate() {
        let sku = format!("TABLE-{}", index + 1);
        let price = [2_000_003_i64, 1_256_323][index];
        sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES($1,$2,$3,'Equipamento','UN',100,'active')")
            .bind(product).bind(tenant).bind(&sku).execute(admin).await.unwrap();
        sqlx::query("INSERT INTO product_costs(tenant_id,product_id,product_line,purchase_cost_cents,tax_credit_bps,packaging_cents,revision) VALUES($1,$2,'imported',530606,2780,0,1)")
            .bind(tenant).bind(product).execute(admin).await.unwrap();
        sqlx::query("INSERT INTO price_table_items(tenant_id,version_id,product_id,product_snapshot,cost_revision,cost_snapshot,price_without_ipi_cents,ipi_bps,price_with_ipi_cents) VALUES($1,$2,$3,$4,1,$5,$6,1300,$7)")
            .bind(tenant).bind(version).bind(product).bind(json!({"sku":sku,"name":"Equipamento","unit":"UN","revision":1}))
            .bind(json!({"purchaseCostCents":530606,"taxCreditBps":2780,"packagingCents":0}))
            .bind(price).bind((price * 11_300 + 9_999) / 10_000).execute(admin).await.unwrap();
    }
    sqlx::query("UPDATE commercial_settings SET active_price_version_id=$2 WHERE tenant_id=$1 AND product_line='imported'")
        .bind(tenant).bind(version).execute(admin).await.unwrap();
    for (id, company, code, status) in [
        (method, TENANT, "PIX", "active"),
        (Uuid::now_v7(), TENANT, "OLD", "archived"),
        (Uuid::now_v7(), OTHER, "FOREIGN", "active"),
    ] {
        sqlx::query("INSERT INTO payment_methods(id,tenant_id,code,name,status,revision,modality,settlement_days,notes) VALUES($1,$2,$3,$3,$4,1,'pix',0,'private settlement notes')")
            .bind(id).bind(Uuid::parse_str(company).unwrap()).bind(code).bind(status).execute(admin).await.unwrap();
    }
    (version, products, method)
}

#[sqlx::test(migrations = "../../migrations")]
async fn commercial_table_limits_match_actor_destination_and_preserved_prices_without_costs(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (version, products, method) = seed(&admin).await;
    let uri = "/api/v1/commercial/tables/imported?destinationState=SP&taxpayer=false";
    let seller = call(&router, uri, "reader", TENANT, None).await;
    assert_eq!(seller.0, StatusCode::OK, "{}", seller.1);
    assert_eq!(seller.1["authority"], "seller");
    assert_eq!(seller.1["canCreateOrder"], false);
    assert_eq!(seller.1["data"]["availability"]["status"], "ready");
    assert_eq!(
        seller.1["data"]["context"],
        json!({"destinationState":"SP","taxpayer":false,"quantity":1,"freightCents":0,"downPayment":"policy"})
    );
    assert_eq!(
        seller.1["paymentMethods"],
        json!([{"id":method,"name":"PIX","kind":"pix"}])
    );
    let raw = seller.1.to_string();
    for secret in [
        "purchaseCost",
        "equipmentCost",
        "creditBps",
        "netProfit",
        "netMargin",
        "policy_snapshot",
        "private settlement notes",
        "FOREIGN",
        "OLD",
    ] {
        assert!(!raw.contains(secret), "Unexpected private field: {secret}");
    }
    assert_eq!(
        call(&router, "/api/v1/payment-methods", "reader", TENANT, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&router, uri, "editor", OTHER, None).await.0,
        StatusCode::FORBIDDEN
    );
    for item in seller.1["data"]["items"].as_array().unwrap() {
        assert_eq!(item["available"], true);
        let limit = item["maxOwnDiscountBps"].as_u64().unwrap();
        assert!(limit <= 2000);
        let quote = call(&router, "/api/v1/commercial/simulate", "reader", TENANT, Some(json!({"line":"imported","versionId":version,"destinationState":"SP","taxpayer":false,"discount":{"kind":"percent","value":limit},"freightCents":0,"items":[{"productId":item["productId"],"quantity":1}]}))).await;
        assert_eq!(quote.0, StatusCode::OK, "{}", quote.1);
        assert_eq!(
            item["minOwnPriceWithIpiCents"],
            quote.1["sale"]["totalCents"]
        );
        assert_eq!(
            item["freeDiscountPriceWithIpiCents"],
            quote.1["sale"]["totalCents"]
        );
        assert_eq!(quote.1["sale"]["approvalReasons"], json!([]));
    }
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','sales.approvals.manage')").execute(&admin).await.unwrap();
    let manager = call(&router, uri, "editor", TENANT, None).await;
    assert_eq!(manager.1["authority"], "managerTarget");
    assert_eq!(manager.1["canCreateOrder"], true);
    let manager_limit = manager.1["data"]["items"][1]["maxOwnDiscountBps"]
        .as_u64()
        .unwrap();
    assert!(manager_limit > 2000);
    let destinations = manager.1["data"]["destinations"].as_array().unwrap();
    assert_eq!(destinations.len(), 54);
    let bound = |state: &str, taxpayer: bool| {
        destinations
            .iter()
            .find(|row| row["state"] == state && row["taxpayer"] == taxpayer)
            .unwrap()["maxOwnDiscountBps"]
            .as_u64()
            .unwrap()
    };
    assert!(bound("MG", true) > bound("MG", false));
    assert_eq!(bound("SP", true), bound("SP", false));
    assert_eq!(bound("SP", false), manager_limit);
    let destination = call(
        &router,
        "/api/v1/commercial/tables/imported?destinationState=MG&taxpayer=true",
        "editor",
        TENANT,
        None,
    )
    .await;
    assert_eq!(
        destination.1["data"]["items"][1]["maxOwnDiscountBps"]
            .as_u64()
            .unwrap(),
        bound("MG", true)
    );
    sqlx::query("UPDATE commercial_approval_settings SET rules=jsonb_set(rules,'{managerLimit}','\"profit\"'),revision=revision+1 WHERE tenant_id=$1")
        .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    let profit = call(&router, uri, "editor", TENANT, None).await;
    assert_eq!(profit.1["authority"], "managerProfit");
    assert!(
        profit.1["data"]["items"][1]["maxOwnDiscountBps"]
            .as_u64()
            .unwrap()
            > manager_limit
    );
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','sales.approvals.director')").execute(&admin).await.unwrap();
    let director = call(&router, uri, "editor", TENANT, None).await;
    assert_eq!(director.1["authority"], "director");
    assert_eq!(director.1["data"]["items"][1]["maxOwnDiscountBps"], 9999);
    assert!(
        director.1["data"]["items"][1]["minOwnPriceWithIpiCents"]
            .as_i64()
            .unwrap()
            > 0
    );
    assert_eq!(
        director.1["data"]["items"][0]["productId"],
        json!(products[0])
    );
    assert!(director.1.get("director").is_none());
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn commercial_table_explains_stale_sources_and_rejects_invalid_destination_queries(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let (_, products, _) = seed(&admin).await;
    let uri = "/api/v1/commercial/tables/imported";
    for query in [
        "?destinationState=XX",
        "?taxpayer=yes",
        "?destinationState=SP&destinationState=MG",
        "?unexpected=true",
    ] {
        let invalid = call(&router, &format!("{uri}{query}"), "reader", TENANT, None).await;
        assert_eq!(invalid.0, StatusCode::UNPROCESSABLE_ENTITY, "{}", invalid.1);
    }
    let initial = call(&router, uri, "reader", TENANT, None).await;
    assert_eq!(initial.1["data"]["context"]["destinationState"], "SP");
    assert_eq!(initial.1["data"]["context"]["taxpayer"], false);
    sqlx::query(
        "UPDATE product_costs SET revision=revision+1 WHERE tenant_id=$1 AND product_id=$2",
    )
    .bind(Uuid::parse_str(TENANT).unwrap())
    .bind(products[0])
    .execute(&admin)
    .await
    .unwrap();
    let source_stale = call(&router, uri, "reader", TENANT, None).await;
    assert_eq!(
        source_stale.1["data"]["availability"]["status"],
        "itemsUnavailable"
    );
    assert_eq!(source_stale.1["data"]["items"][0]["available"], false);
    assert!(source_stale.1["data"]["items"][0]["maxOwnDiscountBps"].is_null());
    assert_eq!(
        source_stale.1["data"]["items"][0]["priceWithIpiCents"],
        initial.1["data"]["items"][0]["priceWithIpiCents"]
    );
    sqlx::query("UPDATE commercial_settings SET revision=revision+1 WHERE tenant_id=$1")
        .bind(Uuid::parse_str(TENANT).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let stale = call(&router, uri, "reader", TENANT, None).await;
    assert_eq!(stale.1["data"]["availability"]["status"], "settingsStale");
    assert!(
        stale.1["data"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["available"] == false && item["maxOwnDiscountBps"].is_null())
    );
    sqlx::query("UPDATE commercial_settings SET revision=revision-1 WHERE tenant_id=$1")
        .bind(Uuid::parse_str(TENANT).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query("DELETE FROM commercial_approval_settings WHERE tenant_id=$1")
        .bind(Uuid::parse_str(TENANT).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let missing = call(&router, uri, "reader", TENANT, None).await;
    assert_eq!(missing.1["data"]["availability"]["status"], "rulesMissing");
    assert!(missing.1["data"]["items"][1]["minOwnPriceWithIpiCents"].is_null());
    cleanup(&admin, app, server, &role).await;
}
