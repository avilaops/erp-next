use super::company_tests::{cleanup, setup};
use crate::{
    domains::fiscal::{
        certificate_crypto::{
            CertificateMaterial,
            tests::{fixture, vault},
        },
        engine_client::FiscalEngine,
    },
    platform::{auth::AuthClient, state::AppState},
};
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Path, State},
    http::{HeaderMap, Request, StatusCode},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
type Calls = Arc<Mutex<Vec<(String, Value)>>>;
#[derive(Clone)]
struct Provider {
    admin: PgPool,
    mode: &'static str,
    calls: Calls,
}
fn registered_event(body: &Value) -> Value {
    let key = body["accessKey"].as_str().unwrap();
    let kind = if body["kind"] == "cancelamento" {
        "110111"
    } else {
        "110110"
    };
    let sequence = body["sequence"].as_i64().unwrap();
    json!({"kind":body["kind"],"sequence":sequence,"text":body["text"],"registered":true,"code":"135","reason":"Evento registrado","protocol":"135260000000002","xml":format!("<procEventoNFe xmlns=\"http://www.portalfiscal.inf.br/nfe\"><retEvento><infEvento><tpAmb>2</tpAmb><chNFe>{key}</chNFe><tpEvento>{kind}</tpEvento><nSeqEvento>{sequence}</nSeqEvento><cStat>135</cStat><nProt>135260000000002</nProt></infEvento></retEvento></procEventoNFe>")})
}
async fn provider(
    State(state): State<Provider>,
    Path(operation): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    assert_eq!(headers["authorization"], "Bearer synthetic-token");
    assert_eq!(body["environment"], "homologation");
    assert!(body["certificate"]["pkcs12Base64"].as_str().is_some());
    state
        .calls
        .lock()
        .unwrap()
        .push((operation.clone(), body.clone()));
    if operation == "prepare" {
        if state.mode == "blocked" && !body["draft"]["payments"].is_array() {
            return (
                StatusCode::OK,
                Json(
                    json!({"status":"blocked","blockers":["payments_required"],"title":"Ignored remote message"}),
                ),
            );
        }
        let number = body["number"].as_i64().unwrap();
        let random = body["randomCode"].as_str().unwrap();
        let prefix = format!("3526100425201100011055001{number:09}1{random}");
        let sum: u32 = prefix
            .bytes()
            .rev()
            .enumerate()
            .map(|(index, b)| u32::from(b - b'0') * (2 + (index % 8) as u32))
            .sum();
        let digit = 11 - sum % 11;
        let digit = if digit >= 10 { 0 } else { digit };
        let key = format!("{prefix}{digit}");
        let issued_at = body["issuedAt"].as_str().unwrap();
        let total = body["draft"]["productsTotal"].as_str().unwrap();
        let xml = format!(
            "<NFe xmlns=\"http://www.portalfiscal.inf.br/nfe\"><infNFe versao=\"4.00\" Id=\"NFe{key}\"><ide><mod>55</mod><tpAmb>2</tpAmb><serie>1</serie><nNF>{number}</nNF><cNF>{random}</cNF><dhEmi>{issued_at}</dhEmi></ide><emit><CNPJ>04252011000110</CNPJ><xNome>Empresa A</xNome></emit><dest><CPF>52998224725</CPF></dest><det nItem=\"1\"/><total><ICMSTot><vNF>{total}</vNF></ICMSTot></total></infNFe><Signature xmlns=\"http://www.w3.org/2000/09/xmldsig#\"><SignedInfo><Reference URI=\"#NFe{key}\"><DigestValue>AAAAAAAAAAAAAAAAAAAAAAAAAAA=</DigestValue></Reference></SignedInfo></Signature></NFe>"
        );
        return (
            StatusCode::OK,
            Json(json!({"accessKey":key,"signedXml":xml})),
        );
    }
    if operation == "void" {
        let durable: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM fiscal_nfe_events WHERE kind='inutilizacao' AND status='unknown'",
        )
        .fetch_one(&state.admin)
        .await
        .unwrap();
        assert_eq!(durable, 1);
        let series = body["series"].as_i64().unwrap();
        let first = body["first"].as_i64().unwrap();
        let last = body["last"].as_i64().unwrap();
        return (
            StatusCode::OK,
            Json(
                json!({"registered":true,"code":"102","protocol":"135260000000003","xml":format!("<retInutNFe xmlns=\"http://www.portalfiscal.inf.br/nfe\"><infInut><tpAmb>2</tpAmb><CNPJ>04252011000110</CNPJ><serie>{series}</serie><nNFIni>{first}</nNFIni><nNFFin>{last}</nNFFin><cStat>102</cStat><nProt>135260000000003</nProt></infInut></retInutNFe>")}),
            ),
        );
    }
    if operation == "event" {
        let durable: i64 =
            sqlx::query_scalar("SELECT count(*) FROM fiscal_nfe_events WHERE status='unknown'")
                .fetch_one(&state.admin)
                .await
                .unwrap();
        assert_eq!(durable, 1);
        if state.mode == "event-loss" {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error":"response lost after authority registration"})),
            );
        }
        return (StatusCode::OK, Json(registered_event(&body)));
    }
    if operation == "authorize" {
        let (status, xml): (String, String) = sqlx::query_as(
            "SELECT status,signed_xml FROM fiscal_nfe_documents WHERE access_key=$1",
        )
        .bind(body["accessKey"].as_str().unwrap())
        .fetch_one(&state.admin)
        .await
        .unwrap();
        assert_eq!(status, "unknown");
        assert_eq!(xml, body["signedXml"]);
        if state.mode == "uncertain" {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error":"synthetic unavailable"})),
            );
        }
        if state.mode == "rejected" {
            return (
                StatusCode::OK,
                Json(json!({"status":"rejected","code":"225","reason":"Rejeição sintética"})),
            );
        }
        if state.mode == "duplicate" {
            return (
                StatusCode::OK,
                Json(json!({"status":"rejected","code":"204","reason":"Duplicidade incerta"})),
            );
        }
    }
    let key = body["accessKey"].as_str().unwrap();
    let digest = if state.mode == "digest-mismatch" {
        "BBBBBBBBBBBBBBBBBBBBBBBBBBB="
    } else {
        "AAAAAAAAAAAAAAAAAAAAAAAAAAA="
    };
    let xml = format!(
        "<nfeProc versao=\"4.00\" xmlns=\"http://www.portalfiscal.inf.br/nfe\">{}<protNFe versao=\"4.00\"><infProt><tpAmb>2</tpAmb><chNFe>{key}</chNFe><cStat>100</cStat><nProt>135260000000001</nProt><dhRecbto>2026-10-31T10:00:00-03:00</dhRecbto><digVal>{digest}</digVal></infProt></protNFe></nfeProc>",
        body["signedXml"].as_str().unwrap()
    );
    let xml = if state.mode == "content-mismatch" {
        xml.replace(
            "<xNome>Empresa A</xNome>",
            "<xNome>Conteúdo alterado</xNome>",
        )
    } else {
        xml
    };
    let events = if state.mode == "event-loss" && operation == "consult" {
        state
            .calls
            .lock()
            .unwrap()
            .iter()
            .find(|(operation, _)| operation == "event")
            .map(|(_, body)| vec![registered_event(body)])
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    (
        StatusCode::OK,
        Json(
            json!({"status":"authorized","code":"100","reason":"Autorizado sintético","protocol":"135260000000001","xml":xml,"events":events}),
        ),
    )
}
fn draft() -> Value {
    json!({"environment":"homologation","model":55,"operationNature":"Venda sintética","taxRuleReference":"instrução de teste","recipient":{"taxId":"52998224725","legalName":"Pessoa de teste","state":"SP","municipalityCode":"3550308","postalCode":"01001000","street":"Rua de teste","number":"1","district":"Centro"},"items":[{"code":"TEST","description":"Produto de teste","unit":"UN","ncm":"00000000","cfop":"5102","quantity":"1.0000","unitPrice":"1.0000000000","grossTotal":"1.00","origin":0,"csosn":"102","pisCst":"07","cofinsCst":"07"}],"productsTotal":"1.00","payments":[{"code":"01","amount":"1.00"}]})
}
async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    subject: &str,
    rev: Option<&str>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {subject}"))
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json");
    if let Some(rev) = rev {
        request = request.header("if-match", rev);
    }
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    let bytes = to_bytes(body, 10 * 1024 * 1024).await.unwrap();
    (
        parts.status,
        parts.headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn services(
    admin: &PgPool,
    application: PgPool,
    mode: &'static str,
) -> (Router, Vec<tokio::task::JoinHandle<()>>, Calls) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code LIKE 'fiscal.%'; INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fiscal.nfe.read');").execute(admin).await.unwrap();
    sqlx::query("INSERT INTO company_profiles(tenant_id,revision,details) VALUES($1::uuid,1,$2)").bind(TENANT).bind(json!({"legalName":"Empresa A","personType":"juridica","taxId":"04252011000110","taxRegime":"simples","stateRegistration":"110042490114","segments":["Indústria"],"postalCode":"01001000","state":"SP","city":"São Paulo","street":"Rua de teste","number":"1","district":"Centro"})).execute(admin).await.unwrap();
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
    sqlx::query("INSERT INTO fiscal_a1_certificates(tenant_id,revision,metadata,encryption_key_id,nonce,ciphertext,updated_by_identity_id) VALUES($1::uuid,1,$2,$3,$4,$5,'33333333-3333-4333-8333-333333333333')").bind(TENANT).bind(serde_json::to_value(metadata).unwrap()).bind(sealed.key_id).bind(sealed.nonce).bind(sealed.ciphertext).execute(admin).await.unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let engine_address = listener.local_addr().unwrap();
    let state = Provider {
        admin: admin.clone(),
        mode,
        calls: calls.clone(),
    };
    let engine_task = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new()
                .route("/v1/{operation}", post(provider))
                .with_state(state),
        )
        .await
        .unwrap();
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let auth_address = listener.local_addr().unwrap();
    let auth_task = tokio::spawn(async move {
        axum::serve(listener,Router::new().route("/userinfo",get(|headers:HeaderMap|async move{let subject=headers["authorization"].to_str().unwrap().strip_prefix("Bearer ").unwrap().to_owned();Json(json!({"sub":subject,"email":format!("{subject}@example.test"),"name":subject}))}))).await.unwrap();
    });
    let router = super::router(
        AppState::new(
            application,
            AuthClient::new(format!("http://{auth_address}/userinfo")),
        )
        .with_certificates(Some(vault))
        .with_fiscal_engine(Some(
            FiscalEngine::new(&format!("http://{engine_address}"), "synthetic-token").unwrap(),
        )),
    );
    let configured=call(&router,"PUT","/api/v1/fiscal/config","editor",Some("\"0\""),None,json!({"environment":"homologation","state":"SP","municipalityCode":"3550308","stateRegistration":"110042490114","crt":1,"series":1})).await;
    assert_eq!(configured.0, StatusCode::OK, "{}", configured.2);
    (router, vec![engine_task, auth_task], calls)
}

