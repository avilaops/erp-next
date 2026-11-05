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

async fn call(
    router: &Router,
    method: &str,
    path: &str,
    who: &str,
    etag: Option<&str>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-tenant-id", TENANT)
        .header("authorization", format!("Bearer {who}"))
        .header("content-type", "application/json");
    if let Some(etag) = etag {
        request = request.header("if-match", etag);
    }
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    let reply = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = reply.status();
    let raw = to_bytes(reply.into_body(), 1_000_000).await.unwrap();
    (status, serde_json::from_slice(&raw).unwrap())
}

#[sqlx::test(migrations = "../../migrations")]
async fn negotiation_preserves_snapshot_hides_costs_and_enforces_revision_authority_and_replay(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code IN ('sales.orders.read','sales.orders.manage','catalog.products.read','catalog.products.manage') ON CONFLICT DO NOTHING; INSERT INTO role_permissions(role_id,permission_code) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.manage') ON CONFLICT DO NOTHING;").execute(&admin).await.unwrap();
    let product = Uuid::now_v7();
    let customer = Uuid::now_v7();
    sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES($1,$2,'LD-TEST','Equipamento','UN',100,'active')").bind(product).bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES($1,$2,'fisica','Cliente','52998224725',true,false,'active')").bind(customer).bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    let settings = json!(crate::platform::commercial_settings_model::tests::example());
    let saved = call(
        &router,
        "PUT",
        "/api/v1/commercial-settings/imported",
        "editor",
        Some("\"1\""),
        None,
        settings,
    )
    .await;
    assert_eq!(saved.0, StatusCode::OK, "{}", saved.1);
    let cost=call(&router,"PUT",&format!("/api/v1/product-costs/{product}"),"editor",Some("\"1\""),None,json!({"productLine":"imported","purchaseCostCents":530606,"taxCreditBps":2780,"packagingCents":0})).await;
    assert_eq!(cost.0, StatusCode::OK, "{}", cost.1);
    let preview = call(
        &router,
        "GET",
        "/api/v1/price-tables/imported/preview",
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(preview.0, StatusCode::OK, "{}", preview.1);
    let published = call(
        &router,
        "POST",
        "/api/v1/price-tables/imported/publish",
        "editor",
        Some("\"2\""),
        Some(Uuid::now_v7()),
        json!({"digest":preview.1["digest"]}),
    )
    .await;
    assert_eq!(published.0, StatusCode::OK, "{}", published.1);
    let rule=call(&router,"PUT","/api/v1/commercial/approval-settings","editor",Some("\"1\""),None,json!({"belowTarget":true,"freight":true,"directorAutoApproval":false,"managerLimit":"target"})).await;
    assert_eq!(rule.0, StatusCode::OK, "{}", rule.1);
    let table = call(
        &router,
        "GET",
        "/api/v1/commercial/tables/imported",
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(table.0, StatusCode::OK);
    assert!(!table.1.to_string().contains("purchaseCost"));
    assert!(!table.1.to_string().contains("netMargin"));
    let mut simulation = json!({"line":"imported","versionId":published.1["id"],"destinationState":"SP","taxpayer":false,"discount":{"kind":"percent","value":2500},"freightCents":10000,"downPaymentCents":0,"items":[{"productId":product,"quantity":3,"structureColor":null,"upholsteryColor":null}]});
    let quote = call(
        &router,
        "POST",
        "/api/v1/commercial/simulate",
        "reader",
        None,
        None,
        simulation.clone(),
    )
    .await;
    assert_eq!(quote.0, StatusCode::OK, "{}", quote.1);
    assert!(quote.1["director"].is_null());
    let conversion = json!({"simulation":simulation,"digest":quote.1["digest"],"customerId":customer,"dueDate":"2027-01-30"});
    let key = Uuid::now_v7();
    let created = call(
        &router,
        "POST",
        "/api/v1/commercial/orders",
        "reader",
        None,
        Some(key),
        conversion.clone(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    assert_eq!(created.1["approvalStatus"], "pending");
    let repeated = call(
        &router,
        "POST",
        "/api/v1/commercial/orders",
        "reader",
        None,
        Some(key),
        conversion.clone(),
    )
    .await;
    assert_eq!(repeated.1, created.1);
    let order = created.1["id"].as_str().unwrap();
    let viewed = call(
        &router,
        "GET",
        &format!("/api/v1/commercial/orders/{order}"),
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(viewed.0, StatusCode::OK);
    assert!(viewed.1["director"].is_null());
    let refused = call(
        &router,
        "POST",
        &format!("/api/v1/orders/{order}/confirm"),
        "reader",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        json!({}),
    )
    .await;
    assert_eq!(refused.0, StatusCode::CONFLICT);
    let denied = call(
        &router,
        "POST",
        &format!("/api/v1/commercial/orders/{order}/decision"),
        "editor",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        json!({"approved":true,"reason":"Conferido"}),
    )
    .await;
    assert_eq!(denied.0, StatusCode::FORBIDDEN);
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','sales.approvals.director')").execute(&admin).await.unwrap();
    let decision_key = Uuid::now_v7();
    let decision = json!({"approved":true,"reason":"Condições conferidas pela diretoria"});
    let approved = call(
        &router,
        "POST",
        &format!("/api/v1/commercial/orders/{order}/decision"),
        "editor",
        Some("\"1\""),
        Some(decision_key),
        decision.clone(),
    )
    .await;
    assert_eq!(approved.0, StatusCode::OK, "{}", approved.1);
    assert_eq!(approved.1["revision"], 2);
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/commercial/orders/{order}/decision"),
            "editor",
            Some("\"1\""),
            Some(decision_key),
            decision
        )
        .await
        .1,
        approved.1
    );
    let snapshot = sqlx::query_scalar::<_, Value>(
        "SELECT public_snapshot FROM commercial_order_quotes WHERE order_id=$1",
    )
    .bind(Uuid::parse_str(order).unwrap())
    .fetch_one(&admin)
    .await
    .unwrap();
    sqlx::query("UPDATE product_costs SET revision=revision+1 WHERE product_id=$1")
        .bind(product)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/v1/commercial/orders/{order}"),
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .1["data"],
        snapshot
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/commercial/orders",
            "reader",
            None,
            Some(key),
            conversion
        )
        .await
        .1,
        created.1
    );
    simulation["discount"] = json!({"kind":"percent","value":1000});
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/commercial/simulate",
            "reader",
            None,
            None,
            simulation
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM commercial_order_quotes")
            .fetch_one(&app)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM commercial_approval_decisions")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn opportunity_is_versioned_idempotent_and_isolated_before_customer_registration(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code IN ('sales.orders.read','sales.orders.manage') ON CONFLICT DO NOTHING;")
        .execute(&admin).await.unwrap();
    let body = json!({"title":"Academia Horizonte","estimatedCents":1250000,"stage":"contacted","customerId":null,"companyName":"Horizonte Ltda","companyTaxId":"","contactName":"Marina","phone":"","email":"","source":"Indicação","notes":"Aguardando visita"});
    let key = Uuid::now_v7();
    let created = call(
        &router,
        "POST",
        "/api/v1/opportunities",
        "editor",
        None,
        Some(key),
        body.clone(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    assert_eq!(created.1["data"]["customerId"], Value::Null);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/opportunities",
            "editor",
            None,
            Some(key),
            body.clone()
        )
        .await
        .1,
        created.1
    );
    let id = created.1["data"]["id"].as_str().unwrap();
    let listed = call(
        &router,
        "GET",
        "/api/v1/opportunities?q=horizonte&stage=contacted&limit=100",
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(listed.0, StatusCode::OK, "{}", listed.1);
    assert_eq!(listed.1["total"], 1);
    let mut changed = body;
    changed["stage"] = json!("negotiation");
    let updated = call(
        &router,
        "PUT",
        &format!("/api/v1/opportunities/{id}"),
        "editor",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        changed.clone(),
    )
    .await;
    assert_eq!(updated.0, StatusCode::OK, "{}", updated.1);
    assert_eq!(updated.1["data"]["revision"], 2);
    assert_eq!(
        call(
            &router,
            "PUT",
            &format!("/api/v1/opportunities/{id}"),
            "editor",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            changed
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/v1/opportunities/{id}"),
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    cleanup(&admin, app, server, &role).await;
}
