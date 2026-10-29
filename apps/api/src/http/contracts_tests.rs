use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderMap, Request, StatusCode},
    routing::{get, post, put},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::{
    domains::contracts::provider::Docuseal,
    platform::{auth::AuthClient, state::AppState},
};

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

#[derive(Clone, Default)]
struct ProviderFixture {
    submission: Arc<Mutex<Value>>,
    creates: Arc<AtomicUsize>,
    sends: Arc<AtomicUsize>,
    completed: Arc<AtomicBool>,
}

fn template() -> Value {
    json!({"id":1,"name":"Contrato de validação","updated_at":"2026-10-29T00:00:00Z","archived_at":null,"submitters":[{"name":"Cliente","uuid":"customer"}],"fields":[{"name":"cliente_nome","type":"text","required":true,"submitter_uuid":"customer"},{"name":"condicoes","type":"text","required":true,"submitter_uuid":"customer"},{"name":"Assinatura","type":"signature","required":true,"submitter_uuid":"customer"}]})
}

async fn call(
    router: &Router,
    method: &str,
    path: &str,
    actor: &str,
    revision: i64,
    key: Uuid,
    body: Value,
) -> (StatusCode, Value) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("authorization", format!("Bearer {actor}"))
                .header("x-tenant-id", TENANT)
                .header("content-type", "application/json")
                .header("idempotency-key", key.to_string())
                .header("if-match", format!("\"{revision}\""))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn contracts_preserve_snapshot_and_reconcile_unknown_results_without_duplicate_dispatch(
    admin: PgPool,
) {
    let (seed_router, pool, fixture_server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions ON CONFLICT DO NOTHING; INSERT INTO role_permissions(role_id,permission_code) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read')").execute(&admin).await.unwrap();
    let customer = call(&seed_router,"POST","/api/v1/parties","editor",1,Uuid::now_v7(),json!({"personType":"juridica","legalName":"Cliente de validação","taxId":"04252011000110","email":"validation@example.test","phone":null,"tradeName":null,"isCustomer":true,"isSupplier":false,"status":"active"})).await;
    assert_eq!(customer.0, StatusCode::CREATED, "{}", customer.1);
    let product = call(&seed_router,"POST","/api/v1/products","editor",1,Uuid::now_v7(),json!({"sku":"CONTRACT-1","name":"Produto","unit":"UN","basePrice":"10.00","ncm":null,"cest":null,"status":"active"})).await;
    assert_eq!(product.0, StatusCode::CREATED, "{}", product.1);
    let order = call(&seed_router,"POST","/api/v1/orders","editor",1,Uuid::now_v7(),json!({"customerId":customer.1["data"]["id"],"dueDate":"2026-12-01","items":[{"productId":product.1["data"]["id"],"quantity":"1.000000"}]})).await;
    assert_eq!(order.0, StatusCode::CREATED, "{}", order.1);

    let fixture = ProviderFixture::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let base = format!("http://{address}/");
    let pdf_base = base.clone();
    let state_base = base.clone();
    let fixture_router = Router::new()
        .route("/userinfo",get(|headers: HeaderMap| async move {
            let actor = headers.get("authorization").unwrap().to_str().unwrap().strip_prefix("Bearer ").unwrap();
            Json(json!({"sub":actor,"email":format!("{actor}@example.test"),"name":actor}))
        }))
        .route("/api/templates/1",get(|| async { Json(template()) }))
        .route("/api/submissions",post(|State(state): State<ProviderFixture>, Json(body): Json<Value>| async move {
            state.creates.fetch_add(1,Ordering::SeqCst);
            assert_eq!(body["send_email"],false);
            assert_eq!(body["submitters"][0]["fields"][0]["readonly"],true);
            let mut submitter = body["submitters"][0].clone();
            submitter["id"] = json!(5);
            submitter["submission_id"] = json!(7);
            // sent_at alone must never be described as confirmed transmission.
            submitter["sent_at"] = json!("2026-10-29T00:00:00Z");
            *state.submission.lock().unwrap() = json!({"id":7,"template":{"id":1},"submitters":[submitter],"submission_events":[]});
            StatusCode::SERVICE_UNAVAILABLE
        }))
        .route("/api/submitters",get(|State(state): State<ProviderFixture>| async move {
            Json(json!({"data":state.submission.lock().unwrap()["submitters"]}))
        }))
        .route("/api/submissions/7",get(move |State(state): State<ProviderFixture>| { let base = state_base.clone(); async move {
            let mut submission = state.submission.lock().unwrap().clone();
            if state.completed.load(Ordering::SeqCst) {
                submission["completed_at"] = json!("2026-10-29T01:00:00Z");
                submission["submitters"][0]["completed_at"] = json!("2026-10-29T01:00:00Z");
                submission["audit_log_url"] = json!(format!("{base}audit.pdf"));
            }
            Json(submission)
        }}))
        .route("/api/submissions/7/documents",get(move || { let base = pdf_base.clone(); async move { Json(json!({"documents":[{"url":format!("{base}document.pdf")}]})) } }))
        .route("/api/submitters/5",put(|State(state): State<ProviderFixture>| async move {
            state.sends.fetch_add(1,Ordering::SeqCst);
            // Accepted upstream, response lost: must not be repeated.
            StatusCode::SERVICE_UNAVAILABLE
        }))
        .route("/document.pdf",get(|| async { "%PDF-1.7\nfixture document" }))
        .route("/audit.pdf",get(|| async { "%PDF-1.7\nfixture audit" }))
        .with_state(fixture.clone());
    let provider_server =
        tokio::spawn(async move { axum::serve(listener, fixture_router).await.unwrap() });
    let router = super::router(
        AppState::new(pool.clone(), AuthClient::new(format!("{base}userinfo"))).with_contracts(
            Some(Docuseal::for_test(
                base.parse().unwrap(),
                TENANT.parse().unwrap(),
                true,
            )),
        ),
    );
    let payload = json!({"orderId":order.1["data"]["id"],"orderRevision":1,"templateId":1,"templateUpdatedAt":"2026-10-29T00:00:00Z","recipients":[{"role":"Cliente","name":"Validação","email":"validation@example.test"}],"fields":{"cliente_nome":"Não deve substituir o cadastro","condicoes":"Apenas validação"}});
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/commercial-contracts",
            "reader",
            1,
            Uuid::now_v7(),
            payload.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let key = Uuid::now_v7();
    let generated = call(
        &router,
        "POST",
        "/api/v1/commercial-contracts",
        "editor",
        1,
        key,
        payload.clone(),
    )
    .await;
    assert_eq!(generated.0, StatusCode::OK, "{}", generated.1);
    assert_eq!(generated.1["data"]["status"], "created");
    assert_eq!(
        generated.1["data"]["fields"]["cliente_nome"],
        "Cliente de validação"
    );
    assert_eq!(generated.1["data"]["progress"][0]["sendConfirmed"], false);
    let id = generated.1["data"]["id"].as_str().unwrap();
    let path = format!("/api/v1/commercial-contracts/{id}");
    for replay_key in [key, Uuid::now_v7()] {
        assert_eq!(
            call(
                &router,
                "POST",
                "/api/v1/commercial-contracts",
                "editor",
                1,
                replay_key,
                payload.clone()
            )
            .await
            .1["data"]["id"],
            id
        );
    }
    assert_eq!(fixture.creates.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.sends.load(Ordering::SeqCst), 0);
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{path}/send"),
            "editor",
            2,
            Uuid::now_v7(),
            json!({})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{path}/review"),
            "reader",
            2,
            Uuid::now_v7(),
            json!({})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{path}/review"),
            "editor",
            1,
            Uuid::now_v7(),
            json!({})
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let reviewed = call(
        &router,
        "POST",
        &format!("{path}/review"),
        "editor",
        2,
        Uuid::now_v7(),
        json!({}),
    )
    .await;
    assert_eq!(reviewed.1["data"]["status"], "reviewed", "{}", reviewed.1);
    let send_key = Uuid::now_v7();
    let send_revision = reviewed.1["data"]["revision"].as_i64().unwrap();
    let email_disabled_router = super::router(
        AppState::new(pool.clone(), AuthClient::new(format!("{base}userinfo"))).with_contracts(
            Some(Docuseal::for_test(
                base.parse().unwrap(),
                TENANT.parse().unwrap(),
                false,
            )),
        ),
    );
    let blocked = call(
        &email_disabled_router,
        "POST",
        &format!("{path}/send"),
        "editor",
        send_revision,
        Uuid::now_v7(),
        json!({}),
    )
    .await;
    assert_eq!(blocked.0, StatusCode::CONFLICT);
    assert_eq!(fixture.sends.load(Ordering::SeqCst), 0);
    let unchanged = call(
        &email_disabled_router,
        "GET",
        &path,
        "editor",
        send_revision,
        Uuid::now_v7(),
        Value::Null,
    )
    .await;
    assert_eq!(unchanged.1["emailReady"], false);
    assert_eq!(unchanged.1["data"]["status"], "reviewed");
    assert!(unchanged.1["data"]["sendRequestedAt"].is_null());
    let sent = call(
        &router,
        "POST",
        &format!("{path}/send"),
        "editor",
        send_revision,
        send_key,
        json!({}),
    )
    .await;
    assert_eq!(sent.1["data"]["status"], "send_requested", "{}", sent.1);
    for replay_key in [send_key, Uuid::now_v7()] {
        assert_eq!(
            call(
                &router,
                "POST",
                &format!("{path}/send"),
                "editor",
                send_revision,
                replay_key,
                json!({})
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    assert_eq!(fixture.sends.load(Ordering::SeqCst), 1);

    let order_id: Uuid = order.1["data"]["id"].as_str().unwrap().parse().unwrap();
    sqlx::query("UPDATE sales_orders SET due_date='2027-01-01',revision=revision+1 WHERE id=$1")
        .bind(order_id)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "GET",
            &path,
            "reader",
            1,
            Uuid::now_v7(),
            Value::Null
        )
        .await
        .1["data"]["snapshot"]["order"]["dueDate"],
        "2026-12-01"
    );
    let customer_path = format!(
        "/api/v1/commercial-contracts?customerId={}",
        customer.1["data"]["id"].as_str().unwrap()
    );
    assert_eq!(
        call(
            &router,
            "GET",
            &customer_path,
            "reader",
            1,
            Uuid::now_v7(),
            Value::Null
        )
        .await
        .1["data"][0]["id"],
        id
    );
    let denied = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(&path)
                .header("authorization", "Bearer editor")
                .header("x-tenant-id", OTHER)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(OTHER)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM commercial_contracts")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM commercial_contract_files")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        0
    );
    tx.rollback().await.unwrap();

    fixture.completed.store(true, Ordering::SeqCst);
    for kind in [
        "submission.completed",
        "submission.completed",
        "submission.created",
    ] {
        let response = router.clone().oneshot(Request::builder().method("POST").uri(format!("/api/v1/webhooks/contracts/{TENANT}"))
            .header("content-type","application/json").header("x-avila-contract-secret","fixture-webhook-secret")
            .body(Body::from(json!({"event_type":kind,"timestamp":"2026-10-29T01:00:00Z","data":{"id":7}}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }
    let complete = call(
        &router,
        "GET",
        &path,
        "reader",
        1,
        Uuid::now_v7(),
        Value::Null,
    )
    .await;
    assert_eq!(complete.1["data"]["status"], "completed");
    assert_eq!(complete.1["files"].as_array().unwrap().len(), 3);
    let forbidden_hook = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/webhooks/contracts/{TENANT}"))
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden_hook.status(), StatusCode::FORBIDDEN);
    assert_eq!(fixture.creates.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.sends.load(Ordering::SeqCst), 1);
    provider_server.abort();
    super::company_tests::cleanup(&admin, pool, fixture_server, &role).await;
}
