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
    sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status,plate_holder_colors) VALUES($1,$2,'LD-TEST','Equipamento','UN',100,'active',ARRAY['Azul legado'])").bind(product).bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
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
    let mut simulation = json!({"line":"imported","versionId":published.1["id"],"destinationState":"SP","taxpayer":false,"discount":{"kind":"percent","value":2500},"freightCents":10000,"downPaymentCents":0,"items":[{"productId":product,"quantity":3,"structureColor":null,"upholsteryColor":null,"plateHolderColor":null,"plateHolderType":"standard"}]});
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
    let management_quote = call(
        &router,
        "POST",
        "/api/v1/commercial/simulate",
        "editor",
        None,
        None,
        simulation.clone(),
    )
    .await;
    assert_eq!(management_quote.0, StatusCode::OK, "{}", management_quote.1);
    assert!(
        management_quote.1["director"].is_null(),
        "Company management alone must not reveal director financials during simulation"
    );
    assert_eq!(quote.1["sale"]["items"][0]["plateHolderType"], "Standard");
    let conversion = json!({"simulation":simulation,"digest":quote.1["digest"],"customerId":customer,"dueDate":"2027-01-30"});
    let mut stale_conversion = conversion.clone();
    stale_conversion["digest"] = json!("0".repeat(64));
    let stale = call(
        &router,
        "POST",
        "/api/v1/commercial/orders",
        "reader",
        None,
        Some(Uuid::now_v7()),
        stale_conversion,
    )
    .await;
    assert_eq!(stale.0, StatusCode::PRECONDITION_FAILED, "{}", stale.1);
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
    let ordinary = call(
        &router,
        "GET",
        &format!("/api/v1/orders/{}", created.1["id"].as_str().unwrap()),
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(ordinary.0, StatusCode::OK, "{}", ordinary.1);
    assert_eq!(ordinary.1["pricingOrigin"], true);
    assert_eq!(ordinary.1["items"][0]["plateHolderType"], "Standard");
    assert!(ordinary.1["items"][0]["plateHolderColor"].is_null());
    let edited = call(
        &router,
        "PUT",
        &format!("/api/v1/orders/{}", created.1["id"].as_str().unwrap()),
        "reader",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        json!({"customerId":customer,"dueDate":"2027-02-01","items":[{"productId":product,"quantity":"1"}]}),
    )
    .await;
    assert_eq!(edited.0, StatusCode::CONFLICT, "{}", edited.1);
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
    let hidden = call(
        &router,
        "GET",
        &format!("/api/v1/commercial/orders/{order}"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert!(
        hidden.1["director"].is_null(),
        "Company management alone must not reveal director financials"
    );
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','sales.approvals.director')").execute(&admin).await.unwrap();
    let director_quote = call(
        &router,
        "POST",
        "/api/v1/commercial/simulate",
        "editor",
        None,
        None,
        simulation.clone(),
    )
    .await;
    assert_eq!(director_quote.0, StatusCode::OK, "{}", director_quote.1);
    assert!(director_quote.1["director"].is_object());
    let visible = call(
        &router,
        "GET",
        &format!("/api/v1/commercial/orders/{order}"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert!(visible.1["director"].is_object());
    let decision_key = Uuid::now_v7();
    let decision = json!({"approved":true,"reason":"Condições conferidas pela diretoria"});
    let stale_decision = call(
        &router,
        "POST",
        &format!("/api/v1/commercial/orders/{order}/decision"),
        "editor",
        Some("\"2\""),
        Some(Uuid::now_v7()),
        decision.clone(),
    )
    .await;
    assert_eq!(
        stale_decision.0,
        StatusCode::PRECONDITION_FAILED,
        "{}",
        stale_decision.1
    );
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

#[sqlx::test(migrations = "../../migrations")]
async fn legacy_frozen_costs_work_without_current_costs_and_calculated_costs_stay_fresh(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let tenant = Uuid::parse_str(TENANT).unwrap();
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code IN ('sales.orders.read','sales.orders.manage') ON CONFLICT DO NOTHING").execute(&admin).await.unwrap();
    let policy = json!(crate::platform::commercial_settings_model::tests::example());
    sqlx::query("INSERT INTO commercial_settings(tenant_id,product_line,parameters,revision) VALUES($1,'imported',$2,1)").bind(tenant).bind(&policy).execute(&admin).await.unwrap();
    let saved = call(&router,"PUT","/api/v1/commercial/approval-settings","editor",Some("\"1\""),None,json!({"belowTarget":true,"freight":false,"directorAutoApproval":false,"managerLimit":"target"})).await;
    assert_eq!(saved.0, StatusCode::OK, "{}", saved.1);
    for legacy in [true, false] {
        let product = Uuid::now_v7();
        let version = Uuid::now_v7();
        let sku = product.to_string().to_uppercase();
        sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES($1,$2,$3,'Frozen','UN',100,'active')").bind(product).bind(tenant).bind(&sku).execute(&admin).await.unwrap();
        sqlx::query("INSERT INTO price_table_versions(id,tenant_id,product_line,version,settings_revision,policy_snapshot,calculator_version,digest,published_by,source_kind,source_reference) VALUES($1,$2,'imported',$3,1,$4,'test',$5,'33333333-3333-4333-8333-333333333333',$6,$7)")
            .bind(version).bind(tenant).bind(if legacy {6_i64} else {7_i64}).bind(&policy).bind(if legacy {"b".repeat(64)} else {"c".repeat(64)}).bind(if legacy {"legacy"} else {"calculated"}).bind(if legacy {json!({"source":"legacy.example.test","version":6,"historicalVersionId":version})} else {json!({})}).execute(&admin).await.unwrap();
        let snapshot = json!({"source":"legacy.example.test","version":6,"product_id":190,"advisory_cost":5306.06,"tax_credit":0.27800090,"packaging":0});
        let insert = "INSERT INTO price_table_items(tenant_id,version_id,product_id,product_snapshot,cost_revision,cost_snapshot,price_without_ipi_cents,ipi_bps,price_with_ipi_cents,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,1256323,1300,1419645,$7)";
        let product_snapshot = json!({"sku":sku,"name":"Frozen","unit":"UN","revision":1});
        let cost = json!({"purchaseCostCents":530606,"taxCreditBps":2780,"packagingCents":0});
        // Neither a calculated NULL revision nor an incomplete legacy cost is accepted.
        let rejected = sqlx::query(insert)
            .bind(tenant)
            .bind(version)
            .bind(product)
            .bind(&product_snapshot)
            .bind(None::<i64>)
            .bind(json!({}))
            .bind(&snapshot)
            .execute(&admin)
            .await;
        assert!(rejected.is_err());
        if legacy {
            let mut foreign_snapshot = snapshot.clone();
            foreign_snapshot["source"] = json!("different.example.test");
            assert!(
                sqlx::query(insert)
                    .bind(tenant)
                    .bind(version)
                    .bind(product)
                    .bind(&product_snapshot)
                    .bind(None::<i64>)
                    .bind(&cost)
                    .bind(&foreign_snapshot)
                    .execute(&admin)
                    .await
                    .is_err()
            );
        }
        sqlx::query(insert)
            .bind(tenant)
            .bind(version)
            .bind(product)
            .bind(&product_snapshot)
            .bind(if legacy { None } else { Some(1_i64) })
            .bind(&cost)
            .bind(&snapshot)
            .execute(&admin)
            .await
            .unwrap();
        if !legacy {
            sqlx::query("INSERT INTO product_costs(tenant_id,product_id,product_line,purchase_cost_cents,tax_credit_bps,packaging_cents,revision) VALUES($1,$2,'imported',530606,2780,0,1)").bind(tenant).bind(product).execute(&admin).await.unwrap();
        }
        sqlx::query("UPDATE commercial_settings SET active_price_version_id=$2 WHERE tenant_id=$1 AND product_line='imported'").bind(tenant).bind(version).execute(&admin).await.unwrap();
        let mut input = json!({"line":"imported","versionId":version,"destinationState":"SP","taxpayer":false,"discount":{"kind":"percent","value":0},"freightCents":0,"items":[{"productId":product,"quantity":1}]});
        let quote = call(
            &router,
            "POST",
            "/api/v1/commercial/simulate",
            "editor",
            None,
            None,
            input.clone(),
        )
        .await;
        assert_eq!(quote.0, StatusCode::OK, "{}", quote.1);
        let mut isolated = app.begin().await.unwrap();
        sqlx::query(
            "SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)",
        )
        .execute(&mut *isolated)
        .await
        .unwrap();
        let visible: i64 =
            sqlx::query_scalar("SELECT count(*) FROM price_table_items WHERE version_id=$1")
                .bind(version)
                .fetch_one(&mut *isolated)
                .await
                .unwrap();
        assert_eq!(
            visible, 0,
            "A different tenant must never see a frozen snapshot"
        );
        isolated.rollback().await.unwrap();
        input["versionId"] = json!(Uuid::now_v7());
        assert_ne!(
            call(
                &router,
                "POST",
                "/api/v1/commercial/simulate",
                "editor",
                None,
                None,
                input.clone()
            )
            .await
            .0,
            StatusCode::OK
        );
        input["versionId"] = json!(version);
        if !legacy {
            sqlx::query("UPDATE product_costs SET revision=2 WHERE tenant_id=$1 AND product_id=$2")
                .bind(tenant)
                .bind(product)
                .execute(&admin)
                .await
                .unwrap();
            assert_eq!(
                call(
                    &router,
                    "POST",
                    "/api/v1/commercial/simulate",
                    "editor",
                    None,
                    None,
                    input.clone()
                )
                .await
                .0,
                StatusCode::CONFLICT
            );
        }
        sqlx::query("UPDATE products SET revision=2 WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(product)
            .execute(&admin)
            .await
            .unwrap();
        assert_eq!(
            call(
                &router,
                "POST",
                "/api/v1/commercial/simulate",
                "editor",
                None,
                None,
                input
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
    }
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn negotiated_orders_prepare_fiscal_items_without_ipi_and_preserve_the_agreement(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let tenant = Uuid::parse_str(TENANT).unwrap();
    let customer = Uuid::now_v7();
    let version = Uuid::now_v7();
    let products = [Uuid::now_v7(), Uuid::now_v7()];
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('sales.orders.read','sales.orders.manage','fiscal.nfe.read','catalog.products.read','catalog.parties.read') ON CONFLICT DO NOTHING")
        .execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES($1,$2,'fisica','Cliente','52998224725',true,false,'active')")
        .bind(customer).bind(tenant).execute(&admin).await.unwrap();
    let policy = json!(crate::platform::commercial_settings_model::tests::example());
    sqlx::query("INSERT INTO commercial_settings(tenant_id,product_line,parameters,revision) VALUES($1,'imported',$2,1)")
        .bind(tenant).bind(&policy).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO commercial_approval_settings(tenant_id,revision,rules) VALUES($1,1,$2)")
        .bind(tenant).bind(json!({"belowTarget":true,"freight":false,"directorAutoApproval":false,"managerLimit":"target"})).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO price_table_versions(id,tenant_id,product_line,version,settings_revision,policy_snapshot,calculator_version,digest,published_by) VALUES($1,$2,'imported',1,1,$3,'test-published-v1',$4,'33333333-3333-4333-8333-333333333333')")
        .bind(version).bind(tenant).bind(&policy).bind("d".repeat(64)).execute(&admin).await.unwrap();
    for (index, product) in products.iter().enumerate() {
        let sku = format!("FISCAL-{}", index + 1);
        let price = [30_001_i64, 50_003][index];
        sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES($1,$2,$3,'Equipamento','UN',100,'active')")
            .bind(product).bind(tenant).bind(&sku).execute(&admin).await.unwrap();
        sqlx::query("INSERT INTO product_costs(tenant_id,product_id,product_line,purchase_cost_cents,tax_credit_bps,packaging_cents,revision) VALUES($1,$2,'imported',1000,1000,0,1)")
            .bind(tenant).bind(product).execute(&admin).await.unwrap();
        sqlx::query("INSERT INTO stock_balances(tenant_id,product_id,quantity_micros) VALUES($1,$2,10000000)")
            .bind(tenant).bind(product).execute(&admin).await.unwrap();
        sqlx::query("INSERT INTO price_table_items(tenant_id,version_id,product_id,product_snapshot,cost_revision,cost_snapshot,price_without_ipi_cents,ipi_bps,price_with_ipi_cents) VALUES($1,$2,$3,$4,1,$5,$6,1300,$7)")
            .bind(tenant).bind(version).bind(product)
            .bind(json!({"sku":sku,"name":"Equipamento","unit":"UN","revision":1}))
            .bind(json!({"purchaseCostCents":1000,"taxCreditBps":1000,"packagingCents":0}))
            .bind(price).bind((price * 11_300 + 9_999) / 10_000).execute(&admin).await.unwrap();
    }
    sqlx::query("UPDATE commercial_settings SET active_price_version_id=$2 WHERE tenant_id=$1 AND product_line='imported'")
        .bind(tenant).bind(version).execute(&admin).await.unwrap();
    let input = json!({"line":"imported","versionId":version,"destinationState":"SP","taxpayer":false,"discount":{"kind":"percent","value":1000},"freightCents":0,"items":[{"productId":products[0],"quantity":3},{"productId":products[1],"quantity":2}]});
    let quote = call(
        &router,
        "POST",
        "/api/v1/commercial/simulate",
        "editor",
        None,
        None,
        input.clone(),
    )
    .await;
    assert_eq!(quote.0, StatusCode::OK, "{}", quote.1);
    assert_eq!(quote.1["sale"]["approvalReasons"], json!([]));
    let converted = call(&router, "POST", "/api/v1/commercial/orders", "editor", None, Some(Uuid::now_v7()), json!({"simulation":input,"digest":quote.1["digest"],"customerId":customer,"dueDate":"2027-01-30"})).await;
    assert_eq!(converted.0, StatusCode::CREATED, "{}", converted.1);
    let order = Uuid::parse_str(converted.1["id"].as_str().unwrap()).unwrap();
    let confirmed = call(
        &router,
        "POST",
        &format!("/api/v1/orders/{order}/confirm"),
        "editor",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        json!({}),
    )
    .await;
    assert_eq!(confirmed.0, StatusCode::OK, "{}", confirmed.1);
    let snapshot: Value = sqlx::query_scalar(
        "SELECT public_snapshot FROM commercial_order_quotes WHERE tenant_id=$1 AND order_id=$2",
    )
    .bind(tenant)
    .bind(order)
    .fetch_one(&admin)
    .await
    .unwrap();
    // Live prices and policy cannot replace the negotiated net amounts.
    sqlx::query("UPDATE commercial_settings SET parameters=jsonb_set(parameters,'{ipiBps}','0') WHERE tenant_id=$1")
        .bind(tenant).execute(&admin).await.unwrap();
    sqlx::query("UPDATE products SET price_cents=1 WHERE tenant_id=$1")
        .bind(tenant)
        .execute(&admin)
        .await
        .unwrap();
    let path = format!("/api/v1/fiscal/order-preparations/{order}");
    let prepared = call(&router, "GET", &path, "editor", None, None, Value::Null).await;
    assert_eq!(prepared.0, StatusCode::OK, "{}", prepared.1);
    let sale = &quote.1["sale"];
    assert_eq!(
        crate::domains::fixed(prepared.1["productsTotal"].as_str().unwrap(), 2).unwrap(),
        sale["netSaleCents"].as_i64().unwrap()
    );
    assert_eq!(prepared.1["items"].as_array().unwrap().len(), 2);
    for (actual, negotiated) in prepared.1["items"]
        .as_array()
        .unwrap()
        .iter()
        .zip(sale["items"].as_array().unwrap())
    {
        assert_eq!(actual["productId"], negotiated["productId"]);
        let unit = crate::domains::fixed(actual["unitPrice"].as_str().unwrap(), 2).unwrap();
        let net = crate::domains::fixed(actual["grossTotal"].as_str().unwrap(), 2).unwrap();
        let quantity = negotiated["quantity"].as_i64().unwrap();
        assert_eq!(unit, negotiated["unitNetCents"].as_i64().unwrap());
        assert_eq!(net, negotiated["netCents"].as_i64().unwrap());
        assert_eq!(unit * quantity, net);
        assert_eq!(
            negotiated["totalCents"].as_i64().unwrap() - net,
            negotiated["ipiCents"].as_i64().unwrap()
        );
        assert!(
            actual.get("ipiBps").is_none(),
            "Commercial rates must not declare fiscal taxes"
        );
    }
    let persisted: (i64, Value) = sqlx::query_as("SELECT o.amount_cents,q.public_snapshot FROM sales_orders o JOIN commercial_order_quotes q ON q.tenant_id=o.tenant_id AND q.order_id=o.id WHERE o.tenant_id=$1 AND o.id=$2")
        .bind(tenant).bind(order).fetch_one(&admin).await.unwrap();
    assert_eq!(persisted.0, sale["totalCents"].as_i64().unwrap());
    assert_eq!(persisted.1, snapshot);
    assert_ne!(sale["totalCents"], sale["netSaleCents"]);
    // Keep unit/quantity arithmetic valid while diverging from the preserved agreement.
    sqlx::query("UPDATE sales_order_lines SET price_cents=price_cents+1,amount_cents=amount_cents+quantity_micros/1000000 WHERE tenant_id=$1 AND order_id=$2 AND product_id=$3")
        .bind(tenant).bind(order).bind(products[1]).execute(&admin).await.unwrap();
    let inconsistent = call(&router, "GET", &path, "editor", None, None, Value::Null).await;
    assert_eq!(inconsistent.0, StatusCode::CONFLICT, "{}", inconsistent.1);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn negotiated_order_conversion_saves_checkout_replays_and_rolls_back_invalid_plans(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    let tenant = Uuid::parse_str(TENANT).unwrap();
    let customer = Uuid::now_v7();
    let product = Uuid::now_v7();
    let version = Uuid::now_v7();
    let method = Uuid::now_v7();
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('sales.orders.read','sales.orders.manage') ON CONFLICT DO NOTHING")
        .execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES($1,$2,'fisica','Cliente preservado','52998224725',true,false,'active')")
        .bind(customer).bind(tenant).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO payment_methods(id,tenant_id,code,name,status,revision,modality,settlement_days) VALUES($1,$2,'PIX','Pix combinado','active',1,'pix',0)")
        .bind(method).bind(tenant).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES($1,$2,'CHECKOUT-QUOTE','Equipamento','UN',100,'active')")
        .bind(product).bind(tenant).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO product_costs(tenant_id,product_id,product_line,purchase_cost_cents,tax_credit_bps,packaging_cents,revision) VALUES($1,$2,'imported',1000,1000,0,1)")
        .bind(tenant).bind(product).execute(&admin).await.unwrap();
    let policy = json!(crate::platform::commercial_settings_model::tests::example());
    sqlx::query("INSERT INTO commercial_settings(tenant_id,product_line,parameters,revision) VALUES($1,'imported',$2,1)")
        .bind(tenant).bind(&policy).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO commercial_approval_settings(tenant_id,revision,rules) VALUES($1,1,$2)")
        .bind(tenant).bind(json!({"belowTarget":true,"freight":false,"directorAutoApproval":false,"managerLimit":"target"})).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO price_table_versions(id,tenant_id,product_line,version,settings_revision,policy_snapshot,calculator_version,digest,published_by) VALUES($1,$2,'imported',1,1,$3,'test-published-v1',$4,'33333333-3333-4333-8333-333333333333')")
        .bind(version).bind(tenant).bind(&policy).bind("f".repeat(64)).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO price_table_items(tenant_id,version_id,product_id,product_snapshot,cost_revision,cost_snapshot,price_without_ipi_cents,ipi_bps,price_with_ipi_cents) VALUES($1,$2,$3,$4,1,$5,30001,1300,33902)")
        .bind(tenant).bind(version).bind(product).bind(json!({"sku":"CHECKOUT-QUOTE","name":"Equipamento","unit":"UN","revision":1}))
        .bind(json!({"purchaseCostCents":1000,"taxCreditBps":1000,"packagingCents":0})).execute(&admin).await.unwrap();
    sqlx::query("UPDATE commercial_settings SET active_price_version_id=$2 WHERE tenant_id=$1 AND product_line='imported'")
        .bind(tenant).bind(version).execute(&admin).await.unwrap();
    let simulation = json!({"line":"imported","versionId":version,"destinationState":"SP","taxpayer":false,"discount":{"kind":"percent","value":0},"freightCents":0,"items":[{"productId":product,"quantity":3}]});
    let quote = call(
        &router,
        "POST",
        "/api/v1/commercial/simulate",
        "editor",
        None,
        None,
        simulation.clone(),
    )
    .await;
    assert_eq!(quote.0, StatusCode::OK, "{}", quote.1);
    let total = quote.1["sale"]["totalCents"].as_i64().unwrap();
    let entry = quote.1["sale"]["downPaymentCents"].as_i64().unwrap();
    let balance = total - entry;
    let checkout = json!({
        "entry":{"paymentMethodId":method,"dueOn":null},
        "installments":[
            {"paymentMethodId":method,"dueOn":"2027-03-01","amountCents":balance/2},
            {"paymentMethodId":method,"dueOn":"2027-04-01","amountCents":balance-balance/2}
        ],
        "manufacturingDays":30,"deliveryNotes":"Entregar na recepção",
        "paymentNotes":"Entrada Pix e saldo em duas parcelas","notes":"Condições conferidas",
        "stateRegistration":"ISENTO"
    });
    let request = json!({"simulation":simulation,"digest":quote.1["digest"],"customerId":customer,"dueDate":"2027-04-01","checkout":checkout});
    let counts = "SELECT jsonb_build_object('orders',(SELECT count(*) FROM sales_orders WHERE tenant_id=$1),'lines',(SELECT count(*) FROM sales_order_lines WHERE tenant_id=$1),'quotes',(SELECT count(*) FROM commercial_order_quotes WHERE tenant_id=$1),'checkouts',(SELECT count(*) FROM sales_order_checkouts WHERE tenant_id=$1),'installments',(SELECT count(*) FROM sales_order_installments WHERE tenant_id=$1),'outbox',(SELECT count(*) FROM outbox_events WHERE tenant_id=$1),'commands',(SELECT count(*) FROM domain_commands WHERE tenant_id=$1),'receivables',(SELECT count(*) FROM receivables WHERE tenant_id=$1))";
    let before: Value = sqlx::query_scalar(counts)
        .bind(tenant)
        .fetch_one(&admin)
        .await
        .unwrap();
    let key = Uuid::now_v7();
    let mut invalid = request.clone();
    invalid["checkout"]["installments"][0]["amountCents"] = json!(balance / 2 + 1);
    let rejected = call(
        &router,
        "POST",
        "/api/v1/commercial/orders",
        "editor",
        None,
        Some(key),
        invalid,
    )
    .await;
    assert_eq!(
        rejected.0,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{}",
        rejected.1
    );
    let after: Value = sqlx::query_scalar(counts)
        .bind(tenant)
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(
        after, before,
        "Rejected plans must leave no partial order, snapshot, outbox or command"
    );
    // A failed request does not consume the command key.
    let created = call(
        &router,
        "POST",
        "/api/v1/commercial/orders",
        "editor",
        None,
        Some(key),
        request.clone(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    let replayed = call(
        &router,
        "POST",
        "/api/v1/commercial/orders",
        "editor",
        None,
        Some(key),
        request.clone(),
    )
    .await;
    assert_eq!(replayed.0, StatusCode::CREATED, "{}", replayed.1);
    assert_eq!(replayed.1, created.1);
    let mut changed = request.clone();
    changed["checkout"]["deliveryNotes"] = json!("Outro local de entrega");
    let conflict = call(
        &router,
        "POST",
        "/api/v1/commercial/orders",
        "editor",
        None,
        Some(key),
        changed,
    )
    .await;
    assert_eq!(conflict.0, StatusCode::CONFLICT, "{}", conflict.1);
    let order = created.1["id"].as_str().unwrap();
    sqlx::query("UPDATE parties SET legal_name='Cadastro alterado' WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(customer)
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query("UPDATE payment_methods SET name='Forma alterada' WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(method)
        .execute(&admin)
        .await
        .unwrap();
    let ordinary = call(
        &router,
        "GET",
        &format!("/api/v1/orders/{order}"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    let negotiated = call(
        &router,
        "GET",
        &format!("/api/v1/commercial/orders/{order}"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(ordinary.0, StatusCode::OK, "{}", ordinary.1);
    assert_eq!(negotiated.0, StatusCode::OK, "{}", negotiated.1);
    let saved = &ordinary.1["checkout"];
    assert_eq!(saved, &negotiated.1["checkout"]);
    assert_eq!(saved["customer"]["legalName"], "Cliente preservado");
    assert_eq!(saved["entry"]["amountCents"], entry);
    assert_eq!(saved["entry"]["paymentMethod"]["name"], "Pix combinado");
    assert!(saved["entry"]["dueOn"].is_null());
    assert_eq!(saved["manufacturingDays"], 30);
    assert_eq!(saved["stateRegistration"], "ISENTO");
    assert_eq!(saved["deliveryNotes"], checkout["deliveryNotes"]);
    assert_eq!(saved["paymentNotes"], checkout["paymentNotes"]);
    assert_eq!(saved["notes"], checkout["notes"]);
    let installments = saved["installments"].as_array().unwrap();
    assert_eq!(installments.len(), 2);
    for (index, installment) in installments.iter().enumerate() {
        assert!(Uuid::parse_str(installment["id"].as_str().unwrap()).is_ok());
        assert_eq!(installment["number"], index + 1);
        assert_eq!(installment["paymentMethodId"], json!(method));
        assert_eq!(installment["paymentMethod"]["name"], "Pix combinado");
        assert_eq!(
            installment["dueOn"],
            checkout["installments"][index]["dueOn"]
        );
        assert_eq!(
            installment["amountCents"],
            checkout["installments"][index]["amountCents"]
        );
    }
    assert_eq!(
        entry
            + installments
                .iter()
                .map(|item| item["amountCents"].as_i64().unwrap())
                .sum::<i64>(),
        total
    );
    assert_eq!(negotiated.1["data"]["sale"]["totalCents"], total);
    let persisted: Value = sqlx::query_scalar(counts)
        .bind(tenant)
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(persisted["orders"], 1);
    assert_eq!(persisted["checkouts"], 1);
    assert_eq!(persisted["installments"], 3);
    assert_eq!(persisted["outbox"], 1);
    assert_eq!(persisted["commands"], 1);
    assert_eq!(
        persisted["receivables"], 0,
        "A saved draft must not create receivables before confirmation"
    );
    cleanup(&admin, app, server, &role).await;
}
