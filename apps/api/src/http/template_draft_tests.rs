use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

async fn call(
    router: &Router,
    actor: &str,
    id: Uuid,
    key: Uuid,
    revision: Option<i64>,
    value: &Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/contract-template-drafts/{id}"))
        .header("authorization", format!("Bearer {actor}"))
        .header("x-tenant-id", "11111111-1111-4111-8111-111111111111")
        .header("content-type", "application/json")
        .header("idempotency-key", key.to_string());
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(value.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[sqlx::test(migrations = "../../migrations")]
async fn drafts_enforce_authorization_revisions_idempotency_and_private_pdf(admin: PgPool) {
    let (router, pool, server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES ('99999999-9999-4999-8999-999999999999','sales.orders.read'),('99999999-9999-4999-8999-999999999999','platform.integrations.manage'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read') ON CONFLICT DO NOTHING;").execute(&admin).await.unwrap();
    let id = Uuid::now_v7();
    let key = Uuid::now_v7();
    let input = json!({"definition":{"name":"Modelo privado","pages":1,"roles":["Cliente"],"fields":[]},"pdfBase64":STANDARD.encode(b"%PDF-1.4\nfixture\n%%EOF")});
    assert_eq!(
        call(&router, "reader", id, key, None, &input).await.0,
        StatusCode::FORBIDDEN
    );
    let first = call(&router, "editor", id, key, None, &input).await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert_eq!(first.1["revision"], 1);
    assert_eq!(call(&router, "editor", id, key, None, &input).await, first);
    let mut changed = input.clone();
    changed["definition"]["name"] = json!("Outra revisão");
    changed["pdfBase64"] = Value::Null;
    assert_eq!(
        call(&router, "editor", id, key, Some(1), &changed).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&router, "editor", id, Uuid::now_v7(), None, &changed)
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(&router, "editor", id, Uuid::now_v7(), Some(1), &changed)
            .await
            .1["revision"],
        2
    );
    assert_eq!(
        call(&router, "editor", id, Uuid::now_v7(), Some(1), &changed)
            .await
            .0,
        StatusCode::PRECONDITION_FAILED
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE entity_type='contract_template_draft'",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(count, 2);
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    let leaked: i64 = sqlx::query_scalar("SELECT count(*) FROM commercial_template_drafts")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(leaked, 0);
    tx.rollback().await.unwrap();
    pool.close().await;
    server.abort();
    sqlx::query(&format!("DROP OWNED BY {role};"))
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query(&format!("DROP ROLE {role};"))
        .execute(&admin)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "../../migrations")]
async fn imports_only_assigned_models_and_reuses_the_private_copy(admin: PgPool) {
    use crate::{
        domains::contracts::provider::Docuseal,
        platform::{auth::AuthClient, state::AppState},
    };
    use axum::{Json, routing::get};
    let (_, pool, auth_server, role) = super::company_tests::setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES ('99999999-9999-4999-8999-999999999999','sales.orders.read'),('99999999-9999-4999-8999-999999999999','platform.integrations.manage'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read') ON CONFLICT DO NOTHING;").execute(&admin).await.unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/", listener.local_addr().unwrap());
    let document_url = format!("{base}document.pdf");
    let publication = std::sync::Arc::new(std::sync::Mutex::new(json!({"found":false})));
    let publish_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let read_publication = publication.clone();
    let write_publication = publication.clone();
    let count_publication = publish_count.clone();
    let external = Router::new()
        .route("/userinfo",get(|headers: axum::http::HeaderMap| async move {
            let actor = headers["authorization"].to_str().unwrap().strip_prefix("Bearer ").unwrap();
            Json(json!({"sub":actor,"email":format!("{actor}@example.test"),"name":actor}))
        }))
        .route("/api/templates/1",get(move || {let url = document_url.clone(); async move {
            Json(json!({"id":1,"name":"Modelo existente","schema":[{"attachment_uuid":"document"}],"documents":[{"uuid":"document","url":url}],"submitters":[{"uuid":"customer","name":"Cliente"}],"fields":[{"uuid":"44444444-4444-4444-8444-444444444444","name":"cliente_nome","type":"text","required":true,"submitter_uuid":"customer","areas":[{"attachment_uuid":"document","page":0,"x":0.1,"y":0.2,"w":0.4,"h":0.05}]}]}))
        }}))
        .route("/document.pdf",get(||async{"%PDF-1.4\nprivate import fixture\n%%EOF"}))
        .route("/api/avila/templates/{id}",get(move || {let value=read_publication.clone(); async move { Json(value.lock().unwrap().clone()) }}).post(move |Json(body):Json<Value>| {
            let value=write_publication.clone(); let count=count_publication.clone();
            async move {
                use sha2::{Digest,Sha256};
                count.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
                let pdf=STANDARD.decode(body["pdfBase64"].as_str().unwrap()).unwrap();
                let pdf_hash=format!("{:x}",Sha256::digest(pdf));
                let hash=format!("{:x}",Sha256::digest(format!("{pdf_hash}:{}",body["definitionJson"].as_str().unwrap())));
                *value.lock().unwrap()=json!({"found":true,"id":99,"archived":false,"requestHash":hash});
                StatusCode::SERVICE_UNAVAILABLE
            }
        }));
    let provider_server =
        tokio::spawn(async move { axum::serve(listener, external).await.unwrap() });
    let router = super::router(
        AppState::new(pool.clone(), AuthClient::new(format!("{base}userinfo"))).with_contracts(
            Some(Docuseal::for_test(
                base.parse().unwrap(),
                "11111111-1111-4111-8111-111111111111".parse().unwrap(),
                false,
            )),
        ),
    );
    async fn import(
        router: &Router,
        actor: &str,
        id: Uuid,
        key: Uuid,
        source: i64,
    ) -> (StatusCode, Value) {
        let result = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/contract-template-drafts/{id}/import"))
                    .header("authorization", format!("Bearer {actor}"))
                    .header("x-tenant-id", "11111111-1111-4111-8111-111111111111")
                    .header("idempotency-key", key.to_string())
                    .header("content-type", "application/json")
                    .body(Body::from(json!({"templateId":source}).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = result.status();
        let bytes = to_bytes(result.into_body(), 1_000_000).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }
    let id = Uuid::now_v7();
    let key = Uuid::now_v7();
    assert_eq!(
        import(&router, "reader", id, key, 1).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        import(&router, "editor", id, key, 2).await.0,
        StatusCode::FORBIDDEN
    );
    let first = import(&router, "editor", id, key, 1).await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert_eq!(import(&router, "editor", id, key, 1).await, first);
    assert_eq!(
        import(&router, "editor", Uuid::now_v7(), Uuid::now_v7(), 1).await,
        first
    );
    let (count,x,page): (i64,Value,Value) = sqlx::query_as("SELECT count(*) OVER(), definition->'fields'->0->'x', definition->'fields'->0->'page' FROM commercial_template_drafts").fetch_one(&admin).await.unwrap();
    assert_eq!(count, 1);
    assert_eq!(x, json!(10.0));
    assert_eq!(page, json!(1));
    let audit: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action='contract_template.imported'",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(audit, 1);
    let mut definition: Value =
        sqlx::query_scalar("SELECT definition FROM commercial_template_drafts WHERE id=$1")
            .bind(id)
            .fetch_one(&admin)
            .await
            .unwrap();
    definition["fields"][0]["kind"] = json!("signature");
    assert_eq!(
        call(
            &router,
            "editor",
            id,
            Uuid::now_v7(),
            Some(1),
            &json!({"definition":definition,"pdfBase64":null})
        )
        .await
        .0,
        StatusCode::OK
    );
    async fn publish(
        router: &Router,
        id: Uuid,
        key: Uuid,
        actor: &str,
        revision: i64,
    ) -> StatusCode {
        router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/contract-template-drafts/{id}/publish"))
                    .header("authorization", format!("Bearer {actor}"))
                    .header("x-tenant-id", "11111111-1111-4111-8111-111111111111")
                    .header("idempotency-key", key.to_string())
                    .header("if-match", format!("\"{revision}\""))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
    }
    let publish_key = Uuid::now_v7();
    assert_eq!(
        publish(&router, id, publish_key, "reader", 2).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        publish(&router, id, publish_key, "editor", 1).await,
        StatusCode::PRECONDITION_FAILED
    );
    assert_eq!(
        publish(&router, id, publish_key, "editor", 2).await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        publish(&router, id, publish_key, "editor", 2).await,
        StatusCode::OK
    );
    assert_eq!(
        publish(&router, id, Uuid::now_v7(), "editor", 2).await,
        StatusCode::OK
    );
    assert_eq!(publish_count.load(std::sync::atomic::Ordering::SeqCst), 1);
    let versions: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM commercial_template_versions WHERE external_id=99",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(versions, 1);
    assert!(
        sqlx::query("UPDATE commercial_template_versions SET definition_json='{}'")
            .execute(&admin)
            .await
            .is_err()
    );
    provider_server.abort();
    auth_server.abort();
    pool.close().await;
    sqlx::query(&format!("DROP OWNED BY {role}"))
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query(&format!("DROP ROLE {role}"))
        .execute(&admin)
        .await
        .unwrap();
}
