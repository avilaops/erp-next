use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderMap, Request, StatusCode},
    routing::{get, post},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::{
    domains::fiscal::engine_client::FiscalEngine,
    platform::{auth::AuthClient, state::AppState},
};

use super::company_tests::{cleanup, setup};

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const BASE: &str = "/api/v1/fiscal/received-nfses";
const XML: &str = include_str!("fixtures/nfse-national.xml");

async fn grant(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code IN ('fiscal.nfse.read','fiscal.nfse.import') ON CONFLICT DO NOTHING")
        .execute(admin).await.unwrap();
}

async fn call(
    router: &Router,
    method: &str,
    path: &str,
    tenant: &str,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Vec<u8>, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", "Bearer editor")
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    let bytes = to_bytes(body, 3 * 1024 * 1024).await.unwrap().to_vec();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (parts.status, parts.headers, bytes, value)
}

#[derive(Clone)]
struct EngineFixture {
    admin: PgPool,
    mode: &'static str,
    calls: Arc<AtomicUsize>,
}

async fn inspect(
    State(fixture): State<EngineFixture>,
    headers: HeaderMap,
    Json(input): Json<Value>,
) -> (StatusCode, Json<Value>) {
    assert_eq!(headers["authorization"], "Bearer synthetic-nfse-token");
    assert_eq!(input["recipientTaxId"], "04252011000110");
    assert_eq!(input.as_object().unwrap().len(), 2);
    fixture.calls.fetch_add(1, Ordering::SeqCst);
    if fixture.mode == "unavailable" {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({})));
    }
    if fixture.mode == "invalid_xml" {
        return (
            StatusCode::OK,
            Json(json!({"status":"blocked","blockers":["invalid_nfse_xml"]})),
        );
    }
    if fixture.mode == "revoke" {
        sqlx::query("DELETE FROM role_permissions WHERE permission_code='fiscal.nfse.import'")
            .execute(&fixture.admin)
            .await
            .unwrap();
    }
    if fixture.mode == "company_changed" {
        sqlx::query("UPDATE tenants SET tax_id='19131243000197' WHERE id=$1")
            .bind(Uuid::parse_str(TENANT).unwrap())
            .execute(&fixture.admin)
            .await
            .unwrap();
    }
    let mut result: Value =
        serde_json::from_str(include_str!("fixtures/nfse-national-inspection.json")).unwrap();
    let xml = input["xml"].as_str().unwrap();
    result["xml"] = json!(xml);
    result["xmlSha256"] = json!(format!("{:x}", Sha256::digest(xml.as_bytes())));
    match fixture.mode {
        "forged_hash" => result["xmlSha256"] = json!("0".repeat(64)),
        "forged_recipient" => result["recipient"]["value"] = json!("19131243000197"),
        "forged_key" => result["accessKey"] = json!("1".repeat(50)),
        "forged_environment" => result["environment"] = json!("production"),
        "forged_amount" => result["serviceCents"] = json!("1"),
        "forged_profile" => result["verification"]["layout"] = json!("official_schema_valid"),
        "forged_signature" => result["verification"]["signature"] = json!("verified"),
        "forged_status" => result["verification"]["currentStatus"] = json!("authorized"),
        "forged_xml" => result["xml"] = json!("<NFSe/>"),
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
                .route("/v1/inspect-nfse", post(inspect))
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
        FiscalEngine::new(&format!("http://{address}"), "synthetic-nfse-token").unwrap(),
    ));
    (super::router(state), server, calls)
}

