use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
    routing::get,
};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tower::ServiceExt;
use uuid::Uuid;

use crate::platform::{auth::AuthClient, state::AppState};

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT: &str = "22222222-2222-4222-8222-222222222222";

fn company() -> Value {
    json!({
        "legalName": "Indústria de Teste", "tradeName": "Teste", "personType": "juridica",
        "taxId": "04.252.011/0001-10", "taxRegime": "simples", "segments": ["Indústria"],
        "postalCode": "01001-000", "state": "SP", "city": "São Paulo", "street": "Praça de Teste",
        "number": "1", "district": "Centro", "email": "teste@example.test",
        "substituteRegistrations": [{"state":"MG", "value":"ISENTO"}]
    })
}

pub(super) async fn setup(admin: &PgPool) -> (Router, PgPool, tokio::task::JoinHandle<()>, String) {
    setup_with_danfe(admin, None).await
}

pub(super) async fn setup_with_danfe(
    admin: &PgPool,
    danfe: Option<crate::domains::fiscal::danfe_client::DanfeClient>,
) -> (Router, PgPool, tokio::task::JoinHandle<()>, String) {
    sqlx::raw_sql(r#"
        INSERT INTO tenants (id, legal_name, tax_id) VALUES
          ('11111111-1111-4111-8111-111111111111', 'Empresa A', '04252011000110'),
          ('22222222-2222-4222-8222-222222222222', 'Empresa B', '52998224725');
        INSERT INTO identities (id, auth_subject, email, display_name) VALUES
          ('33333333-3333-4333-8333-333333333333', 'editor', 'editor@example.test', 'Editor'),
          ('44444444-4444-4444-8444-444444444444', 'reader', 'reader@example.test', 'Leitor'),
          ('55555555-5555-4555-8555-555555555555', 'disabled', 'disabled@example.test', 'Bloqueado');
        INSERT INTO tenant_memberships (id, tenant_id, identity_id, status) VALUES
          ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'active'),
          ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'active'),
          ('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555', 'disabled');
        INSERT INTO roles (id, tenant_id, code, name) VALUES
          ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111', 'editor', 'Editor'),
          ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'reader', 'Leitor');
        INSERT INTO role_permissions (role_id, permission_code) VALUES
          ('99999999-9999-4999-8999-999999999999', 'platform.company.read'),
          ('99999999-9999-4999-8999-999999999999', 'platform.company.manage'),
          ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'platform.company.read');
        INSERT INTO membership_roles (membership_id, role_id) VALUES
          ('66666666-6666-4666-8666-666666666666', '99999999-9999-4999-8999-999999999999'),
          ('77777777-7777-4777-8777-777777777777', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
          ('88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999');
    "#).execute(admin).await.unwrap();
    let role = format!("erp_test_{}", Uuid::now_v7().simple());
    sqlx::raw_sql(&format!("CREATE ROLE {role} NOLOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO {role}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role};"))
        .execute(admin).await.unwrap();
    let role_for_connection = role.clone();
    let application = PgPoolOptions::new()
        .max_connections(4)
        .after_connect(move |connection, _| {
            let command = format!("SET ROLE {role_for_connection}");
            Box::pin(async move {
                sqlx::query(&command).execute(connection).await?;
                Ok(())
            })
        })
        .connect_with(admin.connect_options().as_ref().clone())
        .await
        .unwrap();
    assert!(
        !sqlx::query_scalar::<_, bool>(
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"
        )
        .fetch_one(&application)
        .await
        .unwrap()
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, Router::new().route("/userinfo", get(|headers: HeaderMap| async move {
            let subject = headers.get("authorization").and_then(|h| h.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
            if !["editor", "reader", "disabled"].contains(&subject) { return Err(StatusCode::UNAUTHORIZED); }
            Ok(axum::Json(json!({"sub":subject,"email":format!("{subject}@example.test"),"name":subject})))
        }))).await.unwrap();
    });
    let router = super::router(
        AppState::new(
            application.clone(),
            AuthClient::new(format!("http://{address}/userinfo")),
        )
        .with_danfe(danfe),
    );
    (router, application, server, role)
}

async fn call(
    router: &Router,
    method: &str,
    tenant: &str,
    subject: &str,
    etag: Option<&str>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri("/api/v1/company")
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(etag) = etag {
        request = request.header("if-match", etag);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    let value = serde_json::from_slice(&to_bytes(body, 100_000).await.unwrap()).unwrap();
    (parts.status, parts.headers, value)
}

pub(super) async fn cleanup(
    admin: &PgPool,
    application: PgPool,
    server: tokio::task::JoinHandle<()>,
    role: &str,
) {
    server.abort();
    application.close().await;
    sqlx::raw_sql(&format!("DROP OWNED BY {role}; DROP ROLE {role};"))
        .execute(admin)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "../../migrations")]
