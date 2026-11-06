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
const CUSTOMER: &str = "11111111-2222-4333-8444-555555555555";
const PRODUCT: &str = "11111111-2222-4333-8444-666666666666";

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    subject: &str,
    revision: Option<i64>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
    }
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    let result = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = result.status();
    let bytes = to_bytes(result.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn proposal() -> Value {
    json!({"customerId":CUSTOMER,"validUntil":"2100-01-01","paymentTerms":"À vista","deliveryTerms":"Retirada pelo cliente","notes":"","items":[{"productId":PRODUCT,"quantity":"2.500000","structureColor":null,"upholsteryColor":null}]})
}

#[sqlx::test(migrations = "../../migrations")]
async fn component_colors_are_independent_and_survive_proposal_conversion(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'sales.%' OR code LIKE 'catalog.%' ON CONFLICT DO NOTHING;
        INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES('11111111-2222-4333-8444-555555555555','11111111-1111-4111-8111-111111111111','fisica','Cliente de teste','52998224725',true,false,'active');
        INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status,structure_colors,plate_holder_colors,plate_holder_types) VALUES('11111111-2222-4333-8444-666666666666','11111111-1111-4111-8111-111111111111','COMPONENT-TEST','Equipamento de teste','UN',1999,'active',ARRAY['Piano Black'],ARRAY['Azul','Preto'],ARRAY['Olímpico','Standard']);")
        .execute(&admin).await.unwrap();
    let legacy_product = call(
        &router,
        "POST",
        "/api/v1/products",
        "editor",
        None,
        Some(Uuid::now_v7()),
        json!({"sku":"LEGACY-ARM-COLORS","name":"Produto legado","unit":"UN","ncm":null,"cest":null,"basePrice":"10.00","status":"active","armColors":["Azul"],"plateHolderType":"olympic"}),
    )
    .await;
    assert_eq!(
        legacy_product.0,
        StatusCode::CREATED,
        "{}",
        legacy_product.1
    );
    assert_eq!(
        legacy_product.1["data"]["plateHolderColors"],
        json!(["Azul"])
    );
    assert_eq!(
        legacy_product.1["data"]["plateHolderTypes"],
        json!(["Olímpico"])
    );
    assert_eq!(legacy_product.1["data"]["plateHolderType"], "olympic");
    assert!(legacy_product.1["data"].get("armColors").is_none());
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/products",
            "editor",
            None,
            Some(Uuid::now_v7()),
            json!({"sku":"CONFLICTING-HOLDER-TYPE","name":"Produto divergente","unit":"UN","ncm":null,"cest":null,"basePrice":"10.00","status":"active","plateHolderType":"standard","plateHolderTypes":["Olímpico"]}),
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut input = proposal();
    input["items"][0]["structureColor"] = json!("Piano Black");
    input["items"][0]["armColor"] = json!("Azul");
    input["items"][0]["plateHolderType"] = json!("Olímpico");
    let mut conflicting = input.clone();
    conflicting["items"][0]["plateHolderColor"] = json!("Preto");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/proposals",
            "editor",
            None,
            Some(Uuid::now_v7()),
            conflicting
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut invalid = input.clone();
    invalid["items"][0]["plateHolderType"] = json!("Cônico");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/proposals",
            "editor",
            None,
            Some(Uuid::now_v7()),
            invalid
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let created = call(
        &router,
        "POST",
        "/api/v1/proposals",
        "editor",
        None,
        Some(Uuid::now_v7()),
        input,
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    assert_eq!(created.1["items"][0]["plateHolderColor"], "Azul");
    assert_eq!(created.1["items"][0]["plateHolderType"], "Olímpico");
    assert!(created.1["items"][0].get("armColor").is_none());
    assert!(created.1["items"][0]["upholsteryColor"].is_null());
    let url = format!(
        "/api/v1/proposals/{}",
        created.1["data"]["id"].as_str().unwrap()
    );
    for (action, revision) in [("send", 1), ("accept", 2)] {
        let result = call(
            &router,
            "POST",
            &format!("{url}/{action}"),
            "editor",
            Some(revision),
            Some(Uuid::now_v7()),
            json!({}),
        )
        .await;
        assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    }
    // A later catalog change must not rewrite the customer's agreed finish.
    sqlx::query("UPDATE products SET plate_holder_colors=ARRAY['Preto'],plate_holder_types=ARRAY['Standard'] WHERE id=$1")
        .bind(Uuid::parse_str(PRODUCT).unwrap()).execute(&admin).await.unwrap();
    let converted = call(
        &router,
        "POST",
        &format!("{url}/convert"),
        "editor",
        Some(3),
        Some(Uuid::now_v7()),
        json!({"dueDate":"2100-01-10"}),
    )
    .await;
    assert_eq!(converted.0, StatusCode::OK, "{}", converted.1);
    let order_id = converted.1["data"]["orderId"].as_str().unwrap();
    let order = call(
        &router,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(order.0, StatusCode::OK, "{}", order.1);
    assert_eq!(order.1["items"][0]["plateHolderColor"], "Azul");
    assert_eq!(order.1["items"][0]["plateHolderType"], "Olímpico");
    assert_eq!(order.1["items"][0]["unitPrice"], "19.99");
    let edited = call(&router, "PUT", &format!("/api/v1/orders/{order_id}"), "editor", Some(1), Some(Uuid::now_v7()),
        json!({"customerId":CUSTOMER,"dueDate":"2100-01-10","items":[{"productId":PRODUCT,"quantity":"3.000000","armColor":"Azul"}]})).await;
    assert_eq!(edited.0, StatusCode::OK, "{}", edited.1);
    assert_eq!(edited.1["items"][0]["plateHolderColor"], "Azul");
    assert_eq!(edited.1["items"][0]["plateHolderType"], "Olímpico");
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn proposals_persist_authorize_replay_and_preserve_sent_content(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/proposals",
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'sales.proposals.%'; INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.proposals.read'); INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES('11111111-2222-4333-8444-555555555555','11111111-1111-4111-8111-111111111111','fisica','Cliente de teste','52998224725',true,false,'active'); INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('11111111-2222-4333-8444-666666666666','11111111-1111-4111-8111-111111111111','PROPOSAL-TEST','Produto de teste','UN',1999,'active');")
        .execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/proposals",
            "reader",
            None,
            Some(Uuid::now_v7()),
            proposal()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/proposals",
            "editor",
            None,
            None,
            proposal()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let key = Uuid::now_v7();
    let created = call(
        &router,
        "POST",
        "/api/v1/proposals",
        "editor",
        None,
        Some(key),
        proposal(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    assert_eq!(created.1["data"]["amount"], "49.98");
    assert_eq!(created.1["data"]["status"], "draft");
    let id = created.1["data"]["id"].as_str().unwrap();
    let url = format!("/api/v1/proposals/{id}");
    let replay = call(
        &router,
        "POST",
        "/api/v1/proposals",
        "editor",
        None,
        Some(key),
        proposal(),
    )
    .await;
    assert_eq!(replay.1, created.1);
    let read = call(&router, "GET", &url, "reader", None, None, Value::Null).await;
    assert_eq!(read.1["canEdit"], false);
    assert_eq!(read.1["data"], created.1["data"]);
    let listing = call(
        &router,
        "GET",
        "/api/v1/proposals?q=Cliente&status=draft",
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(listing.1["total"], 1);
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{url}/accept"),
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let sent = call(
        &router,
        "POST",
        &format!("{url}/send"),
        "editor",
        Some(1),
        Some(Uuid::now_v7()),
        json!({}),
    )
    .await;
    assert_eq!(sent.0, StatusCode::OK, "{}", sent.1);
    assert_eq!(sent.1["data"]["revision"], 2);
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{url}/accept"),
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let protected =
        sqlx::query("UPDATE sales_proposal_lines SET name='Changed' WHERE proposal_id=$1")
            .bind(Uuid::parse_str(id).unwrap())
            .execute(&admin)
            .await;
    assert!(
        protected.is_err(),
        "Published item snapshots must be immutable even for privileged database clients"
    );
    let accepted = call(
        &router,
        "POST",
        &format!("{url}/accept"),
        "editor",
        Some(2),
        Some(Uuid::now_v7()),
        json!({}),
    )
    .await;
    assert_eq!(accepted.0, StatusCode::OK, "{}", accepted.1);
    assert_eq!(accepted.1["data"]["status"], "accepted");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sales_orders")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE entity_type='sales_proposal'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        3
    );
    let conversion_key = Uuid::now_v7();
    let conversion = json!({"dueDate":"2100-01-10"});
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{url}/convert"),
            "editor",
            Some(3),
            Some(conversion_key),
            conversion.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','sales.orders.read'),('99999999-9999-4999-8999-999999999999','sales.orders.manage'); UPDATE products SET price_cents=9999 WHERE id='11111111-2222-4333-8444-666666666666';")
        .execute(&admin).await.unwrap();
    let converted = call(
        &router,
        "POST",
        &format!("{url}/convert"),
        "editor",
        Some(3),
        Some(conversion_key),
        conversion.clone(),
    )
    .await;
    assert_eq!(converted.0, StatusCode::OK, "{}", converted.1);
    assert!(converted.1["data"]["orderId"].is_string());
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{url}/convert"),
            "editor",
            Some(3),
            Some(conversion_key),
            conversion.clone()
        )
        .await
        .1,
        converted.1
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{url}/convert"),
            "editor",
            Some(4),
            Some(Uuid::now_v7()),
            conversion
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT number FROM sales_orders")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    let order: (i64, String) = sqlx::query_as("SELECT amount_cents,status FROM sales_orders")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(
        order,
        (4998, "draft".to_owned()),
        "Conversion preserves agreed prices and does not reserve stock"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    let second = call(
        &router,
        "POST",
        "/api/v1/proposals",
        "editor",
        None,
        Some(Uuid::now_v7()),
        proposal(),
    )
    .await;
    assert_eq!(second.0, StatusCode::CREATED, "{}", second.1);
    let second_url = format!(
        "/api/v1/proposals/{}",
        second.1["data"]["id"].as_str().unwrap()
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{second_url}/send"),
            "editor",
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
            &format!("{second_url}/reject"),
            "editor",
            Some(2),
            Some(Uuid::now_v7()),
            json!({})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{second_url}/reject"),
            "editor",
            Some(2),
            Some(Uuid::now_v7()),
            json!({"reason":"Cliente solicitou outro escopo"})
        )
        .await
        .0,
        StatusCode::OK
    );
    let revised = call(
        &router,
        "POST",
        &format!("{second_url}/revise"),
        "editor",
        Some(3),
        Some(Uuid::now_v7()),
        json!({}),
    )
    .await;
    assert_eq!(revised.0, StatusCode::OK, "{}", revised.1);
    assert_eq!(revised.1["data"]["version"], 2);
    assert_eq!(revised.1["data"]["status"], "draft");
    assert_eq!(revised.1["versions"].as_array().unwrap().len(), 2);
    let mut edited = proposal();
    edited["items"][0]["quantity"] = json!("1.000000");
    let updated = call(
        &router,
        "PUT",
        &second_url,
        "editor",
        Some(4),
        Some(Uuid::now_v7()),
        edited,
    )
    .await;
    assert_eq!(updated.0, StatusCode::OK, "{}", updated.1);
    assert_eq!(updated.1["data"]["amount"], "99.99");
    let historical = call(
        &router,
        "GET",
        &format!("{second_url}?version=1"),
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(historical.0, StatusCode::OK, "{}", historical.1);
    assert_eq!(historical.1["data"]["amount"], "249.98");
    assert_eq!(
        historical.1["data"]["decisionReason"],
        "Cliente solicitou outro escopo"
    );
    assert_eq!(historical.1["data"]["isCurrent"], false);
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='sales.proposals.negotiate'").execute(&admin).await.unwrap();
    let mut negotiated = proposal();
    negotiated["items"][0]["unitPrice"] = json!("80.00");
    assert_eq!(
        call(
            &router,
            "PUT",
            &second_url,
            "editor",
            Some(5),
            Some(Uuid::now_v7()),
            negotiated.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','sales.proposals.negotiate')").execute(&admin).await.unwrap();
    let negotiated = call(
        &router,
        "PUT",
        &second_url,
        "editor",
        Some(5),
        Some(Uuid::now_v7()),
        negotiated,
    )
    .await;
    assert_eq!(negotiated.0, StatusCode::OK, "{}", negotiated.1);
    assert_eq!(negotiated.1["data"]["amount"], "200.00");
    assert_eq!(negotiated.1["items"][0]["catalogPrice"], "99.99");
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT price_cents FROM products WHERE id='11111111-2222-4333-8444-666666666666'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        9999
    );
    let mut isolated = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *isolated)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sales_proposals")
            .fetch_one(&mut *isolated)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sales_proposal_versions")
            .fetch_one(&mut *isolated)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sales_proposal_lines")
            .fetch_one(&mut *isolated)
            .await
            .unwrap(),
        0
    );
    isolated.rollback().await.unwrap();
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
