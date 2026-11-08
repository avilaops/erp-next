//! Local HTTP regression coverage for explicit approval and request-scoped e-mail delivery.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const CUSTOMER: &str = "11111111-2222-4333-8444-555555555555";
const PRODUCT: &str = "11111111-2222-4333-8444-666666666666";
const EDITOR_ROLE: &str = "99999999-9999-4999-8999-999999999999";

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    subject: &str,
    revision: Option<i64>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, Value, Option<String>) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {subject}"));
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
    }
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    let result = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = result.status();
    let etag = result
        .headers()
        .get("etag")
        .map(|v| v.to_str().unwrap().to_owned());
    let body = to_bytes(result.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&body).unwrap_or(Value::Null),
        etag,
    )
}

async fn seed(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'sales.%' ON CONFLICT DO NOTHING;
        INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.proposals.read') ON CONFLICT DO NOTHING;
        INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,email,is_customer,is_supplier,status) VALUES('11111111-2222-4333-8444-555555555555','11111111-1111-4111-8111-111111111111','fisica','Cliente de teste','52998224725','cliente@example.test',true,false,'active');
        INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('11111111-2222-4333-8444-666666666666','11111111-1111-4111-8111-111111111111','PROPOSAL-ACTIONS','Produto de teste','UN',1999,'active');")
        .execute(admin).await.unwrap();
}

async fn create(router: &Router) -> Value {
    let result = call(router, "POST", "/api/v1/proposals", "editor", None, Some(Uuid::now_v7()),
        json!({"customerId":CUSTOMER,"validUntil":"2100-01-01","paymentTerms":"À vista","deliveryTerms":"Retirada","notes":"","items":[{"productId":PRODUCT,"quantity":"2.500000","unitPrice":"17.99"}]})).await;
    assert_eq!(result.0, StatusCode::CREATED, "{}", result.1);
    result.1
}

