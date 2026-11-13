use super::company_tests::{cleanup, setup};
use crate::domains::sales::checkout::{self, CheckoutInput};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const CUSTOMER: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const METHOD: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACCOUNT: &str = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

async fn operation(
    router: &Router,
    order: Uuid,
    action: &str,
    rev: i64,
    key: Uuid,
) -> (StatusCode, HeaderMap, Value) {
    call(
        router,
        (TENANT, "editor"),
        "POST",
        &format!("/api/v1/orders/{order}/{action}"),
        Some(rev),
        Some(key),
        json!({}),
    )
    .await
}

async fn titles(admin: &PgPool, order: Uuid) -> Vec<Uuid> {
    sqlx::query_scalar("SELECT r.id FROM receivables r JOIN sales_order_installments i ON i.tenant_id=r.tenant_id AND i.id=r.order_installment_id WHERE r.order_id=$1 ORDER BY i.number").bind(order).fetch_all(admin).await.unwrap()
}

async fn financial_snapshot(admin: &PgPool, order: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('titles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM receivables r WHERE r.order_id=$1),'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM receivable_payments p JOIN receivables r ON r.tenant_id=p.tenant_id AND r.id=p.receivable_id WHERE r.order_id=$1),'schedule',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.number) FROM sales_order_installments i WHERE i.order_id=$1))").bind(order).fetch_one(admin).await.unwrap()
}

fn proof() -> Value {
    json!({"filename":"comprovante.pdf","mediaType":"application/pdf","contentBase64":STANDARD.encode(b"%PDF-1.4\nacceptance-proof"),"description":"Original sintético","documentDate":"2026-11-13"})
}

async fn pay(router: &Router, title: Uuid, rev: i64, amount: &str) -> Value {
    let paid = call(router,(TENANT,"editor"),"POST",&format!("/api/v1/receivables/{title}/payments"),Some(rev),Some(Uuid::now_v7()),json!({"amount":amount,"method":"bank_transfer","paymentMethodId":METHOD,"reference":"Recebimento sintético","occurredOn":"2026-11-13","financialAccountId":ACCOUNT,"supportingDocument":proof()})).await;
    assert_eq!(paid.0, StatusCode::OK, "{}", paid.2);
    paid.2
}

async fn seed_account(admin: &PgPool) {
    sqlx::query("INSERT INTO financial_accounts(id,tenant_id,code,name,status,revision,account_type) VALUES($1::uuid,$2::uuid,'ACCEPT-CASH','Caixa sintético','active',1,'cash')").bind(ACCOUNT).bind(TENANT).execute(admin).await.unwrap();
}

async fn receipt(router: &Router) {
    let stock = call(router,(TENANT,"editor"),"POST","/api/v1/stock/movements",None,Some(Uuid::now_v7()),json!({"productId":PRODUCT,"direction":"receipt","quantity":"1.000000","reason":"Chegada física sintética conferida","reversesId":null})).await;
    assert_eq!(stock.0, StatusCode::CREATED, "{}", stock.2);
}

async fn physical(admin: &PgPool) -> (i64, i64, i64) {
    sqlx::query_as("SELECT COALESCE((SELECT quantity_micros FROM stock_balances WHERE product_id=$1::uuid),0),COALESCE((SELECT sum(l.quantity_micros)::bigint FROM sales_order_lines l JOIN sales_orders o ON o.tenant_id=l.tenant_id AND o.id=l.order_id WHERE o.status='confirmed' AND l.product_id=$1::uuid),0),(SELECT count(*) FROM stock_movements WHERE product_id=$1::uuid)").bind(PRODUCT).fetch_one(admin).await.unwrap()
}

async fn signed_fixture(admin: &PgPool, order: Uuid) -> Uuid {
    let contract = Uuid::now_v7();
    sqlx::query("INSERT INTO commercial_contracts(id,tenant_id,customer_id,order_id,template_id,template_name,template_snapshot,snapshot,recipients,fields,fingerprint,status) VALUES($1,$2::uuid,$3::uuid,$4,2,'Contrato sintético','{}','{\"accepted\":true}','[]','{}','acceptance-signature-preservation','completed')").bind(contract).bind(TENANT).bind(CUSTOMER).bind(order).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO commercial_contract_files(id,tenant_id,contract_id,kind,position,sha256,content) VALUES($1,$2::uuid,$3,'signed',0,'658a04a0a4f9863fb9d1abfffcf9c3e7779954647c57e58cda349318fb150074',decode('255044462d312e340a7369676e6564','hex'))").bind(Uuid::now_v7()).bind(TENANT).bind(contract).execute(admin).await.unwrap();
    contract
}

