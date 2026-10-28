use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const EDITOR: &str = "66666666-6666-4666-8666-666666666666";
const READER: &str = "77777777-7777-4777-8777-777777777777";
const EDITOR_ROLE: &str = "99999999-9999-4999-8999-999999999999";
const READER_ROLE: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async fn setup(admin: &PgPool) -> (Router, PgPool, tokio::task::JoinHandle<()>, String) {
    let result = super::company_tests::setup(admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions (role_id, permission_code) SELECT '99999999-9999-4999-8999-999999999999', code FROM permissions ON CONFLICT DO NOTHING; INSERT INTO role_permissions (role_id, permission_code) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','platform.users.read'), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','platform.roles.read') ON CONFLICT DO NOTHING;")
        .execute(admin).await.unwrap();
    result
}

async fn call(
    router: &Router,
    method: &str,
    path: &str,
    actor: &str,
    revision: Option<&str>,
    command: Option<Uuid>,
    data: Value,
) -> (u16, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json");
    if !actor.is_empty() {
        request = request.header("authorization", format!("Bearer {actor}"));
    }
    if let Some(revision) = revision {
        request = request.header("if-match", revision);
    }
    if let Some(key) = command {
        request = request.header("idempotency-key", key.to_string());
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(data.to_string())).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    let bytes = to_bytes(body, 100_000).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (parts.status.as_u16(), parts.headers, value)
}

fn role_input(code: &str) -> Value {
    json!({"code":code,"name":"Consulta comercial","description":"Papel de teste","permissions":["platform.company.read"]})
}

