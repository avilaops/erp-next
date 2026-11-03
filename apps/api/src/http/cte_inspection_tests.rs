use super::company_tests::{cleanup, setup};
use crate::{
    domains::fiscal::engine_client::FiscalEngine,
    platform::{auth::AuthClient, state::AppState},
};
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderMap, Request, StatusCode},
    routing::{get, post},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const BASE: &str = "/api/v1/fiscal/cte-distribution/documents";
const XML: &str = include_str!("fixtures/cte-received.xml");
const FACTS: &str = include_str!("fixtures/cte-received-inspection.json");

#[sqlx::test(migrations = "../../migrations")]
async fn cte_commercial_links_authorize_before_loading_source_or_payload(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let id = Uuid::now_v7();
    let link = Uuid::now_v7();
    for (method, suffix) in [
        ("GET", "commercial-links".to_owned()),
        ("GET", "commercial-options?kind=purchase".to_owned()),
        ("POST", "commercial-links".to_owned()),
        ("POST", format!("commercial-links/{link}/unlink")),
    ] {
        assert_eq!(
            call(&router, method, &format!("{BASE}/{id}/{suffix}"), TENANT, None, json!({})).await.0,
            StatusCode::FORBIDDEN,
            "{method} {suffix} must authorize before loading an absent document or validating its command"
        );
    }
    cleanup(&admin, pool, auth, &role).await;
}