#[sqlx::test(migrations = "../../migrations")]
async fn received_nfse_import_requires_explicit_permission(admin: PgPool) {
    let (router, application, auth, role) = setup(&admin).await;
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/fiscal/received-nfses/import")
        .header("authorization", "Bearer editor")
        .header("x-tenant-id", "11111111-1111-4111-8111-111111111111")
        .header("content-type", "application/json")
        .header("idempotency-key", "019a4a82-7ad5-7aff-8afb-d014ef8bc532")
        .body(Body::from(r#"{"xml":"<NFSe/>"}"#))
        .unwrap();
    let response = router.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn received_nfse_preserves_xml_replays_and_isolates_immutable_documents(admin: PgPool) {
    let (_, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    let (router, engine, calls) = services(&admin, &pool, "success").await;
    let path = format!("{BASE}/import");
    let key = Uuid::now_v7();
    let first = call(
        &router,
        "POST",
        &path,
        TENANT,
        Some(key),
        json!({"xml":XML}),
    )
    .await;
    assert_eq!(first.0, StatusCode::CREATED, "{}", first.3);
    let id = first.3["data"]["id"].as_str().unwrap();
    assert_eq!(
        first.3["data"]["document"]["verification"]["signature"],
        "not_verified"
    );
    assert_eq!(
        first.3["data"]["document"]["verification"]["layout"],
        "local_profile_valid"
    );
    assert!(first.3["data"]["document"].get("xml").is_none());
    let again = call(
        &router,
        "POST",
        &path,
        TENANT,
        Some(key),
        json!({"xml":XML}),
    )
    .await;
    assert_eq!(again.0, StatusCode::OK);
    assert_eq!(again.3["data"], first.3["data"]);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let duplicate = call(
        &router,
        "POST",
        &path,
        TENANT,
        Some(Uuid::now_v7()),
        json!({"xml":XML}),
    )
    .await;
    assert_eq!(duplicate.0, StatusCode::OK);
    assert_eq!(duplicate.3["data"]["id"], id);
    for command in [key, Uuid::now_v7()] {
        let changed = call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(command),
            json!({"xml":format!("{XML}\n")}),
        )
        .await;
        assert_eq!(changed.0, StatusCode::CONFLICT);
    }
    let xml = call(
        &router,
        "GET",
        &format!("{BASE}/{id}/xml"),
        TENANT,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(xml.0, StatusCode::OK);
    assert_eq!(xml.2, XML.as_bytes());
    assert_eq!(xml.1["cache-control"], "no-store");
    assert_eq!(xml.1["x-content-type-options"], "nosniff");
    let page = call(&router, "GET", BASE, TENANT, None, Value::Null).await;
    assert_eq!(page.3["total"], 1);
    assert_eq!(page.3["tenantId"], TENANT);
    sqlx::raw_sql("INSERT INTO tenant_memberships(id,tenant_id,identity_id,status) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','active'); INSERT INTO roles(id,tenant_id,code,name) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','nfse','NFS-e'); INSERT INTO membership_roles(membership_id,role_id) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'); INSERT INTO role_permissions(role_id,permission_code) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','fiscal.nfse.read')")
        .execute(&admin).await.unwrap();
    for suffix in [String::new(), "/xml".to_owned()] {
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("{BASE}/{id}{suffix}"),
                OTHER,
                None,
                Value::Null
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(OTHER)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_received_nfses")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    tx.rollback().await.unwrap();
    assert!(
        sqlx::query("UPDATE fiscal_received_nfses SET xml='<changed/>'")
            .execute(&admin)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM fiscal_received_nfses")
            .execute(&admin)
            .await
            .is_err()
    );
    for table in ["fiscal_received_nfses", "audit_log", "outbox_events"] {
        let count = sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&admin)
            .await
            .unwrap();
        assert_eq!(count, 1, "{table}");
    }
    engine.abort();
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn received_nfse_rejects_uncorrelated_inspections_and_invented_verification(admin: PgPool) {
    let (_, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    for mode in [
        "forged_hash",
        "forged_recipient",
        "forged_key",
        "forged_environment",
        "forged_amount",
        "forged_profile",
        "forged_signature",
        "forged_status",
        "forged_xml",
    ] {
        let (router, engine, _) = services(&admin, &pool, mode).await;
        let result = call(
            &router,
            "POST",
            &format!("{BASE}/import"),
            TENANT,
            Some(Uuid::now_v7()),
            json!({"xml":XML}),
        )
        .await;
        assert_eq!(result.0, StatusCode::BAD_GATEWAY, "{mode}: {}", result.3);
        engine.abort();
    }
    let (router, engine, _) = services(&admin, &pool, "success").await;
    for xml in [
        XML.replace("<toma><CNPJ>04252011000110", "<toma><CNPJ>19131243000197"),
        XML.replace("<nNFSe>1</nNFSe>", "<nNFSe>1</nNFSe><nNFSe>2</nNFSe>"),
    ] {
        assert_eq!(
            call(
                &router,
                "POST",
                &format!("{BASE}/import"),
                TENANT,
                Some(Uuid::now_v7()),
                json!({"xml":xml})
            )
            .await
            .0,
            StatusCode::BAD_GATEWAY
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_received_nfses")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    engine.abort();
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn received_nfse_reauthorizes_and_checks_company_after_inspection(admin: PgPool) {
    let (_, pool, auth, role) = setup(&admin).await;
    for (mode, expected) in [
        ("revoke", StatusCode::FORBIDDEN),
        ("company_changed", StatusCode::CONFLICT),
    ] {
        grant(&admin).await;
        let (router, engine, calls) = services(&admin, &pool, mode).await;
        let result = call(
            &router,
            "POST",
            &format!("{BASE}/import"),
            TENANT,
            Some(Uuid::now_v7()),
            json!({"xml":XML}),
        )
        .await;
        assert_eq!(result.0, expected, "{}", result.3);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        engine.abort();
        sqlx::query("DELETE FROM role_permissions WHERE permission_code IN ('fiscal.nfse.read','fiscal.nfse.import')").execute(&admin).await.unwrap();
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_received_nfses")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn received_nfse_import_rolls_back_document_command_and_audit_if_outbox_fails(admin: PgPool) {
    let (_, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    let (router, engine, _) = services(&admin, &pool, "success").await;
    sqlx::raw_sql("CREATE FUNCTION reject_nfse_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END $$; CREATE TRIGGER reject_nfse_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_nfse_outbox()")
        .execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{BASE}/import"),
            TENANT,
            Some(key),
            json!({"xml":XML})
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    for table in [
        "fiscal_received_nfses",
        "audit_log",
        "outbox_events",
        "domain_commands",
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
    sqlx::query("DROP TRIGGER reject_nfse_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{BASE}/import"),
            TENANT,
            Some(key),
            json!({"xml":XML})
        )
        .await
        .0,
        StatusCode::CREATED
    );
    engine.abort();
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn received_nfse_bounds_inputs_and_never_persists_failed_inspections(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    let path = format!("{BASE}/import");
    assert_eq!(
        call(&router, "POST", &path, TENANT, None, json!({"xml":XML}))
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(Uuid::now_v7()),
            json!({"xml":XML})
        )
        .await
        .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    for (mode, expected) in [
        ("invalid_xml", StatusCode::UNPROCESSABLE_ENTITY),
        ("unavailable", StatusCode::BAD_GATEWAY),
    ] {
        let (router, engine, _) = services(&admin, &pool, mode).await;
        assert_eq!(
            call(
                &router,
                "POST",
                &path,
                TENANT,
                Some(Uuid::now_v7()),
                json!({"xml":XML})
            )
            .await
            .0,
            expected
        );
        engine.abort();
    }
    let (router, engine, calls) = services(&admin, &pool, "success").await;
    for body in [
        json!({"xml":""}),
        json!({"xml":"x".repeat(1_048_577)}),
        json!({"xml":XML,"recipientTaxId":"19131243000197"}),
    ] {
        assert_eq!(
            call(&router, "POST", &path, TENANT, Some(Uuid::now_v7()), body)
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("{BASE}?limit=0"),
            TENANT,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    engine.abort();
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn received_nfse_serializes_concurrent_imports_with_append_only_application_grants(
    admin: PgPool,
) {
    let (_, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    sqlx::raw_sql(&format!(
        "REVOKE UPDATE,DELETE ON fiscal_received_nfses FROM {role}"
    ))
    .execute(&admin)
    .await
    .unwrap();
    let (router, engine, _) = services(&admin, &pool, "success").await;
    let path = format!("{BASE}/import");
    let key = Uuid::now_v7();
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(key),
            json!({"xml":XML})
        ),
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(key),
            json!({"xml":XML})
        )
    );
    assert!([a.0, b.0].contains(&StatusCode::CREATED));
    assert!([a.0, b.0].contains(&StatusCode::OK));
    assert_eq!(a.3["data"], b.3["data"]);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_received_nfses")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM domain_commands")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    engine.abort();
    cleanup(&admin, pool, auth, &role).await;
}
