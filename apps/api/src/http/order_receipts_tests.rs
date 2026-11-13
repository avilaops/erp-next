use super::company_tests::{cleanup, setup};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const ORDER: &str = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TITLE_A: &str = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const TITLE_B: &str = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const METHOD: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTRACT: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async fn seed(admin: &PgPool) {
    sqlx::raw_sql(&format!(r#"
      INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('sales.orders.read','sales.orders.manage','finance.receivables.read','finance.receivables.manage');
      INSERT INTO role_permissions(role_id,permission_code) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',code FROM permissions WHERE code IN ('sales.orders.read','finance.receivables.read');
      INSERT INTO parties(id,tenant_id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','{TENANT}','juridica','Cliente sintético','04252011000110',true,false,'active');
      INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES('{ORDER}','{TENANT}','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Cliente sintético','04252011000110','2026-11-13',10000000,'confirmed');
      INSERT INTO payment_methods(id,tenant_id,code,name,status,revision,modality,settlement_days) VALUES('{METHOD}','{TENANT}','PIX','Pix conferido','active',1,'pix',0);
      INSERT INTO receivables(id,tenant_id,order_id,customer_name,due_date,amount_cents,status) VALUES('{TITLE_A}','{TENANT}','{ORDER}','Cliente sintético','2026-11-13',5000000,'open');
      INSERT INTO sales_order_checkouts(tenant_id,order_id,customer_snapshot,entry_amount_cents,delivery_notes,payment_notes,notes) VALUES('{TENANT}','{ORDER}','{{}}',0,'','','');
      INSERT INTO sales_order_installments(id,tenant_id,order_id,number,kind,payment_method_id,payment_method,due_on,amount_cents) VALUES('abababab-abab-4bab-8bab-abababababab','{TENANT}','{ORDER}',1,'balance','{METHOD}','{{}}','2026-11-14',5000000);
      INSERT INTO receivables(id,tenant_id,order_id,order_installment_id,customer_name,due_date,amount_cents,status) VALUES('{TITLE_B}','{TENANT}','{ORDER}','abababab-abab-4bab-8bab-abababababab','Cliente sintético','2026-11-14',5000000,'open');
      INSERT INTO commercial_contracts(id,tenant_id,customer_id,order_id,template_id,template_name,template_snapshot,snapshot,recipients,fields,fingerprint,status) VALUES('{CONTRACT}','{TENANT}','cccccccc-cccc-4ccc-8ccc-cccccccccccc','{ORDER}',2,'Técnico sem valor comercial','{{}}','{{}}','[]','{{}}','test-signature-preservation','completed');
      INSERT INTO commercial_contract_files(id,tenant_id,contract_id,kind,position,sha256,content) VALUES('12121212-1212-4212-8212-121212121212','{TENANT}','{CONTRACT}','signed',0,'658a04a0a4f9863fb9d1abfffcf9c3e7779954647c57e58cda349318fb150074',decode('255044462d312e340a7369676e6564','hex'));
    "#)).execute(admin).await.unwrap();
}

async fn call(
    router: &Router,
    method: &str,
    path: &str,
    subject: &str,
    revision: Option<i64>,
    key: Option<Uuid>,
    value: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {subject}"))
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json");
    if let Some(rev) = revision {
        request = request.header("if-match", format!("\"{rev}\""));
    }
    if let Some(id) = key {
        request = request.header("idempotency-key", id.to_string());
    }
    let result = router
        .clone()
        .oneshot(request.body(Body::from(value.to_string())).unwrap())
        .await
        .unwrap();
    let status = result.status();
    let bytes = to_bytes(result.into_body(), 20 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({"raw":String::from_utf8_lossy(&bytes)})),
    )
}

fn document() -> Value {
    json!({"filename":"comprovante.pdf","mediaType":"application/pdf","contentBase64":STANDARD.encode(b"%PDF-1.4\nproof-fixture"),"description":"Comprovante original de teste","documentDate":"2026-11-13"})
}

fn receipt(amount: &str) -> Value {
    json!({"amount":amount,"method":"card","paymentMethodId":METHOD,"reference":"Pix declarado sintético","occurredOn":"2026-11-13","supportingDocument":document()})
}

#[sqlx::test(migrations = "../../migrations")]
async fn order_receipts_all_titles_original_proofs_retry_and_post_signature_preserve_money(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let path = format!("/api/v1/orders/{ORDER}/finance");
    let before = call(&router, "GET", &path, "editor", None, None, Value::Null).await;
    assert_eq!(before.0, StatusCode::OK, "{}", before.1);
    assert_eq!(before.1["state"], "open");
    assert_eq!(before.1["titleAmount"], "100000.00");
    let key = Uuid::now_v7();
    let first_path = format!("/api/v1/receivables/{TITLE_A}/payments");
    let first = call(
        &router,
        "POST",
        &first_path,
        "editor",
        Some(1),
        Some(key),
        receipt("50000.00"),
    )
    .await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert_eq!(
        first.1["payments"][0]["paymentMethod"]["name"],
        "Pix conferido"
    );
    assert_eq!(first.1["payments"][0]["method"], "bank_transfer");
    sqlx::query("UPDATE payment_methods SET name='Pix renomeado' WHERE id=$1::uuid")
        .bind(METHOD)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &first_path,
            "editor",
            Some(1),
            Some(key),
            receipt("50000.00")
        )
        .await,
        first
    );
    let partial = call(&router, "GET", &path, "editor", None, None, Value::Null)
        .await
        .1;
    assert_eq!(partial["receivedAmount"], "50000.00");
    assert_eq!(partial["outstandingAmount"], "50000.00");
    assert_eq!(partial["state"], "partial");
    let second_path = format!("/api/v1/receivables/{TITLE_B}/payments");
    let second = call(
        &router,
        "POST",
        &second_path,
        "editor",
        Some(1),
        Some(Uuid::now_v7()),
        receipt("10000.00"),
    )
    .await;
    assert_eq!(second.0, StatusCode::OK, "{}", second.1);
    let middle = call(&router, "GET", &path, "reader", None, None, Value::Null)
        .await
        .1;
    assert_eq!(middle["receivedAmount"], "60000.00");
    assert_eq!(middle["outstandingAmount"], "40000.00");
    let third = call(
        &router,
        "POST",
        &second_path,
        "editor",
        Some(2),
        Some(Uuid::now_v7()),
        receipt("40000.00"),
    )
    .await;
    assert_eq!(third.0, StatusCode::OK, "{}", third.1);
    let payment_id = first.1["payments"][0]["id"].clone();
    let docs_path = format!("/api/v1/orders/{ORDER}/documents");
    let upload = json!({"paymentId":payment_id,"document":document()});
    let upload_key = Uuid::now_v7();
    let attached = call(
        &router,
        "POST",
        &docs_path,
        "editor",
        None,
        Some(upload_key),
        upload.clone(),
    )
    .await;
    assert_eq!(attached.0, StatusCode::CREATED, "{}", attached.1);
    assert_eq!(
        call(
            &router,
            "POST",
            &docs_path,
            "editor",
            None,
            Some(upload_key),
            upload
        )
        .await,
        attached
    );
    let files = call(
        &router,
        "GET",
        &docs_path,
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(files.1["data"].as_array().unwrap().len(), 4);
    let final_state = call(&router, "GET", &path, "editor", None, None, Value::Null)
        .await
        .1;
    assert_eq!(final_state["state"], "paid");
    assert_eq!(final_state["receivedAmount"], "100000.00");
    assert_eq!(final_state["outstandingAmount"], "0.00");
    assert_eq!(final_state["receivables"].as_array().unwrap().len(), 2);
    let raw_commands: String =
        sqlx::query_scalar("SELECT string_agg(request::text,'') FROM domain_commands")
            .fetch_one(&admin)
            .await
            .unwrap();
    assert!(!raw_commands.contains("contentBase64"));
    assert!(!raw_commands.contains(document()["contentBase64"].as_str().unwrap()));
    let signed: Vec<u8> = sqlx::query_scalar(
        "SELECT content FROM commercial_contract_files WHERE contract_id=$1::uuid",
    )
    .bind(CONTRACT)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(signed, b"%PDF-1.4\nsigned");
    let preserved_hash: String = sqlx::query_scalar(
        "SELECT sha256 FROM commercial_contract_files WHERE contract_id=$1::uuid",
    )
    .bind(CONTRACT)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(
        preserved_hash,
        "658a04a0a4f9863fb9d1abfffcf9c3e7779954647c57e58cda349318fb150074"
    );
    let reversed=call(&router,"POST",&format!("/api/v1/receivables/{TITLE_B}/reverse-payment"),"editor",Some(3),Some(Uuid::now_v7()),json!({"paymentId":second.1["payments"][0]["id"],"reason":"Estorno do segundo recebimento","occurredOn":"2026-11-14"})).await;
    assert_eq!(reversed.0, StatusCode::OK, "{}", reversed.1);
    let state = call(&router, "GET", &path, "editor", None, None, Value::Null)
        .await
        .1;
    assert_eq!(state["receivedAmount"], "90000.00");
    assert_eq!(state["outstandingAmount"], "10000.00");
    assert_eq!(
        call(
            &router,
            "GET",
            &docs_path,
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .1["data"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn order_receipts_document_authorization_separates_finance_from_sales_and_parent(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let docs = format!("/api/v1/orders/{ORDER}/documents");
    assert_eq!(
        call(
            &router,
            "POST",
            &docs,
            "editor",
            None,
            Some(Uuid::now_v7()),
            json!({"document":document()})
        )
        .await
        .0,
        StatusCode::CREATED
    );
    let first = call(
        &router,
        "POST",
        &format!("/api/v1/receivables/{TITLE_A}/payments"),
        "editor",
        Some(1),
        Some(Uuid::now_v7()),
        receipt("1.00"),
    )
    .await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    let full = call(&router, "GET", &docs, "editor", None, None, Value::Null)
        .await
        .1;
    let proof = full["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| !r["paymentId"].is_null())
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    sqlx::query("DELETE FROM role_permissions WHERE role_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND permission_code='finance.receivables.read'").execute(&admin).await.unwrap();
    let sales = call(&router, "GET", &docs, "reader", None, None, Value::Null).await;
    assert_eq!(sales.0, StatusCode::OK);
    assert_eq!(sales.1["data"].as_array().unwrap().len(), 1);
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("{docs}/{proof}"),
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/v1/orders/{ORDER}/finance"),
            "reader",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::raw_sql("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code LIKE 'sales.orders.%';").execute(&admin).await.unwrap();
    let finance = call(&router, "GET", &docs, "editor", None, None, Value::Null).await;
    assert_eq!(finance.0, StatusCode::OK, "{}", finance.1);
    assert_eq!(finance.1["data"].as_array().unwrap().len(), 1);
    assert_eq!(finance.1["canAttachOther"], false);
    assert_eq!(finance.1["canAttachPayment"], true);
    let mut isolated = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *isolated)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM order_supporting_documents")
            .fetch_one(&mut *isolated)
            .await
            .unwrap(),
        0
    );
    isolated.rollback().await.unwrap();
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("{docs}/{proof}"),
            "editor",
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &docs,
            "editor",
            None,
            Some(Uuid::now_v7()),
            json!({"document":document()})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/orders/{}/documents", Uuid::now_v7()),
            "editor",
            None,
            Some(Uuid::now_v7()),
            json!({"paymentId":first.1["payments"][0]["id"],"document":document()})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let another = Uuid::now_v7();
    sqlx::query("INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) SELECT $1,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status FROM sales_orders WHERE id=$2::uuid").bind(another).bind(ORDER).execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/orders/{another}/documents"),
            "editor",
            None,
            Some(Uuid::now_v7()),
            json!({"paymentId":first.1["payments"][0]["id"],"document":document()})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn order_receipts_invalid_proof_overpayment_and_foreign_method_are_atomic(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let path = format!("/api/v1/receivables/{TITLE_A}/payments");
    for (field, value) in [
        ("mediaType", json!("image/png")),
        ("filename", json!("../proof.pdf")),
        ("documentDate", json!("2026-02-30")),
        ("description", json!("")),
        ("contentBase64", json!("not base64")),
    ] {
        let mut value_body = receipt("1.00");
        value_body["supportingDocument"][field] = value;
        assert_eq!(
            call(
                &router,
                "POST",
                &path,
                "editor",
                Some(1),
                Some(Uuid::now_v7()),
                value_body
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{field}"
        );
    }
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            receipt("50000.01")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut foreign = receipt("1.00");
    foreign["paymentMethodId"] = json!(Uuid::now_v7());
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            foreign
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let mut oversized = receipt("1.00");
    let mut bytes = vec![b'X'; 10 * 1024 * 1024 + 1];
    bytes[..9].copy_from_slice(b"%PDF-1.4\n");
    oversized["supportingDocument"]["contentBase64"] = json!(STANDARD.encode(bytes));
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            oversized
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivable_payments")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM order_supporting_documents")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn order_receipts_proof_failures_rollback_and_concurrent_uploads_preserve_one_document(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    sqlx::raw_sql("CREATE FUNCTION reject_receipt_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='receivable.payment_recorded' THEN RAISE EXCEPTION 'synthetic receipt rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_receipt_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_receipt_event();").execute(&admin).await.unwrap();
    let path = format!("/api/v1/receivables/{TITLE_A}/payments");
    let key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            "editor",
            Some(1),
            Some(key),
            receipt("1.00")
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivable_payments")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM order_supporting_documents")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    sqlx::raw_sql("DROP TRIGGER reject_receipt_event ON outbox_events;")
        .execute(&admin)
        .await
        .unwrap();
    let received = call(
        &router,
        "POST",
        &path,
        "editor",
        Some(1),
        Some(key),
        receipt("1.00"),
    )
    .await;
    assert_eq!(received.0, StatusCode::OK, "{}", received.1);
    let docs = format!("/api/v1/orders/{ORDER}/documents");
    let upload = json!({"paymentId":received.1["payments"][0]["id"],"document":document()});
    let doc_key = Uuid::now_v7();
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            &docs,
            "editor",
            None,
            Some(doc_key),
            upload.clone()
        ),
        call(
            &router,
            "POST",
            &docs,
            "editor",
            None,
            Some(doc_key),
            upload
        )
    );
    assert_eq!(a.0, StatusCode::CREATED, "{}", a.1);
    assert_eq!(a, b);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM order_supporting_documents")
            .fetch_one(&admin)
            .await
            .unwrap(),
        2
    );
    let id = a.1["data"]["id"].as_str().unwrap();
    assert!(
        sqlx::query(
            "UPDATE order_supporting_documents SET description='changed' WHERE id=$1::uuid"
        )
        .bind(id)
        .execute(&admin)
        .await
        .is_err()
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn order_receipts_not_originated_inconsistent_and_cancelled_are_never_paid(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let path = format!("/api/v1/orders/{ORDER}/finance");
    sqlx::query("UPDATE receivables SET amount_cents=1 WHERE id=$1::uuid")
        .bind(TITLE_A)
        .execute(&admin)
        .await
        .unwrap();
    let invalid = call(&router, "GET", &path, "reader", None, None, Value::Null).await;
    assert_eq!(invalid.0, StatusCode::OK, "{}", invalid.1);
    assert_eq!(invalid.1["state"], "inconsistent");
    sqlx::query("DELETE FROM receivables WHERE order_id=$1::uuid")
        .bind(ORDER)
        .execute(&admin)
        .await
        .unwrap();
    let none = call(&router, "GET", &path, "reader", None, None, Value::Null)
        .await
        .1;
    assert_eq!(none["state"], "not_originated");
    assert_eq!(none["receivedAmount"], "0.00");
    assert_eq!(none["outstandingAmount"], "100000.00");
    sqlx::query("UPDATE sales_orders SET status='cancelled' WHERE id=$1::uuid")
        .bind(ORDER)
        .execute(&admin)
        .await
        .unwrap();
    let cancelled = call(&router, "GET", &path, "reader", None, None, Value::Null)
        .await
        .1;
    assert_eq!(cancelled["state"], "cancelled");
    assert_eq!(cancelled["outstandingAmount"], "0.00");
    let uploaded = call(
        &router,
        "POST",
        &format!("/api/v1/orders/{ORDER}/documents"),
        "editor",
        None,
        Some(Uuid::now_v7()),
        json!({"document":document()}),
    )
    .await;
    assert_eq!(uploaded.0, StatusCode::CREATED, "{}", uploaded.1);
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn order_receipts_exact_ten_mib_proof_crosses_both_post_routes_and_downloads_original_hash(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let mut original = vec![b'x'; 10 * 1024 * 1024];
    original[..9].copy_from_slice(b"%PDF-1.4\n");
    let expected_hash = format!("{:x}", Sha256::digest(&original));
    let large_document = json!({"filename":"comprovante-limite.pdf","mediaType":"application/pdf",
        "contentBase64":STANDARD.encode(&original),"description":"Comprovante original no limite permitido","documentDate":"2026-11-13"});
    let mut payment = receipt("1.00");
    payment["supportingDocument"] = large_document.clone();
    // This request must pass the route override, not Axum's 2 MiB default.
    assert!(payment.to_string().len() > 2 * 1024 * 1024);
    let received = call(
        &router,
        "POST",
        &format!("/api/v1/receivables/{TITLE_A}/payments"),
        "editor",
        Some(1),
        Some(Uuid::now_v7()),
        payment,
    )
    .await;
    assert_eq!(received.0, StatusCode::OK, "{}", received.1);
    let payment_id = received.1["payments"][0]["id"].clone();
    let docs_path = format!("/api/v1/orders/{ORDER}/documents");
    let first = call(
        &router,
        "GET",
        &docs_path,
        "reader",
        None,
        None,
        Value::Null,
    )
    .await
    .1;
    assert_eq!(first["data"].as_array().unwrap().len(), 1);
    assert_eq!(first["data"][0]["byteSize"], original.len());
    assert_eq!(first["data"][0]["sha256"], expected_hash);
    let later = call(
        &router,
        "POST",
        &docs_path,
        "editor",
        None,
        Some(Uuid::now_v7()),
        json!({"paymentId":payment_id,"document":large_document}),
    )
    .await;
    assert_eq!(later.0, StatusCode::CREATED, "{}", later.1);
    assert_eq!(later.1["data"]["byteSize"], original.len());
    assert_eq!(later.1["data"]["sha256"], expected_hash);
    let download = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "{docs_path}/{}",
                    later.1["data"]["id"].as_str().unwrap()
                ))
                .header("authorization", "Bearer reader")
                .header("x-tenant-id", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(download.status(), StatusCode::OK);
    assert_eq!(download.headers()["content-type"], "application/pdf");
    assert_eq!(download.headers()["cache-control"], "private, no-store");
    assert_eq!(download.headers()["x-content-type-options"], "nosniff");
    let downloaded = to_bytes(download.into_body(), original.len())
        .await
        .unwrap();
    assert_eq!(downloaded.len(), original.len());
    assert_eq!(format!("{:x}", Sha256::digest(&downloaded)), expected_hash);
    let finance = call(
        &router,
        "GET",
        &format!("/api/v1/orders/{ORDER}/finance"),
        "reader",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(finance.1["receivedAmount"], "1.00");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivable_payments")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn order_receipts_replay_pre_upgrade_command_without_optional_fields_or_new_effects(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let payment = Uuid::now_v7();
    sqlx::query("INSERT INTO receivable_payments(id,tenant_id,receivable_id,kind,amount_cents,method,reference,occurred_on) VALUES($1,$2,$3,'receipt',100,'cash','Recebimento anterior à atualização','2026-11-13')")
        .bind(payment).bind(Uuid::parse_str(TENANT).unwrap()).bind(Uuid::parse_str(TITLE_A).unwrap())
        .execute(&admin).await.unwrap();
    sqlx::query("UPDATE receivables SET revision=2 WHERE id=$1")
        .bind(Uuid::parse_str(TITLE_A).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let path = format!("/api/v1/receivables/{TITLE_A}");
    let previous = call(&router, "GET", &path, "editor", None, None, Value::Null).await;
    assert_eq!(previous.0, StatusCode::OK, "{}", previous.1);
    assert_eq!(previous.1["data"]["revision"], 2);
    assert!(previous.1["payments"][0].get("paymentMethodId").is_none());
    let old_input = json!({"amount":"1.00","method":"cash","reference":"Recebimento anterior à atualização",
        "occurredOn":"2026-11-13","financialAccountId":null});
    let key = Uuid::now_v7();
    // Persist the exact pre-upgrade canonical envelope: neither extension existed.
    let old_request = json!({"id":TITLE_A,"revision":1,"input":old_input});
    sqlx::query("INSERT INTO domain_commands(tenant_id,auth_subject,command_key,scope,request,result) VALUES($1,'editor',$2,'receivable.pay',$3,$4)")
        .bind(Uuid::parse_str(TENANT).unwrap()).bind(key).bind(&old_request).bind(&previous.1)
        .execute(&admin).await.unwrap();
    let replayed = call(
        &router,
        "POST",
        &format!("{path}/payments"),
        "editor",
        Some(1),
        Some(key),
        old_input.clone(),
    )
    .await;
    assert_eq!(replayed, previous);
    let mut changed = old_input;
    changed["amount"] = json!("2.00");
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("{path}/payments"),
            "editor",
            Some(1),
            Some(key),
            changed
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    for (table, expected) in [
        ("receivable_payments", 1i64),
        ("domain_commands", 1),
        ("order_supporting_documents", 0),
        ("audit_log", 0),
        ("outbox_events", 0),
    ] {
        let query = format!("SELECT count(*) FROM {table}");
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&query)
                .fetch_one(&admin)
                .await
                .unwrap(),
            expected,
            "{table} must not gain effects on replay"
        );
    }
    cleanup(&admin, application, server, &role).await;
}