async fn call(
    router: &Router,
    method: &str,
    path: &str,
    tenant: &str,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", "Bearer editor")
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    let result = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = result.status();
    let headers = result.headers().clone();
    let bytes = to_bytes(result.into_body(), 12 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn grant(admin: &PgPool) {
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('fiscal.cte.read','fiscal.cte.inspect') ON CONFLICT DO NOTHING").execute(admin).await.unwrap();
}

async fn seed(admin: &PgPool, nsu: &str) -> Uuid {
    let tenant = Uuid::parse_str(TENANT).unwrap();
    let run = Uuid::now_v7();
    let id = Uuid::now_v7();
    let facts: Value = serde_json::from_str(FACTS).unwrap();
    sqlx::query("INSERT INTO fiscal_cte_distribution_state(tenant_id,environment,company_tax_id,last_nsu,max_nsu) VALUES($1,2,'04252011000110',$2,$2) ON CONFLICT(tenant_id,environment) DO UPDATE SET max_nsu=GREATEST(fiscal_cte_distribution_state.max_nsu,excluded.max_nsu),last_nsu=GREATEST(fiscal_cte_distribution_state.last_nsu,excluded.last_nsu)")
        .bind(tenant).bind(nsu).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO fiscal_cte_distribution_runs(tenant_id,id,environment,company_tax_id,author_state,auth_subject,command_key,requested_nsu,status,code,document_count) VALUES($1,$2,2,'04252011000110','SP','editor',$3,'000000000000000','completed','138',1)")
        .bind(tenant).bind(run).bind(Uuid::now_v7()).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO fiscal_cte_distribution_documents(tenant_id,id,run_id,environment,company_tax_id,nsu,schema_name,kind,xml,xml_sha256) VALUES($1,$2,$3,2,'04252011000110',$4,'procCTe_v4.00.xsd','full',$5,$6)")
        .bind(tenant).bind(id).bind(run).bind(nsu).bind(XML).bind(facts["xmlSha256"].as_str().unwrap()).execute(admin).await.unwrap();
    id
}

#[derive(Clone)]
struct EngineFixture {
    admin: PgPool,
    mode: &'static str,
    calls: Arc<AtomicUsize>,
}

async fn inspect(
    State(state): State<EngineFixture>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    assert_eq!(
        headers["authorization"],
        "Bearer synthetic-cte-inspection-token"
    );
    assert_eq!(
        body,
        json!({"xml":XML,"companyTaxId":"04252011000110","environment":"homologation"})
    );
    state.calls.fetch_add(1, Ordering::SeqCst);
    if state.mode == "transport" {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error":"PRIVATE-PROVIDER-ERROR"})),
        );
    }
    if state.mode == "unsupported" {
        return (
            StatusCode::OK,
            Json(
                json!({"status":"blocked","blockers":["cte_profile_unsupported"],"title":"PRIVATE-PROVIDER-ERROR"}),
            ),
        );
    }
    if state.mode == "invalid" {
        return (
            StatusCode::OK,
            Json(
                json!({"status":"blocked","blockers":["invalid_cte_xml"],"title":"PRIVATE-PROVIDER-ERROR"}),
            ),
        );
    }
    if state.mode == "revoke" {
        sqlx::query("DELETE FROM role_permissions WHERE permission_code='fiscal.cte.inspect'")
            .execute(&state.admin)
            .await
            .unwrap();
    }
    if state.mode == "company" {
        sqlx::query("UPDATE tenants SET tax_id='11222333000181' WHERE id=$1::uuid")
            .bind(TENANT)
            .execute(&state.admin)
            .await
            .unwrap();
    }
    if state.mode == "concurrent" {
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    }
    let mut result: Value = serde_json::from_str(FACTS).unwrap();
    result["xml"] = json!(XML);
    match state.mode {
        "forged_xml" => result["xml"] = json!("<CTe/>"),
        "forged_hash" => result["xmlSha256"] = json!("0".repeat(64)),
        "forged_key" => result["accessKey"] = json!("0".repeat(44)),
        "forged_company" => result["companyTaxId"] = json!("11222333000181"),
        "forged_environment" => result["environment"] = json!("production"),
        "forged_carrier" => result["carrier"]["value"] = json!("04252011000110"),
        "forged_taker" => result["taker"]["value"] = json!("11222333000181"),
        "forged_roles" => result["companyRoles"] = json!(["carrier"]),
        "forged_amount" => result["serviceCents"] = json!("15002"),
        "forged_nfe" => result["nfeReferences"] = json!([]),
        "forged_cte" => {
            result["cteReferences"] = json!(["35261011222333000181570010000001231482917360"])
        }
        "forged_protocol" => result["protocol"]["code"] = json!("999"),
        "forged_profile" => result["profile"] = json!("unknown-profile"),
        "forged_layout" => result["verification"]["layout"] = json!("trusted"),
        "forged_signature" => result["verification"]["signature"] = json!("not_verified"),
        "forged_trust" => result["verification"]["certificateTrust"] = json!("verified"),
        "forged_status" => result["verification"]["currentStatus"] = json!("authorized"),
        _ => {}
    }
    (StatusCode::OK, Json(result))
}

async fn services(
    admin: &PgPool,
    pool: &PgPool,
    mode: &'static str,
) -> (Router, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let fixture = EngineFixture {
        admin: admin.clone(),
        mode,
        calls: calls.clone(),
    };
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new()
                .route("/v1/inspect-cte", post(inspect))
                .route(
                    "/userinfo",
                    get(|| async {
                        Json(json!({"sub":"editor","email":"editor@example.test","name":"Editor"}))
                    }),
                )
                .with_state(fixture),
        )
        .await
        .unwrap();
    });
    let state = AppState::new(
        pool.clone(),
        AuthClient::new(format!("http://{address}/userinfo")),
    )
    .with_fiscal_engine(Some(
        FiscalEngine::new(
            &format!("http://{address}"),
            "synthetic-cte-inspection-token",
        )
        .unwrap(),
    ));
    (super::router(state), server, calls)
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_inspection_separates_read_and_inspect_and_requires_command_key(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let id = seed(&admin, "000000000000001").await;
    for permission in ["fiscal.cte.read", "fiscal.cte.inspect"] {
        sqlx::query("DELETE FROM role_permissions WHERE permission_code LIKE 'fiscal.cte.%'")
            .execute(&admin)
            .await
            .unwrap();
        sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code=$1").bind(permission).execute(&admin).await.unwrap();
        assert_eq!(
            call(
                &router,
                "POST",
                &format!("{BASE}/{id}/inspect"),
                TENANT,
                Some(Uuid::now_v7()),
                json!({})
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        let read = call(
            &router,
            "GET",
            &format!("{BASE}/{id}/inspection"),
            TENANT,
            None,
            Value::Null,
        )
        .await;
        assert_eq!(
            read.0,
            if permission == "fiscal.cte.read" {
                StatusCode::OK
            } else {
                StatusCode::FORBIDDEN
            }
        );
    }
    grant(&admin).await;
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{BASE}/{id}/inspect"),
            TENANT,
            None,
            json!({})
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{BASE}/{id}/inspect"),
            TENANT,
            Some(Uuid::now_v7()),
            json!({"xml":"PRIVATE-XML"})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_inspection_preserves_source_cursor_replays_and_tenant_isolation(admin: PgPool) {
    let (_, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    let id = seed(&admin, "000000000000001").await;
    let path = format!("{BASE}/{id}/inspect");
    let command = Uuid::now_v7();
    let (router, engine, calls) = services(&admin, &pool, "success").await;
    let first = call(&router, "POST", &path, TENANT, Some(command), json!({})).await;
    assert_eq!(first.0, StatusCode::CREATED, "{}", first.2);
    assert_eq!(first.1["cache-control"], "no-store");
    let facts: Value = serde_json::from_str(FACTS).unwrap();
    assert_eq!(first.2["data"]["document"], facts);
    assert!(first.2["data"]["document"].get("xml").is_none());
    for key in [command, Uuid::now_v7()] {
        let repeated = call(&router, "POST", &path, TENANT, Some(key), json!({})).await;
        assert_eq!(repeated.0, StatusCode::OK, "{}", repeated.2);
        assert_eq!(repeated.2["data"], first.2["data"]);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let stored = call(
        &router,
        "GET",
        &format!("{BASE}/{id}/inspection"),
        TENANT,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(stored.0, StatusCode::OK);
    assert_eq!(stored.2["data"], first.2["data"]);
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("{BASE}/{id}/inspection"),
            OTHER,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let second = seed(&admin, "000000000000002").await;
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{BASE}/{second}/inspect"),
            TENANT,
            Some(command),
            json!({})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let original: String =
        sqlx::query_scalar("SELECT xml FROM fiscal_cte_distribution_documents WHERE id=$1")
            .bind(id)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(original, XML);
    let last: String = sqlx::query_scalar(
        "SELECT last_nsu FROM fiscal_cte_distribution_state WHERE tenant_id=$1::uuid",
    )
    .bind(TENANT)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(last, "000000000000002");
    for statement in [
        "UPDATE fiscal_cte_inspections SET metadata='{}'",
        "DELETE FROM fiscal_cte_inspections",
    ] {
        assert!(sqlx::query(statement).execute(&admin).await.is_err());
    }
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(OTHER)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_inspections")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    tx.rollback().await.unwrap();
    engine.abort();
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_inspection_rejects_forged_metadata_without_overwriting_source(admin: PgPool) {
    let (_, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    let id = seed(&admin, "000000000000001").await;
    for mode in [
        "forged_xml",
        "forged_hash",
        "forged_key",
        "forged_company",
        "forged_environment",
        "forged_carrier",
        "forged_taker",
        "forged_roles",
        "forged_amount",
        "forged_nfe",
        "forged_cte",
        "forged_protocol",
        "forged_profile",
        "forged_layout",
        "forged_signature",
        "forged_trust",
        "forged_status",
    ] {
        let (router, engine, _) = services(&admin, &pool, mode).await;
        let result = call(
            &router,
            "POST",
            &format!("{BASE}/{id}/inspect"),
            TENANT,
            Some(Uuid::now_v7()),
            json!({}),
        )
        .await;
        assert_eq!(result.0, StatusCode::BAD_GATEWAY, "{mode}: {}", result.2);
        engine.abort();
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_inspections")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT xml FROM fiscal_cte_distribution_documents WHERE id=$1"
        )
        .bind(id)
        .fetch_one(&admin)
        .await
        .unwrap(),
        XML
    );
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_inspection_reauthorizes_and_rechecks_company_after_engine_io(admin: PgPool) {
    let (_, pool, auth, role) = setup(&admin).await;
    let id = seed(&admin, "000000000000001").await;
    for (mode, expected) in [
        ("revoke", StatusCode::FORBIDDEN),
        ("company", StatusCode::CONFLICT),
    ] {
        grant(&admin).await;
        let (router, engine, calls) = services(&admin, &pool, mode).await;
        let result = call(
            &router,
            "POST",
            &format!("{BASE}/{id}/inspect"),
            TENANT,
            Some(Uuid::now_v7()),
            json!({}),
        )
        .await;
        assert_eq!(result.0, expected, "{}", result.2);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_inspections")
                .fetch_one(&admin)
                .await
                .unwrap(),
            0
        );
        engine.abort();
    }
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_inspection_engine_failures_preserve_source_and_do_not_record_success(admin: PgPool) {
    let (_, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    let id = seed(&admin, "000000000000001").await;
    for (mode, expected) in [
        ("invalid", StatusCode::UNPROCESSABLE_ENTITY),
        ("unsupported", StatusCode::UNPROCESSABLE_ENTITY),
        ("transport", StatusCode::BAD_GATEWAY),
    ] {
        let (router, engine, _) = services(&admin, &pool, mode).await;
        let result = call(
            &router,
            "POST",
            &format!("{BASE}/{id}/inspect"),
            TENANT,
            Some(Uuid::now_v7()),
            json!({}),
        )
        .await;
        assert_eq!(result.0, expected);
        assert!(!result.2.to_string().contains("PRIVATE-PROVIDER"));
        engine.abort();
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_inspections")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_inspection_outbox_failure_rolls_back_metadata_audit_and_command(admin: PgPool) {
    let (_, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    let id = seed(&admin, "000000000000001").await;
    sqlx::raw_sql("CREATE FUNCTION reject_cte_inspection_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='fiscal.cte.inspected' THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_cte_inspection_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_cte_inspection_outbox();").execute(&admin).await.unwrap();
    let (router, engine, _) = services(&admin, &pool, "success").await;
    let result = call(
        &router,
        "POST",
        &format!("{BASE}/{id}/inspect"),
        TENANT,
        Some(Uuid::now_v7()),
        json!({}),
    )
    .await;
    assert_eq!(result.0, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_inspections")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='fiscal.cte.inspected'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_commands WHERE scope='fiscal.cte.inspect'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    engine.abort();
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_inspection_concurrent_commands_store_one_inspection_and_one_event(admin: PgPool) {
    let (_, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    let id = seed(&admin, "000000000000001").await;
    let path = format!("{BASE}/{id}/inspect");
    let (router, engine, _) = services(&admin, &pool, "concurrent").await;
    let (one, two) = tokio::join!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(Uuid::now_v7()),
            json!({})
        ),
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(Uuid::now_v7()),
            json!({})
        )
    );
    assert!(one.0.is_success(), "{}", one.2);
    assert!(two.0.is_success(), "{}", two.2);
    assert_eq!(one.2["data"]["id"], two.2["data"]["id"]);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_inspections")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM outbox_events WHERE event_type='fiscal.cte.inspected'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        1
    );
    engine.abort();
    cleanup(&admin, pool, auth, &role).await;
}