#[sqlx::test(migrations = "../../migrations")]
async fn pending_membership_cannot_bypass_auth_confirmation_through_blocking(admin: PgPool) {
    let (router, pool, server, role) = setup(&admin).await;
    let id = "88888888-8888-4888-8888-888888888888";
    sqlx::query("UPDATE tenant_memberships SET status = 'invited' WHERE id = $1::uuid")
        .bind(id)
        .execute(&admin)
        .await
        .unwrap();
    let path = format!("/api/v1/users/{id}");
    for status in ["active", "blocked"] {
        assert_eq!(
            call(
                &router,
                "PUT",
                &path,
                "editor",
                Some("\"1\""),
                None,
                json!({"status":status,"roleIds":[READER_ROLE]})
            )
            .await
            .0,
            409
        );
    }
    let updated = call(
        &router,
        "PUT",
        &path,
        "editor",
        Some("\"1\""),
        None,
        json!({"status":"pending","roleIds":[READER_ROLE]}),
    )
    .await;
    assert_eq!(updated.0, 200);
    assert_eq!(updated.2["status"], "pending");
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/me",
            "disabled",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        403
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM tenant_memberships WHERE id=$1::uuid")
            .bind(id)
            .fetch_one(&admin)
            .await
            .unwrap(),
        "invited"
    );
    super::company_tests::cleanup(&admin, pool, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn role_commands_are_authorized_revisioned_idempotent_and_audited(admin: PgPool) {
    let (router, pool, server, role) = setup(&admin).await;
    let key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/roles",
            "editor",
            None,
            None,
            role_input("consulta")
        )
        .await
        .0,
        428
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/roles",
            "reader",
            None,
            Some(key),
            role_input("consulta")
        )
        .await
        .0,
        403
    );
    let (status, headers, created) = call(
        &router,
        "POST",
        "/api/v1/roles",
        "editor",
        None,
        Some(key),
        role_input("consulta"),
    )
    .await;
    assert_eq!(status, 201, "{created}");
    assert_eq!(headers["etag"], "\"1\"");
    let id = created["id"].as_str().unwrap();
    let path = format!("/api/v1/roles/{id}");
    let replay = call(
        &router,
        "POST",
        "/api/v1/roles",
        "editor",
        None,
        Some(key),
        role_input("consulta"),
    )
    .await;
    assert_eq!(replay.0, 201);
    assert_eq!(replay.2, created);
    assert_eq!(replay.1["idempotency-replayed"], "true");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/roles",
            "editor",
            None,
            Some(key),
            role_input("outro")
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/roles",
            "editor",
            None,
            Some(Uuid::now_v7()),
            role_input("consulta")
        )
        .await
        .0,
        409
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM role_creation_commands")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    let mut updated = role_input("consulta");
    updated["name"] = json!("Consulta atualizada");
    let saved = call(
        &router,
        "PUT",
        &path,
        "editor",
        Some("\"1\""),
        None,
        updated.clone(),
    )
    .await;
    assert_eq!(saved.0, 200, "{}", saved.2);
    assert_eq!(saved.1["etag"], "\"2\"");
    assert_eq!(
        call(
            &router,
            "PUT",
            &path,
            "editor",
            Some("\"1\""),
            None,
            updated
        )
        .await
        .0,
        412
    );
    assert_eq!(
        call(
            &router,
            "DELETE",
            &path,
            "editor",
            Some("\"2\""),
            None,
            Value::Null
        )
        .await
        .0,
        204
    );
    assert_eq!(
        call(&router, "GET", &path, "editor", None, None, Value::Null)
            .await
            .0,
        404
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        3
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox_events")
            .fetch_one(&admin)
            .await
            .unwrap(),
        3
    );
    super::company_tests::cleanup(&admin, pool, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn member_updates_cannot_block_self_remove_last_admin_or_grant_foreign_roles(admin: PgPool) {
    let (router, pool, server, role) = setup(&admin).await;
    let own_path = format!("/api/v1/users/{EDITOR}");
    let reader_path = format!("/api/v1/users/{READER}");
    let read = call(
        &router,
        "GET",
        &reader_path,
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(read.0, 200);
    assert_eq!(read.1["etag"], "\"1\"");
    assert_eq!(
        call(
            &router,
            "PUT",
            &own_path,
            "editor",
            Some("\"1\""),
            None,
            json!({"status":"blocked","roleIds":[EDITOR_ROLE]})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &own_path,
            "editor",
            Some("\"1\""),
            None,
            json!({"status":"active","roleIds":[READER_ROLE]})
        )
        .await
        .0,
        409
    );
    assert_eq!(
        call(
            &router,
            "DELETE",
            &format!("/api/v1/roles/{EDITOR_ROLE}"),
            "editor",
            Some("\"1\""),
            None,
            Value::Null
        )
        .await
        .0,
        409
    );
    let foreign = Uuid::now_v7();
    sqlx::query("INSERT INTO roles (id,tenant_id,code,name) VALUES ($1,'22222222-2222-4222-8222-222222222222','foreign','Outra empresa')").bind(foreign).execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/v1/roles/{foreign}"),
            "editor",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        404
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &reader_path,
            "editor",
            Some("\"1\""),
            None,
            json!({"status":"active","roleIds":[foreign]})
        )
        .await
        .0,
        404
    );
    let saved = call(
        &router,
        "PUT",
        &reader_path,
        "editor",
        Some("\"1\""),
        None,
        json!({"status":"blocked","roleIds":[READER_ROLE]}),
    )
    .await;
    assert_eq!(saved.0, 200, "{}", saved.2);
    assert_eq!(saved.2["status"], "blocked");
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/me",
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        403
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &reader_path,
            "editor",
            Some("\"1\""),
            None,
            json!({"status":"active","roleIds":[READER_ROLE]})
        )
        .await
        .0,
        412
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &reader_path,
            "editor",
            Some("\"2\""),
            None,
            json!({"status":"active","roleIds":[READER_ROLE]})
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/me",
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        200
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        2
    );
    super::company_tests::cleanup(&admin, pool, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn delegation_and_permission_dependencies_are_enforced(admin: PgPool) {
    let (router, pool, server, role) = setup(&admin).await;
    let mut invalid = role_input("invalid");
    invalid["permissions"] = json!(["platform.company.manage"]);
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/roles",
            "editor",
            None,
            Some(Uuid::now_v7()),
            invalid
        )
        .await
        .0,
        422
    );
    sqlx::raw_sql("UPDATE tenant_memberships SET status='active' WHERE id='88888888-8888-4888-8888-888888888888'; DELETE FROM membership_roles WHERE membership_id='88888888-8888-4888-8888-888888888888'; INSERT INTO roles (id,tenant_id,code,name) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','limited','Gestor limitado'); INSERT INTO role_permissions (role_id,permission_code) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','platform.users.read'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','platform.users.manage'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','platform.roles.read'); INSERT INTO membership_roles VALUES ('88888888-8888-4888-8888-888888888888','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');").execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "PUT",
            &format!("/api/v1/users/{READER}"),
            "disabled",
            Some("\"1\""),
            None,
            json!({"status":"active","roleIds":[EDITOR_ROLE]})
        )
        .await
        .0,
        403
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &format!("/api/v1/users/{EDITOR}"),
            "disabled",
            Some("\"1\""),
            None,
            json!({"status":"blocked","roleIds":[]})
        )
        .await
        .0,
        403
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    super::company_tests::cleanup(&admin, pool, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn concurrent_admin_demotions_keep_an_administrator_and_outbox_failure_rolls_back(
    admin: PgPool,
) {
    let (router, pool, server, role) = setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions (role_id,permission_code) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',code FROM permissions ON CONFLICT DO NOTHING;").execute(&admin).await.unwrap();
    let a_path = format!("/api/v1/roles/{EDITOR_ROLE}");
    let b_path = format!("/api/v1/roles/{READER_ROLE}");
    let (a, b) = tokio::join!(
        call(
            &router,
            "PUT",
            &a_path,
            "editor",
            Some("\"1\""),
            None,
            role_input("editor")
        ),
        call(
            &router,
            "PUT",
            &b_path,
            "reader",
            Some("\"1\""),
            None,
            role_input("reader")
        )
    );
    let mut codes = vec![a.0, b.0];
    codes.sort();
    assert_eq!(codes, vec![200, 409]);
    let remaining = if a.0 == 200 { "reader" } else { "editor" };
    let audit_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
        .fetch_one(&admin)
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION fail_access_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test outbox failure'; END $$; CREATE TRIGGER fail_access_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_access_outbox();").execute(&admin).await.unwrap();
    let failed = call(
        &router,
        "POST",
        "/api/v1/roles",
        remaining,
        None,
        Some(Uuid::now_v7()),
        role_input("must-rollback"),
    )
    .await;
    assert_eq!(failed.0, 500, "{}", failed.2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM roles WHERE code='must-rollback'")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM role_creation_commands")
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
        audit_count
    );
    super::company_tests::cleanup(&admin, pool, server, &role).await;
}
