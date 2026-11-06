use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
async fn call(
    router: &Router,
    method: &str,
    subject: &str,
    tenant: &str,
    path: &str,
    etag: Option<&str>,
) -> (StatusCode, Vec<u8>) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-tenant-id", tenant)
        .header("authorization", format!("Bearer {subject}"));
    if let Some(value) = etag {
        request = request.header("if-match", value);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 200_000)
        .await
        .unwrap()
        .to_vec();
    (status, body)
}

#[sqlx::test(migrations = "../../migrations")]
async fn files_are_filtered_tenant_scoped_downloaded_and_archived(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql(&format!("GRANT USAGE ON SCHEMA system_config TO {role}; GRANT EXECUTE ON FUNCTION system_config.has_permission(text) TO {role}; GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA system_config TO {role}; GRANT SELECT ON legacy_files,legacy_history TO {role};")).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES('99999999-9999-4999-8999-999999999999','system.files.read'),('99999999-9999-4999-8999-999999999999','system.files.manage')").execute(&admin).await.unwrap();
    sqlx::raw_sql("INSERT INTO legacy_history(tenant_id,id,collection,title,details) VALUES ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','files','Importado','{}'),('22222222-2222-4222-8222-222222222222','20000000-0000-4000-8000-000000000001','files','Outro','{}'); INSERT INTO legacy_files(tenant_id,id,history_id,filename,media_type,content,sha256) VALUES ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','nota.xml','application/xml',decode('3c612f3e','hex'),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),('22222222-2222-4222-8222-222222222222','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','outra.xml','application/xml',decode('3c622f3e','hex'),'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'); INSERT INTO system_config.files(tenant_id,id,storage_key,original_name,media_type,byte_size,sha256,status,created_by) SELECT tenant_id,'10000000-0000-4000-8000-000000000003','products/manual.pdf','manual.pdf','application/pdf',42,'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','available',identity_id FROM tenant_memberships WHERE tenant_id='11111111-1111-4111-8111-111111111111' ORDER BY identity_id LIMIT 1;").execute(&admin).await.unwrap();

    assert_eq!(
        call(
            &router,
            "GET",
            "reader",
            TENANT,
            "/api/v1/system/files",
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, body) = call(
        &router,
        "GET",
        "editor",
        TENANT,
        "/api/v1/system/files?q=.pdf",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["total"], 1);
    assert_eq!(payload["data"][0]["origin"], "system");
    let (_, all) = call(
        &router,
        "GET",
        "editor",
        TENANT,
        "/api/v1/system/files",
        None,
    )
    .await;
    let all: Value = serde_json::from_slice(&all).unwrap();
    assert_eq!(all["total"], 2);
    assert!(
        !all["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["filename"] == "outra.xml")
    );
    let (status, content) = call(
        &router,
        "GET",
        "editor",
        TENANT,
        "/api/v1/system/files/10000000-0000-4000-8000-000000000002/content",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content, b"<a/>");
    assert_eq!(
        call(
            &router,
            "GET",
            "editor",
            TENANT,
            "/api/v1/system/files/20000000-0000-4000-8000-000000000002/content",
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
            "editor",
            TENANT,
            "/api/v1/system/files/10000000-0000-4000-8000-000000000003/archive",
            None
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let (status, archived) = call(
        &router,
        "POST",
        "editor",
        TENANT,
        "/api/v1/system/files/10000000-0000-4000-8000-000000000003/archive",
        Some("\"1\""),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let archived: Value = serde_json::from_slice(&archived).unwrap();
    assert_eq!(archived["data"]["status"], "archived");
    assert_eq!(archived["data"]["revision"], 2);
    assert_eq!(
        call(
            &router,
            "POST",
            "editor",
            TENANT,
            "/api/v1/system/files/10000000-0000-4000-8000-000000000003/archive",
            Some("\"1\"")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let audit: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE tenant_id=$1 AND action='system.file.archived'",
    )
    .bind(TENANT.parse::<uuid::Uuid>().unwrap())
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(audit, 1);
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
