//! Standalone order email regression coverage; SMTP is never configured or contacted.
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

#[sqlx::test(migrations = "../../migrations")]
async fn order_document_download_is_authorized_revisioned_binary_and_read_only(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    seed(&admin).await;
    let created = create(&admin).await;
    let id = created["data"]["id"].as_str().unwrap();
    let url = format!("/api/v1/orders/{id}/document");
    assert_eq!(
        call(&router, "GET", &url, "editor", None, None, Value::Null)
            .await
            .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(&router, "GET", &url, "editor", Some(2), None, Value::Null)
            .await
            .0,
        StatusCode::PRECONDITION_FAILED
    );
    assert_eq!(
        call(&router, "GET", &url, "disabled", Some(1), None, Value::Null)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(&url)
                .header("x-tenant-id", TENANT)
                .header("authorization", "Bearer reader")
                .header("if-match", "\"1\"")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/pdf");
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["etag"], "\"1\"");
    assert!(
        response.headers()["content-disposition"]
            .to_str()
            .unwrap()
            .contains(".pdf")
    );
    let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    assert!(bytes.starts_with(b"%PDF-"));
    let parsed = lopdf::Document::load_mem(&bytes).unwrap();
    assert_eq!(parsed.get_pages().len(), 1);
    let text = parsed.extract_text(&[1]).unwrap();
    assert!(text.contains("Produto de teste"));
    assert!(text.contains("49,98"));
    let state: (i64, String) =
        sqlx::query_as("SELECT revision,status FROM sales_orders WHERE id=$1::uuid")
            .bind(id)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(state, (1, "draft".into()));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sales_order_email_deliveries")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn delivery_runtime_grants_restore_preview_without_delete_or_rls_bypass(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    seed(&admin).await;
    let created = create(&admin).await;
    let id = created["data"]["id"].as_str().unwrap();
    let url = format!("/api/v1/orders/{id}/email");
    assert!(
        role.chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '_')
    );
    sqlx::raw_sql(&format!(
        "REVOKE ALL ON sales_order_email_deliveries,sales_proposal_email_deliveries FROM {role}"
    ))
    .execute(&admin)
    .await
    .unwrap();
    assert_eq!(
        call(&router, "GET", &url, "editor", None, None, Value::Null)
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let grants = include_str!("../../../../deploy/grant-commercial-email.sql")
        .lines()
        .filter(|line| !line.starts_with('\\'))
        .collect::<Vec<_>>()
        .join("\n")
        .replace("erp_next_app", &role);
    sqlx::raw_sql(&grants).execute(&admin).await.unwrap();
    assert_eq!(
        call(&router, "GET", &url, "editor", None, None, Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    for table in [
        "sales_order_email_deliveries",
        "sales_proposal_email_deliveries",
    ] {
        for privilege in ["SELECT", "INSERT", "UPDATE"] {
            assert!(
                sqlx::query_scalar::<_, bool>("SELECT has_table_privilege($1,$2,$3)")
                    .bind(&role)
                    .bind(table)
                    .bind(privilege)
                    .fetch_one(&admin)
                    .await
                    .unwrap()
            );
        }
        assert!(
            !sqlx::query_scalar::<_, bool>("SELECT has_table_privilege($1,$2,'DELETE')")
                .bind(&role)
                .bind(table)
                .fetch_one(&admin)
                .await
                .unwrap()
        );
        assert!(
            sqlx::query_scalar::<_, bool>(
                "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=$1::regclass"
            )
            .bind(table)
            .fetch_one(&admin)
            .await
            .unwrap()
        );
    }
    assert!(
        !sqlx::query_scalar::<_, bool>(
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user"
        )
        .fetch_one(&application)
        .await
        .unwrap()
    );
    let post = call(&router, "POST", &url, "editor", Some(1), Some(Uuid::now_v7()),
        json!({"recipient":"cliente@example.test","subject":"Pedido","message":"Confira o documento."})).await;
    assert_eq!(post.0, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sales_order_email_deliveries")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

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
        INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read') ON CONFLICT DO NOTHING;
        INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,email,is_customer,is_supplier,status) VALUES('11111111-2222-4333-8444-555555555555','11111111-1111-4111-8111-111111111111','fisica','Cliente de teste','52998224725','cliente@example.test',true,false,'active');
        INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES('11111111-2222-4333-8444-666666666666','11111111-1111-4111-8111-111111111111','PROPOSAL-ACTIONS','Produto de teste','UN',1999,'active');")
        .execute(admin).await.unwrap();
}

async fn create(admin: &PgPool) -> Value {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES($1,$2::uuid,$3::uuid,'Cliente de teste','52998224725','2100-01-10',4998,'draft')")
        .bind(id).bind(TENANT).bind(CUSTOMER).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO sales_order_lines(tenant_id,order_id,line_number,product_id,sku,name,unit,quantity_micros,price_cents,amount_cents) VALUES($1::uuid,$2,1,$3::uuid,'EMAIL-TEST','Produto de teste','UN',2500000,1999,4998)")
        .bind(TENANT).bind(id).bind(PRODUCT).execute(admin).await.unwrap();
    json!({"data":{"id":id}})
}

#[sqlx::test(migrations = "../../migrations")]
async fn email_unconfigured_never_publishes_or_records_delivery(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    seed(&admin).await;
    let created = create(&admin).await;
    let id = created["data"]["id"].as_str().unwrap();
    let url = format!("/api/v1/orders/{id}/email");
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
        &format!("/api/v1/orders/{id}"),
        "editor",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(current.1["data"]["revision"], 1);
    assert_eq!(current.1["data"]["status"], "draft");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sales_order_email_deliveries")
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
    let created = create(&admin).await;
    let id = Uuid::parse_str(created["data"]["id"].as_str().unwrap()).unwrap();
    let key = Uuid::now_v7();
    let delivery = Uuid::now_v7();
    let body = json!({"recipient":"cliente@example.test","subject":"Sua proposta","message":"Confira a proposta em anexo."});
    sqlx::query("INSERT INTO sales_order_email_deliveries(id,tenant_id,order_id,order_revision,result_revision,subject_id,command_key,recipient,snapshot_html,status) VALUES($1,$2::uuid,$3,1,1,'editor',$4,'cliente@example.test','<p>Captured order</p>','uncertain')")
        .bind(delivery).bind(TENANT).bind(id).bind(key).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO domain_commands(tenant_id,auth_subject,command_key,scope,request,result) VALUES($1::uuid,'editor',$2,'order.email',$3,$4)")
        .bind(TENANT).bind(key).bind(json!({"id":id,"revision":1,"input":body})).bind(json!({"deliveryId":delivery})).execute(&admin).await.unwrap();
    let url = format!("/api/v1/orders/{id}/email");
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
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sales_order_email_deliveries")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(count, 1);
    // A new command must not send another copy while the earlier SMTP result is unknown.
    let blocked = call(
        &router, "POST", &url, "editor", Some(1), Some(Uuid::now_v7()),
        json!({"recipient":"cliente@example.test","subject":"Pedido","message":"Documento em anexo."}),
    ).await;
    assert_eq!(blocked.0, StatusCode::CONFLICT);
    // FORCE RLS applies to the same restricted role used by HTTP, across companies.
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    let visible: i64 = sqlx::query_scalar("SELECT count(*) FROM sales_order_email_deliveries")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(visible, 0);
    tx.rollback().await.unwrap();
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cancelled_and_stale_orders_cannot_start_delivery(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    seed(&admin).await;
    let created = create(&admin).await;
    let id = created["data"]["id"].as_str().unwrap();
    let url = format!("/api/v1/orders/{id}/email");
    let body = json!({"recipient":"cliente@example.test","subject":"Pedido","message":"Documento em anexo."});
    assert_eq!(
        call(
            &router,
            "POST",
            &url,
            "editor",
            Some(2),
            Some(Uuid::now_v7()),
            body.clone()
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    sqlx::query("UPDATE sales_orders SET status='cancelled' WHERE id=$1::uuid")
        .bind(id)
        .execute(&admin)
        .await
        .unwrap();
    let status = call(&router, "GET", &url, "reader", None, None, Value::Null).await;
    assert_eq!(status.0, StatusCode::OK);
    assert_eq!(status.1["canSend"], false);
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
        StatusCode::CONFLICT
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sales_order_email_deliveries")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(count, 0);
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