async fn evidence(admin: &PgPool, order: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('proofs',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM order_supporting_documents d WHERE d.order_id=$1),'contract',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM commercial_contracts c WHERE c.order_id=$1),'signed',(SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM commercial_contract_files f JOIN commercial_contracts c ON c.tenant_id=f.tenant_id AND c.id=f.contract_id WHERE c.order_id=$1))").bind(order).fetch_one(admin).await.unwrap()
}

async fn seed(admin: &PgPool) {
    super::returns_tests::seed(admin).await;
    sqlx::raw_sql("UPDATE products SET price_cents=10000000 WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'; INSERT INTO payment_methods(id,tenant_id,code,name,status,revision,modality,settlement_days) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','ACCEPT-PIX','Pix sintético','active',1,'pix',0); INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read') ON CONFLICT DO NOTHING;")
        .execute(admin).await.unwrap();
}

async fn call(
    router: &Router,
    actor: (&str, &str),
    method: &str,
    uri: &str,
    revision: Option<i64>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {}", actor.1))
        .header("x-tenant-id", actor.0)
        .header("content-type", "application/json");
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
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
    let bytes = to_bytes(body, 1_000_000).await.unwrap();
    (
        parts.status,
        parts.headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn draft(router: &Router) -> Uuid {
    let result = call(router, (TENANT, "editor"), "POST", "/api/v1/orders", None, Some(Uuid::now_v7()), json!({"customerId":CUSTOMER,"dueDate":"2027-01-30","items":[{"productId":PRODUCT,"quantity":"1.000000"}]})).await;
    assert_eq!(result.0, StatusCode::CREATED, "{}", result.2);
    Uuid::parse_str(result.2["data"]["id"].as_str().unwrap()).unwrap()
}

async fn save(application: &PgPool, order: Uuid) {
    save_with_entry_due(application, order, None).await;
}

async fn save_with_entry_due(application: &PgPool, order: Uuid, due: Option<&str>) {
    let input: CheckoutInput = serde_json::from_value(json!({"entry":{"paymentMethodId":METHOD,"dueOn":due},"installments":[{"paymentMethodId":METHOD,"dueOn":"2027-01-30","amountCents":5000000}],"manufacturingDays":45,"deliveryNotes":"Entrega após chegada real","paymentNotes":"Entrada e saldo","notes":"Acordo preservado"})).unwrap();
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(TENANT)
        .execute(&mut *tx)
        .await
        .unwrap();
    checkout::save(
        &mut tx,
        Uuid::parse_str(TENANT).unwrap(),
        order,
        Uuid::parse_str(CUSTOMER).unwrap(),
        10000000,
        5000000,
        &input,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

async fn accept(
    router: &Router,
    order: Uuid,
    revision: i64,
    key: Uuid,
) -> (StatusCode, HeaderMap, Value) {
    call(
        router,
        (TENANT, "editor"),
        "POST",
        &format!("/api/v1/orders/{order}/accept"),
        Some(revision),
        Some(key),
        json!({}),
    )
    .await
}

async fn unchanged(admin: &PgPool, order: Uuid) {
    let state: (String, i64) =
        sqlx::query_as("SELECT status,revision FROM sales_orders WHERE id=$1")
            .bind(order)
            .fetch_one(admin)
            .await
            .unwrap();
    assert_eq!(state, ("draft".into(), 1));
    let titles: i64 = sqlx::query_scalar("SELECT count(*) FROM receivables WHERE order_id=$1")
        .bind(order)
        .fetch_one(admin)
        .await
        .unwrap();
    assert_eq!(titles, 0);
    let commands: i64 =
        sqlx::query_scalar("SELECT count(*) FROM domain_commands WHERE scope='order.accept'")
            .fetch_one(admin)
            .await
            .unwrap();
    assert_eq!(commands, 0);
}

// Catches acceptance incorrectly requiring stock, leaving an editable obligation,
// duplicating titles on replay, or treating planned entry as received money.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_zero_stock_freezes_checkout_and_originates_all_titles_once(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    save(&application, order).await;
    let before = call(
        &router,
        (TENANT, "editor"),
        "GET",
        &format!("/api/v1/orders/{order}"),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(before.0, StatusCode::OK);
    assert_eq!(before.2["data"]["amount"], "100000.00");
    assert!(before.2["checkout"]["entry"]["dueOn"].is_null());
    let key = Uuid::now_v7();
    let accepted = accept(&router, order, 1, key).await;
    assert_eq!(accepted.0, StatusCode::OK, "{}", accepted.2);
    assert_eq!(accepted.1["etag"], "\"2\"");
    assert_eq!(accepted.2["data"]["status"], "accepted");
    assert_eq!(accepted.2["data"]["revision"], 2);
    assert_eq!(
        accepted.2["checkout"]["confirmationCreatesReceivables"],
        false
    );
    assert_eq!(
        accepted.2["checkout"]["customer"],
        before.2["checkout"]["customer"]
    );
    let local_date: String = sqlx::query_scalar(
        "SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date::text",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(accepted.2["checkout"]["entry"]["dueOn"], local_date);
    let replayed = accept(&router, order, 1, key).await;
    assert_eq!((replayed.0, replayed.2), (accepted.0, accepted.2.clone()));
    let titles: Vec<(i32,i64,String,String)> = sqlx::query_as("SELECT i.number,r.amount_cents,r.due_date::text,r.status FROM receivables r JOIN sales_order_installments i ON i.tenant_id=r.tenant_id AND i.id=r.order_installment_id WHERE r.order_id=$1 ORDER BY i.number").bind(order).fetch_all(&admin).await.unwrap();
    assert_eq!(
        titles,
        vec![
            (0, 5000000, local_date, "open".into()),
            (1, 5000000, "2027-01-30".into(), "open".into())
        ]
    );
    let physical: (i64,i64,i64,i64) = sqlx::query_as("SELECT (SELECT count(*) FROM stock_balances),(SELECT count(*) FROM stock_movements),(SELECT count(*) FROM receivable_payments),(SELECT count(*) FROM sales_orders WHERE status='confirmed')").fetch_one(&admin).await.unwrap();
    assert_eq!(physical, (0, 0, 0, 0));
    let command: (String, Value) =
        sqlx::query_as("SELECT scope,request FROM domain_commands WHERE command_key=$1")
            .bind(key)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(
        command,
        ("order.accept".into(), json!({"id":order,"revision":1}))
    );
    assert_eq!(accept(&router, order, 2, key).await.0, StatusCode::CONFLICT);
    assert_eq!(
        accept(&router, order, 2, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    let edit = call(&router,(TENANT,"editor"),"PUT",&format!("/api/v1/orders/{order}"),Some(2),Some(Uuid::now_v7()),json!({"customerId":CUSTOMER,"dueDate":"2027-02-20","items":[{"productId":PRODUCT,"quantity":"2.000000"}]})).await;
    assert_eq!(edit.0, StatusCode::CONFLICT);
    let event: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM outbox_events WHERE event_type='order.accepted' AND aggregate_id=$1",
    )
    .bind(order.to_string())
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(event, 1);
    let origin: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action='receivable.created' AND details->>'source'='accepted_order_schedule'").fetch_one(&admin).await.unwrap();
    assert_eq!(origin, 2);
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='sales.orders.manage'").execute(&admin).await.unwrap();
    assert_eq!(
        accept(&router, order, 1, key).await.0,
        StatusCode::FORBIDDEN
    );
    cleanup(&admin, application, server, &role).await;
}

// Catches missing commercial/auth/revision validation before any obligation exists.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_rejects_missing_checkout_pending_approval_foreign_or_unmanaged_order(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    unchanged(&admin, order).await;
    save(&application, order).await;
    for (revision, key) in [(None, Some(Uuid::now_v7())), (Some(1), None)] {
        let result = call(
            &router,
            (TENANT, "editor"),
            "POST",
            &format!("/api/v1/orders/{order}/accept"),
            revision,
            key,
            json!({}),
        )
        .await;
        assert_eq!(result.0, StatusCode::PRECONDITION_REQUIRED, "{}", result.2);
        unchanged(&admin, order).await;
    }
    for (actor, revision, status) in [
        ((TENANT, "reader"), 1, StatusCode::FORBIDDEN),
        ((OTHER, "editor"), 1, StatusCode::FORBIDDEN),
        ((TENANT, "disabled"), 1, StatusCode::FORBIDDEN),
        ((TENANT, "editor"), 2, StatusCode::PRECONDITION_FAILED),
    ] {
        let result = call(
            &router,
            actor,
            "POST",
            &format!("/api/v1/orders/{order}/accept"),
            Some(revision),
            Some(Uuid::now_v7()),
            json!({}),
        )
        .await;
        assert_eq!(result.0, status, "{}", result.2);
        unchanged(&admin, order).await;
    }
    for (mutation, restore) in [
        (
            "UPDATE sales_orders SET amount_cents=10000001",
            "UPDATE sales_orders SET amount_cents=10000000",
        ),
        (
            "UPDATE parties SET status='archived'",
            "UPDATE parties SET status='active'",
        ),
        (
            "UPDATE parties SET is_customer=false",
            "UPDATE parties SET is_customer=true",
        ),
        (
            "UPDATE products SET status='archived'",
            "UPDATE products SET status='active'",
        ),
        (
            "UPDATE products SET unit='KG'",
            "UPDATE products SET unit='UN'",
        ),
    ] {
        sqlx::query(mutation).execute(&admin).await.unwrap();
        let result = accept(&router, order, 1, Uuid::now_v7()).await;
        assert_eq!(result.0, StatusCode::CONFLICT, "{mutation}: {}", result.2);
        unchanged(&admin, order).await;
        sqlx::query(restore).execute(&admin).await.unwrap();
    }
    // An authorized actor in another tenant must still not find this order.
    sqlx::raw_sql("INSERT INTO tenant_memberships(id,tenant_id,identity_id,status) VALUES('12121212-1212-4212-8212-121212121212','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','active'); INSERT INTO roles(id,tenant_id,code,name) VALUES('13131313-1313-4313-8313-131313131313','22222222-2222-4222-8222-222222222222','other-editor','Editor sintético'); INSERT INTO membership_roles(membership_id,role_id) VALUES('12121212-1212-4212-8212-121212121212','13131313-1313-4313-8313-131313131313'); INSERT INTO role_permissions(role_id,permission_code) VALUES('13131313-1313-4313-8313-131313131313','sales.orders.read'),('13131313-1313-4313-8313-131313131313','sales.orders.manage')").execute(&admin).await.unwrap();
    let foreign = call(
        &router,
        (OTHER, "editor"),
        "POST",
        &format!("/api/v1/orders/{order}/accept"),
        Some(1),
        Some(Uuid::now_v7()),
        json!({}),
    )
    .await;
    assert_eq!(foreign.0, StatusCode::NOT_FOUND, "{}", foreign.2);
    unchanged(&admin, order).await;
    // The same minimum, term and contact rules as direct confirmation apply.
    sqlx::raw_sql("INSERT INTO sales_settings(tenant_id,revision,minimum_order_amount_cents,maximum_payment_term_days,require_customer_contact) VALUES('11111111-1111-4111-8111-111111111111',1,10000001,3650,false)").execute(&admin).await.unwrap();
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    unchanged(&admin, order).await;
    sqlx::raw_sql("UPDATE sales_settings SET minimum_order_amount_cents=0,maximum_payment_term_days=0; UPDATE sales_orders SET due_date=(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date+1").execute(&admin).await.unwrap();
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    unchanged(&admin, order).await;
    sqlx::query(
        "UPDATE sales_settings SET maximum_payment_term_days=3650,require_customer_contact=true",
    )
    .execute(&admin)
    .await
    .unwrap();
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    unchanged(&admin, order).await;
    sqlx::query("UPDATE sales_settings SET require_customer_contact=false")
        .execute(&admin)
        .await
        .unwrap();
    // A real quote with a pending management decision must keep blocking acceptance.
    sqlx::raw_sql("INSERT INTO commercial_settings(tenant_id,product_line,parameters,revision) VALUES('11111111-1111-4111-8111-111111111111','imported','{}',1); INSERT INTO price_table_versions(id,tenant_id,product_line,version,settings_revision,policy_snapshot,calculator_version,digest,published_by) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','imported',1,1,'{}','acceptance-test',repeat('a',64),'33333333-3333-4333-8333-333333333333')").execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO commercial_order_quotes(tenant_id,order_id,price_version_id,public_snapshot,private_snapshot,approval_rules,approval_status,requires_director,created_by) VALUES($1::uuid,$2,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','{}','{}','{}','pending',false,'33333333-3333-4333-8333-333333333333')").bind(TENANT).bind(order).execute(&admin).await.unwrap();
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    unchanged(&admin, order).await;
    sqlx::query("UPDATE commercial_order_quotes SET approval_status='approved'")
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query("INSERT INTO order_pricing_snapshots(tenant_id,order_id,version_id,snapshot,needs_approval) VALUES($1::uuid,$2,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','{}',true)").bind(TENANT).bind(order).execute(&admin).await.unwrap();
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    unchanged(&admin, order).await;
    cleanup(&admin, application, server, &role).await;
}

// Catches accidentally originating a checkout alongside an existing legacy title.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_refuses_preexisting_titles_without_financial_or_order_effects(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    save(&application, order).await;
    let existing = Uuid::now_v7();
    sqlx::query("INSERT INTO receivables(id,tenant_id,order_id,customer_name,due_date,amount_cents,status) VALUES($1,$2::uuid,$3,'Título sintético legado','2027-01-30',10000000,'open')").bind(existing).bind(TENANT).bind(order).execute(&admin).await.unwrap();
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::CONFLICT
    );
    let state: (String, i64) =
        sqlx::query_as("SELECT status,revision FROM sales_orders WHERE id=$1")
            .bind(order)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(state, ("draft".into(), 1));
    let titles: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM receivables WHERE order_id=$1")
        .bind(order)
        .fetch_all(&admin)
        .await
        .unwrap();
    assert_eq!(titles, vec![existing]);
    let due: Option<String> = sqlx::query_scalar(
        "SELECT due_on::text FROM sales_order_installments WHERE order_id=$1 AND kind='entry'",
    )
    .bind(order)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert!(due.is_none());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_commands WHERE scope='order.accept'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    cleanup(&admin, application, server, &role).await;
}

// Catches partial transaction commits when publishing the accepted event fails.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_outbox_failure_rolls_back_order_due_date_titles_audit_and_command(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    save(&application, order).await;
    let audits: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log")
        .fetch_one(&admin)
        .await
        .unwrap();
    let events: i64 = sqlx::query_scalar("SELECT count(*) FROM outbox_events")
        .fetch_one(&admin)
        .await
        .unwrap();
    sqlx::raw_sql("CREATE FUNCTION fail_acceptance_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='order.accepted' THEN RAISE EXCEPTION 'synthetic acceptance failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_acceptance_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_acceptance_outbox();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        accept(&router, order, 1, key).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    unchanged(&admin, order).await;
    let due: Option<String> = sqlx::query_scalar(
        "SELECT due_on::text FROM sales_order_installments WHERE order_id=$1 AND kind='entry'",
    )
    .bind(order)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert!(due.is_none());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap(),
        audits
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM outbox_events")
            .fetch_one(&admin)
            .await
            .unwrap(),
        events
    );
    sqlx::query("DROP TRIGGER fail_acceptance_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(accept(&router, order, 1, key).await.0, StatusCode::OK);
    cleanup(&admin, application, server, &role).await;
}

// Catches an acceptance/confirmation race bypassing revision or double origin.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_competes_with_confirmation_and_repeated_acceptance(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let stock = call(&router,(TENANT,"editor"),"POST","/api/v1/stock/movements",None,Some(Uuid::now_v7()),json!({"productId":PRODUCT,"direction":"receipt","quantity":"1.000000","reason":"Entrada física sintética","reversesId":null})).await;
    assert_eq!(stock.0, StatusCode::CREATED, "{}", stock.2);
    let order = draft(&router).await;
    save(&application, order).await;
    let accept_key = Uuid::now_v7();
    let confirm_path = format!("/api/v1/orders/{order}/confirm");
    let (accepted, confirmed) = tokio::join!(
        accept(&router, order, 1, accept_key),
        call(
            &router,
            (TENANT, "editor"),
            "POST",
            &confirm_path,
            Some(1),
            Some(Uuid::now_v7()),
            json!({})
        )
    );
    assert!(
        (accepted.0 == StatusCode::OK && confirmed.0 == StatusCode::PRECONDITION_FAILED)
            || (confirmed.0 == StatusCode::OK && accepted.0 == StatusCode::PRECONDITION_FAILED),
        "accept {} confirm {}",
        accepted.2,
        confirmed.2
    );
    let titles: (i64, i64) = sqlx::query_as(
        "SELECT count(*),sum(amount_cents)::bigint FROM receivables WHERE order_id=$1",
    )
    .bind(order)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(titles, (2, 10000000));
    let order2 = draft(&router).await;
    save(&application, order2).await;
    let key = Uuid::now_v7();
    let (first, second) = tokio::join!(
        accept(&router, order2, 1, key),
        accept(&router, order2, 1, key)
    );
    assert_eq!(first.0, StatusCode::OK, "{}", first.2);
    assert_eq!((second.0, second.2), (first.0, first.2));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables WHERE order_id=$1")
            .bind(order2)
            .fetch_one(&admin)
            .await
            .unwrap(),
        2
    );
    cleanup(&admin, application, server, &role).await;
}

// Catches treating planned money or full settlement as physical receipt/reservation,
// and losing original proofs or the signed contract when another proof arrives.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_receives_50000_10000_40000_before_physical_arrival(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    seed_account(&admin).await;
    let order = draft(&router).await;
    save(&application, order).await;
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::OK
    );
    let ids = titles(&admin, order).await;
    assert_eq!(ids.len(), 2);
    let mut first_payment = Value::Null;
    for (index, (title, rev, amount, received, outstanding)) in [
        (ids[0], 1, "50000.00", "50000.00", "50000.00"),
        (ids[1], 1, "10000.00", "60000.00", "40000.00"),
        (ids[1], 2, "40000.00", "100000.00", "0.00"),
    ]
    .into_iter()
    .enumerate()
    {
        let paid = pay(&router, title, rev, amount).await;
        if index == 0 {
            first_payment = paid["payments"][0]["id"].clone();
        }
        let state = call(
            &router,
            (TENANT, "editor"),
            "GET",
            &format!("/api/v1/orders/{order}/finance"),
            None,
            None,
            Value::Null,
        )
        .await;
        assert_eq!(state.0, StatusCode::OK, "{}", state.2);
        assert_eq!(state.2["receivedAmount"], received);
        assert_eq!(state.2["outstandingAmount"], outstanding);
        assert_eq!(physical(&admin).await, (0, 0, 0));
    }
    signed_fixture(&admin, order).await;
    let before = evidence(&admin, order).await;
    assert_eq!(before["proofs"].as_array().unwrap().len(), 3);
    let money = financial_snapshot(&admin, order).await;
    let attached = call(
        &router,
        (TENANT, "editor"),
        "POST",
        &format!("/api/v1/orders/{order}/documents"),
        None,
        Some(Uuid::now_v7()),
        json!({"paymentId":first_payment,"document":proof()}),
    )
    .await;
    assert_eq!(attached.0, StatusCode::CREATED, "{}", attached.2);
    let after = evidence(&admin, order).await;
    assert_eq!(after["signed"], before["signed"]);
    assert_eq!(after["contract"], before["contract"]);
    assert_eq!(after["proofs"].as_array().unwrap().len(), 4);
    for original in before["proofs"].as_array().unwrap() {
        assert!(after["proofs"].as_array().unwrap().contains(original));
    }
    assert_eq!(financial_snapshot(&admin, order).await, money);
    assert_eq!(
        operation(&router, order, "complete", 2, Uuid::now_v7())
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(physical(&admin).await, (0, 0, 0));
    cleanup(&admin, application, server, &role).await;
}

// Catches reoriginating/redating accepted titles, losing partial receipts, creating
// another title at completion, or letting payment substitute for real stock.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_reserves_after_real_receipt_without_reoriginating_or_redating(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    seed_account(&admin).await;
    let order = draft(&router).await;
    save_with_entry_due(&application, order, Some("2026-10-30")).await;
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::OK
    );
    let ids = titles(&admin, order).await;
    pay(&router, ids[0], 1, "50000.00").await;
    pay(&router, ids[1], 1, "10000.00").await;
    let before = financial_snapshot(&admin, order).await;
    let key = Uuid::now_v7();
    assert_eq!(
        operation(&router, order, "confirm", 2, key).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(financial_snapshot(&admin, order).await, before);
    assert_eq!(physical(&admin).await, (0, 0, 0));
    let state: (String, i64) =
        sqlx::query_as("SELECT status,revision FROM sales_orders WHERE id=$1")
            .bind(order)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(state, ("accepted".into(), 2));
    receipt(&router).await;
    let confirmed = operation(&router, order, "confirm", 2, key).await;
    assert_eq!(confirmed.0, StatusCode::OK, "{}", confirmed.2);
    assert_eq!(confirmed.2["data"]["status"], "confirmed");
    assert_eq!(confirmed.1["etag"], "\"3\"");
    assert_eq!(
        operation(&router, order, "confirm", 2, key).await.2,
        confirmed.2
    );
    assert_eq!(
        operation(&router, order, "confirm", 3, Uuid::now_v7())
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(physical(&admin).await, (1000000, 1000000, 1));
    assert_eq!(financial_snapshot(&admin, order).await, before);
    let completed = operation(&router, order, "complete", 3, Uuid::now_v7()).await;
    assert_eq!(completed.0, StatusCode::OK, "{}", completed.2);
    assert_eq!(physical(&admin).await, (0, 0, 2));
    assert_eq!(financial_snapshot(&admin, order).await, before);
    assert_eq!(titles(&admin, order).await, ids);
    cleanup(&admin, application, server, &role).await;
}

// Catches either repricing frozen accepted agreements, bypassing current physical
// product/customer checks, or oversubscribing the same real unit concurrently.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_reservation_competes_with_other_orders_and_honors_frozen_terms(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let a = draft(&router).await;
    let b = draft(&router).await;
    for order in [a, b] {
        save(&application, order).await;
        assert_eq!(
            accept(&router, order, 1, Uuid::now_v7()).await.0,
            StatusCode::OK
        );
    }
    let before_a = financial_snapshot(&admin, a).await;
    let before_b = financial_snapshot(&admin, b).await;
    receipt(&router).await;
    for (mutation, restore) in [
        (
            "UPDATE parties SET status='archived'",
            "UPDATE parties SET status='active'",
        ),
        (
            "UPDATE parties SET is_customer=false",
            "UPDATE parties SET is_customer=true",
        ),
        (
            "UPDATE products SET status='archived'",
            "UPDATE products SET status='active'",
        ),
        (
            "UPDATE products SET unit='KG'",
            "UPDATE products SET unit='UN'",
        ),
    ] {
        sqlx::query(mutation).execute(&admin).await.unwrap();
        assert_eq!(
            operation(&router, a, "confirm", 2, Uuid::now_v7()).await.0,
            StatusCode::CONFLICT,
            "{mutation}"
        );
        assert_eq!(physical(&admin).await, (1000000, 0, 1));
        sqlx::query(restore).execute(&admin).await.unwrap();
    }
    sqlx::raw_sql("UPDATE products SET price_cents=1; UPDATE payment_methods SET status='archived'; INSERT INTO sales_settings(tenant_id,revision,minimum_order_amount_cents,maximum_payment_term_days,require_customer_contact) VALUES('11111111-1111-4111-8111-111111111111',1,10000001,0,true); INSERT INTO commercial_settings(tenant_id,product_line,parameters,revision) VALUES('11111111-1111-4111-8111-111111111111','imported','{}',1)").execute(&admin).await.unwrap();
    sqlx::raw_sql("INSERT INTO price_table_versions(id,tenant_id,product_line,version,settings_revision,policy_snapshot,calculator_version,digest,published_by) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111','imported',1,1,'{}','acceptance-future-policy',repeat('b',64),'33333333-3333-4333-8333-333333333333'); INSERT INTO price_table_items(tenant_id,version_id,product_id,product_snapshot,cost_revision,cost_snapshot,price_without_ipi_cents,ipi_bps,price_with_ipi_cents) VALUES('11111111-1111-4111-8111-111111111111','ffffffff-ffff-4fff-8fff-ffffffffffff','cccccccc-cccc-4ccc-8ccc-cccccccccccc','{}',1,'{}',1,0,1); UPDATE commercial_settings SET active_price_version_id='ffffffff-ffff-4fff-8fff-ffffffffffff'").execute(&admin).await.unwrap();
    let (x, y) = tokio::join!(
        operation(&router, a, "confirm", 2, Uuid::now_v7()),
        operation(&router, b, "confirm", 2, Uuid::now_v7())
    );
    let mut statuses = [x.0.as_u16(), y.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 409], "a={} b={}", x.2, y.2);
    assert_eq!(physical(&admin).await, (1000000, 1000000, 1));
    assert_eq!(financial_snapshot(&admin, a).await, before_a);
    assert_eq!(financial_snapshot(&admin, b).await, before_b);
    cleanup(&admin, application, server, &role).await;
}