async fn company_persists_and_enforces_permissions_and_tenant_isolation(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    let (status, headers, initial) =
        call(&router, "GET", TENANT, "editor", None, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(initial["revision"], 0);
    assert_eq!(headers["etag"], "\"0\"");
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(
        call(&router, "GET", TENANT, "", None, Value::Null).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&router, "GET", OTHER_TENANT, "editor", None, Value::Null)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&router, "GET", TENANT, "disabled", None, Value::Null)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&router, "PUT", TENANT, "reader", Some("\"0\""), company())
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&router, "PUT", TENANT, "editor", None, company())
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let mut invalid = company();
    invalid["taxId"] = json!("00000000000000");
    assert_eq!(
        call(&router, "PUT", TENANT, "editor", Some("\"0\""), invalid)
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut unknown = company();
    unknown["tenantId"] = json!(OTHER_TENANT);
    assert_eq!(
        call(&router, "PUT", TENANT, "editor", Some("\"0\""), unknown)
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, saved_headers, saved) =
        call(&router, "PUT", TENANT, "editor", Some("\"0\""), company()).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved_headers["etag"], "\"1\"");
    assert_eq!(saved["data"]["taxId"], "04252011000110");
    assert_eq!(saved["data"]["postalCode"], "01001000");
    let reread = call(&router, "GET", TENANT, "reader", None, Value::Null)
        .await
        .2;
    assert_eq!(reread["data"], saved["data"]);
    assert_eq!(reread["canEdit"], false);
    assert_eq!(
        call(&router, "PUT", TENANT, "editor", Some("\"0\""), company())
            .await
            .0,
        StatusCode::PRECONDITION_FAILED
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox_events")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    let audit: Value = sqlx::query_scalar("SELECT details FROM audit_log")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(audit, json!({"previousRevision":0,"revision":1}));
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT legal_name FROM tenants WHERE id = $1::uuid")
            .bind(OTHER_TENANT)
            .fetch_one(&admin)
            .await
            .unwrap(),
        "Empresa B"
    );
    // No context: a non-superuser connection sees no enterprise rows.
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tenants")
            .fetch_one(&application)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM company_profiles")
            .fetch_one(&application)
            .await
            .unwrap(),
        0
    );
    assert!(
        sqlx::query("UPDATE audit_log SET action = 'tampered'")
            .execute(&admin)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM audit_log")
            .execute(&admin)
            .await
            .is_err()
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn concurrent_company_updates_and_failed_outbox_do_not_leave_partial_writes(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    let mut second = company();
    second["tradeName"] = json!("Outra edição");
    let (a, b) = tokio::join!(
        call(&router, "PUT", TENANT, "editor", Some("\"0\""), company()),
        call(&router, "PUT", TENANT, "editor", Some("\"0\""), second)
    );
    let mut statuses = vec![a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, vec![200, 412]);
    let previous = call(&router, "GET", TENANT, "editor", None, Value::Null)
        .await
        .2;
    sqlx::raw_sql("CREATE FUNCTION fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test outbox failure'; END $$; CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_outbox();")
        .execute(&admin).await.unwrap();
    let mut changed = company();
    changed["legalName"] = json!("Não deve persistir");
    assert_eq!(
        call(&router, "PUT", TENANT, "editor", Some("\"1\""), changed)
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        call(&router, "GET", TENANT, "editor", None, Value::Null)
            .await
            .2,
        previous
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox_events")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn waiting_company_write_rechecks_permissions_after_access_revocation(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    let mut revocation = admin.begin().await.unwrap();
    sqlx::query("SELECT id FROM tenants WHERE id=$1::uuid FOR UPDATE")
        .bind(TENANT)
        .execute(&mut *revocation)
        .await
        .unwrap();
    let writer = tokio::spawn(async move {
        call(&router, "PUT", TENANT, "editor", Some("\"0\""), company()).await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT id FROM tenants WHERE id = $1 FOR UPDATE')")
                .fetch_one(&admin).await.unwrap();
            if waiting { break; }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("company write must wait for the tenant lock");
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='platform.company.manage'")
        .execute(&mut *revocation).await.unwrap();
    revocation.commit().await.unwrap();
    assert_eq!(writer.await.unwrap().0, StatusCode::FORBIDDEN);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM company_profiles")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, application, server, &role).await;
}
