use super::company_tests::{cleanup, setup};
use crate::domains::fiscal::danfe::FIXTURE;
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const SUPPLIER: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async fn call(
    router: &Router,
    method: &str,
    path: &str,
    key: Option<Uuid>,
    rev: Option<i64>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", "Bearer editor")
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json");
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    if let Some(rev) = rev {
        request = request.header("if-match", format!("\"{rev}\""));
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn seed(admin: &PgPool, router: &Router) -> i64 {
    seed_xml(admin, router, FIXTURE).await
}

async fn seed_xml(admin: &PgPool, router: &Router, xml: &str) -> i64 {
    sqlx::raw_sql("UPDATE tenants SET tax_id='19131243000197' WHERE id='11111111-1111-4111-8111-111111111111'; INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','juridica','Fornecedor','04252011000110',false,true,'active'); INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','IN-1','Produto recebido','UN',1000,'active'); INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code='fiscal.received_nfe.manage' OR code LIKE 'purchasing.orders.%' ON CONFLICT DO NOTHING;").execute(admin).await.unwrap();
    let imported = call(
        router,
        "POST",
        "/api/v1/fiscal/received-nfes/import",
        None,
        None,
        json!({"xml":xml}),
    )
    .await;
    assert_eq!(imported.0, StatusCode::CREATED, "{}", imported.1);
    imported.1["id"].as_i64().unwrap()
}

fn mapping() -> Value {
    json!({"supplierId":SUPPLIER,"dueDate":"2026-11-30","items":[{"itemNumber":1,"productId":PRODUCT}]})
}

#[sqlx::test(migrations = "../../migrations")]
async fn incoming_conversion_is_atomic_replayed_and_concurrent(admin: PgPool) {
    let (router, app, auth, role) = setup(&admin).await;
    let id = seed(&admin, &router).await;
    let path = format!("/api/v1/fiscal/received-nfes/{id}/purchase");
    let preview = call(&router, "GET", &path, None, None, Value::Null).await;
    assert_eq!(preview.0, StatusCode::OK, "{}", preview.1);
    assert_eq!(preview.1["canConvert"], true);
    assert_eq!(preview.1["items"][0]["sourceCode"], "TESTE");
    assert_eq!(preview.1["items"][0]["name"], "PRODUTO SINTETICO DE TESTE");
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            Some(Uuid::now_v7()),
            None,
            mapping()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    sqlx::raw_sql("CREATE FUNCTION reject_incoming_cost() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic conversion failure'; END $$; CREATE TRIGGER reject_incoming_cost BEFORE INSERT ON fiscal_received_item_costs FOR EACH ROW EXECUTE FUNCTION reject_incoming_cost();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        call(&router, "POST", &path, Some(key), Some(1), mapping())
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM purchase_orders")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    sqlx::query("DROP TRIGGER reject_incoming_cost ON fiscal_received_item_costs")
        .execute(&admin)
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        call(&router, "POST", &path, Some(key), Some(1), mapping()),
        call(&router, "POST", &path, Some(key), Some(1), mapping())
    );
    assert_eq!(a.0, StatusCode::CREATED, "{}", a.1);
    assert_eq!(b.0, a.0, "{}", b.1);
    assert_eq!(a.1, b.1);
    assert_eq!(a.1["purchase"]["data"]["status"], "draft");
    let purchase_path = format!(
        "/api/v1/purchase-orders/{}",
        a.1["purchaseOrderId"].as_str().unwrap()
    );
    let original = json!({"supplierId":SUPPLIER,"dueDate":"2026-12-15","items":[{"productId":PRODUCT,"quantity":"1.000000","unitCost":"10.00"}]});
    let edited = call(
        &router,
        "PUT",
        &purchase_path,
        None,
        Some(1),
        original.clone(),
    )
    .await;
    assert_eq!(edited.0, StatusCode::OK, "{}", edited.1);
    assert_eq!(edited.1["data"]["dueDate"], "2026-12-15");
    for (field, value) in [("quantity", "2.000000"), ("unitCost", "12.00")] {
        let mut changed = original.clone();
        changed["items"][0][field] = json!(value);
        assert_eq!(
            call(&router, "PUT", &purchase_path, None, Some(2), changed)
                .await
                .0,
            StatusCode::CONFLICT
        );
    }
    sqlx::raw_sql("INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','juridica','Outro fornecedor','19131243000197',false,true,'active'); INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111','IN-OTHER','Outro produto','UN',1000,'active');").execute(&admin).await.unwrap();
    let mut changed = original.clone();
    changed["supplierId"] = json!("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    assert_eq!(
        call(&router, "PUT", &purchase_path, None, Some(2), changed)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let mut changed = original.clone();
    changed["items"][0]["productId"] = json!("ffffffff-ffff-4fff-8fff-ffffffffffff");
    assert_eq!(
        call(&router, "PUT", &purchase_path, None, Some(2), changed)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT landed_cents FROM fiscal_received_item_costs")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1000
    );
    for table in [
        "purchase_orders",
        "fiscal_received_purchase_links",
        "fiscal_received_item_costs",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            1,
            "{table}"
        );
    }
    for table in ["purchase_receipts", "stock_movements", "payables"] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            0,
            "{table}"
        );
    }
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            Some(Uuid::now_v7()),
            Some(1),
            mapping()
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    sqlx::query("DELETE FROM role_permissions WHERE permission_code='purchasing.orders.manage'")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(&router, "POST", &path, Some(key), Some(1), mapping())
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    drop(router);
    cleanup(&admin, app, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn incoming_conversion_rejects_mapping_and_current_unit_mismatch(admin: PgPool) {
    let (router, app, auth, role) = setup(&admin).await;
    let id = seed(&admin, &router).await;
    let path = format!("/api/v1/fiscal/received-nfes/{id}/purchase");
    let mut missing = mapping();
    missing["items"] = json!([]);
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            Some(Uuid::now_v7()),
            Some(1),
            missing
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    sqlx::query("UPDATE products SET unit='KG'")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            Some(Uuid::now_v7()),
            Some(1),
            mapping()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM purchase_orders")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    drop(router);
    cleanup(&admin, app, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn production_received_xml_converts_once_without_posting_stock_or_payables(admin: PgPool) {
    let (router, app, auth, role) = setup(&admin).await;
    let xml = FIXTURE.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>");
    let id = seed_xml(&admin, &router, &xml).await;
    assert_eq!(
        sqlx::query_scalar::<_, i16>("SELECT environment FROM fiscal_received_nfes WHERE id=$1")
            .bind(id)
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    let path = format!("/api/v1/fiscal/received-nfes/{id}/purchase");
    let preview = call(&router, "GET", &path, None, None, Value::Null).await;
    assert_eq!(preview.0, StatusCode::OK);
    assert_eq!(preview.1["canConvert"], true);
    let key = Uuid::now_v7();
    let converted = call(&router, "POST", &path, Some(key), Some(1), mapping()).await;
    assert_eq!(converted.0, StatusCode::CREATED, "{}", converted.1);
    assert_eq!(converted.1["purchase"]["data"]["status"], "draft");
    let replay = call(&router, "POST", &path, Some(key), Some(1), mapping()).await;
    assert_eq!(replay, converted);
    for table in [
        "purchase_orders",
        "fiscal_received_purchase_links",
        "fiscal_received_item_costs",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            1,
            "{table}"
        );
    }
    for table in [
        "stock_movements",
        "payables",
        "fiscal_recipient_manifestations",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            0,
            "{table}"
        );
    }
    drop(router);
    cleanup(&admin, app, auth, &role).await;
}

async fn fiscal_state(
    admin: &PgPool,
    app: PgPool,
    address: std::net::SocketAddr,
) -> crate::platform::state::AppState {
    use crate::domains::fiscal::{
        certificate_crypto::{
            CertificateMaterial,
            tests::{fixture, vault},
        },
        engine_client::FiscalEngine,
    };
    use base64::{Engine, engine::general_purpose::STANDARD};
    let fixture = fixture();
    let vault = vault();
    let material = CertificateMaterial {
        pkcs12: STANDARD.decode(fixture["valid"].as_str().unwrap()).unwrap(),
        password: fixture["password"].as_str().unwrap().to_owned(),
    };
    let metadata = vault
        .inspect(
            &material.pkcs12,
            &material.password,
            "04252011000110",
            time::OffsetDateTime::now_utc(),
        )
        .unwrap();
    let encrypted = vault
        .seal(TENANT.parse().unwrap(), 1, &metadata, &material)
        .unwrap();
    sqlx::query("INSERT INTO fiscal_a1_certificates(tenant_id,revision,metadata,encryption_key_id,nonce,ciphertext,updated_by_identity_id) VALUES($1::uuid,1,$2,$3,$4,$5,'33333333-3333-4333-8333-333333333333')").bind(TENANT).bind(serde_json::to_value(metadata).unwrap()).bind(encrypted.key_id).bind(encrypted.nonce).bind(encrypted.ciphertext).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','fiscal.received_nfe.manage') ON CONFLICT DO NOTHING").execute(admin).await.unwrap();
    crate::platform::state::AppState::new(
        app,
        crate::platform::auth::AuthClient::new("http://127.0.0.1:1/userinfo".to_owned()),
    )
    .with_certificates(Some(vault))
    .with_fiscal_engine(Some(
        FiscalEngine::new(&format!("http://{address}"), "synthetic-only").unwrap(),
    ))
}

fn actor() -> crate::platform::auth::AuthenticatedIdentity {
    crate::platform::auth::AuthenticatedIdentity {
        subject: "editor".to_owned(),
        email: "editor@example.test".to_owned(),
        name: "Editor".to_owned(),
    }
}
fn tenant_headers() -> axum::http::HeaderMap {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert("x-tenant-id", TENANT.parse().unwrap());
    headers
}

#[sqlx::test(migrations = "../../migrations")]
async fn incoming_distribution_lease_invalid_batch_cooldown_replay_and_tenant_isolation(
    admin: PgPool,
) {
    use crate::domains::fiscal::incoming::run_distribution;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let (router, app, auth, role) = setup(&admin).await;
    let calls = Arc::new(AtomicUsize::new(0));
    let called = calls.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener,Router::new().route("/v1/distribute",axum::routing::post(move || {let n=called.fetch_add(1,Ordering::SeqCst);async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        Json(if n==0 {json!({"code":"138","lastNsu":"000000000000001","maxNsu":"000000000000001","documents":[{"nsu":"000000000000001","schema":"procNFe_v4.00.xsd","kind":"full","xml":"<broken/>"}]})}else{json!({"code":if n==1{"137"}else{"656"},"lastNsu":"000000000000000","maxNsu":"000000000000000","documents":[]})})
    }}))).await.unwrap();
    });
    let state = fiscal_state(&admin, app.clone(), address).await;
    let actor = actor();
    let headers = tenant_headers();
    let key = Uuid::now_v7();
    let (first, second) = tokio::join!(
        run_distribution(&state, &actor, &headers, 1, key),
        run_distribution(&state, &actor, &headers, 1, Uuid::now_v7())
    );
    assert!(first.is_ok() ^ second.is_ok());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT last_nsu FROM fiscal_distribution_cursors")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_distribution_documents")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    let run: Value = sqlx::query_scalar("SELECT response FROM fiscal_distribution_runs")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(run["code"], "138");
    for expected_code in ["137", "656"] {
        sqlx::query("UPDATE fiscal_distribution_cursors SET next_query_at=NULL")
            .execute(&admin)
            .await
            .unwrap();
        let rev: i64 = sqlx::query_scalar("SELECT revision FROM fiscal_distribution_cursors")
            .fetch_one(&admin)
            .await
            .unwrap();
        let key = Uuid::now_v7();
        let result = run_distribution(&state, &actor, &headers, rev, key)
            .await
            .unwrap();
        assert_eq!(result["lastCode"], expected_code);
        let delay:bool=sqlx::query_scalar("SELECT next_query_at>clock_timestamp()+interval '59 minutes' FROM fiscal_distribution_cursors").fetch_one(&admin).await.unwrap();
        assert!(delay);
        let count = calls.load(Ordering::SeqCst);
        crate::domains::fiscal::incoming::worker::tick(&state, &actor, &headers)
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), count);
        run_distribution(&state, &actor, &headers, rev, key)
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), count);
        assert!(
            run_distribution(&state, &actor, &headers, rev + 2, Uuid::now_v7())
                .await
                .is_err()
        );
    }
    let mut tx = app.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_distribution_runs")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    tx.rollback().await.unwrap();
    server.abort();
    drop(state);
    drop(router);
    cleanup(&admin, app, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn incoming_distribution_persists_full_summary_and_event_before_advancing(admin: PgPool) {
    use crate::domains::fiscal::incoming::run_distribution;
    let (router, app, auth, role) = setup(&admin).await;
    let summary = "<resNFe xmlns=\"http://www.portalfiscal.inf.br/nfe\"><chNFe>35261004252011000110550010000000011000000017</chNFe><CNPJ>04252011000110</CNPJ><xNome>Fornecedor sintético</xNome><dhEmi>2026-10-27T12:00:00-03:00</dhEmi><vNF>10.00</vNF></resNFe>";
    let event = "<procEventoNFe xmlns=\"http://www.portalfiscal.inf.br/nfe\"><evento><infEvento><tpAmb>2</tpAmb><chNFe>35261004252011000110550010000000011000000017</chNFe><tpEvento>210210</tpEvento></infEvento></evento><retEvento><infEvento><tpAmb>2</tpAmb><chNFe>35261004252011000110550010000000011000000017</chNFe><tpEvento>210210</tpEvento></infEvento></retEvento></procEventoNFe>";
    let full = FIXTURE.replace("<CNPJ>19131243000197</CNPJ>", "<CNPJ>04252011000110</CNPJ>");
    let reply = json!({"code":"138","lastNsu":"000000000000003","maxNsu":"000000000000003","documents":[{"nsu":"000000000000001","schema":"resNFe_v1.01.xsd","kind":"summary","xml":summary},{"nsu":"000000000000002","schema":"procEventoNFe_v1.00.xsd","kind":"event","xml":event},{"nsu":"000000000000003","schema":"procNFe_v4.00.xsd","kind":"full","xml":full}]});
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/v1/distribute",
                axum::routing::post(move || {
                    let value = reply.clone();
                    async move { Json(value) }
                }),
            ),
        )
        .await
        .unwrap();
    });
    let state = fiscal_state(&admin, app.clone(), address).await;
    let result = run_distribution(&state, &actor(), &tenant_headers(), 1, Uuid::now_v7())
        .await
        .unwrap();
    assert_eq!(result["status"], "completed");
    assert_eq!(result["lastNsu"], "000000000000003");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_distribution_documents")
            .fetch_one(&admin)
            .await
            .unwrap(),
        3
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_received_nfes")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM fiscal_distribution_documents WHERE kind='full' AND received_nfe_id IS NOT NULL").fetch_one(&admin).await.unwrap(),1);
    server.abort();
    drop(state);
    drop(router);
    cleanup(&admin, app, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn incoming_manifestation_uncertain_retries_never_resend(admin: PgPool) {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let (router, app, auth, role) = setup(&admin).await;
    let calls = Arc::new(AtomicUsize::new(0));
    let called = calls.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let evidence = r#"<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><evento><infEvento><tpAmb>2</tpAmb><CNPJ>04252011000110</CNPJ><chNFe>35261004252011000110550010000000011000000017</chNFe><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento></infEvento></evento><retEvento><infEvento><tpAmb>2</tpAmb><CNPJDest>04252011000110</CNPJDest><chNFe>35261004252011000110550010000000011000000017</chNFe><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><cStat>135</cStat><nProt>135260000000001</nProt></infEvento></retEvento></procEventoNFe>"#;
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/v1/manifest",
                axum::routing::post(move || {
                    called.fetch_add(1, Ordering::SeqCst);
                    async { StatusCode::BAD_GATEWAY }
                }),
            ).route("/v1/distribute",axum::routing::post(move ||async move{Json(json!({"code":"138","lastNsu":"000000000000002","maxNsu":"000000000000002","documents":[{"nsu":"000000000000002","schema":"procEventoNFe_v1.00.xsd","kind":"event","xml":evidence}]}))})),
        )
        .await
        .unwrap();
    });
    let state = fiscal_state(&admin, app.clone(), address).await;
    // A summary is visible to this recipient through its authenticated distribution.
    sqlx::query("INSERT INTO fiscal_distribution_documents(tenant_id,environment,nsu,schema_name,kind,access_key,xml,xml_sha256,metadata) VALUES($1::uuid,2,1,'resNFe_v1.01.xsd','summary','35261004252011000110550010000000011000000017','<synthetic/>',repeat('0',64),'{}')").bind(TENANT).execute(&admin).await.unwrap();
    let isolated = crate::domains::fiscal::incoming::routes()
        .layer(axum::Extension(actor()))
        .with_state(state.clone());
    let key = Uuid::now_v7();
    let body = json!({"accessKey":"35261004252011000110550010000000011000000017","kind":"ciencia"});
    let first = call(
        &isolated,
        "POST",
        "/api/v1/fiscal/manifestations",
        Some(key),
        Some(1),
        body.clone(),
    )
    .await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert_eq!(first.1["status"], "unknown");
    let second = call(
        &isolated,
        "POST",
        "/api/v1/fiscal/manifestations",
        Some(key),
        Some(1),
        body.clone(),
    )
    .await;
    assert_eq!(second, first);
    assert_eq!(
        call(
            &isolated,
            "POST",
            "/api/v1/fiscal/manifestations",
            Some(Uuid::now_v7()),
            Some(1),
            body
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let id = first.1["id"].as_str().unwrap();
    let detail_path = format!("/api/v1/fiscal/manifestations/{id}");
    let recovery_path = format!("{detail_path}/reconcile");
    let awaiting = call(
        &isolated,
        "POST",
        &recovery_path,
        Some(Uuid::now_v7()),
        Some(2),
        json!({}),
    )
    .await;
    assert_eq!(awaiting.0, StatusCode::OK, "{}", awaiting.1);
    assert_eq!(awaiting.1["status"], "unknown");
    assert_eq!(
        awaiting.1["reconciliation"]["status"],
        "awaiting_distribution_evidence"
    );
    crate::domains::fiscal::incoming::run_distribution(
        &state,
        &actor(),
        &tenant_headers(),
        1,
        Uuid::now_v7(),
    )
    .await
    .unwrap();
    let reconciled = call(&isolated, "GET", &detail_path, None, None, Value::Null).await;
    assert_eq!(reconciled.0, StatusCode::OK, "{}", reconciled.1);
    assert_eq!(reconciled.1["status"], "accepted");
    assert_eq!(reconciled.1["revision"], 3);
    assert_eq!(reconciled.1["result"]["protocol"], "135260000000001");
    assert_eq!(reconciled.1["result"]["evidenceNsu"], "000000000000002");
    let list = call(
        &isolated,
        "GET",
        "/api/v1/fiscal/manifestations?accessKey=35261004252011000110550010000000011000000017",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(list.0, StatusCode::OK);
    assert_eq!(list.1["data"].as_array().unwrap().len(), 1);
    assert_eq!(
        call(
            &isolated,
            "GET",
            "/api/v1/fiscal/manifestations?accessKey=invalid",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    // Simulate a crash after durable intent but before a response was saved.
    // The official event was already distributed; recovery consumes that proof.
    let crashed = Uuid::now_v7();
    sqlx::query("INSERT INTO fiscal_recipient_manifestations(id,tenant_id,environment,access_key,kind,auth_subject,command_key,request,status) VALUES($1,$2::uuid,2,'35261004252011000110550010000000011000000017','confirmacao','editor',$3,'{}','pending')").bind(crashed).bind(TENANT).bind(Uuid::now_v7()).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO fiscal_distribution_documents(tenant_id,environment,nsu,schema_name,kind,access_key,xml,xml_sha256,metadata) VALUES($1::uuid,2,3,'procEventoNFe_v1.00.xsd','event','35261004252011000110550010000000011000000017',$2,repeat('0',64),'{}')").bind(TENANT).bind(evidence.replace("210210","210200")).execute(&admin).await.unwrap();
    let recovery = format!("/api/v1/fiscal/manifestations/{crashed}/reconcile");
    let recovery_key = Uuid::now_v7();
    let recovered = call(
        &isolated,
        "POST",
        &recovery,
        Some(recovery_key),
        Some(1),
        json!({}),
    )
    .await;
    assert_eq!(recovered.0, StatusCode::OK, "{}", recovered.1);
    assert_eq!(recovered.1["status"], "accepted");
    assert_eq!(recovered.1["revision"], 2);
    assert_eq!(
        call(
            &isolated,
            "POST",
            &recovery,
            Some(recovery_key),
            Some(1),
            json!({})
        )
        .await,
        recovered
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "Recovery must never retransmit the manifestation"
    );
    let mut foreign_tx = crate::platform::access::tenant_transaction(
        &state,
        "22222222-2222-4222-8222-222222222222".parse().unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM fiscal_recipient_manifestations WHERE access_key='35261004252011000110550010000000011000000017'").fetch_one(&mut *foreign_tx).await.unwrap(),0);
    foreign_tx.rollback().await.unwrap();
    server.abort();
    drop(isolated);
    drop(state);
    drop(router);
    cleanup(&admin, app, auth, &role).await;
}
