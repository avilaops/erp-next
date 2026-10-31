use super::company_tests::{cleanup, setup, setup_with_monitor};
use crate::domains::fiscal::{
    certificate_crypto::{
        CertificateMaterial,
        tests::{fixture, vault},
    },
    distribution::tests::{CNPJ, KEY, ONE, ZERO, reply, summary, zipped},
    sefaz_client::Sefaz,
};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use tokio::sync::Notify;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
async fn grant(admin: &PgPool) {
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code LIKE 'fiscal.monitor.%' OR code='fiscal.received_nfe.manage'")
        .execute(admin).await.unwrap();
}

#[derive(Clone)]
struct Feed {
    replies: Arc<Mutex<std::collections::VecDeque<String>>>,
    calls: Arc<AtomicUsize>,
    requests: Arc<Mutex<Vec<String>>>,
    started: Arc<Notify>,
    gate: Option<Arc<Notify>>,
}
async fn feed(
    replies: Vec<String>,
    gate: Option<Arc<Notify>>,
) -> (Sefaz, Feed, tokio::task::JoinHandle<()>) {
    let feed = Feed {
        replies: Arc::new(Mutex::new(replies.into())),
        calls: Arc::new(AtomicUsize::new(0)),
        requests: Arc::new(Mutex::new(Vec::new())),
        started: Arc::new(Notify::new()),
        gate,
    };
    let fixture = feed.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/",
                axum::routing::post(move |body: String| {
                    let fixture = fixture.clone();
                    async move {
                        fixture.calls.fetch_add(1, Ordering::SeqCst);
                        fixture.requests.lock().unwrap().push(body);
                        fixture.started.notify_one();
                        if let Some(gate) = fixture.gate {
                            gate.notified().await;
                        }
                        let xml = fixture
                            .replies
                            .lock()
                            .unwrap()
                            .pop_front()
                            .expect("unexpected SEFAZ request");
                        ([("content-type", "application/soap+xml")], xml)
                    }
                }),
            ),
        )
        .await
        .unwrap();
    });
    (Sefaz::test(url), feed, server)
}
async fn seed_certificate(admin: &PgPool) {
    let fixture = fixture();
    let material = CertificateMaterial {
        pkcs12: STANDARD.decode(fixture["valid"].as_str().unwrap()).unwrap(),
        password: fixture["password"].as_str().unwrap().into(),
    };
    let vault = vault();
    let metadata = vault
        .inspect(
            &material.pkcs12,
            &material.password,
            CNPJ,
            time::OffsetDateTime::now_utc(),
        )
        .unwrap();
    let tenant = Uuid::parse_str(TENANT).unwrap();
    let sealed = vault.seal(tenant, 1, &metadata, &material).unwrap();
    sqlx::query("INSERT INTO fiscal_a1_certificates(tenant_id,revision,metadata,encryption_key_id,nonce,ciphertext,updated_by_identity_id) VALUES($1,1,$2,$3,$4,$5,'33333333-3333-4333-8333-333333333333')")
        .bind(tenant).bind(serde_json::to_value(metadata).unwrap()).bind(sealed.key_id).bind(sealed.nonce).bind(sealed.ciphertext).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO company_profiles(tenant_id,revision,details) VALUES($1,1,$2)")
        .bind(tenant)
        .bind(json!({"state":"SP"}))
        .execute(admin)
        .await
        .unwrap();
}
fn production_xml() -> String {
    crate::domains::fiscal::danfe::FIXTURE
        .replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>")
        .replace("<CNPJ>19131243000197</CNPJ>", "<CNPJ>04252011000110</CNPJ>")
}
async fn counts(admin: &PgPool) -> (i64, i64, i64, i64) {
    sqlx::query_as("SELECT (SELECT count(*) FROM fiscal_monitor_documents),(SELECT count(*) FROM fiscal_received_nfes),(SELECT count(*) FROM stock_movements),(SELECT count(*) FROM payables)")
        .fetch_one(admin).await.unwrap()
}

