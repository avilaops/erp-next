use super::company_tests::{cleanup, setup};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";

async fn get(router: &Router, uri: &str) -> (StatusCode, Value) {
    get_as(router, uri, "editor").await
}

async fn get_as(router: &Router, uri: &str, subject: &str) -> (StatusCode, Value) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("x-tenant-id", TENANT)
                .header("authorization", format!("Bearer {subject}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn page(router: &Router, uri: &str) -> Vec<Value> {
    let (status, body) = get(router, uri).await;
    assert_eq!(status, StatusCode::OK, "{uri}: {body}");
    body["data"].as_array().unwrap().clone()
}

async fn numeric_pages(router: &Router, endpoint: &str, key: &str, response_key: &str) {
    for direction in ["asc", "desc"] {
        let mut rows = Vec::new();
        for offset in [0, 50, 100, 150] {
            let uri =
                format!("{endpoint}&sortBy={key}&sortOrder={direction}&limit=50&offset={offset}");
            let (status, body) = get(router, &uri).await;
            assert_eq!(status, StatusCode::OK, "{uri}: {body}");
            assert_eq!(body["total"], 160, "{uri}");
            rows.extend(body["data"].as_array().unwrap().clone());
        }
        assert_eq!(rows.len(), 160);
        let values: Vec<i64> = rows
            .iter()
            .map(|r| match &r[response_key] {
                Value::String(s) => s.replace('.', "").parse().unwrap(),
                value => value.as_i64().unwrap(),
            })
            .collect();
        assert!(
            values.windows(2).all(|p| if direction == "asc" {
                p[0] <= p[1]
            } else {
                p[0] >= p[1]
            }),
            "{endpoint} {key} {direction}: {values:?}"
        );
        for pair in rows.windows(2) {
            if pair[0][response_key] == pair[1][response_key] {
                let stable = match (&pair[0]["id"], &pair[1]["id"]) {
                    (Value::String(a), Value::String(b)) => a < b,
                    (a, b) => a.as_i64().unwrap() < b.as_i64().unwrap(),
                };
                assert!(stable, "stable unique tie: {pair:?}");
            }
        }
        assert_eq!(
            values[0],
            if key == "number" {
                if direction == "asc" { 1 } else { 160 }
            } else if direction == "asc" {
                200
            } else {
                10000
            }
        );
    }
}

async fn grant(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions ON CONFLICT DO NOTHING")
        .execute(admin).await.unwrap();
}

#[sqlx::test(migrations = "../../migrations")]
async fn business_lists_sort_the_full_filtered_tenant_set_with_native_numbers_and_aggregates(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    let tenant = Uuid::parse_str(TENANT).unwrap();
    sqlx::raw_sql(r#"
        INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status)
        VALUES(md5('sort-party')::uuid,'11111111-1111-4111-8111-111111111111','juridica','Cliente','04252011000110',true,true,'active'),
        (md5('other-sort-party')::uuid,'22222222-2222-4222-8222-222222222222','juridica','Outro','04252011000110',true,true,'active');
        INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status)
        SELECT md5('sort-order-'||i)::uuid,'11111111-1111-4111-8111-111111111111',md5('sort-party')::uuid,'Cliente '||i,'04252011000110',DATE '2026-01-01'+i,CASE i%3 WHEN 0 THEN 200 WHEN 1 THEN 1000 ELSE 10000 END,CASE WHEN i%2=0 THEN 'draft' ELSE 'confirmed' END FROM generate_series(1,160) i;
        INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status)
        VALUES(md5('foreign-sort-order')::uuid,'22222222-2222-4222-8222-222222222222',md5('other-sort-party')::uuid,'Cliente 0','04252011000110','2025-01-01',1,'draft');
        INSERT INTO receivables(id,tenant_id,order_id,customer_name,due_date,amount_cents,status)
        SELECT md5('sort-receivable-'||number)::uuid,tenant_id,id,customer_name,due_date,amount_cents,'open' FROM sales_orders WHERE tenant_id='11111111-1111-4111-8111-111111111111';
        INSERT INTO receivables(id,tenant_id,order_id,customer_name,due_date,amount_cents,status)
        SELECT md5('foreign-sort-receivable')::uuid,tenant_id,id,customer_name,due_date,amount_cents,'open' FROM sales_orders WHERE tenant_id='22222222-2222-4222-8222-222222222222';
        INSERT INTO purchase_orders(id,tenant_id,supplier_id,supplier_name,supplier_tax_id,due_date,amount_cents,status)
        SELECT md5('sort-purchase-'||number)::uuid,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,'draft' FROM sales_orders WHERE tenant_id='11111111-1111-4111-8111-111111111111';
        INSERT INTO purchase_receipts(id,tenant_id,order_id,reference,occurred_on,amount_cents)
        SELECT md5('sort-receipt-'||id)::uuid,tenant_id,id,'Receipt '||id,due_date,amount_cents FROM purchase_orders;
        INSERT INTO payables(id,tenant_id,receipt_id,supplier_name,due_date,amount_cents,status)
        SELECT md5('sort-payable-'||p.id)::uuid,p.tenant_id,r.id,p.supplier_name,p.due_date,p.amount_cents,'open' FROM purchase_orders p JOIN purchase_receipts r ON r.order_id=p.id AND r.tenant_id=p.tenant_id;
        INSERT INTO sales_opportunities(id,tenant_id,data,created_by)
        SELECT md5('sort-opportunity-'||i)::uuid,'11111111-1111-4111-8111-111111111111',jsonb_build_object('title','Oportunidade '||i,'companyName','Empresa '||i,'estimatedCents',CASE i%3 WHEN 0 THEN 200 WHEN 1 THEN 1000 ELSE 10000 END,'stage',CASE i%3 WHEN 0 THEN 'new' WHEN 1 THEN 'negotiation' ELSE 'won' END),'33333333-3333-4333-8333-333333333333' FROM generate_series(160,1,-1) i;
        INSERT INTO sales_proposals(id,tenant_id) SELECT md5('sort-proposal-'||i)::uuid,'11111111-1111-4111-8111-111111111111' FROM generate_series(160,1,-1) i;
        INSERT INTO sales_proposal_versions(tenant_id,proposal_id,version,customer_id,customer_name,customer_tax_id,valid_until,payment_terms,delivery_terms,amount_cents,status,created_by,sent_at)
        SELECT '11111111-1111-4111-8111-111111111111',md5('sort-proposal-'||i)::uuid,1,md5('sort-party')::uuid,'Cliente '||i,'04252011000110',CASE WHEN i%2=0 THEN CURRENT_DATE-10 ELSE CURRENT_DATE+10 END,'À vista','Retirada',CASE i%3 WHEN 0 THEN 200 WHEN 1 THEN 1000 ELSE 10000 END,'sent','editor',CURRENT_TIMESTAMP FROM generate_series(160,1,-1) i;
    "#).execute(&admin).await.unwrap();
    for (endpoint, key, output) in [
        ("/api/v1/orders?", "number", "number"),
        ("/api/v1/orders?", "amount", "amount"),
        ("/api/v1/receivables?", "amount", "amount"),
        (
            "/api/v1/receivables?",
            "outstandingAmount",
            "outstandingAmount",
        ),
        ("/api/v1/purchase-orders?", "amount", "amount"),
        ("/api/v1/payables?", "amount", "amount"),
        (
            "/api/v1/financial-payables?",
            "outstandingAmount",
            "outstandingAmount",
        ),
        ("/api/v1/opportunities?", "estimatedCents", "estimatedCents"),
        ("/api/v1/proposals?", "amount", "amount"),
    ] {
        numeric_pages(&router, endpoint, key, output).await;
    }
    for direction in ["asc", "desc"] {
        let orders = page(
            &router,
            &format!("/api/v1/orders?sortBy=dueDate&sortOrder={direction}&limit=100"),
        )
        .await;
        assert_eq!(
            orders[0]["number"],
            if direction == "asc" { "1" } else { "160" }
        );
        let receivables = page(
            &router,
            &format!("/api/v1/receivables?sortBy=orderNumber&sortOrder={direction}&limit=100"),
        )
        .await;
        assert_eq!(receivables[0]["orderId"], orders[0]["id"]);
        assert_eq!(receivables[0]["orderNumber"], orders[0]["number"]);
        let (status, detail) = get(
            &router,
            &format!(
                "/api/v1/receivables/{}",
                receivables[0]["id"].as_str().unwrap()
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(detail["data"]["orderNumber"], orders[0]["number"]);
    }
    let filtered = page(
        &router,
        "/api/v1/orders?q=PV-100&sortBy=amount&sortOrder=asc",
    )
    .await;
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0]["number"], "100");
    let stages = page(
        &router,
        "/api/v1/opportunities?stage=won&sortBy=title&sortOrder=desc&limit=100",
    )
    .await;
    assert_eq!(stages[0]["title"], "Oportunidade 158");
    assert!(stages.iter().all(|r| r["stage"] == "won"));
    let mixed_stages = page(
        &router,
        "/api/v1/opportunities?sortBy=stage&sortOrder=asc&limit=100",
    )
    .await;
    assert_eq!(mixed_stages[0]["stage"], "won");
    assert_eq!(mixed_stages[53]["stage"], "negotiation");
    let proposals = page(
        &router,
        "/api/v1/proposals?sortBy=status&sortOrder=desc&limit=50",
    )
    .await;
    assert!(proposals.iter().all(|r| r["expired"] == true));
    let proposals = page(
        &router,
        "/api/v1/proposals?status=sent&sortBy=validUntil&sortOrder=asc&limit=100",
    )
    .await;
    assert_eq!(proposals.len(), 80);
    assert!(proposals.iter().all(|r| r["expired"] == false));
    // A ledger entry changes the displayed outstanding amount independently of face value.
    sqlx::query("INSERT INTO receivable_payments(id,tenant_id,receivable_id,kind,amount_cents,method,reference,occurred_on) VALUES(md5('sort-partial')::uuid,$1,md5('sort-receivable-2')::uuid,'receipt',9900,'cash','Partial receipt',CURRENT_DATE)")
        .bind(tenant).execute(&admin).await.unwrap();
    let outstanding = page(
        &router,
        "/api/v1/receivables?sortBy=outstandingAmount&limit=1",
    )
    .await;
    assert_eq!(outstanding[0]["outstandingAmount"], "1.00");
    let by_status = page(
        &router,
        "/api/v1/receivables?sortBy=status&sortOrder=desc&limit=1",
    )
    .await;
    assert_eq!(by_status[0]["receivedAmount"], "99.00");
    sqlx::query("INSERT INTO payable_payments(id,tenant_id,payable_id,kind,amount_cents,method,reference,occurred_on) SELECT md5('sort-paid-partial')::uuid,tenant_id,id,'payment',9900,'cash','Partial payment',CURRENT_DATE FROM payables WHERE tenant_id=$1 AND amount_cents=10000 LIMIT 1")
        .bind(tenant).execute(&admin).await.unwrap();
    for endpoint in ["payables", "financial-payables"] {
        let outstanding = page(
            &router,
            &format!("/api/v1/{endpoint}?sortBy=outstandingAmount&limit=1"),
        )
        .await;
        assert_eq!(outstanding[0]["outstandingAmount"], "1.00");
        let status = page(
            &router,
            &format!("/api/v1/{endpoint}?sortBy=status&sortOrder=desc&limit=1"),
        )
        .await;
        assert_eq!(status[0]["paidAmount"], "99.00");
    }
    for (endpoint, valid) in [
        ("orders", "number"),
        ("proposals", "version"),
        ("receivables", "amount"),
        ("payables", "dueDate"),
        ("financial-payables", "status"),
        ("purchase-orders", "supplierName"),
        ("opportunities", "stage"),
    ] {
        for bad in [
            "sortBy=amount%3BDROP%20TABLE%20tenants",
            "sortOrder=asc",
            "sortBy=unknown",
            "sortBy=amount&sortOrder=desc%20NULLS%20FIRST",
            "sort_by=amount",
        ] {
            assert_eq!(
                get(&router, &format!("/api/v1/{endpoint}?{bad}")).await.0,
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        assert_eq!(
            get(&router, &format!("/api/v1/{endpoint}?sortBy={valid}"))
                .await
                .0,
            StatusCode::OK
        );
    }
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn pos_sorts_calculated_prices_sales_and_session_nulls_before_pagination(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    sqlx::raw_sql(r#"
        INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status)
        SELECT md5('pos-sort-product-'||i)::uuid,'11111111-1111-4111-8111-111111111111','POS-SORT-'||i,'Produto '||i,'UN',CASE i%3 WHEN 0 THEN 200 WHEN 1 THEN 1000 ELSE 10000 END,'active' FROM generate_series(160,1,-1) i;
        INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES(md5('foreign-pos-sort')::uuid,'22222222-2222-4222-8222-222222222222','POS-FOREIGN','Produto 0','UN',1,'active');
        INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES(md5('zero-pos-sort')::uuid,'11111111-1111-4111-8111-111111111111','POS-ZERO','Produto 0','UN',0,'active');
        INSERT INTO financial_accounts(id,tenant_id,code,name,status,revision,account_type) VALUES(md5('sort-cash')::uuid,'11111111-1111-4111-8111-111111111111','SORT-CASH','Caixa','active',1,'cash');
        INSERT INTO pos_sessions(id,tenant_id,register,cash_account_id,opening_cents,status,opened_by,opened_at,closed_at,counted_cents)
        SELECT md5('sort-session-'||i)::uuid,'11111111-1111-4111-8111-111111111111','Caixa '||i,md5('sort-cash')::uuid,0,'closed','editor',TIMESTAMPTZ '2026-01-01 12:00Z'+i*INTERVAL '1 day',TIMESTAMPTZ '2026-01-01 13:00Z'+i*INTERVAL '1 day',0 FROM generate_series(160,1,-1) i;
        INSERT INTO pos_sessions(id,tenant_id,register,cash_account_id,opening_cents,status,opened_by) VALUES(md5('sort-open-session')::uuid,'11111111-1111-4111-8111-111111111111','Aberto',md5('sort-cash')::uuid,0,'open','editor');
        INSERT INTO pos_sales(id,tenant_id,session_id,total_cents,receipt,created_by,created_at,status)
        SELECT md5('sort-pos-sale-'||i)::uuid,'11111111-1111-4111-8111-111111111111',md5('sort-session-1')::uuid,CASE i%3 WHEN 0 THEN 200 WHEN 1 THEN 1000 ELSE 10000 END,'{}','editor',TIMESTAMPTZ '2026-01-01 12:00Z'+i*INTERVAL '1 day',CASE WHEN i%2=0 THEN 'cancelled' ELSE 'completed' END FROM generate_series(160,1,-1) i;
    "#).execute(&admin).await.unwrap();
    numeric_pages(
        &router,
        "/api/v1/pos/products?destination=SP&taxpayer=false&search=POS-SORT-",
        "price",
        "unitPrice",
    )
    .await;
    numeric_pages(&router, "/api/v1/pos/sales?", "total", "total").await;
    for direction in ["asc", "desc"] {
        let mut products = page(&router, &format!("/api/v1/pos/products?destination=SP&taxpayer=false&sortBy=price&sortOrder={direction}&limit=100")).await;
        products.extend(page(&router, &format!("/api/v1/pos/products?destination=SP&taxpayer=false&sortBy=price&sortOrder={direction}&limit=100&offset=100")).await);
        assert_eq!(products.len(), 161);
        assert!(
            products[..160]
                .iter()
                .all(|r| r["pricingAvailable"] == true)
        );
        assert_eq!(products[160]["sku"], "POS-ZERO");
        assert_eq!(products[160]["unitPrice"], "0.00");
        assert_eq!(products[160]["pricingAvailable"], false);
    }
    let products = page(
        &router,
        "/api/v1/pos/products?destination=SP&taxpayer=false&sortBy=name&sortOrder=desc&limit=1",
    )
    .await;
    assert_eq!(products[0]["name"], "Produto 160");
    let products = page(
        &router,
        "/api/v1/pos/products?destination=SP&taxpayer=false&search=POS-SORT-160&sortBy=price",
    )
    .await;
    assert_eq!(products.len(), 1);
    assert_eq!(products[0]["name"], "Produto 160");
    for direction in ["asc", "desc"] {
        let mut sessions = page(
            &router,
            &format!("/api/v1/pos/sessions?sortBy=closedAt&sortOrder={direction}&limit=100"),
        )
        .await;
        sessions.extend(page(&router,&format!("/api/v1/pos/sessions?sortBy=closedAt&sortOrder={direction}&limit=100&offset=100")).await);
        assert_eq!(sessions.len(), 161);
        assert_eq!(sessions.last().unwrap()["closedAt"], Value::Null);
        assert_eq!(
            sessions[0]["register"],
            if direction == "asc" {
                "Caixa 1"
            } else {
                "Caixa 160"
            }
        );
    }
    let sessions = page(&router,"/api/v1/pos/sessions?status=closed&startDate=2026-01-02&endDate=2026-01-03&sortBy=register&sortOrder=desc").await;
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0]["register"], "Caixa 2");
    let sales = page(
        &router,
        "/api/v1/pos/sales?status=cancelled&sortBy=createdAt&sortOrder=asc&limit=100",
    )
    .await;
    assert_eq!(sales.len(), 80);
    assert!(sales.iter().all(|r| r["status"] == "cancelled"));
    for endpoint in [
        "products?destination=SP&taxpayer=false&",
        "sessions?",
        "sales?",
    ] {
        for bad in [
            "sortBy=unknown",
            "sortOrder=desc",
            "sortBy=price&sortOrder=desc%20NULLS%20FIRST",
        ] {
            assert_eq!(
                get(&router, &format!("/api/v1/pos/{endpoint}&{bad}"))
                    .await
                    .0,
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
    }
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn pos_movement_pages_sort_all_records_with_tenant_and_permission_guards(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    sqlx::raw_sql(r#"
        INSERT INTO financial_accounts(id,tenant_id,code,name,status,revision,account_type) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac01','11111111-1111-4111-8111-111111111111','MOVE-CASH','Caixa','active',1,'cash'),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac02','11111111-1111-4111-8111-111111111111','MOVE-BANK','Banco','active',1,'bank'),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac03','22222222-2222-4222-8222-222222222222','MOVE-OTHER','Caixa externo','active',1,'cash');
        INSERT INTO pos_sessions(id,tenant_id,register,cash_account_id,opening_cents,status,opened_by) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab01','11111111-1111-4111-8111-111111111111','Movimentos','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac01',0,'open','editor'),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab02','22222222-2222-4222-8222-222222222222','Movimentos externos','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac03',0,'open','editor');
        INSERT INTO financial_account_transfers(id,tenant_id,source_account_id,target_account_id,amount_cents,occurred_on,description)
        VALUES(md5('movement-sort-transfer')::uuid,'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac02',10000,CURRENT_DATE,'Transferência para teste');
        INSERT INTO pos_cash_movements(id,tenant_id,session_id,direction,amount_cents,reason,transfer_id,created_at)
        SELECT md5('movement-sort-'||i)::uuid,'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab01',CASE WHEN i%2=0 THEN 'withdrawal' ELSE 'supply' END,CASE i%3 WHEN 0 THEN 200 WHEN 1 THEN 1000 ELSE 10000 END,'Motivo '||i,md5('movement-sort-transfer')::uuid,TIMESTAMPTZ '2026-01-01 12:00Z'+i*INTERVAL '1 day' FROM generate_series(160,1,-1) i;
    "#).execute(&admin).await.unwrap();
    let endpoint = "/api/v1/pos/sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab01/movements";
    numeric_pages(&router, &format!("{endpoint}?"), "amount", "amount").await;
    let (status, body) = get(&router, endpoint).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total"], 160);
    assert_eq!(body["offset"], 0);
    assert_eq!(body["limit"], 50);
    assert_eq!(body["canEdit"], true);
    assert_eq!(body["data"].as_array().unwrap().len(), 50);
    assert_eq!(body["data"][0]["reason"], "Motivo 160");
    for direction in ["asc", "desc"] {
        for key in ["createdAt", "type"] {
            let mut rows = Vec::new();
            for offset in [0, 50, 100, 150] {
                rows.extend(
                    page(
                        &router,
                        &format!(
                            "{endpoint}?sortBy={key}&sortOrder={direction}&limit=50&offset={offset}"
                        ),
                    )
                    .await,
                );
            }
            let mut expected: Vec<i32> = if key == "createdAt" {
                (1..=160).collect()
            } else {
                (1..=80)
                    .map(|i| i * 2)
                    .chain((0..80).map(|i| i * 2 + 1))
                    .collect()
            };
            if direction == "desc" {
                expected.reverse();
            }
            assert_eq!(
                rows.iter()
                    .map(|r| r["reason"].as_str().unwrap().to_owned())
                    .collect::<Vec<_>>(),
                expected
                    .iter()
                    .map(|i| format!("Motivo {i}"))
                    .collect::<Vec<_>>()
            );
        }
    }
    for bad in [
        "sortBy=amount%3BDROP%20TABLE%20tenants",
        "sortOrder=desc",
        "sortBy=unknown",
        "sortBy=amount&sortOrder=DESC",
        "sortBy=amount&sortOrder=asc%20NULLS%20FIRST",
        "sort_by=amount",
        "offset=100001",
        "limit=0",
        "limit=101",
    ] {
        assert_eq!(
            get(&router, &format!("{endpoint}?{bad}")).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(
        get(
            &router,
            "/api/v1/pos/sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab02/movements"
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(
            &router,
            "/api/v1/pos/sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab03/movements"
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get_as(&router, endpoint, "reader").await.0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.pos.read')").execute(&admin).await.unwrap();
    let (status, read_only) = get_as(&router, endpoint, "reader").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(read_only["canEdit"], false);
    // The movement ledger forbids zero and NULL amounts; sorting preserves that contract.
    for amount in [Some(0_i64), None] {
        let error=sqlx::query("INSERT INTO pos_cash_movements(id,tenant_id,session_id,direction,amount_cents,reason,transfer_id) SELECT $1,tenant_id,session_id,direction,$2,reason,transfer_id FROM pos_cash_movements LIMIT 1")
            .bind(Uuid::now_v7()).bind(amount).execute(&admin).await.unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().unwrap(),
            if amount.is_some() { "23514" } else { "23502" }
        );
    }
    assert_eq!(get(&router, endpoint).await.1["total"], 160);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn outgoing_imports_use_typed_global_number_amount_date_and_visible_environment(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    sqlx::raw_sql(r#"
        INSERT INTO fiscal_outgoing_imports(tenant_id,access_key,issuer_document,issuer_name,recipient_name,number,series,issued_at,total_cents,item_count,environment,xml,xml_sha256,imported_by_identity_id)
        SELECT '11111111-1111-4111-8111-111111111111',lpad(i::text,44,'0'),'04252011000110','Emitente','Destinatário '||i,i,1,TIMESTAMPTZ '2026-01-01 12:00Z'+i*INTERVAL '1 day',CASE i%3 WHEN 0 THEN 200 WHEN 1 THEN 1000 ELSE 10000 END,1,CASE WHEN i%2=0 THEN 2 ELSE 1 END,'<xml/>',repeat('a',64),'33333333-3333-4333-8333-333333333333' FROM generate_series(160,1,-1) i;
        INSERT INTO fiscal_outgoing_imports(tenant_id,access_key,issuer_document,issuer_name,recipient_name,number,series,issued_at,total_cents,item_count,environment,xml,xml_sha256,imported_by_identity_id)
        VALUES('22222222-2222-4222-8222-222222222222',repeat('0',43)||'1','04252011000110','Outro emitente','Destinatário 0',1,1,'2020-01-01',1,1,1,'<xml/>',repeat('a',64),'33333333-3333-4333-8333-333333333333');
    "#).execute(&admin).await.unwrap();
    numeric_pages(
        &router,
        "/api/v1/fiscal/outgoing-imports?",
        "number",
        "number",
    )
    .await;
    numeric_pages(
        &router,
        "/api/v1/fiscal/outgoing-imports?",
        "totalCents",
        "totalCents",
    )
    .await;
    let rows = page(
        &router,
        "/api/v1/fiscal/outgoing-imports?sortBy=issuedAt&sortOrder=asc&limit=1",
    )
    .await;
    assert_eq!(rows[0]["number"], 1);
    let rows = page(
        &router,
        "/api/v1/fiscal/outgoing-imports?sortBy=recipientName&sortOrder=desc&limit=1",
    )
    .await;
    assert_eq!(rows[0]["number"], 160);
    let rows = page(
        &router,
        "/api/v1/fiscal/outgoing-imports?sortBy=environment&sortOrder=asc&limit=50",
    )
    .await;
    assert!(rows.iter().all(|r| r["environment"] == 2));
    let rows = page(&router,"/api/v1/fiscal/outgoing-imports?q=Destinat%C3%A1rio&from=2026-01-02&to=2026-01-03&sortBy=number&sortOrder=desc").await;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["number"], 2);
    for bad in [
        "sortBy=number%3BDROP%20TABLE%20tenants",
        "sortOrder=asc",
        "sortBy=unknown",
        "sortBy=totalCents&sortOrder=desc%20NULLS%20FIRST",
        "sort_by=number",
    ] {
        assert_eq!(
            get(&router, &format!("/api/v1/fiscal/outgoing-imports?{bad}"))
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    cleanup(&admin, app, server, &role).await;
}
