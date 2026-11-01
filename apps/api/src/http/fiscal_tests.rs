use super::company_tests::{cleanup, setup};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

struct Call<'a> {
    method: &'a str,
    uri: &'a str,
    tenant: &'a str,
    subject: &'a str,
    revision: Option<&'a str>,
    key: Option<Uuid>,
    body: Value,
}
impl<'a> Call<'a> {
    fn new(method: &'a str, uri: &'a str, body: Value) -> Self {
        Self {
            method,
            uri,
            tenant: TENANT,
            subject: "editor",
            revision: None,
            key: None,
            body,
        }
    }
    async fn send(self, router: &Router) -> (StatusCode, HeaderMap, Value) {
        let mut request = Request::builder()
            .method(self.method)
            .uri(self.uri)
            .header("x-tenant-id", self.tenant)
            .header("content-type", "application/json");
        if !self.subject.is_empty() {
            request = request.header("authorization", format!("Bearer {}", self.subject));
        }
        if let Some(value) = self.revision {
            request = request.header("if-match", value);
        }
        if let Some(value) = self.key {
            request = request.header("idempotency-key", value.to_string());
        }
        let reply = router
            .clone()
            .oneshot(request.body(Body::from(self.body.to_string())).unwrap())
            .await
            .unwrap();
        let (parts, body) = reply.into_parts();
        let data = to_bytes(body, 2_000_000).await.unwrap();
        (
            parts.status,
            parts.headers,
            serde_json::from_slice(&data).unwrap_or(Value::Null),
        )
    }
}

