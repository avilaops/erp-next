use super::company_tests::{cleanup, setup};
use crate::{
    domains::fiscal::{
        certificate_crypto::{
            CertificateMaterial,
            tests::{fixture, vault},
        },
        engine_client::FiscalEngine,
    },
    platform::{
        auth::{AuthClient, AuthenticatedIdentity},
        state::AppState,
    },
};
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderMap, Request, StatusCode},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT: &str = "22222222-2222-4222-8222-222222222222";
const BASE: &str = "/api/v1/fiscal/cte-distribution";

#[sqlx::test(migrations = "../../migrations")]
async fn cte_individual_inspection_requires_permission_before_loading_source(admin: PgPool) {
    let (router, application, auth, role) = setup(&admin).await;
    let id = Uuid::now_v7();
    let result = call(
        &router,
        "POST",
        &format!("{BASE}/documents/{id}/inspect"),
        TENANT,
        Some(Uuid::now_v7()),
        None,
    )
    .await;
    assert_eq!(result.0, StatusCode::FORBIDDEN, "{}", result.1);
    cleanup(&admin, application, auth, &role).await;
}

async fn call(
    router: &Router,
    method: &str,
    path: &str,
    tenant: &str,
    key: Option<Uuid>,
    revision: Option<i64>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", "Bearer editor")
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
    }
    let result = router
        .clone()
        .oneshot(request.body(Body::from("{}")).unwrap())
        .await
        .unwrap();
    let status = result.status();
    let bytes = to_bytes(result.into_body(), 12 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_distribution_requires_explicit_permissions_and_never_reuses_nfe_state(admin: PgPool) {
    let (router, application, auth, role) = setup(&admin).await;
    let path = format!("{BASE}/status");
    assert_eq!(
        call(&router, "GET", &path, TENANT, None, None).await.0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','fiscal.cte.read')")
        .execute(&admin).await.unwrap();
    let result = call(&router, "GET", &path, TENANT, None, None).await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    assert_eq!(result.1["environment"], "homologation");
    assert_eq!(result.1["lastNsu"], "000000000000000");
    assert_eq!(result.1["revision"], 1);
    assert_eq!(result.1["canQuery"], false);
    assert_eq!(
        call(&router, "GET", &path, OTHER_TENANT, None, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{BASE}/query"),
            TENANT,
            Some(Uuid::now_v7()),
            Some(1)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_distribution_cursors")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, application, auth, &role).await;
}

const XML: &str = "<?xml version=\"1.0\"?>\n<cteProc xmlns=\"http://www.portalfiscal.inf.br/cte\" versao=\"4.00\"><CTe/></cteProc>\n";
const EVENT: &str = "<procEventoCTe xmlns=\"http://www.portalfiscal.inf.br/cte\" versao=\"4.00\"><eventoCTe/></procEventoCTe>";

#[derive(Clone)]
struct Provider {
    admin: PgPool,
    mode: &'static str,
    calls: Arc<AtomicUsize>,
}

async fn provider(
    State(state): State<Provider>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    assert_eq!(headers["authorization"], "Bearer synthetic-cte-token");
    assert_eq!(body["environment"], "homologation");
    assert_eq!(body["issuerTaxId"], "04252011000110");
    assert_eq!(body["authorState"], "SP");
    assert!(body["certificate"]["pkcs12Base64"].as_str().is_some());
    state.calls.fetch_add(1, Ordering::SeqCst);
    let durable: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM fiscal_cte_distribution_runs WHERE status='running'",
    )
    .fetch_one(&state.admin)
    .await
    .unwrap();
    assert_eq!(durable, 1, "intent must be committed before external I/O");
    if state.mode == "unknown" {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error":"private-provider-text"})),
        );
    }
    if state.mode == "revoke" {
        sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='fiscal.cte.query'").execute(&state.admin).await.unwrap();
    }
    if state.mode == "lease-loss" {
        sqlx::query("UPDATE fiscal_cte_distribution_state SET lease_id=$1")
            .bind(Uuid::now_v7())
            .execute(&state.admin)
            .await
            .unwrap();
    }
    if state.mode == "reject" {
        return (
            StatusCode::OK,
            Json(
                json!({"code":"656","lastNsu":"000000000000000","maxNsu":"000000000000000","nextNsu":null,"documents":[]}),
            ),
        );
    }
    if state.mode == "empty" {
        return (
            StatusCode::OK,
            Json(
                json!({"code":"137","lastNsu":"000000000000000","maxNsu":"000000000000000","nextNsu":"000000000000000","documents":[]}),
            ),
        );
    }
    let first_xml = if state.mode == "bad-xml" {
        "<cteProc xmlns=\"http://www.portalfiscal.inf.br/cte\">&#0;</cteProc>"
    } else {
        XML
    };
    let second = if state.mode == "invalid" {
        "000000000000001"
    } else {
        "000000000000002"
    };
    (
        StatusCode::OK,
        Json(
            json!({"code":"138","lastNsu":"000000000000002","maxNsu":if state.mode=="more" {"000000000000010"}else{"000000000000002"},"nextNsu":"000000000000002","documents":[
                {"nsu":"000000000000001","schema":"procCTe_v4.00.xsd","kind":"full","xml":first_xml},
                {"nsu":second,"schema":"procEventoCTe_v4.00.xsd","kind":"event","xml":EVENT}
            ]}),
        ),
    )
}

async fn services(
    admin: &PgPool,
    application: &PgPool,
    mode: &'static str,
) -> (
    Router,
    AppState,
    Vec<tokio::task::JoinHandle<()>>,
    Arc<AtomicUsize>,
) {
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('fiscal.cte.read','fiscal.cte.query') ON CONFLICT DO NOTHING").execute(admin).await.unwrap();
    sqlx::query("INSERT INTO company_profiles(tenant_id,revision,details) VALUES($1::uuid,1,$2)")
        .bind(TENANT)
        .bind(json!({"state":"SP"}))
        .execute(admin)
        .await
        .unwrap();
    let vault = vault();
    let fixture = fixture();
    let material = CertificateMaterial {
        pkcs12: STANDARD.decode(fixture["valid"].as_str().unwrap()).unwrap(),
        password: fixture["password"].as_str().unwrap().into(),
    };
    let metadata = vault
        .inspect(
            &material.pkcs12,
            &material.password,
            "04252011000110",
            time::OffsetDateTime::now_utc(),
        )
        .unwrap();
    let sealed = vault
        .seal(Uuid::parse_str(TENANT).unwrap(), 1, &metadata, &material)
        .unwrap();
    sqlx::query("INSERT INTO fiscal_a1_certificates(tenant_id,revision,metadata,encryption_key_id,nonce,ciphertext,updated_by_identity_id) VALUES($1::uuid,1,$2,$3,$4,$5,'33333333-3333-4333-8333-333333333333')")
        .bind(TENANT).bind(serde_json::to_value(metadata).unwrap()).bind(sealed.key_id).bind(sealed.nonce).bind(sealed.ciphertext).execute(admin).await.unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let provider_state = Provider {
        admin: admin.clone(),
        mode,
        calls: calls.clone(),
    };
    let engine = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new()
                .route("/v1/distribute-cte", post(provider))
                .with_state(provider_state),
        )
        .await
        .unwrap();
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let auth_address = listener.local_addr().unwrap();
    let auth = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/userinfo",
                get(|| async {
                    Json(json!({"sub":"editor","email":"editor@example.test","name":"Editor"}))
                }),
            ),
        )
        .await
        .unwrap();
    });
    let state = AppState::new(
        application.clone(),
        AuthClient::new(format!("http://{auth_address}/userinfo")),
    )
    .with_certificates(Some(vault))
    .with_fiscal_engine(Some(
        FiscalEngine::new(&format!("http://{address}"), "synthetic-cte-token").unwrap(),
    ));
    (
        super::router(state.clone()),
        state,
        vec![engine, auth],
        calls,
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_distribution_persists_atomically_replays_and_isolates_xml(admin: PgPool) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, _, tasks, calls) = services(&admin, &application, "success").await;
    let path = format!("{BASE}/query");
    let key = Uuid::now_v7();
    assert_eq!(
        call(&router, "POST", &path, TENANT, Some(key), None)
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(&router, "POST", &path, TENANT, Some(key), Some(99))
            .await
            .0,
        StatusCode::PRECONDITION_FAILED
    );
    let (a, b) = tokio::join!(
        call(&router, "POST", &path, TENANT, Some(key), Some(1)),
        call(&router, "POST", &path, TENANT, Some(key), Some(1))
    );
    assert_eq!(a.0, StatusCode::OK, "{}", a.1);
    assert_eq!(b.0, StatusCode::OK, "{}", b.1);
    assert_eq!(a.1["runId"], b.1["runId"]);
    let result = call(&router, "POST", &path, TENANT, Some(key), Some(1)).await;
    assert_eq!(result.1["status"], "completed");
    assert_eq!(result.1["lastNsu"], "000000000000002");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let list = call(
        &router,
        "GET",
        &format!("{BASE}/documents"),
        TENANT,
        None,
        None,
    )
    .await;
    assert_eq!(list.1["total"], 2);
    assert_eq!(list.1["data"][0]["verification"], "pending");
    let id = list.1["data"][0]["id"].as_str().unwrap();
    let document = call(
        &router,
        "GET",
        &format!("{BASE}/documents/{id}"),
        TENANT,
        None,
        None,
    )
    .await;
    assert_eq!(document.1["xml"], EVENT);
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT xml FROM fiscal_cte_distribution_documents WHERE nsu='000000000000001'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        XML
    );
    sqlx::raw_sql("INSERT INTO roles(id,tenant_id,code,name) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222','cte-reader','CT-e Reader'); INSERT INTO tenant_memberships(id,tenant_id,identity_id,status) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','active'); INSERT INTO role_permissions(role_id,permission_code) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','fiscal.cte.read'); INSERT INTO membership_roles(membership_id,role_id) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','dddddddd-dddd-4ddd-8ddd-dddddddddddd');").execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("{BASE}/documents/{id}"),
            OTHER_TENANT,
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(Uuid::now_v7()),
            Some(3)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(OTHER_TENANT)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_distribution_documents")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    tx.rollback().await.unwrap();
    assert!(
        sqlx::query("UPDATE fiscal_cte_distribution_documents SET xml='modified'")
            .execute(&admin)
            .await
            .is_err()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_received_nfes")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    let audit: String =
        sqlx::query_scalar("SELECT COALESCE(jsonb_agg(details)::text,'') FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap();
    assert!(!audit.contains("pkcs12Base64") && !audit.contains("private-provider-text"));
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_distribution_failed_second_insert_rolls_back_the_entire_batch(admin: PgPool) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, _, tasks, calls) = services(&admin, &application, "success").await;
    sqlx::raw_sql("CREATE FUNCTION reject_second_cte() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.nsu='000000000000002' THEN RAISE EXCEPTION 'synthetic persistence failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_second_cte BEFORE INSERT ON fiscal_cte_distribution_documents FOR EACH ROW EXECUTE FUNCTION reject_second_cte();").execute(&admin).await.unwrap();
    let result = call(
        &router,
        "POST",
        &format!("{BASE}/query"),
        TENANT,
        Some(Uuid::now_v7()),
        Some(1),
    )
    .await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    assert_eq!(result.1["status"], "failed");
    assert_eq!(result.1["lastCode"], "persistence_failed");
    assert_eq!(result.1["lastNsu"], "000000000000000");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_distribution_documents")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_distribution_invalid_rejected_and_lost_replies_preserve_the_cursor_and_pause(
    admin: PgPool,
) {
    // Each mode is tested against a fresh source state, without resetting a live source.
    let (_, application, auth, role) = setup(&admin).await;
    for mode in ["invalid", "bad-xml", "reject", "unknown", "empty"] {
        let (router, _, tasks, calls) = services(&admin, &application, mode).await;
        let result = call(
            &router,
            "POST",
            &format!("{BASE}/query"),
            TENANT,
            Some(Uuid::now_v7()),
            Some(1),
        )
        .await;
        assert_eq!(result.0, StatusCode::OK, "{mode}: {}", result.1);
        assert_eq!(result.1["lastNsu"], "000000000000000", "{mode}");
        assert_eq!(
            result.1["status"],
            match mode {
                "reject" => "rejected",
                "unknown" => "unknown",
                "empty" => "completed",
                _ => "failed",
            }
        );
        assert!(sqlx::query_scalar::<_,bool>("SELECT next_query_at>clock_timestamp()+interval '59 minutes' AND lease_id IS NULL FROM fiscal_cte_distribution_state").fetch_one(&admin).await.unwrap());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_distribution_documents")
                .fetch_one(&admin)
                .await
                .unwrap(),
            0
        );
        for task in tasks {
            task.abort();
        }
        sqlx::raw_sql("DELETE FROM fiscal_cte_distribution_runs; DELETE FROM fiscal_cte_distribution_state; DELETE FROM company_profiles; DELETE FROM fiscal_a1_certificates;").execute(&admin).await.unwrap();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_distribution_revoked_permission_or_lost_lease_cannot_commit_a_late_reply(
    admin: PgPool,
) {
    let (_, application, auth, role) = setup(&admin).await;
    for mode in ["revoke", "lease-loss"] {
        let (router, _, tasks, calls) = services(&admin, &application, mode).await;
        let result = call(
            &router,
            "POST",
            &format!("{BASE}/query"),
            TENANT,
            Some(Uuid::now_v7()),
            Some(1),
        )
        .await;
        assert_eq!(
            result.0,
            if mode == "revoke" {
                StatusCode::FORBIDDEN
            } else {
                StatusCode::CONFLICT
            },
            "{}",
            result.1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_distribution_documents")
                .fetch_one(&admin)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT last_nsu FROM fiscal_cte_distribution_state")
                .fetch_one(&admin)
                .await
                .unwrap(),
            "000000000000000"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        for task in tasks {
            task.abort();
        }
        sqlx::raw_sql("DELETE FROM fiscal_cte_distribution_runs; DELETE FROM fiscal_cte_distribution_state; DELETE FROM company_profiles; DELETE FROM fiscal_a1_certificates;").execute(&admin).await.unwrap();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_worker_respects_the_durable_pause_and_current_permissions(admin: PgPool) {
    let (_, application, auth, role) = setup(&admin).await;
    let (_, state, tasks, calls) = services(&admin, &application, "empty").await;
    let mut headers = HeaderMap::new();
    headers.insert("x-tenant-id", TENANT.parse().unwrap());
    let identity = AuthenticatedIdentity {
        subject: "editor".into(),
        email: String::new(),
        name: String::new(),
    };
    crate::domains::fiscal::cte_distribution::worker::tick(&state, &identity, &headers)
        .await
        .unwrap();
    crate::domains::fiscal::cte_distribution::worker::tick(&state, &identity, &headers)
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    sqlx::raw_sql("UPDATE fiscal_cte_distribution_state SET next_query_at=clock_timestamp()-interval '1 minute'; DELETE FROM role_permissions WHERE permission_code='fiscal.cte.query';").execute(&admin).await.unwrap();
    assert!(
        crate::domains::fiscal::cte_distribution::worker::tick(&state, &identity, &headers)
            .await
            .is_err()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_distribution_recovers_an_expired_run_without_advancing_its_source(admin: PgPool) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, _, tasks, calls) = services(&admin, &application, "empty").await;
    let key = Uuid::now_v7();
    let first = call(
        &router,
        "POST",
        &format!("{BASE}/query"),
        TENANT,
        Some(key),
        Some(1),
    )
    .await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    let id = Uuid::parse_str(first.1["runId"].as_str().unwrap()).unwrap();
    sqlx::query("UPDATE fiscal_cte_distribution_runs SET status='running',result=NULL,completed_at=NULL WHERE id=$1").bind(id).execute(&admin).await.unwrap();
    sqlx::query("UPDATE fiscal_cte_distribution_state SET lease_id=$1,lease_until=clock_timestamp()-interval '1 minute',next_query_at=clock_timestamp()-interval '1 minute'").bind(id).execute(&admin).await.unwrap();
    let second = call(
        &router,
        "POST",
        &format!("{BASE}/query"),
        TENANT,
        Some(Uuid::now_v7()),
        Some(3),
    )
    .await;
    assert_eq!(second.0, StatusCode::OK, "{}", second.1);
    assert_eq!(second.1["lastNsu"], "000000000000000");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    let old = call(
        &router,
        "GET",
        &format!("{BASE}/runs/{id}"),
        TENANT,
        None,
        None,
    )
    .await;
    assert_eq!(old.1["status"], "unknown");
    let replay = call(
        &router,
        "POST",
        &format!("{BASE}/query"),
        TENANT,
        Some(key),
        Some(1),
    )
    .await;
    assert_eq!(replay.1["status"], "unknown");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    sqlx::query("UPDATE tenants SET tax_id='11222333000181' WHERE id=$1::uuid")
        .bind(TENANT)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{BASE}/query"),
            TENANT,
            Some(Uuid::now_v7()),
            Some(5)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_distribution_upgrade_preserves_forced_rls_and_append_only_runtime_grants(
    admin: PgPool,
) {
    let (_, application, auth, role) = setup(&admin).await;
    let bootstrap = include_str!("../../../../deploy/bootstrap.sql")
        .lines()
        .filter(|line| !line.starts_with('\\'))
        .collect::<Vec<_>>()
        .join("\n")
        .replace(":'tenant'", "'11111111-1111-4111-8111-111111111111'")
        .replace(":'admin_sub'", "'editor'")
        .replace(":'admin_email'", "'editor@example.test'")
        .replace("erp_next_app", &role);
    sqlx::raw_sql(&bootstrap).execute(&admin).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.code='administrator' AND rp.permission_code IN ('fiscal.cte.read','fiscal.cte.query')").fetch_one(&admin).await.unwrap(),0);
    let script = include_str!("../../../../deploy/grant-cte-distribution.sql")
        .replace("erp_next_app", &role)
        .replace("\\set ON_ERROR_STOP on", "");
    sqlx::raw_sql(&script).execute(&admin).await.unwrap();
    for table in [
        "fiscal_cte_distribution_state",
        "fiscal_cte_distribution_runs",
        "fiscal_cte_distribution_documents",
    ] {
        assert!(
            sqlx::query_scalar::<_, bool>(
                "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=$1::regclass"
            )
            .bind(table)
            .fetch_one(&admin)
            .await
            .unwrap()
        );
        assert!(
            !sqlx::query_scalar::<_, bool>("SELECT has_table_privilege($1,$2,'DELETE')")
                .bind(&role)
                .bind(table)
                .fetch_one(&admin)
                .await
                .unwrap()
        );
        assert!(
            sqlx::query_scalar::<_, bool>("SELECT has_table_privilege($1,$2,'INSERT')")
                .bind(&role)
                .bind(table)
                .fetch_one(&admin)
                .await
                .unwrap()
        );
    }
    assert!(
        !sqlx::query_scalar::<_, bool>(
            "SELECT has_table_privilege($1,'fiscal_cte_distribution_documents','UPDATE')"
        )
        .bind(&role)
        .fetch_one(&admin)
        .await
        .unwrap()
    );
    assert!(
        include_str!("../../../../deploy/migrate-release.py")
            .contains("\"grant-cte-distribution.sql\"")
    );
    cleanup(&admin, application, auth, &role).await;
}
