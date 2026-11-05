use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
async fn call(
    router: &Router,
    method: &str,
    path: &str,
    subject: &str,
    tenant: &str,
    revision: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .header("x-tenant-id", tenant);
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(revision) = revision {
        request = request.header("if-match", revision);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    (
        response.status(),
        serde_json::from_slice(&to_bytes(response.into_body(), 1_000_000).await.unwrap()).unwrap(),
    )
}
async fn seed(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code IN ('fiscal.config.read','fiscal.config.manage','fiscal.nfe.read'); INSERT INTO role_permissions(role_id,permission_code) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fiscal.config.read'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fiscal.nfe.read');").execute(admin).await.unwrap();
}
#[sqlx::test(migrations = "../../migrations")]
async fn nfce_settings_encrypt_csc_and_preserve_tenant_revision_and_environment(admin: PgPool) {
    let vault = crate::domains::fiscal::certificate_crypto::tests::vault();
    let (router, application, server, role) =
        super::company_tests::setup_with_certificates(&admin, vault.clone()).await;
    seed(&admin).await;
    let path = "/api/v1/fiscal/settings/nfce";
    let value = json!({"environment":"production","state":"SP","series":2,"nextNumber":145,"cscId":"000001","csc":"12345678-1234-1234-1234-123456789ABC"});
    assert_eq!(
        call(&router, "GET", path, "editor", TENANT, None, Value::Null)
            .await
            .1["data"],
        Value::Null
    );
    assert_eq!(
        call(&router, "PUT", path, "editor", TENANT, None, value.clone())
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            path,
            "reader",
            TENANT,
            Some("\"1\""),
            value.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "GET",
            path,
            "editor",
            "22222222-2222-4222-8222-222222222222",
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, saved) = call(
        &router,
        "PUT",
        path,
        "editor",
        TENANT,
        Some("\"1\""),
        value.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["data"]["environment"], "production");
    assert_eq!(saved["data"]["cscConfigured"], true);
    assert!(!saved.to_string().contains("12345678-1234"));
    let (context,key_id,nonce,ciphertext):(String,String,Vec<u8>,Vec<u8>)=sqlx::query_as("SELECT secret_context,secret_key_id,secret_nonce,secret_ciphertext FROM fiscal_preferences WHERE section='nfce'").fetch_one(&admin).await.unwrap();
    let sealed = crate::domains::fiscal::certificate_crypto::SealedCertificate {
        key_id,
        nonce,
        ciphertext,
    };
    assert_eq!(
        &*vault.open_settings_secret(&context, &sealed).unwrap(),
        value["csc"].as_str().unwrap().as_bytes()
    );
    assert!(
        vault
            .open_settings_secret(&context.replace("production", "homologation"), &sealed)
            .is_err()
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            path,
            "editor",
            TENANT,
            Some("\"1\""),
            value.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let mut update = value.clone();
    update.as_object_mut().unwrap().remove("csc");
    update["nextNumber"] = json!(146);
    assert_eq!(
        call(
            &router,
            "PUT",
            path,
            "editor",
            TENANT,
            Some("\"2\""),
            update.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    update["environment"] = json!("homologation");
    assert_eq!(
        call(
            &router,
            "PUT",
            path,
            "editor",
            TENANT,
            Some("\"3\""),
            update
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM fiscal_nfe_documents")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let logs:String=sqlx::query_scalar("SELECT coalesce(jsonb_agg(details)::text,'') FROM audit_log WHERE action='fiscal.preferences.updated'").fetch_one(&admin).await.unwrap();
    assert!(!logs.contains("12345678-1234"));
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
#[sqlx::test(migrations = "../../migrations")]
async fn operation_natures_validate_cfop_duplicates_and_isolate_real_event_pages(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    seed(&admin).await;
    let path = "/api/v1/fiscal/settings/operation-natures";
    let nature = json!({"id":"77777777-2222-4222-8222-222222222222","code":"VENDA","name":"Venda de produção","direction":"outgoing","purpose":1,"model":55,"internalCfop":"5101","interstateCfop":"6101","foreignCfop":"7101","active":true});
    let value = json!({"items":[nature.clone()]});
    let mut invalid = value.clone();
    invalid["items"][0]["internalCfop"] = json!("1101");
    assert_eq!(
        call(
            &router,
            "PUT",
            path,
            "editor",
            TENANT,
            Some("\"1\""),
            invalid
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            path,
            "editor",
            TENANT,
            Some("\"1\""),
            json!({"items":[nature.clone(),nature]})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            path,
            "editor",
            TENANT,
            Some("\"1\""),
            value.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&router, "GET", path, "reader", TENANT, None, Value::Null)
            .await
            .1["data"],
        value
    );
    sqlx::raw_sql("INSERT INTO fiscal_nfe_events(tenant_id,id,kind,sequence,request,status) VALUES ('11111111-1111-4111-8111-111111111111','77777777-0000-4000-8000-000000000001','inutilizacao',1,'{\"year\":2026,\"series\":1,\"first\":3,\"last\":5}', 'unknown'),('11111111-1111-4111-8111-111111111111','77777777-0000-4000-8000-000000000002','inutilizacao',1,'{\"year\":2026,\"series\":1,\"first\":6,\"last\":7}', 'registered'),('22222222-2222-4222-8222-222222222222','77777777-0000-4000-8000-000000000003','inutilizacao',1,'{}','pending');").execute(&admin).await.unwrap();
    let (status, page) = call(
        &router,
        "GET",
        "/api/v1/fiscal/nfe-events?kind=inutilizacao&limit=1",
        "reader",
        TENANT,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["data"].as_array().unwrap().len(), 1);
    assert_eq!(page["data"][0]["status"], "registered");
    let next = format!(
        "/api/v1/fiscal/nfe-events?kind=inutilizacao&limit=1&cursor={}",
        page["nextCursor"].as_str().unwrap()
    );
    let page = call(&router, "GET", &next, "reader", TENANT, None, Value::Null)
        .await
        .1;
    assert_eq!(page["data"][0]["status"], "unknown");
    assert!(page["nextCursor"].is_null());
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/fiscal/nfe-events?kind=correcao",
            "reader",
            TENANT,
            None,
            Value::Null
        )
        .await
        .1["data"],
        json!([])
    );
    assert_eq!(
        call(
            &router,
            "GET",
            "/api/v1/fiscal/nfe-events?kind=all",
            "reader",
            TENANT,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