#[sqlx::test(migrations = "../../migrations")]
async fn approve_order_is_atomic_authorized_and_idempotent(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    seed(&admin).await;
    let created = create(&router).await;
    let id = created["data"]["id"].as_str().unwrap();
    let url = format!("/api/v1/proposals/{id}/approve-order");
    let body = json!({"dueDate":"2100-01-10"});
    assert_eq!(
        call(
            &router,
            "POST",
            &url,
            "reader",
            Some(1),
            Some(Uuid::now_v7()),
            body.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("DELETE FROM role_permissions WHERE role_id=$1::uuid AND permission_code='sales.proposals.decide'").bind(EDITOR_ROLE).execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &url,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            body.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) VALUES($1::uuid,'sales.proposals.decide')").bind(EDITOR_ROLE).execute(&admin).await.unwrap();
    sqlx::query("UPDATE products SET status='inactive' WHERE id=$1::uuid")
        .bind(PRODUCT)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &url,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            body.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let unchanged = call(
        &router,
        "GET",
        &format!("/api/v1/proposals/{id}"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(unchanged.1["data"]["status"], "draft");
    assert_eq!(unchanged.1["data"]["revision"], 1);
    assert!(unchanged.1["data"]["orderId"].is_null());
    sqlx::query("UPDATE products SET status='active' WHERE id=$1::uuid")
        .bind(PRODUCT)
        .execute(&admin)
        .await
        .unwrap();
    let key = Uuid::now_v7();
    let approved = call(
        &router,
        "POST",
        &url,
        "editor",
        Some(1),
        Some(key),
        body.clone(),
    )
    .await;
    assert_eq!(approved.0, StatusCode::OK, "{}", approved.1);
    assert_eq!(approved.2.as_deref(), Some("\"2\""));
    assert_eq!(approved.1["data"]["status"], "accepted");
    assert_eq!(approved.1["data"]["revision"], 2);
    let order_id = approved.1["data"]["orderId"].as_str().unwrap();
    let order = call(
        &router,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(order.1["data"]["status"], "draft");
    assert_eq!(order.1["items"][0]["unitPrice"], "17.99");
    assert_eq!(order.1["data"]["amount"], "44.98");
    let replay = call(
        &router,
        "POST",
        &url,
        "editor",
        Some(1),
        Some(key),
        body.clone(),
    )
    .await;
    assert_eq!(replay.1, approved.1);
    assert_eq!(
        call(
            &router,
            "POST",
            &url,
            "editor",
            Some(2),
            Some(Uuid::now_v7()),
            body
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sales_orders WHERE tenant_id=$1::uuid")
            .bind(TENANT)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(count, 1);
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn email_unconfigured_never_publishes_or_records_delivery(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    seed(&admin).await;
    let created = create(&router).await;
    let id = created["data"]["id"].as_str().unwrap();
    let url = format!("/api/v1/proposals/{id}/email");
    let body = json!({"recipient":"cliente@example.test","subject":"Sua proposta","message":"Confira a proposta em anexo."});
    let status = call(&router, "GET", &url, "editor", None, None, Value::Null).await;
    assert_eq!(status.0, StatusCode::OK);
    assert_eq!(status.1["recipient"], "cliente@example.test");
    assert_eq!(status.1["emailReady"], false);
    assert_eq!(status.1["canSend"], true);
    assert_eq!(
        call(
            &router,
            "POST",
            &url,
            "reader",
            Some(1),
            Some(Uuid::now_v7()),
            body.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &url,
            "editor",
            None,
            Some(Uuid::now_v7()),
            body.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(&router, "POST", &url, "editor", Some(1), None, body.clone())
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let mut invalid = body.clone();
    invalid["recipient"] = json!("a@example.test\r\nBcc:b@example.test");
    assert_eq!(
        call(
            &router,
            "POST",
            &url,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            invalid
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &url,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            body
        )
        .await
        .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    let current = call(
        &router,
        "GET",
        &format!("/api/v1/proposals/{id}"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(current.1["data"]["revision"], 1);
    assert_eq!(current.1["data"]["status"], "draft");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sales_proposal_email_deliveries")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(count, 0);
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn replaying_uncertain_email_returns_same_receipt_without_resending(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    seed(&admin).await;
    let created = create(&router).await;
    let id = Uuid::parse_str(created["data"]["id"].as_str().unwrap()).unwrap();
    let key = Uuid::now_v7();
    let delivery = Uuid::now_v7();
    let body = json!({"recipient":"cliente@example.test","subject":"Sua proposta","message":"Confira a proposta em anexo."});
    sqlx::query("INSERT INTO sales_proposal_email_deliveries(id,tenant_id,proposal_id,version,proposal_revision,result_revision,subject_id,command_key,recipient,snapshot_html,status) VALUES($1,$2::uuid,$3,1,1,1,'editor',$4,'cliente@example.test','<p>Captured proposal</p>','uncertain')")
        .bind(delivery).bind(TENANT).bind(id).bind(key).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO domain_commands(tenant_id,auth_subject,command_key,scope,request,result) VALUES($1::uuid,'editor',$2,'proposal.email',$3,$4)")
        .bind(TENANT).bind(key).bind(json!({"id":id,"revision":1,"input":body})).bind(json!({"deliveryId":delivery})).execute(&admin).await.unwrap();
    let url = format!("/api/v1/proposals/{id}/email");
    for _ in 0..2 {
        let replay = call(
            &router,
            "POST",
            &url,
            "editor",
            Some(1),
            Some(key),
            body.clone(),
        )
        .await;
        assert_eq!(replay.0, StatusCode::OK, "{}", replay.1);
        assert_eq!(replay.1["delivery"]["id"], delivery.to_string());
        assert_eq!(replay.1["delivery"]["status"], "uncertain");
        assert_eq!(replay.2.as_deref(), Some("\"1\""));
    }
    let mut changed = body;
    changed["subject"] = json!("Assunto alterado");
    assert_eq!(
        call(&router, "POST", &url, "editor", Some(1), Some(key), changed)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sales_proposal_email_deliveries")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(count, 1);
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