// Catches implicit reversal during unshipped cancellation, loss of original
// evidence, or using the completed-sale compensation route for accepted stock.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_cancellation_requires_explicit_reversal_and_preserves_evidence(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    seed_account(&admin).await;
    let order = draft(&router).await;
    // Real immutable commission terms: 5% of the synthetic entry, no IPI.
    sqlx::raw_sql("INSERT INTO staff(id,tenant_id,code,name,is_employee,is_seller,status) VALUES('abababab-abab-4bab-8bab-abababababab','11111111-1111-4111-8111-111111111111','ACCEPT-SELLER','Vendedor sintético',true,true,'active')").execute(&admin).await.unwrap();
    let configured = call(&router,(TENANT,"editor"),"PUT",&format!("/api/v1/orders/{order}/commission"),Some(1),Some(Uuid::now_v7()),json!({"sellerStaffId":"abababab-abab-4bab-8bab-abababababab","commissionRate":"5.0000","ipiRate":"0.0000","paymentDay":10})).await;
    assert_eq!(configured.0, StatusCode::OK, "{}", configured.2);
    save(&application, order).await;
    assert_eq!(
        accept(&router, order, 2, Uuid::now_v7()).await.0,
        StatusCode::OK
    );
    let ids = titles(&admin, order).await;
    let paid = pay(&router, ids[0], 1, "50000.00").await;
    signed_fixture(&admin, order).await;
    let original = evidence(&admin, order).await;
    let before = financial_snapshot(&admin, order).await;
    assert_eq!(
        operation(&router, order, "cancel-completed", 3, Uuid::now_v7())
            .await
            .0,
        StatusCode::CONFLICT
    );
    let cancel_key = Uuid::now_v7();
    let refused = operation(&router, order, "cancel", 3, cancel_key).await;
    assert_eq!(refused.0, StatusCode::CONFLICT, "{}", refused.2);
    assert!(refused.2.to_string().contains("estornos"), "{}", refused.2);
    assert_eq!(financial_snapshot(&admin, order).await, before);
    let reversed = call(&router,(TENANT,"editor"),"POST",&format!("/api/v1/receivables/{}/reverse-payment",ids[0]),Some(2),Some(Uuid::now_v7()),json!({"paymentId":paid["payments"][0]["id"],"reason":"Estorno explícito sintético","occurredOn":"2026-11-14"})).await;
    assert_eq!(reversed.0, StatusCode::OK, "{}", reversed.2);
    let state = call(
        &router,
        (TENANT, "editor"),
        "GET",
        &format!("/api/v1/orders/{order}/finance"),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(state.2["receivedAmount"], "0.00");
    assert_eq!(state.2["outstandingAmount"], "100000.00");
    let ledger:(i64,i64)=sqlx::query_as("SELECT count(*),sum(CASE direction WHEN 'credit' THEN amount_cents ELSE -amount_cents END)::bigint FROM financial_account_entries WHERE account_id=$1::uuid").bind(ACCOUNT).fetch_one(&admin).await.unwrap();
    assert_eq!(ledger, (2, 0));
    let commission: (i64, i64) = sqlx::query_as(
        "SELECT count(*),sum(amount_cents)::bigint FROM commission_entries WHERE order_id=$1",
    )
    .bind(order)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(commission, (2, 0));
    let cancelled = operation(&router, order, "cancel", 3, cancel_key).await;
    assert_eq!(cancelled.0, StatusCode::OK, "{}", cancelled.2);
    assert_eq!(cancelled.2["data"]["status"], "cancelled");
    assert_eq!(
        operation(&router, order, "cancel", 3, cancel_key).await.2,
        cancelled.2
    );
    let cancelled_titles: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM receivables WHERE order_id=$1 AND status='cancelled'",
    )
    .bind(order)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(cancelled_titles, 2);
    assert_eq!(evidence(&admin, order).await, original);
    assert_eq!(physical(&admin).await, (0, 0, 0));
    let reconciliation: Value =
        sqlx::query_scalar("SELECT summary FROM sales_order_cancellations WHERE order_id=$1")
            .bind(order)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(reconciliation["beforeShipment"], true);
    assert_eq!(reconciliation["stockMovementIds"], json!([]));
    assert_eq!(reconciliation["paymentReversalIds"], json!([]));
    cleanup(&admin, application, server, &role).await;
}