#[sqlx::test(migrations = "../../migrations")]
async fn emission_persists_before_transport_replays_and_records_events_without_duplicate_numbers(
    admin: PgPool,
) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, tasks, calls) = services(&admin, application.clone(), "authorized").await;
    let created = call(
        &router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        draft(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/fiscal/nfe/{id}/issue");
    let key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "POST",
            &uri,
            "reader",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let issued = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(issued.0, StatusCode::OK, "{}", issued.2);
    assert_eq!(issued.2["status"], "authorized");
    assert_eq!(issued.2["number"], 1);
    let repeated = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(issued.2, repeated.2);
    assert_eq!(calls.lock().unwrap().len(), 2);
    let revision = issued.1["etag"].to_str().unwrap();
    let correction = call(
        &router,
        "POST",
        &format!("/api/v1/fiscal/nfe/{id}/correction"),
        "editor",
        Some(revision),
        Some(Uuid::now_v7()),
        json!({"text":"Correção sintética do endereço complementar"}),
    )
    .await;
    assert_eq!(correction.0, StatusCode::OK, "{}", correction.2);
    assert_eq!(correction.2["status"], "registered");
    let current = call(
        &router,
        "GET",
        &format!("/api/v1/fiscal/nfe/{id}/emission"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    let cancel_key = Uuid::now_v7();
    let cancel_uri = format!("/api/v1/fiscal/nfe/{id}/cancel");
    let cancellation = call(
        &router,
        "POST",
        &cancel_uri,
        "editor",
        Some(current.1["etag"].to_str().unwrap()),
        Some(cancel_key),
        json!({"text":"Cancelamento sintético solicitado pelo cliente"}),
    )
    .await;
    assert_eq!(cancellation.2["status"], "registered", "{}", cancellation.2);
    let final_doc = call(
        &router,
        "GET",
        &format!("/api/v1/fiscal/nfe/{id}/emission"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(final_doc.2["status"], "cancelled");
    let unchanged = call(
        &router,
        "PUT",
        &format!("/api/v1/fiscal/nfe/{id}"),
        "editor",
        Some("\"1\""),
        None,
        draft(),
    )
    .await;
    assert_eq!(unchanged.0, StatusCode::CONFLICT);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_nfe_documents")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn emission_uncertainty_consults_same_document_before_any_retransmission(admin: PgPool) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, tasks, calls) = services(&admin, application.clone(), "uncertain").await;
    let created = call(
        &router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        draft(),
    )
    .await;
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/fiscal/nfe/{id}/issue");
    let key = Uuid::now_v7();
    let first = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(first.0, StatusCode::ACCEPTED, "{}", first.2);
    assert_eq!(first.2["status"], "unknown");
    let reconciled = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(reconciled.2["status"], "authorized", "{}", reconciled.2);
    assert_eq!(reconciled.2["number"], first.2["number"]);
    assert_eq!(reconciled.2["accessKey"], first.2["accessKey"]);
    assert_eq!(
        calls
            .lock()
            .unwrap()
            .iter()
            .map(|v| v.0.as_str())
            .collect::<Vec<_>>(),
        ["prepare", "authorize", "consult"]
    );
    let persisted: String = sqlx::query_scalar("SELECT signed_xml FROM fiscal_nfe_documents")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(persisted, calls.lock().unwrap()[1].1["signedXml"]);
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn emission_rejection_keeps_reserved_number_and_cannot_be_edited_or_reissued(admin: PgPool) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, tasks, calls) = services(&admin, application.clone(), "rejected").await;
    let created = call(
        &router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        draft(),
    )
    .await;
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/fiscal/nfe/{id}/issue");
    let key = Uuid::now_v7();
    let rejected = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(rejected.0, StatusCode::OK, "{}", rejected.2);
    assert_eq!(rejected.2["status"], "rejected");
    assert_eq!(
        call(
            &router,
            "POST",
            &uri,
            "editor",
            Some("\"1\""),
            Some(key),
            Value::Null
        )
        .await
        .2,
        rejected.2
    );
    assert_eq!(calls.lock().unwrap().len(), 2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT next_number FROM fiscal_number_sequences")
            .fetch_one(&admin)
            .await
            .unwrap(),
        2
    );
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn emission_preparation_blockers_allow_fixing_draft_without_renumbering(admin: PgPool) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, tasks, calls) = services(&admin, application.clone(), "blocked").await;
    let mut incomplete = draft();
    incomplete.as_object_mut().unwrap().remove("payments");
    let created = call(
        &router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        incomplete,
    )
    .await;
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/fiscal/nfe/{id}/issue");
    let key = Uuid::now_v7();
    let blocked = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(blocked.0, StatusCode::ACCEPTED, "{}", blocked.2);
    assert_eq!(blocked.2["status"], "preparing");
    assert_eq!(
        blocked.2["result"]["blockers"],
        json!(["payments_required"])
    );
    let fixed = call(
        &router,
        "PUT",
        &format!("/api/v1/fiscal/nfe/{id}"),
        "editor",
        Some("\"1\""),
        None,
        draft(),
    )
    .await;
    assert_eq!(fixed.0, StatusCode::OK, "{}", fixed.2);
    let emitted = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(emitted.2["status"], "authorized", "{}", emitted.2);
    assert_eq!(emitted.2["number"], blocked.2["number"]);
    assert_eq!(
        calls
            .lock()
            .unwrap()
            .iter()
            .map(|v| v.0.as_str())
            .collect::<Vec<_>>(),
        ["prepare", "prepare", "authorize"]
    );
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn emission_voids_reserve_numbers_durably_replay_and_preserve_tenant_rls(admin: PgPool) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, tasks, calls) = services(&admin, application.clone(), "authorized").await;
    let body = json!({"year":time::OffsetDateTime::now_utc().year(),"series":1,"first":1,"last":3,"text":"Inutilização sintética de faixa não utilizada"});
    let key = Uuid::now_v7();
    let first = call(
        &router,
        "POST",
        "/api/v1/fiscal/number-voids",
        "editor",
        Some("\"0\""),
        Some(key),
        body.clone(),
    )
    .await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.2);
    assert_eq!(first.2["status"], "registered");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/fiscal/number-voids",
            "editor",
            Some("\"0\""),
            Some(key),
            body
        )
        .await
        .2,
        first.2
    );
    assert_eq!(calls.lock().unwrap().len(), 1);
    let created = call(
        &router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        draft(),
    )
    .await;
    let id = created.2["data"]["id"].as_str().unwrap();
    let issued = call(
        &router,
        "POST",
        &format!("/api/v1/fiscal/nfe/{id}/issue"),
        "editor",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        Value::Null,
    )
    .await;
    assert_eq!(issued.2["number"], 4, "{}", issued.2);
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    for table in [
        "fiscal_nfe_documents",
        "fiscal_nfe_events",
        "fiscal_number_sequences",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&mut *tx)
                .await
                .unwrap(),
            0
        );
    }
    tx.rollback().await.unwrap();
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn emission_order_cancellation_records_commercial_request_before_fiscal_confirmation(
    admin: PgPool,
) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, tasks, calls) = services(&admin, application.clone(), "authorized").await;
    super::returns_tests::seed(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','catalog.parties.read') ON CONFLICT DO NOTHING").execute(&admin).await.unwrap();
    let (order, _) = super::returns_tests::completed(&router).await;
    let mut body = draft();
    body["sourceOrderId"] = json!(order);
    body["recipient"]["taxId"] = json!("04252011000110");
    body["recipient"]["legalName"] = json!("Cliente fornecedor");
    body["items"][0]["code"] = json!("RETURN-1");
    body["items"][0]["quantity"] = json!("2.0000");
    body["items"][0]["grossTotal"] = json!("2.00");
    body["productsTotal"] = json!("2.00");
    body["payments"][0]["amount"] = json!("2.00");
    let created = call(
        &router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        body.clone(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    let issued = call(
        &router,
        "POST",
        &format!("/api/v1/fiscal/nfe/{id}/issue"),
        "editor",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        Value::Null,
    )
    .await;
    assert_eq!(issued.2["status"], "authorized", "{}", issued.2);
    // A second full draft cannot create a second live NF-e for the same order.
    let duplicate = call(
        &router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        body,
    )
    .await;
    let duplicate_id = duplicate.2["data"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/fiscal/nfe/{duplicate_id}/issue"),
            "editor",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            Value::Null
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let cancelled = call(
        &router,
        "POST",
        &format!("/api/v1/orders/{order}/cancel-completed"),
        "editor",
        Some("\"3\""),
        Some(Uuid::now_v7()),
        super::returns_tests::reversal(),
    )
    .await;
    assert_eq!(cancelled.0, StatusCode::OK, "{}", cancelled.2);
    assert_eq!(
        cancelled.2["data"]["fiscalCancellation"]["status"],
        "pending"
    );
    let fiscal_before = call(
        &router,
        "GET",
        &format!("/api/v1/fiscal/nfe/{id}/emission"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(fiscal_before.2["status"], "authorized");
    assert_eq!(calls.lock().unwrap().len(), 2);
    let cancellation_id = cancelled.2["data"]["cancellationId"].as_str().unwrap();
    let uri = format!("/api/v1/fiscal/order-cancellations/{cancellation_id}/process");
    let key = Uuid::now_v7();
    let processed = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some(fiscal_before.1["etag"].to_str().unwrap()),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(processed.2["status"], "registered", "{}", processed.2);
    assert_eq!(
        processed.2["request"]["sourceCancellationId"],
        cancellation_id
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &uri,
            "editor",
            Some(fiscal_before.1["etag"].to_str().unwrap()),
            Some(key),
            Value::Null
        )
        .await
        .2,
        processed.2
    );
    assert_eq!(calls.lock().unwrap().len(), 3);
    let fiscal_after = call(
        &router,
        "GET",
        &format!("/api/v1/fiscal/nfe/{id}/emission"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(fiscal_after.2["status"], "cancelled");
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn emission_uncertain_event_recovers_authority_receipt_before_any_resend(admin: PgPool) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, tasks, calls) = services(&admin, application.clone(), "event-loss").await;
    let created = call(
        &router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        draft(),
    )
    .await;
    let id = created.2["data"]["id"].as_str().unwrap();
    let issued = call(
        &router,
        "POST",
        &format!("/api/v1/fiscal/nfe/{id}/issue"),
        "editor",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        Value::Null,
    )
    .await;
    assert_eq!(issued.2["status"], "authorized", "{}", issued.2);
    let uri = format!("/api/v1/fiscal/nfe/{id}/cancel");
    let key = Uuid::now_v7();
    let text = json!({"text":"  Cancelamento  registrado com  resposta perdida  "});
    let revision = issued.1["etag"].to_str().unwrap();
    let uncertain = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some(revision),
        Some(key),
        text.clone(),
    )
    .await;
    assert_eq!(uncertain.2["status"], "unknown", "{}", uncertain.2);
    let recovered = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some(revision),
        Some(key),
        text,
    )
    .await;
    assert_eq!(recovered.2["status"], "registered", "{}", recovered.2);
    assert_eq!(
        calls
            .lock()
            .unwrap()
            .iter()
            .map(|v| v.0.as_str())
            .collect::<Vec<_>>(),
        ["prepare", "authorize", "event", "consult"]
    );
    assert_eq!(
        calls
            .lock()
            .unwrap()
            .iter()
            .find(|call| call.0 == "event")
            .unwrap()
            .1["text"],
        "Cancelamento registrado com resposta perdida"
    );
    let fiscal = call(
        &router,
        "GET",
        &format!("/api/v1/fiscal/nfe/{id}/emission"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(fiscal.2["status"], "cancelled");
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}

async fn uncertain_authorization_preserves_business_identity(admin: PgPool, mode: &'static str) {
    let (_, application, auth, role) = setup(&admin).await;
    let (router, tasks, calls) = services(&admin, application.clone(), mode).await;
    super::returns_tests::seed(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','catalog.parties.read') ON CONFLICT DO NOTHING").execute(&admin).await.unwrap();
    let (order, _) = super::returns_tests::completed(&router).await;
    let mut body = draft();
    body["sourceOrderId"] = json!(order);
    body["recipient"]["taxId"] = json!("04252011000110");
    body["items"][0]["code"] = json!("RETURN-1");
    body["items"][0]["quantity"] = json!("2.0000");
    body["items"][0]["grossTotal"] = json!("2.00");
    body["productsTotal"] = json!("2.00");
    body["payments"][0]["amount"] = json!("2.00");
    let created = call(
        &router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        body.clone(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    let issued = call(
        &router,
        "POST",
        &format!("/api/v1/fiscal/nfe/{id}/issue"),
        "editor",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        Value::Null,
    )
    .await;
    assert_eq!(issued.2["status"], "unknown", "{}", issued.2);
    let second = call(
        &router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        body,
    )
    .await;
    let second_id = second.2["data"]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/fiscal/nfe/{second_id}/issue"),
            "editor",
            Some("\"1\""),
            Some(Uuid::now_v7()),
            Value::Null
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(calls.lock().unwrap().len(), 2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT next_number FROM fiscal_number_sequences")
            .fetch_one(&admin)
            .await
            .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM fiscal_nfe_documents WHERE authorized_xml IS NOT NULL"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, application, auth, &role).await;
}
#[sqlx::test(migrations = "../../migrations")]
async fn emission_protocol_digest_mismatch_stays_uncertain_and_blocks_duplicate_order(
    admin: PgPool,
) {
    uncertain_authorization_preserves_business_identity(admin, "digest-mismatch").await;
}
#[sqlx::test(migrations = "../../migrations")]
async fn emission_tampered_authorized_content_with_unchanged_digest_stays_uncertain(admin: PgPool) {
    uncertain_authorization_preserves_business_identity(admin, "content-mismatch").await;
}
#[sqlx::test(migrations = "../../migrations")]
async fn emission_sefaz_duplicate_stays_uncertain_and_cannot_allocate_a_second_number(
    admin: PgPool,
) {
    uncertain_authorization_preserves_business_identity(admin, "duplicate").await;
}
