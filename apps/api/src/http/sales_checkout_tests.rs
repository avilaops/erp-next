use super::company_tests::{cleanup, setup};
use crate::domains::sales::checkout::{self, CheckoutInput};
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
const CUSTOMER: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const METHOD: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACCOUNT: &str = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

async fn seed(admin: &PgPool) {
    super::returns_tests::seed(admin).await;
    sqlx::raw_sql("INSERT INTO financial_accounts(id,tenant_id,code,name,status,revision,account_type) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','CHECKOUT-CASH','Caixa sintético','active',1,'cash')").execute(admin).await.unwrap();
    sqlx::raw_sql("INSERT INTO payment_methods(id,tenant_id,code,name,status,revision,modality,settlement_days) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','PIX','Pix combinado','active',1,'pix',0); UPDATE parties SET addresses='[{\"label\":\"Principal\",\"postalCode\":\"01001000\",\"state\":\"SP\",\"city\":\"São Paulo\",\"street\":\"Rua preservada\",\"number\":\"10\",\"district\":\"Centro\",\"primary\":true}]'::jsonb WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sales.orders.read') ON CONFLICT DO NOTHING;").execute(admin).await.unwrap();
}

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    revision: Option<i64>,
    body: Value,
) -> (StatusCode, Value) {
    call_as(router, "editor", method, uri, revision, body).await
}

async fn call_as(
    router: &Router,
    subject: &str,
    method: &str,
    uri: &str,
    revision: Option<i64>,
    body: Value,
) -> (StatusCode, Value) {
    call_key(router, subject, method, uri, revision, body, Uuid::now_v7()).await
}