// Catches blindly reusing missing, cancelled, redated or changed titles, and
// a late confirmation failure leaving a physical reservation behind.
#[sqlx::test(migrations = "../../migrations")]
async fn acceptance_confirmation_verifies_every_title_and_rolls_back_failed_reservation(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    save(&application, order).await;
    assert_eq!(
        accept(&router, order, 1, Uuid::now_v7()).await.0,
        StatusCode::OK
    );
    receipt(&router).await;
    let ids = titles(&admin, order).await;
    for (mutation, restore) in [
        (
            "UPDATE receivables SET amount_cents=5000001 WHERE id=$1",
            "UPDATE receivables SET amount_cents=5000000 WHERE id=$1",
        ),
        (
            "UPDATE receivables SET due_date=due_date+1 WHERE id=$1",
            "UPDATE receivables SET due_date=due_date-1 WHERE id=$1",
        ),
        (
            "UPDATE receivables SET status='cancelled' WHERE id=$1",
            "UPDATE receivables SET status='open' WHERE id=$1",
        ),
    ] {
        sqlx::query(mutation)
            .bind(ids[1])
            .execute(&admin)
            .await
            .unwrap();
        let before = financial_snapshot(&admin, order).await;
        assert_eq!(
            operation(&router, order, "confirm", 2, Uuid::now_v7())
                .await
                .0,
            StatusCode::CONFLICT,
            "{mutation}"
        );
        assert_eq!(financial_snapshot(&admin, order).await, before);
        assert_eq!(physical(&admin).await, (1000000, 0, 1));
        sqlx::query(restore)
            .bind(ids[1])
            .execute(&admin)
            .await
            .unwrap();
    }
    let extra = Uuid::now_v7();
    sqlx::query("INSERT INTO receivables(id,tenant_id,order_id,customer_name,due_date,amount_cents,status) VALUES($1,$2::uuid,$3,'Título indevido','2027-01-30',1,'open')").bind(extra).bind(TENANT).bind(order).execute(&admin).await.unwrap();
    assert_eq!(
        operation(&router, order, "confirm", 2, Uuid::now_v7())
            .await
            .0,
        StatusCode::CONFLICT
    );
    sqlx::query("DELETE FROM receivables WHERE id=$1")
        .bind(extra)
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query("DELETE FROM receivables WHERE id=$1")
        .bind(ids[1])
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        operation(&router, order, "confirm", 2, Uuid::now_v7())
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(titles(&admin, order).await, vec![ids[0]]);
    sqlx::query("INSERT INTO receivables(id,tenant_id,order_id,order_installment_id,customer_name,due_date,amount_cents,status) SELECT $1,i.tenant_id,i.order_id,i.id,'Cliente fornecedor',i.due_on,i.amount_cents,'open' FROM sales_order_installments i WHERE i.order_id=$2 AND i.number=1").bind(ids[1]).bind(order).execute(&admin).await.unwrap();
    let before = financial_snapshot(&admin, order).await;
    sqlx::raw_sql("CREATE FUNCTION fail_accepted_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='order.confirmed' THEN RAISE EXCEPTION 'synthetic accepted reservation failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_accepted_confirmation BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_accepted_confirmation()").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    assert_eq!(
        operation(&router, order, "confirm", 2, key).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(financial_snapshot(&admin, order).await, before);
    assert_eq!(physical(&admin).await, (1000000, 0, 1));
    sqlx::query("DROP TRIGGER fail_accepted_confirmation ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        operation(&router, order, "confirm", 2, key).await.0,
        StatusCode::OK
    );
    assert_eq!(financial_snapshot(&admin, order).await, before);
    cleanup(&admin, application, server, &role).await;
}
