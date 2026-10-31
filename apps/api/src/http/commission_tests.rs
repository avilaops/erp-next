use super::company_tests::{cleanup, setup};
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
const SELLER: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ORDER: &str = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ACCOUNT: &str = "ffffffff-ffff-4fff-8fff-ffffffffffff";

async fn seed(admin: &PgPool) {
    super::returns_tests::seed(admin).await;
    sqlx::raw_sql("INSERT INTO staff(id,tenant_id,code,name,is_employee,is_seller,status) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','SELLER','Vendedora original',true,true,'active'); INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Cliente fornecedor','04252011000110','2026-11-01',11000,'draft'); INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions WHERE code LIKE 'finance.commissions.%' ON CONFLICT DO NOTHING; INSERT INTO role_permissions(role_id,permission_code) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','finance.commissions.read');").execute(admin).await.unwrap();
}

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    actor: (&str, &str),
    revision: Option<i64>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, Value) {
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
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
fn terms() -> Value {
    json!({"sellerStaffId":SELLER,"commissionRate":"5.0000","ipiRate":"10.0000","paymentDay":10})
}
async fn configure(router: &Router, admin: &PgPool) {
    let result = call(
        router,
        "PUT",
        &format!("/api/v1/orders/{ORDER}/commission"),
        (TENANT, "editor"),
        Some(1),
        Some(Uuid::now_v7()),
        terms(),
    )
    .await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    sqlx::raw_sql("UPDATE sales_orders SET status='completed' WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; INSERT INTO receivables(id,tenant_id,order_id,customer_name,due_date,amount_cents,status) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Cliente','2026-11-01',11000,'open');").execute(admin).await.unwrap();
}
fn receipt() -> Value {
    json!({"amount":"55.00","method":"bank_transfer","reference":"Parcial conferida","occurredOn":"2026-10-30"})
}
async fn seller(router: &Router) -> Value {
    let result = call(
        router,
        "GET",
        &format!("/api/v1/commissions/{SELLER}"),
        (TENANT, "reader"),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(result.0, StatusCode::OK, "{}", result.1);
    result.1
}

#[sqlx::test(migrations = "../../migrations")]
async fn commission_partial_receipt_paid_then_reversed_keeps_payment_and_exact_debit(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    configure(&router, &admin).await;
    let key = Uuid::now_v7();
    let received = call(
        &router,
        "POST",
        &format!("/api/v1/receivables/{ACCOUNT}/payments"),
        (TENANT, "editor"),
        Some(1),
        Some(key),
        receipt(),
    )
    .await;
    assert_eq!(received.0, StatusCode::OK, "{}", received.1);
    assert_eq!(
        call(
            &router,
            "POST",
            &format!("/api/v1/receivables/{ACCOUNT}/payments"),
            (TENANT, "editor"),
            Some(1),
            Some(key),
            receipt()
        )
        .await,
        received
    );
    let book = seller(&router).await;
    assert_eq!(book["data"]["openAmount"], "2.50");
    assert_eq!(book["entries"][0]["baseAmount"], "50.00");
    assert_eq!(book["entries"][0]["paymentDue"], "2026-11-10");
    // Match deploy/grant-retornos-fiscal.sql: immutable ledgers have no UPDATE
    // or DELETE privilege, including for row locks during payment allocation.
    sqlx::raw_sql(&format!("REVOKE UPDATE, DELETE ON commission_entries, commission_payments, commission_payment_entries FROM {role}"))
        .execute(&admin).await.unwrap();
    let paid=call(&router,"POST",&format!("/api/v1/commissions/{SELLER}/payments"),(TENANT,"editor"),book["data"]["revision"].as_i64(),Some(Uuid::now_v7()),json!({"throughCompetence":"2026-10","occurredOn":"2026-11-10","reference":"Comissão mensal conferida"})).await;
    assert_eq!(paid.0, StatusCode::OK, "{}", paid.1);
    sqlx::query(
        "UPDATE staff SET name='Nome alterado',status='archived',is_seller=false WHERE id=$1",
    )
    .bind(Uuid::parse_str(SELLER).unwrap())
    .execute(&admin)
    .await
    .unwrap();
    let receipt_id = received.1["payments"][0]["id"].clone();
    let reversed = call(
        &router,
        "POST",
        &format!("/api/v1/receivables/{ACCOUNT}/reverse-payment"),
        (TENANT, "editor"),
        Some(2),
        Some(Uuid::now_v7()),
        json!({"paymentId":receipt_id,"reason":"Estorno conferido","occurredOn":"2026-11-12"}),
    )
    .await;
    assert_eq!(reversed.0, StatusCode::OK, "{}", reversed.1);
    let book = seller(&router).await;
    assert_eq!(book["data"]["openAmount"], "-2.50");
    assert_eq!(book["data"]["paidAmount"], "2.50");
    assert_eq!(book["entries"].as_array().unwrap().len(), 2);
    assert_eq!(book["entries"][1]["amount"], "-2.50");
    assert_eq!(book["entries"][1]["baseAmount"], "-50.00");
    assert_eq!(book["entries"][1]["sellerName"], "Vendedora original");
    assert_eq!(book["entries"][1]["competence"], "2026-11");
    assert_eq!(book["entries"][1]["paymentDue"], "2026-12-10");
    assert_eq!(book["payments"].as_array().unwrap().len(), 1);
    let adjusted=call(&router,"POST",&format!("/api/v1/commissions/{SELLER}/adjustments"),(TENANT,"editor"),book["data"]["revision"].as_i64(),Some(Uuid::now_v7()),json!({"amount":"4.00","competence":"2026-12","paymentDay":10,"reason":"Complemento administrativo"})).await;
    assert_eq!(
        adjusted.0,
        StatusCode::CONFLICT,
        "Vendedor arquivado não recebe novos ajustes"
    );
    sqlx::query("UPDATE staff SET status='active',is_seller=true WHERE id=$1")
        .bind(Uuid::parse_str(SELLER).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let adjusted=call(&router,"POST",&format!("/api/v1/commissions/{SELLER}/adjustments"),(TENANT,"editor"),book["data"]["revision"].as_i64(),Some(Uuid::now_v7()),json!({"amount":"4.00","competence":"2026-12","paymentDay":10,"reason":"Complemento administrativo"})).await;
    assert_eq!(adjusted.0, StatusCode::CREATED, "{}", adjusted.1);
    let paid=call(&router,"POST",&format!("/api/v1/commissions/{SELLER}/payments"),(TENANT,"editor"),adjusted.1["data"]["revision"].as_i64(),Some(Uuid::now_v7()),json!({"throughCompetence":"2026-12","occurredOn":"2027-01-10","reference":"Saldo descontado"})).await;
    assert_eq!(paid.0, StatusCode::OK, "{}", paid.1);
    assert_eq!(paid.1["payments"][1]["amount"], "1.50");
    assert_eq!(paid.1["data"]["openAmount"], "0.00");
    assert_eq!(paid.1["data"]["paidAmount"], "4.00");
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn commission_config_authorization_snapshots_replay_and_foreign_ids(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let uri = format!("/api/v1/orders/{ORDER}/commission");
    let key = Uuid::now_v7();
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            (TENANT, "reader"),
            Some(1),
            Some(key),
            terms()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let configured = call(
        &router,
        "PUT",
        &uri,
        (TENANT, "editor"),
        Some(1),
        Some(key),
        terms(),
    )
    .await;
    assert_eq!(configured.0, StatusCode::OK, "{}", configured.1);
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            (TENANT, "editor"),
            Some(1),
            Some(key),
            terms()
        )
        .await,
        configured
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            (TENANT, "editor"),
            Some(1),
            Some(Uuid::now_v7()),
            terms()
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let foreign_seller = Uuid::now_v7();
    sqlx::query("INSERT INTO staff(id,tenant_id,code,name,is_employee,is_seller,status) VALUES($1,'22222222-2222-4222-8222-222222222222','FOREIGN','Outro vendedor',false,true,'active')").bind(foreign_seller).execute(&admin).await.unwrap();
    let mut foreign = terms();
    foreign["sellerStaffId"] = json!(foreign_seller);
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            (TENANT, "editor"),
            Some(2),
            Some(Uuid::now_v7()),
            foreign
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE sales_orders SET status='confirmed' WHERE id=$1")
        .bind(Uuid::parse_str(ORDER).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            (TENANT, "editor"),
            Some(2),
            Some(Uuid::now_v7()),
            terms()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='finance.commissions.manage'").execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "PUT",
            &uri,
            (TENANT, "editor"),
            Some(1),
            Some(key),
            terms()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/v1/commissions/{}", Uuid::now_v7()),
            (TENANT, "editor"),
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM commission_entries")
            .fetch_one(&app)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn commission_concurrent_adjustments_and_outbox_failure_are_atomic(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    let uri = format!("/api/v1/commissions/{SELLER}/adjustments");
    let input =
        json!({"amount":"1.00","competence":"2026-10","paymentDay":10,"reason":"Ajuste conferido"});
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            &uri,
            (TENANT, "editor"),
            Some(1),
            Some(Uuid::now_v7()),
            input.clone()
        ),
        call(
            &router,
            "POST",
            &uri,
            (TENANT, "editor"),
            Some(1),
            Some(Uuid::now_v7()),
            input.clone()
        )
    );
    assert!(
        (a.0 == StatusCode::CREATED && b.0 == StatusCode::PRECONDITION_FAILED)
            || (b.0 == StatusCode::CREATED && a.0 == StatusCode::PRECONDITION_FAILED),
        "{a:?} {b:?}"
    );
    sqlx::raw_sql("CREATE FUNCTION reject_commission_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='commission.adjusted' THEN RAISE EXCEPTION 'test outbox failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_commission_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_commission_outbox();").execute(&admin).await.unwrap();
    let result = call(
        &router,
        "POST",
        &uri,
        (TENANT, "editor"),
        Some(2),
        Some(Uuid::now_v7()),
        input,
    )
    .await;
    assert_eq!(result.0, StatusCode::INTERNAL_SERVER_ERROR);
    let book = seller(&router).await;
    assert_eq!(book["data"]["openAmount"], "1.00");
    assert_eq!(book["data"]["revision"], 2);
    assert_eq!(book["entries"].as_array().unwrap().len(), 1);
    let mut isolated = app.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true)")
        .execute(&mut *isolated)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM commission_entries")
            .fetch_one(&mut *isolated)
            .await
            .unwrap(),
        0
    );
    isolated.rollback().await.unwrap();
    let entry = book["entries"][0]["id"].as_str().unwrap();
    assert!(
        sqlx::query("UPDATE commission_entries SET amount_cents=999 WHERE id=$1")
            .bind(Uuid::parse_str(entry).unwrap())
            .execute(&admin)
            .await
            .is_err()
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn commission_completed_cancellation_reverses_once_and_preserves_paid_amount(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    configure(&router, &admin).await;
    // This historical completed fixture includes the delivery that cancellation must undo.
    sqlx::raw_sql("INSERT INTO sales_order_lines(tenant_id,order_id,line_number,product_id,sku,name,unit,quantity_micros,price_cents,amount_cents) VALUES('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',1,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','RETURN-1','Produto','UN',110000000,100,11000); INSERT INTO stock_balances(tenant_id,product_id,quantity_micros) VALUES('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc',0); INSERT INTO stock_movements(id,tenant_id,product_id,direction,quantity_micros,balance_after_micros,reason) VALUES('12121212-1212-4212-8212-121212121212','11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','receipt',110000000,110000000,'Saldo inicial do teste'); INSERT INTO stock_movements(id,tenant_id,product_id,direction,quantity_micros,balance_after_micros,reason,source_order_id) VALUES('13131313-1313-4313-8313-131313131313','11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','issue',110000000,0,'Entrega do pedido','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');").execute(&admin).await.unwrap();
    let received = call(
        &router,
        "POST",
        &format!("/api/v1/receivables/{ACCOUNT}/payments"),
        (TENANT, "editor"),
        Some(1),
        Some(Uuid::now_v7()),
        receipt(),
    )
    .await;
    assert_eq!(received.0, StatusCode::OK, "{}", received.1);
    let book = seller(&router).await;
    let paid=call(&router,"POST",&format!("/api/v1/commissions/{SELLER}/payments"),(TENANT,"editor"),book["data"]["revision"].as_i64(),Some(Uuid::now_v7()),json!({"throughCompetence":"2026-10","occurredOn":"2026-11-10","reference":"Comissão mensal"})).await;
    assert_eq!(paid.0, StatusCode::OK, "{}", paid.1);
    let key = Uuid::now_v7();
    let uri = format!("/api/v1/orders/{ORDER}/cancel-completed");
    let input = json!({"reason":"Cancelamento integral conferido","occurredOn":"2026-11-12"});
    let cancelled = call(
        &router,
        "POST",
        &uri,
        (TENANT, "editor"),
        Some(2),
        Some(key),
        input.clone(),
    )
    .await;
    assert_eq!(cancelled.0, StatusCode::OK, "{}", cancelled.1);
    assert_eq!(
        call(
            &router,
            "POST",
            &uri,
            (TENANT, "editor"),
            Some(2),
            Some(key),
            input.clone()
        )
        .await,
        cancelled
    );
    let book = seller(&router).await;
    assert_eq!(book["entries"].as_array().unwrap().len(), 2);
    assert_eq!(book["payments"].as_array().unwrap().len(), 1);
    assert_eq!(book["data"]["openAmount"], "-2.50");
    assert_eq!(book["data"]["paidAmount"], "2.50");
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='finance.commissions.manage'").execute(&admin).await.unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &uri,
            (TENANT, "editor"),
            Some(2),
            Some(key),
            input
        )
        .await
        .0,
        StatusCode::FORBIDDEN,
        "Replay também verifica a permissão atual de comissão"
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn commission_receipt_outbox_failure_rolls_back_receipt_ledger_and_command(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    configure(&router, &admin).await;
    sqlx::raw_sql("CREATE FUNCTION reject_accrual_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='commission.accrued' THEN RAISE EXCEPTION 'test accrual outbox failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_accrual_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_accrual_outbox();").execute(&admin).await.unwrap();
    let key = Uuid::now_v7();
    let uri = format!("/api/v1/receivables/{ACCOUNT}/payments");
    let rejected = call(
        &router,
        "POST",
        &uri,
        (TENANT, "editor"),
        Some(1),
        Some(key),
        receipt(),
    )
    .await;
    assert_eq!(
        rejected.0,
        StatusCode::INTERNAL_SERVER_ERROR,
        "{}",
        rejected.1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM receivable_payments")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM commission_entries")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT revision FROM receivables WHERE id=$1")
            .bind(Uuid::parse_str(ACCOUNT).unwrap())
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    assert!(
        !sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM domain_commands WHERE command_key=$1)"
        )
        .bind(key)
        .fetch_one(&admin)
        .await
        .unwrap()
    );
    sqlx::query("DROP TRIGGER reject_accrual_outbox ON outbox_events")
        .execute(&admin)
        .await
        .unwrap();
    let retried = call(
        &router,
        "POST",
        &uri,
        (TENANT, "editor"),
        Some(1),
        Some(key),
        receipt(),
    )
    .await;
    assert_eq!(retried.0, StatusCode::OK, "{}", retried.1);
    assert_eq!(seller(&router).await["data"]["openAmount"], "2.50");
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn commission_payment_cannot_predate_allocated_receipt_or_reversal_but_allows_advance(
    admin: PgPool,
) {
    let (router, app, server, role) = setup(&admin).await;
    seed(&admin).await;
    configure(&router, &admin).await;
    let received = call(
        &router,
        "POST",
        &format!("/api/v1/receivables/{ACCOUNT}/payments"),
        (TENANT, "editor"),
        Some(1),
        Some(Uuid::now_v7()),
        receipt(),
    )
    .await;
    assert_eq!(received.0, StatusCode::OK, "{}", received.1);
    let book = seller(&router).await;
    let uri = format!("/api/v1/commissions/{SELLER}/payments");
    let before_receipt=call(&router,"POST",&uri,(TENANT,"editor"),book["data"]["revision"].as_i64(),Some(Uuid::now_v7()),json!({"throughCompetence":"2026-10","occurredOn":"2026-10-01","reference":"Data anterior ao recebimento"})).await;
    assert_eq!(
        before_receipt.0,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Pagamento não pode anteceder recebimento: {}",
        before_receipt.1
    );
    let early=call(&router,"POST",&uri,(TENANT,"editor"),book["data"]["revision"].as_i64(),Some(Uuid::now_v7()),json!({"throughCompetence":"2026-10","occurredOn":"2026-10-30","reference":"Antecipação após recebimento"})).await;
    assert_eq!(
        early.0,
        StatusCode::OK,
        "Antecipação antes do vencimento deve funcionar: {}",
        early.1
    );
    let reversed=call(&router,"POST",&format!("/api/v1/receivables/{ACCOUNT}/reverse-payment"),(TENANT,"editor"),Some(2),Some(Uuid::now_v7()),json!({"paymentId":received.1["payments"][0]["id"],"reason":"Estorno conferido","occurredOn":"2026-11-12"})).await;
    assert_eq!(reversed.0, StatusCode::OK, "{}", reversed.1);
    let book = seller(&router).await;
    let adjusted=call(&router,"POST",&format!("/api/v1/commissions/{SELLER}/adjustments"),(TENANT,"editor"),book["data"]["revision"].as_i64(),Some(Uuid::now_v7()),json!({"amount":"4.00","competence":"2026-11","paymentDay":10,"reason":"Complemento administrativo"})).await;
    assert_eq!(adjusted.0, StatusCode::CREATED, "{}", adjusted.1);
    let before_reversal=call(&router,"POST",&uri,(TENANT,"editor"),adjusted.1["data"]["revision"].as_i64(),Some(Uuid::now_v7()),json!({"throughCompetence":"2026-11","occurredOn":"2026-11-01","reference":"Data anterior ao estorno"})).await;
    assert_eq!(
        before_reversal.0,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Pagamento não pode anteceder débito do estorno: {}",
        before_reversal.1
    );
    let after_reversal=call(&router,"POST",&uri,(TENANT,"editor"),adjusted.1["data"]["revision"].as_i64(),Some(Uuid::now_v7()),json!({"throughCompetence":"2026-11","occurredOn":"2026-11-12","reference":"Antecipação com débito descontado"})).await;
    assert_eq!(after_reversal.0, StatusCode::OK, "{}", after_reversal.1);
    assert_eq!(after_reversal.1["payments"][1]["amount"], "1.50");
    cleanup(&admin, app, server, &role).await;
}