#[sqlx::test(migrations = "../../migrations")]
async fn one_reservation_serializes_concurrency_replays_and_links_the_canonical_nfe(admin: PgPool) {
    let gate = Arc::new(Notify::new());
    let documents = format!(
        "{}{}",
        zipped(&summary(), ONE, "resNFe_v1.01.xsd"),
        zipped(&production_xml(), "000000000000002", "procNFe_v4.00.xsd")
    );
    let (service, feed, server) = feed(
        vec![reply(
            "138",
            "000000000000002",
            "000000000000002",
            &documents,
        )],
        Some(gate.clone()),
    )
    .await;
    let (router, app, auth, role) = setup_with_monitor(&admin, service).await;
    grant(&admin).await;
    seed_certificate(&admin).await;
    let first_key = Uuid::now_v7();
    let first_router = router.clone();
    let first = tokio::spawn(async move {
        call(
            &first_router,
            "POST",
            "/api/v1/fiscal/monitor/sync",
            "editor",
            Some(first_key),
        )
        .await
    });
    feed.started.notified().await;
    let second = call(
        &router,
        "POST",
        "/api/v1/fiscal/monitor/sync",
        "editor",
        Some(Uuid::now_v7()),
    )
    .await;
    assert_eq!(second.0, StatusCode::TOO_MANY_REQUESTS, "{}", second.1);
    let replay = call(
        &router,
        "POST",
        "/api/v1/fiscal/monitor/sync",
        "editor",
        Some(first_key),
    )
    .await;
    assert_eq!(replay.1["outcome"], "pending");
    assert_eq!(counts(&admin).await, (0, 0, 0, 0));
    gate.notify_one();
    let result = first.await.unwrap();
    assert_eq!(result.0, StatusCode::ACCEPTED, "{}", result.1);
    assert_eq!(result.1["outcome"], "applied");
    assert_eq!(counts(&admin).await, (2, 1, 0, 0));
    let replay = call(
        &router,
        "POST",
        "/api/v1/fiscal/monitor/sync",
        "editor",
        Some(first_key),
    )
    .await;
    assert_eq!(replay.1, result.1);
    assert_eq!(feed.calls.load(Ordering::SeqCst), 1);
    assert!(feed.requests.lock().unwrap()[0].contains("<ultNSU>000000000000000</ultNSU>"));
    let state = call(&router, "GET", "/api/v1/fiscal/monitor", "editor", None).await;
    assert_eq!(state.1["lastNsu"], "000000000000002");
    assert_eq!(
        state.1["documents"][0]["receivedNfeId"],
        state.1["documents"][1]["receivedNfeId"]
    );
    assert!(state.1["documents"][0]["receivedNfeId"].as_i64().is_some());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='fiscal.received_nfe.imported'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        1
    );
    let mut tx = app.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_monitor_documents")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_monitor_state")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    tx.rollback().await.unwrap();
    server.abort();
    cleanup(&admin, app, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn malformed_and_blocked_batches_preserve_cursor_and_cooldown(admin: PgPool) {
    let (service, feed, server) = feed(
        vec![
            "<not-a-fiscal-response/>".into(),
            reply("656", ZERO, ZERO, ""),
        ],
        None,
    )
    .await;
    let (router, app, auth, role) = setup_with_monitor(&admin, service).await;
    grant(&admin).await;
    seed_certificate(&admin).await;
    let result = call(
        &router,
        "POST",
        "/api/v1/fiscal/monitor/sync",
        "editor",
        Some(Uuid::now_v7()),
    )
    .await;
    assert_eq!(result.0, StatusCode::ACCEPTED, "{}", result.1);
    assert_eq!(result.1["outcome"], "failed");
    assert_eq!(counts(&admin).await, (0, 0, 0, 0));
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/fiscal/monitor/sync",
            "editor",
            Some(Uuid::now_v7())
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );
    sqlx::query("UPDATE fiscal_monitor_state SET last_nsu=$1,max_nsu=$1,next_query_at=clock_timestamp()-interval '1 second'").bind(ONE).execute(&admin).await.unwrap();
    let blocked = call(
        &router,
        "POST",
        "/api/v1/fiscal/monitor/sync",
        "editor",
        Some(Uuid::now_v7()),
    )
    .await;
    assert_eq!(blocked.1["status"], "656");
    let state = call(&router, "GET", "/api/v1/fiscal/monitor", "editor", None).await;
    assert_eq!(state.1["lastNsu"], ONE);
    assert_eq!(state.1["maxNsu"], ONE);
    assert_eq!(feed.calls.load(Ordering::SeqCst), 2);
    server.abort();
    cleanup(&admin, app, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn changed_original_xml_rolls_back_the_entire_batch(admin: PgPool) {
    let full = production_xml();
    let docs = format!(
        "{}{}",
        zipped(&summary(), ONE, "resNFe_v1.01.xsd"),
        zipped(&full, "000000000000002", "procNFe_v4.00.xsd")
    );
    let (service, _, server) = feed(
        vec![reply("138", "000000000000002", "000000000000002", &docs)],
        None,
    )
    .await;
    let (router, app, auth, role) = setup_with_monitor(&admin, service).await;
    grant(&admin).await;
    seed_certificate(&admin).await;
    let import = Request::builder()
        .method("POST")
        .uri("/api/v1/fiscal/received-nfes/import")
        .header("authorization", "Bearer editor")
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json")
        .body(Body::from(json!({"xml":format!("{full}\n")}).to_string()))
        .unwrap();
    assert_eq!(
        router.clone().oneshot(import).await.unwrap().status(),
        StatusCode::CREATED
    );
    let result = call(
        &router,
        "POST",
        "/api/v1/fiscal/monitor/sync",
        "editor",
        Some(Uuid::now_v7()),
    )
    .await;
    assert_eq!(result.0, StatusCode::CONFLICT, "{}", result.1);
    assert_eq!(counts(&admin).await, (0, 1, 0, 0));
    let state = call(&router, "GET", "/api/v1/fiscal/monitor", "editor", None).await;
    assert_eq!(state.1["lastNsu"], ZERO);
    assert_eq!(state.1["lastRun"]["outcome"], "failed");
    server.abort();
    cleanup(&admin, app, auth, &role).await;
}

async fn manifest(
    router: &Router,
    id: i64,
    event_type: &str,
    key: Uuid,
    token: &str,
) -> (StatusCode, Value) {
    let request = Request::builder().method("POST").uri(format!("/api/v1/fiscal/monitor/documents/{id}/manifest"))
        .header("authorization",format!("Bearer {token}")).header("x-tenant-id",TENANT).header("content-type","application/json").header("idempotency-key",key.to_string())
        .body(Body::from(json!({"eventType":event_type,"justification":if event_type=="210240" { Some("Os produtos não foram entregues à empresa") } else { None }}).to_string())).unwrap();
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 100_000).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

#[sqlx::test(migrations = "../../migrations")]
async fn recipient_events_are_explicit_correlated_persistent_and_never_resent_after_unknown(
    admin: PgPool,
) {
    let response = format!(
        "<retEnvEvento xmlns=\"http://www.portalfiscal.inf.br/nfe\"><cStat>128</cStat><retEvento><infEvento><tpAmb>1</tpAmb><cStat>135</cStat><chNFe>{KEY}</chNFe><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><nProt>135260000000001</nProt></infEvento></retEvento></retEnvEvento>"
    );
    let (service, feed, server) = feed(
        vec![
            reply(
                "138",
                ONE,
                ONE,
                &zipped(&summary(), ONE, "resNFe_v1.01.xsd"),
            ),
            response,
            "<broken-response/>".into(),
        ],
        None,
    )
    .await;
    let (router, app, auth, role) = setup_with_monitor(&admin, service).await;
    grant(&admin).await;
    seed_certificate(&admin).await;
    let collected = call(
        &router,
        "POST",
        "/api/v1/fiscal/monitor/sync",
        "editor",
        Some(Uuid::now_v7()),
    )
    .await;
    assert_eq!(collected.1["outcome"], "applied", "{}", collected.1);
    let id: i64 = sqlx::query_scalar("SELECT id FROM fiscal_monitor_documents")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(feed.calls.load(Ordering::SeqCst), 1); // Collection never manifests.
    assert_eq!(
        manifest(&router, id, "210210", Uuid::now_v7(), "reader")
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let key = Uuid::now_v7();
    let accepted = manifest(&router, id, "210210", key, "editor").await;
    assert_eq!(accepted.0, StatusCode::ACCEPTED, "{}", accepted.1);
    assert_eq!(accepted.1["outcome"], "accepted");
    assert_eq!(accepted.1["protocol"], "135260000000001");
    assert_eq!(
        manifest(&router, id, "210210", key, "editor").await.1,
        accepted.1
    );
    assert_eq!(
        manifest(&router, id, "210210", Uuid::now_v7(), "editor")
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        manifest(&router, id, "210220", key, "editor").await.0,
        StatusCode::CONFLICT
    );
    let key = Uuid::now_v7();
    let unknown = manifest(&router, id, "210240", key, "editor").await;
    assert_eq!(unknown.1["outcome"], "unknown");
    assert_eq!(
        manifest(&router, id, "210240", key, "editor").await.1,
        unknown.1
    );
    assert_eq!(
        manifest(&router, id, "210240", Uuid::now_v7(), "editor")
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(feed.calls.load(Ordering::SeqCst), 3);
    assert!(
        feed.requests.lock().unwrap()[1].contains("<descEvento>Ciencia da Operacao</descEvento>")
    );
    assert_eq!(counts(&admin).await, (1, 0, 0, 0));
    server.abort();
    cleanup(&admin, app, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn revocation_during_collection_prevents_document_application(admin: PgPool) {
    let gate = Arc::new(Notify::new());
    let (service, feed, server) = feed(
        vec![reply(
            "138",
            ONE,
            ONE,
            &zipped(&summary(), ONE, "resNFe_v1.01.xsd"),
        )],
        Some(gate.clone()),
    )
    .await;
    let (router, app, auth, role) = setup_with_monitor(&admin, service).await;
    grant(&admin).await;
    seed_certificate(&admin).await;
    let first_router = router.clone();
    let first = tokio::spawn(async move {
        call(
            &first_router,
            "POST",
            "/api/v1/fiscal/monitor/sync",
            "editor",
            Some(Uuid::now_v7()),
        )
        .await
    });
    feed.started.notified().await;
    sqlx::query("DELETE FROM role_permissions WHERE permission_code='fiscal.monitor.manage'")
        .execute(&admin)
        .await
        .unwrap();
    gate.notify_one();
    assert_eq!(first.await.unwrap().0, StatusCode::FORBIDDEN);
    assert_eq!(counts(&admin).await, (0, 0, 0, 0));
    let state = call(&router, "GET", "/api/v1/fiscal/monitor", "editor", None).await;
    assert_eq!(state.1["lastNsu"], ZERO);
    assert_eq!(state.1["lastRun"]["outcome"], "failed");
    server.abort();
    cleanup(&admin, app, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cpf_received_invoice_and_non_recipient_xml_share_cursor_without_crossing_roles(
    admin: PgPool,
) {
    use crate::domains::fiscal::distribution::tests::cpf_xml;
    let (key, full) = cpf_xml();
    let summary = summary()
        .replace(KEY, &key)
        .replace("<CNPJ>04252011000110</CNPJ>", "<CPF>52998224725</CPF>");
    let other =
        crate::domains::fiscal::danfe::FIXTURE.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>");
    let docs = format!(
        "{}{}{}",
        zipped(&summary, ONE, "resNFe_v1.01.xsd"),
        zipped(&full, "000000000000002", "procNFe_v4.00.xsd"),
        zipped(&other, "000000000000003", "procNFe_v4.00.xsd")
    );
    let (service, _, server) = feed(
        vec![reply("138", "000000000000003", "000000000000003", &docs)],
        None,
    )
    .await;
    let (router, app, auth, role) = setup_with_monitor(&admin, service).await;
    grant(&admin).await;
    seed_certificate(&admin).await;
    let result = call(
        &router,
        "POST",
        "/api/v1/fiscal/monitor/sync",
        "editor",
        Some(Uuid::now_v7()),
    )
    .await;
    assert_eq!(result.1["outcome"], "applied", "{}", result.1);
    assert_eq!(counts(&admin).await, (3, 1, 0, 0));
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT issuer_document FROM fiscal_received_nfes")
            .fetch_one(&admin)
            .await
            .unwrap(),
        "52998224725"
    );
    let state = call(&router, "GET", "/api/v1/fiscal/monitor", "editor", None).await;
    assert_eq!(state.1["lastNsu"], "000000000000003");
    assert_eq!(state.1["documents"][0]["kind"], "other");
    assert!(state.1["documents"][0]["receivedNfeId"].is_null());
    server.abort();
    cleanup(&admin, app, auth, &role).await;
}
async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    token: &str,
    key: Option<Uuid>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", TENANT)
        .header("authorization", format!("Bearer {token}"));
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
#[sqlx::test(migrations = "../../migrations")]
async fn monitor_has_real_status_permissions_and_disabled_collection(admin: PgPool) {
    let (router, app, auth, role) = setup(&admin).await;
    grant(&admin).await;
    let status = call(&router, "GET", "/api/v1/fiscal/monitor", "editor", None).await;
    assert_eq!(status.0, StatusCode::OK, "{}", status.1);
    assert_eq!(status.1["lastNsu"], "000000000000000");
    assert_eq!(status.1["collectionEnabled"], false);
    assert_eq!(status.1["tenantId"], TENANT);
    assert_eq!(
        call(&router, "GET", "/api/v1/fiscal/monitor", "reader", None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/fiscal/monitor/sync",
            "editor",
            Some(Uuid::now_v7())
        )
        .await
        .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_monitor_runs")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM stock_movements")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, app, auth, &role).await;
}