async fn call_key(
    router: &Router,
    subject: &str,
    method: &str,
    uri: &str,
    revision: Option<i64>,
    body: Value,
    key: Uuid,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {subject}"))
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json");
    if method != "GET" {
        request = request.header("idempotency-key", key.to_string());
    }
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

fn conditions() -> CheckoutInput {
    serde_json::from_value(json!({
        "entry":{"paymentMethodId":METHOD,"dueOn":null},
        "installments":[
            {"paymentMethodId":METHOD,"dueOn":"2027-01-30","amountCents":30},
            {"paymentMethodId":METHOD,"dueOn":"2027-03-01","amountCents":30}
        ],
        "manufacturingDays":45,"deliveryNotes":"Entregar no endereço cadastrado",
        "paymentNotes":"Saldo em duas parcelas","notes":"Acordo comercial","stateRegistration":"ISENTO"
    }))
    .unwrap()
}

async fn draft(router: &Router) -> Uuid {
    let stock = call(router, "POST", "/api/v1/stock/movements", None,
        json!({"productId":PRODUCT,"direction":"receipt","quantity":"3.000000","reason":"Saldo sintético","reversesId":null})).await;
    assert_eq!(stock.0, StatusCode::CREATED, "{}", stock.1);
    let order = call(router, "POST", "/api/v1/orders", None,
        json!({"customerId":CUSTOMER,"dueDate":"2027-01-30","items":[{"productId":PRODUCT,"quantity":"2.000000"}]})).await;
    assert_eq!(order.0, StatusCode::CREATED, "{}", order.1);
    Uuid::parse_str(order.1["data"]["id"].as_str().unwrap()).unwrap()
}

async fn save(
    application: &PgPool,
    order: Uuid,
    input: &CheckoutInput,
) -> Result<(), crate::domains::DomainError> {
    let tenant = Uuid::parse_str(TENANT).unwrap();
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(TENANT)
        .execute(&mut *tx)
        .await
        .unwrap();
    let result = checkout::save(
        &mut tx,
        tenant,
        order,
        Uuid::parse_str(CUSTOMER).unwrap(),
        200,
        140,
        input,
    )
    .await;
    if result.is_ok() {
        tx.commit().await.unwrap();
    } else {
        tx.rollback().await.unwrap();
    }
    result
}

#[sqlx::test(migrations = "../../migrations")]
async fn checkout_confirm_originates_each_installment_and_complete_preserves_partial_receipts(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    save(&application, order, &conditions()).await.unwrap();
    sqlx::query(
        "UPDATE parties SET legal_name='Cadastro alterado',addresses='[]' WHERE id=$1::uuid",
    )
    .bind(CUSTOMER)
    .execute(&admin)
    .await
    .unwrap();
    let before = call_as(
        &router,
        "reader",
        "GET",
        &format!("/api/v1/orders/{order}"),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(before.0, StatusCode::OK);
    assert_eq!(before.1["checkout"]["stateRegistration"], "ISENTO");
    assert_eq!(before.1["checkout"]["confirmationCreatesReceivables"], true);
    assert_eq!(
        before.1["checkout"]["customer"]["legalName"],
        "Cliente fornecedor"
    );
    assert_eq!(
        before.1["checkout"]["customer"]["addresses"][0]["street"],
        "Rua preservada"
    );
    assert!(before.1["checkout"]["entry"]["dueOn"].is_null());
    let contract = call(
        &router,
        "GET",
        &format!("/api/v1/commercial-contracts/options/{order}"),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(contract.0, StatusCode::OK, "{}", contract.1);
    assert_eq!(contract.1["defaults"]["cliente_nome"], "Cliente fornecedor");
    assert!(
        contract.1["defaults"]["cliente_endereco"]
            .as_str()
            .unwrap()
            .contains("Rua preservada")
    );
    assert!(
        contract.1["defaults"]["condicoes"]
            .as_str()
            .unwrap()
            .contains("Parcela 2: R$ 0,30")
    );
    assert!(
        contract.1["defaults"]["entrega"]
            .as_str()
            .unwrap()
            .contains("45 dias após o recebimento da entrada")
    );
    assert_eq!(contract.1["defaults"]["observacoes"], "Acordo comercial");
    assert!(contract.1["snapshot"]["proposal"].is_null());
    assert!(contract.1["snapshot"]["commercialTerms"].is_object());
    let confirmation_key = Uuid::now_v7();
    let confirmed = call_key(
        &router,
        "editor",
        "POST",
        &format!("/api/v1/orders/{order}/confirm"),
        Some(1),
        json!({}),
        confirmation_key,
    )
    .await;
    assert_eq!(confirmed.0, StatusCode::OK, "{}", confirmed.1);
    assert!(confirmed.1["checkout"]["entry"]["dueOn"].is_string());
    let replayed = call_key(
        &router,
        "editor",
        "POST",
        &format!("/api/v1/orders/{order}/confirm"),
        Some(1),
        json!({}),
        confirmation_key,
    )
    .await;
    assert_eq!(replayed, confirmed);
    let listing = call(&router, "GET", "/api/v1/receivables", None, Value::Null).await;
    assert_eq!(listing.0, StatusCode::OK);
    assert_eq!(listing.1["data"].as_array().unwrap().len(), 3);
    assert!(listing.1["data"].as_array().unwrap().iter().all(|row| {
        row["orderInstallmentId"].is_string() && row["plannedPaymentMethodId"] == METHOD
    }));
    assert_eq!(
        listing.1["data"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["installmentKind"] == "entry")
            .count(),
        1
    );
    let titles: Vec<(Uuid, i64)> = sqlx::query_as("SELECT r.id,r.amount_cents FROM receivables r JOIN sales_order_installments i ON i.tenant_id=r.tenant_id AND i.id=r.order_installment_id WHERE r.order_id=$1 ORDER BY i.number").bind(order).fetch_all(&admin).await.unwrap();
    assert_eq!(
        titles.iter().map(|t| t.1).collect::<Vec<_>>(),
        [140, 30, 30]
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivable_payments")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    for (id, amount) in [(titles[0].0, "0.50"), (titles[1].0, "0.30")] {
        let paid = call(&router, "POST", &format!("/api/v1/receivables/{id}/payments"), Some(1), json!({"amount":amount,"method":"bank_transfer","reference":"Entrada declarada","occurredOn":"2027-01-01","financialAccountId":ACCOUNT})).await;
        assert_eq!(paid.0, StatusCode::OK, "{}", paid.1);
    }
    let completed = call(
        &router,
        "POST",
        &format!("/api/v1/orders/{order}/complete"),
        Some(2),
        json!({}),
    )
    .await;
    assert_eq!(completed.0, StatusCode::OK, "{}", completed.1);
    let (count, total): (i64, i64) = sqlx::query_as(
        "SELECT count(*),sum(amount_cents)::bigint FROM receivables WHERE order_id=$1",
    )
    .bind(order)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!((count, total), (3, 200));
    let returned = call(
        &router,
        "POST",
        &format!("/api/v1/orders/{order}/cancel-completed"),
        Some(3),
        json!({"reason":"Cancelamento sintético integral","occurredOn":"2027-01-02"}),
    )
    .await;
    assert_eq!(returned.0, StatusCode::OK, "{}", returned.1);
    assert_eq!(
        returned.1["data"]["receivableIds"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM receivables WHERE order_id=$1 AND status='cancelled'"
        )
        .bind(order)
        .fetch_one(&admin)
        .await
        .unwrap(),
        3
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM receivable_payments WHERE kind='reversal'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        2
    );
    let ledger:(i64,i64)=sqlx::query_as("SELECT count(*),sum(CASE direction WHEN 'credit' THEN amount_cents ELSE -amount_cents END)::bigint FROM financial_account_entries WHERE account_id=$1::uuid").bind(ACCOUNT).fetch_one(&admin).await.unwrap();
    assert_eq!(ledger, (4, 0));
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn checkout_confirmed_cancellation_requires_explicit_reversal_of_received_entry(
    admin: PgPool,
) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    save(&application, order, &conditions()).await.unwrap();
    let confirmed = call(
        &router,
        "POST",
        &format!("/api/v1/orders/{order}/confirm"),
        Some(1),
        json!({}),
    )
    .await;
    assert_eq!(confirmed.0, StatusCode::OK, "{}", confirmed.1);
    let title: Uuid = sqlx::query_scalar("SELECT r.id FROM receivables r JOIN sales_order_installments i ON i.tenant_id=r.tenant_id AND i.id=r.order_installment_id WHERE r.order_id=$1 AND i.kind='entry'").bind(order).fetch_one(&admin).await.unwrap();
    let paid = call(&router,"POST",&format!("/api/v1/receivables/{title}/payments"),Some(1),json!({"amount":"0.50","method":"cash","reference":"Entrada declarada","occurredOn":"2027-01-01"})).await;
    assert_eq!(paid.0, StatusCode::OK, "{}", paid.1);
    let refused = call(
        &router,
        "POST",
        &format!("/api/v1/orders/{order}/cancel"),
        Some(2),
        json!({}),
    )
    .await;
    assert_eq!(refused.0, StatusCode::CONFLICT, "{}", refused.1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables WHERE status='cancelled'")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    let reversal = call(&router,"POST",&format!("/api/v1/receivables/{title}/reverse-payment"),Some(2),json!({"paymentId":paid.1["payments"][0]["id"],"reason":"Estorno declarado antes de cancelar","occurredOn":"2027-01-02"})).await;
    assert_eq!(reversal.0, StatusCode::OK, "{}", reversal.1);
    let cancelled = call(
        &router,
        "POST",
        &format!("/api/v1/orders/{order}/cancel"),
        Some(2),
        json!({}),
    )
    .await;
    assert_eq!(cancelled.0, StatusCode::OK, "{}", cancelled.1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM receivables WHERE order_id=$1 AND status='cancelled'"
        )
        .bind(order)
        .fetch_one(&admin)
        .await
        .unwrap(),
        3
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn checkout_rejects_wrong_totals_invalid_dates_and_unavailable_methods(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    let mut wrong = conditions();
    wrong.installments[0].amount_cents = 31;
    assert!(save(&application, order, &wrong).await.is_err());
    let mut wrong = conditions();
    wrong.installments[0].due_on = "2027-02-30".into();
    assert!(save(&application, order, &wrong).await.is_err());
    let mut wrong = conditions();
    wrong.installments[0].payment_method_id = Uuid::now_v7();
    assert!(save(&application, order, &wrong).await.is_err());
    sqlx::query("UPDATE payment_methods SET status='archived' WHERE id=$1::uuid")
        .bind(METHOD)
        .execute(&admin)
        .await
        .unwrap();
    assert!(save(&application, order, &conditions()).await.is_err());
    sqlx::query("UPDATE payment_methods SET status='active',tenant_id='22222222-2222-4222-8222-222222222222' WHERE id=$1::uuid").bind(METHOD).execute(&admin).await.unwrap();
    assert!(save(&application, order, &conditions()).await.is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sales_order_checkouts")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn checkout_is_immutable_tenant_isolated_and_requires_order_read_access(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    save(&application, order, &conditions()).await.unwrap();
    assert!(
        sqlx::query("UPDATE sales_order_checkouts SET notes='Mutação' WHERE order_id=$1")
            .bind(order)
            .execute(&admin)
            .await
            .is_err()
    );
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(
        checkout::load(&mut tx, Uuid::parse_str(TENANT).unwrap(), order)
            .await
            .unwrap()
            .is_none()
    );
    tx.rollback().await.unwrap();
    sqlx::query("DELETE FROM role_permissions WHERE role_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND permission_code='sales.orders.read'").execute(&admin).await.unwrap();
    assert_eq!(
        call_as(
            &router,
            "reader",
            "GET",
            &format!("/api/v1/orders/{order}"),
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn checkout_omission_keeps_legacy_single_title_at_completion(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    seed(&admin).await;
    let order = draft(&router).await;
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/orders/{order}/confirm"),
            Some(1),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivables")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/orders/{order}/complete"),
            Some(2),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    let title: (i64, Option<Uuid>) = sqlx::query_as(
        "SELECT amount_cents,order_installment_id FROM receivables WHERE order_id=$1",
    )
    .bind(order)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(title, (200, None));
    cleanup(&admin, application, server, &role).await;
}