async fn seed(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'fiscal.%'; INSERT INTO role_permissions(role_id,permission_code) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fiscal.config.read'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fiscal.nfe.read');")
        .execute(admin).await.unwrap();
    sqlx::query("INSERT INTO company_profiles(tenant_id,revision,details) VALUES($1,1,$2)")
        .bind(Uuid::parse_str(TENANT).unwrap()).bind(json!({"legalName":"Empresa de teste","personType":"juridica","taxId":"04252011000110","taxRegime":"simples","stateRegistration":"110042490114","segments":["Indústria"],"postalCode":"01001000","state":"SP","city":"São Paulo","street":"Rua de teste","number":"1","district":"Centro"})).execute(admin).await.unwrap();
}
fn profile() -> Value {
    json!({"environment":"homologation","state":"SP","municipalityCode":"3550308","stateRegistration":"110042490114","crt":1,"series":1,"certificateReference":"fixture-a1"})
}
fn draft() -> Value {
    json!({"environment":"homologation","model":55,"operationNature":"Venda de teste","taxRuleReference":"fixture-instruction-not-a-real-tax-approval","recipient":{"taxId":"52998224725","legalName":"Destinatário de teste","state":"SP","municipalityCode":"3550308","postalCode":"01001000","street":"Rua de teste","number":"1","district":"Centro"},"items":[{"code":"TEST","description":"Produto de teste","unit":"UN","ncm":"00000000","cfop":"5102","quantity":"3.0000","unitPrice":"0.3333333333","grossTotal":"1.00","origin":0,"icmsCst":null,"csosn":"102","pisCst":"07","cofinsCst":"07"}],"productsTotal":"1.00"})
}
async fn configure(router: &Router) {
    let mut call = Call::new("PUT", "/api/v1/fiscal/config", profile());
    call.revision = Some("\"0\"");
    let reply = call.send(router).await;
    assert_eq!(reply.0, StatusCode::OK, "{}", reply.2);
    assert_eq!(reply.2["certificateVerified"], false);
}
async fn create(router: &Router, key: Uuid, body: Value) -> (StatusCode, HeaderMap, Value) {
    let mut call = Call::new("POST", "/api/v1/fiscal/nfe", body);
    call.key = Some(key);
    call.send(router).await
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_configuration_enforces_permissions_revisions_and_no_secret_payloads(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let initial = Call::new("GET", "/api/v1/fiscal/config", Value::Null)
        .send(&router)
        .await;
    assert_eq!(initial.1["etag"], "\"0\"");
    assert!(initial.2["data"].is_null());
    let mut call = Call::new("PUT", "/api/v1/fiscal/config", profile());
    call.subject = "reader";
    call.revision = Some("\"0\"");
    assert_eq!(call.send(&router).await.0, StatusCode::FORBIDDEN);
    let mut call = Call::new("GET", "/api/v1/fiscal/config", Value::Null);
    call.subject = "";
    assert_eq!(call.send(&router).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(
        Call::new("PUT", "/api/v1/fiscal/config", profile())
            .send(&router)
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let mut invalid = profile();
    invalid["environment"] = json!("production");
    let mut call = Call::new("PUT", "/api/v1/fiscal/config", invalid);
    call.revision = Some("\"0\"");
    assert_eq!(call.send(&router).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    let mut invalid = profile();
    invalid["certificatePassword"] = json!("synthetic-rejected-secret");
    let mut call = Call::new("PUT", "/api/v1/fiscal/config", invalid);
    call.revision = Some("\"0\"");
    let rejected = call.send(&router).await;
    assert_eq!(rejected.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(!rejected.2.to_string().contains("synthetic-rejected-secret"));
    configure(&router).await;
    let mut call = Call::new("PUT", "/api/v1/fiscal/config", profile());
    call.revision = Some("\"0\"");
    assert_eq!(call.send(&router).await.0, StatusCode::PRECONDITION_FAILED);
    let mut invalid = profile();
    invalid["crt"] = json!(3);
    let mut call = Call::new("PUT", "/api/v1/fiscal/config", invalid);
    call.revision = Some("\"1\"");
    assert_eq!(call.send(&router).await.0, StatusCode::CONFLICT);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='fiscal.profile.updated'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        1
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_draft_creation_is_idempotent_and_atomic_with_audit_and_outbox(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    assert_eq!(
        create(&router, Uuid::now_v7(), draft()).await.0,
        StatusCode::CONFLICT
    );
    configure(&router).await;
    assert_eq!(
        Call::new("POST", "/api/v1/fiscal/nfe", draft())
            .send(&router)
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let key = Uuid::now_v7();
    let (a, b) = tokio::join!(create(&router, key, draft()), create(&router, key, draft()));
    assert_eq!(a.0, StatusCode::CREATED, "{}", a.2);
    assert_eq!(b.0, StatusCode::CREATED, "{}", b.2);
    assert_eq!(a.2, b.2);
    assert!(a.1.contains_key("idempotency-replayed") || b.1.contains_key("idempotency-replayed"));
    assert_eq!(a.2["data"]["status"], "draft");
    assert_eq!(a.2["data"]["fiscalValidationComplete"], false);
    assert_eq!(a.2["data"]["productsTotal"], "1.00");
    let mut changed = draft();
    changed["operationNature"] = json!("Outra operação");
    assert_eq!(create(&router, key, changed).await.0, StatusCode::CONFLICT);
    for table in ["fiscal_nfe_drafts", "domain_commands"] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            1
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='fiscal.nfe.draft.created'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM outbox_events WHERE event_type='fiscal.nfe.draft.created'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        1
    );
    // A failed outbox write rolls the draft and its command back as well.
    sqlx::raw_sql("CREATE FUNCTION fiscal_test_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='fiscal.nfe.draft.created' THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fiscal_test_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fiscal_test_reject_outbox();").execute(&admin).await.unwrap();
    assert_eq!(
        create(&router, Uuid::now_v7(), draft()).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_nfe_drafts")
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
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_draft_updates_preserve_snapshots_and_detect_concurrent_edits(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    configure(&router).await;
    let key = Uuid::now_v7();
    let created = create(&router, key, draft()).await;
    let uri = format!(
        "/api/v1/fiscal/nfe/{}",
        created.2["data"]["id"].as_str().unwrap()
    );
    let mut call = Call::new("PUT", "/api/v1/fiscal/config", profile());
    call.revision = Some("\"1\"");
    assert_eq!(call.send(&router).await.0, StatusCode::OK);
    let before = Call::new("GET", &uri, Value::Null).send(&router).await;
    assert_eq!(before.2["data"]["issuer"]["profileRevision"], 1);
    // Replaying a creation still returns its original snapshot after configuration changes.
    assert_eq!(create(&router, key, draft()).await.2, created.2);
    let mut first = Call::new("PUT", &uri, draft());
    first.revision = Some("\"1\"");
    let mut second = Call::new("PUT", &uri, draft());
    second.revision = Some("\"1\"");
    let (a, b) = tokio::join!(first.send(&router), second.send(&router));
    assert!([a.0, b.0].contains(&StatusCode::OK));
    assert!([a.0, b.0].contains(&StatusCode::PRECONDITION_FAILED));
    let after = Call::new("GET", &uri, Value::Null).send(&router).await;
    assert_eq!(after.2["data"]["revision"], 2);
    assert_eq!(after.2["data"]["issuer"]["profileRevision"], 2);
    let page = Call::new("GET", "/api/v1/fiscal/nfe?limit=1", Value::Null)
        .send(&router)
        .await;
    assert_eq!(page.2["data"].as_array().unwrap().len(), 1);
    assert!(page.2["nextCursor"].is_null());
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_tables_and_routes_isolate_tenants_and_refuse_invalid_drafts(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    configure(&router).await;
    let mut invalid = draft();
    invalid["productsTotal"] = json!("0.99");
    assert_eq!(
        create(&router, Uuid::now_v7(), invalid).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut invalid = draft();
    invalid["items"][0]["csosn"] = json!("999");
    assert_eq!(
        create(&router, Uuid::now_v7(), invalid).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut invalid = draft();
    invalid["items"][0]["unitPrice"] = json!(0.33);
    assert_eq!(
        create(&router, Uuid::now_v7(), invalid).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let created = create(&router, Uuid::now_v7(), draft()).await;
    let id = created.2["data"]["id"].as_str().unwrap();
    sqlx::raw_sql("INSERT INTO tenant_memberships(id,tenant_id,identity_id,status) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','active'); INSERT INTO roles(id,tenant_id,code,name) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','fiscal-reader','Fiscal reader'); INSERT INTO role_permissions(role_id,permission_code) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','fiscal.nfe.read'); INSERT INTO membership_roles(membership_id,role_id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc');").execute(&admin).await.unwrap();
    let uri = format!("/api/v1/fiscal/nfe/{id}");
    let mut call = Call::new("GET", &uri, Value::Null);
    call.tenant = OTHER;
    assert_eq!(call.send(&router).await.0, StatusCode::NOT_FOUND);
    let mut call = Call::new("GET", "/api/v1/fiscal/nfe", Value::Null);
    call.tenant = OTHER;
    assert_eq!(call.send(&router).await.2["data"], json!([]));
    let mut tx = app.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(OTHER)
        .execute(&mut *tx)
        .await
        .unwrap();
    for table in ["fiscal_profiles", "fiscal_nfe_drafts"] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&mut *tx)
                .await
                .unwrap(),
            0
        );
    }
    assert!(sqlx::query("INSERT INTO fiscal_profiles(tenant_id,revision,environment,details) VALUES($1,1,'homologation','{}')").bind(Uuid::parse_str(TENANT).unwrap()).execute(&mut *tx).await.is_err());
    tx.rollback().await.unwrap();
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_emission_guard_never_numbers_queues_or_transmits_a_draft(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    configure(&router).await;
    let ready = Call::new("GET", "/api/v1/fiscal/readiness", Value::Null)
        .send(&router)
        .await;
    assert_eq!(ready.2["canTransmit"], false);
    assert_eq!(ready.2["productionEnabled"], false);
    assert_eq!(ready.2["certificateVerified"], false);
    assert_eq!(
        ready.2["blockers"],
        json!([
            "fiscal_engine_not_configured",
            "a1_certificate_missing_expired_or_unavailable"
        ])
    );
    let created = create(&router, Uuid::now_v7(), draft()).await;
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/fiscal/nfe/{id}/issue");
    let mut reader = Call::new("POST", &uri, Value::Null);
    reader.subject = "reader";
    reader.revision = Some("\"1\"");
    reader.key = Some(Uuid::now_v7());
    assert_eq!(reader.send(&router).await.0, StatusCode::FORBIDDEN);
    let key = Uuid::now_v7();
    for _ in 0..2 {
        let mut call = Call::new("POST", &uri, Value::Null);
        call.revision = Some("\"1\"");
        call.key = Some(key);
        let result = call.send(&router).await;
        assert_eq!(result.0, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(result.1["cache-control"], "no-store");
        assert_eq!(result.1["content-type"], "application/problem+json");
        assert_eq!(result.2["productionEnabled"], false);
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM outbox_events WHERE event_type LIKE 'fiscal.%'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        2
    );
    let uri = format!("/api/v1/fiscal/nfe/{id}");
    let after = Call::new("GET", &uri, Value::Null).send(&router).await;
    assert_eq!(after.2, created.2);
    assert!(after.2["data"].get("protocol").is_none());
    assert!(after.2["data"].get("number").is_none());
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_request_limits_and_revoked_permissions_are_enforced(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    configure(&router).await;
    let mut huge = draft();
    huge["operationNature"] = json!("X".repeat(1_048_576));
    assert_eq!(
        create(&router, Uuid::now_v7(), huge).await.0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='fiscal.nfe.manage'").execute(&admin).await.unwrap();
    assert_eq!(
        create(&router, Uuid::now_v7(), draft()).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_nfe_drafts")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, app, server, &role).await;
}
