use super::{
    company_tests::{cleanup, setup},
    cte_inspection_tests::seed,
};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const FACTS: &str = include_str!("fixtures/cte-received-inspection.json");
const BASE: &str = "/api/v1/fiscal/cte-distribution/documents";

async fn call(
    router: &Router,
    method: &str,
    path: &str,
    tenant: &str,
    revision: Option<i64>,
    command: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", "Bearer editor")
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
    }
    if let Some(command) = command {
        request = request.header("idempotency-key", command.to_string());
    }
    let result = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = result.status();
    let headers = result.headers().clone();
    let bytes = to_bytes(result.into_body(), 2 * 1024 * 1024).await.unwrap();
    (
        status,
        headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn grant(admin: &PgPool) {
    sqlx::query("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('fiscal.cte.read','fiscal.cte.link','catalog.parties.read','purchasing.orders.read','sales.orders.read') ON CONFLICT DO NOTHING").execute(admin).await.unwrap();
}

struct Fixture {
    doc: Uuid,
    carrier: Uuid,
    purchase: Uuid,
    sale: Uuid,
}
async fn fixture(admin: &PgPool) -> Fixture {
    grant(admin).await;
    let doc = seed(admin, "000000000000001").await;
    let facts: Value = serde_json::from_str(FACTS).unwrap();
    sqlx::query("INSERT INTO fiscal_cte_inspections(tenant_id,id,document_id,source_xml_sha256,inspector_version,schema_release,metadata,inspected_by) VALUES($1::uuid,$2,$3,$4,'cte-received-v1',$5,$6,'editor')")
        .bind(TENANT).bind(Uuid::now_v7()).bind(doc).bind(facts["xmlSha256"].as_str().unwrap()).bind(facts["profile"].as_str().unwrap()).bind(&facts).execute(admin).await.unwrap();
    let carrier = Uuid::now_v7();
    let purchase = Uuid::now_v7();
    let sale = Uuid::now_v7();
    sqlx::query("INSERT INTO parties(tenant_id,id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES($1::uuid,$2,'juridica','Transportadora cadastrada','11222333000181',true,true,'active')").bind(TENANT).bind(carrier).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO purchase_orders(tenant_id,id,supplier_id,supplier_name,supplier_tax_id,due_date,amount_cents,status) VALUES($1::uuid,$2,$3,'Fornecedor sintético','11222333000181','2026-11-10',50000,'confirmed')").bind(TENANT).bind(purchase).bind(carrier).execute(admin).await.unwrap();
    sqlx::query("INSERT INTO sales_orders(tenant_id,id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES($1::uuid,$2,$3,'Cliente sintético','11222333000181','2026-11-10',90000,'completed')").bind(TENANT).bind(sale).bind(carrier).execute(admin).await.unwrap();
    Fixture {
        doc,
        carrier,
        purchase,
        sale,
    }
}
fn input(f: &Fixture, kind: &str, cents: &str) -> Value {
    json!({"kind":kind,"orderId":if kind=="purchase" { f.purchase } else { f.sale },"carrierPartyId":f.carrier,"freightCents":cents,"reason":"Conferi o pedido e os documentos transportados"})
}
async fn untouched(admin: &PgPool) -> Value {
    let xml: String =
        sqlx::query_scalar("SELECT xml FROM fiscal_cte_distribution_documents LIMIT 1")
            .fetch_one(admin)
            .await
            .unwrap();
    let state: Value =
        sqlx::query_scalar("SELECT to_jsonb(s) FROM fiscal_cte_distribution_state s LIMIT 1")
            .fetch_one(admin)
            .await
            .unwrap();
    let purchase: Value =
        sqlx::query_scalar("SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM purchase_orders p")
            .fetch_one(admin)
            .await
            .unwrap();
    let sales: Value =
        sqlx::query_scalar("SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM sales_orders s")
            .fetch_one(admin)
            .await
            .unwrap();
    let inventory: i64 = sqlx::query_scalar("SELECT count(*) FROM stock_movements")
        .fetch_one(admin)
        .await
        .unwrap();
    let payables: i64 = sqlx::query_scalar("SELECT count(*) FROM payables")
        .fetch_one(admin)
        .await
        .unwrap();
    let receivables: i64 = sqlx::query_scalar("SELECT count(*) FROM receivables")
        .fetch_one(admin)
        .await
        .unwrap();
    json!({"xml":xml,"state":state,"purchase":purchase,"sales":sales,"inventory":inventory,"payables":payables,"receivables":receivables})
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_require_inspection_separate_permissions_and_command_preconditions(
    admin: PgPool,
) {
    let (router, pool, auth, role) = setup(&admin).await;
    grant(&admin).await;
    let doc = seed(&admin, "000000000000002").await;
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("{BASE}/{doc}/commercial-links"),
            TENANT,
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let f = fixture(&admin).await;
    let path = format!("{BASE}/{}/commercial-links", f.doc);
    for permission in [
        "fiscal.cte.link",
        "catalog.parties.read",
        "purchasing.orders.read",
    ] {
        sqlx::query("DELETE FROM role_permissions WHERE permission_code=$1")
            .bind(permission)
            .execute(&admin)
            .await
            .unwrap();
        assert_eq!(
            call(
                &router,
                "POST",
                &path,
                TENANT,
                Some(1),
                Some(Uuid::now_v7()),
                input(&f, "purchase", "1")
            )
            .await
            .0,
            StatusCode::FORBIDDEN,
            "{permission}"
        );
        grant(&admin).await;
    }
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            None,
            Some(Uuid::now_v7()),
            input(&f, "purchase", "1")
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            None,
            input(&f, "purchase", "1")
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let mut invented = input(&f, "purchase", "1");
    invented["generatePayable"] = json!(true);
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            invented
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(&router, "GET", &path, OTHER, None, None, Value::Null)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_commercial_links")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_allocate_exact_freight_replay_and_preserve_commercial_and_fiscal_sources(
    admin: PgPool,
) {
    let (router, pool, auth, role) = setup(&admin).await;
    let f = fixture(&admin).await;
    let before = untouched(&admin).await;
    let path = format!("{BASE}/{}/commercial-links", f.doc);
    let initial = call(&router, "GET", &path, TENANT, None, None, Value::Null).await;
    assert_eq!(initial.0, StatusCode::OK);
    assert_eq!(initial.1["etag"], "\"1\"");
    assert_eq!(initial.2["serviceCents"], "15001");
    assert_eq!(initial.2["allocatedCents"], "0");
    assert_eq!(initial.2["carrier"]["partyId"], f.carrier.to_string());
    let command = Uuid::now_v7();
    let zero = input(&f, "purchase", "0");
    let first = call(
        &router,
        "POST",
        &path,
        TENANT,
        Some(1),
        Some(command),
        zero.clone(),
    )
    .await;
    assert_eq!(first.0, StatusCode::CREATED);
    assert_eq!(first.2["revision"], 2);
    assert_eq!(first.2["data"][0]["freightCents"], "0");
    assert_eq!(
        call(&router, "POST", &path, TENANT, Some(1), Some(command), zero)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(2),
            Some(command),
            input(&f, "purchase", "1")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(2),
            Some(Uuid::now_v7()),
            input(&f, "purchase", "0")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            input(&f, "sale", "15001")
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    let second = call(
        &router,
        "POST",
        &path,
        TENANT,
        Some(2),
        Some(Uuid::now_v7()),
        input(&f, "sale", "15001"),
    )
    .await;
    assert_eq!(second.0, StatusCode::CREATED);
    assert_eq!(second.2["allocatedCents"], "15001");
    assert_eq!(second.2["data"].as_array().unwrap().len(), 2);
    assert_eq!(untouched(&admin).await, before);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE entity_type='fiscal_cte_commercial_link'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM domain_commands WHERE scope='fiscal.cte.link'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        2
    );
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_unlink_releases_budget_without_erasing_history_and_forces_rls(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let f = fixture(&admin).await;
    let path = format!("{BASE}/{}/commercial-links", f.doc);
    let created = call(
        &router,
        "POST",
        &path,
        TENANT,
        Some(1),
        Some(Uuid::now_v7()),
        input(&f, "purchase", "15001"),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    let link = created.2["data"][0]["id"].as_str().unwrap();
    let remove = format!("{path}/{link}/unlink");
    let key = Uuid::now_v7();
    let body = json!({"reason":"Associação comercial escolhida incorretamente"});
    let removed = call(
        &router,
        "POST",
        &remove,
        TENANT,
        Some(2),
        Some(key),
        body.clone(),
    )
    .await;
    assert_eq!(removed.0, StatusCode::OK);
    assert_eq!(removed.2["revision"], 3);
    assert_eq!(removed.2["allocatedCents"], "0");
    assert_eq!(removed.2["data"], json!([]));
    assert_eq!(
        call(
            &router,
            "POST",
            &remove,
            TENANT,
            Some(2),
            Some(key),
            body.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &remove,
            TENANT,
            Some(3),
            Some(Uuid::now_v7()),
            body
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(3),
            Some(Uuid::now_v7()),
            input(&f, "purchase", "15001")
        )
        .await
        .0,
        StatusCode::CREATED
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_commercial_links")
            .fetch_one(&admin)
            .await
            .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_commercial_unlinks")
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    for table in [
        "fiscal_cte_commercial_links",
        "fiscal_cte_commercial_unlinks",
    ] {
        assert!(
            sqlx::query(&format!("DELETE FROM {table}"))
                .execute(&admin)
                .await
                .is_err()
        );
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
            .bind(OTHER)
            .execute(&mut *tx)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&mut *tx)
                .await
                .unwrap(),
            0
        );
        tx.rollback().await.unwrap();
    }
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_reject_invalid_values_carrier_and_target_recheck_current_status(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let f = fixture(&admin).await;
    let path = format!("{BASE}/{}/commercial-links", f.doc);
    for cents in ["-1", "01", "1.0", "1e2", "1000000000000000"] {
        assert_eq!(
            call(
                &router,
                "POST",
                &path,
                TENANT,
                Some(1),
                Some(Uuid::now_v7()),
                input(&f, "purchase", cents)
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{cents}"
        );
    }
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            input(&f, "purchase", "15002")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut wrong = input(&f, "purchase", "1");
    wrong["carrierPartyId"] = Value::Null;
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            wrong
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let options = call(
        &router,
        "GET",
        &format!(
            "{BASE}/{}/commercial-options?kind=purchase&offset=0&limit=1",
            f.doc
        ),
        TENANT,
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(options.0, StatusCode::OK);
    assert_eq!(options.2["data"][0]["id"], f.purchase.to_string());
    sqlx::query("UPDATE purchase_orders SET status='cancelled',revision=revision+1 WHERE id=$1")
        .bind(f.purchase)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            input(&f, "purchase", "1")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut wrong = input(&f, "sale", "1");
    wrong["orderId"] = json!(Uuid::now_v7());
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            wrong
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE parties SET status='archived' WHERE id=$1")
        .bind(f.carrier)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            input(&f, "sale", "1")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_concurrent_commands_cannot_overallocate_same_revision(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let f = fixture(&admin).await;
    let path = format!("{BASE}/{}/commercial-links", f.doc);
    let (a, b) = tokio::join!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            input(&f, "purchase", "10000")
        ),
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            input(&f, "sale", "10000")
        )
    );
    let mut codes = vec![a.0.as_u16(), b.0.as_u16()];
    codes.sort();
    assert_eq!(codes, vec![201, 412]);
    let current = call(&router, "GET", &path, TENANT, None, None, Value::Null).await;
    assert_eq!(current.2["allocatedCents"], "10000");
    assert_eq!(current.2["data"].as_array().unwrap().len(), 1);
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_outbox_failure_rolls_back_link_audit_and_command(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let f = fixture(&admin).await;
    sqlx::raw_sql("CREATE FUNCTION reject_cte_link_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='fiscal.cte.linked' THEN RAISE EXCEPTION 'forced'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_cte_link_event BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION reject_cte_link_event();").execute(&admin).await.unwrap();
    let result = call(
        &router,
        "POST",
        &format!("{BASE}/{}/commercial-links", f.doc),
        TENANT,
        Some(1),
        Some(Uuid::now_v7()),
        input(&f, "purchase", "15001"),
    )
    .await;
    assert_eq!(result.0, StatusCode::INTERNAL_SERVER_ERROR);
    for sql in [
        "SELECT count(*) FROM fiscal_cte_commercial_links",
        "SELECT count(*) FROM domain_commands",
        "SELECT count(*) FROM audit_log WHERE entity_type='fiscal_cte_commercial_link'",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(sql)
                .fetch_one(&admin)
                .await
                .unwrap(),
            0
        );
    }
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_options_are_paged_authorized_and_do_not_accept_arbitrary_filters(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let f = fixture(&admin).await;
    for _ in 0..3 {
        sqlx::query("INSERT INTO sales_orders(tenant_id,id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES($1::uuid,$2,$3,'Outra venda','11222333000181','2026-11-10',10000,'confirmed')").bind(TENANT).bind(Uuid::now_v7()).bind(f.carrier).execute(&admin).await.unwrap();
    }
    let path = format!("{BASE}/{}/commercial-options", f.doc);
    let result = call(
        &router,
        "GET",
        &format!("{path}?kind=sale&offset=1&limit=2"),
        TENANT,
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(result.0, StatusCode::OK);
    assert_eq!(result.2["total"], 4);
    assert_eq!(result.2["offset"], 1);
    assert_eq!(result.2["data"].as_array().unwrap().len(), 2);
    for filter in [
        "kind=unknown",
        "kind=sale&limit=51",
        "kind=sale&offset=100001",
        "kind=sale&environment=production",
    ] {
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("{path}?{filter}"),
                TENANT,
                None,
                None,
                Value::Null
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{filter}"
        );
    }
    sqlx::query("DELETE FROM role_permissions WHERE permission_code='sales.orders.read'")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("{path}?kind=sale"),
            TENANT,
            None,
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let links = call(
        &router,
        "GET",
        &format!("{BASE}/{}/commercial-links", f.doc),
        TENANT,
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(links.0, StatusCode::OK);
    assert_eq!(links.2["canLinkSale"], false);
    assert_eq!(links.2["canLinkPurchase"], true);
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_reject_changed_company_and_other_tenant_targets(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let f = fixture(&admin).await;
    let foreign_party = Uuid::now_v7();
    let foreign_order = Uuid::now_v7();
    sqlx::query("INSERT INTO parties(tenant_id,id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES($1::uuid,$2,'fisica','Pessoa de outra empresa','52998224725',true,true,'active')").bind(OTHER).bind(foreign_party).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO sales_orders(tenant_id,id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES($1::uuid,$2,$3,'Venda de outra empresa','52998224725','2026-11-10',10000,'confirmed')").bind(OTHER).bind(foreign_order).bind(foreign_party).execute(&admin).await.unwrap();
    let path = format!("{BASE}/{}/commercial-links", f.doc);
    let mut foreign = input(&f, "sale", "1");
    foreign["orderId"] = json!(foreign_order);
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            foreign
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE tenants SET tax_id='11222333000181' WHERE id=$1::uuid")
        .bind(TENANT)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(&router, "GET", &path, TENANT, None, None, Value::Null)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            input(&f, "sale", "1")
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_cte_commercial_links")
            .fetch_one(&admin)
            .await
            .unwrap(),
        0
    );
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_own_carrier_uses_company_without_creating_duplicate_party(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let f = fixture(&admin).await;
    let xml = include_str!("fixtures/cte-own-carrier.xml");
    let facts: Value =
        serde_json::from_str(include_str!("fixtures/cte-own-carrier-inspection.json")).unwrap();
    let run = Uuid::now_v7();
    let doc = Uuid::now_v7();
    sqlx::query("INSERT INTO fiscal_cte_distribution_runs(tenant_id,id,environment,company_tax_id,author_state,auth_subject,command_key,requested_nsu,status,code,document_count) VALUES($1::uuid,$2,2,'04252011000110','SP','editor',$3,'000000000000001','completed','138',1)")
        .bind(TENANT).bind(run).bind(Uuid::now_v7()).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO fiscal_cte_distribution_documents(tenant_id,id,run_id,environment,company_tax_id,nsu,schema_name,kind,xml,xml_sha256) VALUES($1::uuid,$2,$3,2,'04252011000110','000000000000002','procCTe_v4.00.xsd','full',$4,$5)")
        .bind(TENANT).bind(doc).bind(run).bind(xml).bind(facts["xmlSha256"].as_str().unwrap()).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO fiscal_cte_inspections(tenant_id,id,document_id,source_xml_sha256,inspector_version,schema_release,metadata,inspected_by) VALUES($1::uuid,$2,$3,$4,'cte-received-v1',$5,$6,'editor')")
        .bind(TENANT).bind(Uuid::now_v7()).bind(doc).bind(facts["xmlSha256"].as_str().unwrap()).bind(facts["profile"].as_str().unwrap()).bind(&facts).execute(&admin).await.unwrap();
    let mut body = input(&f, "purchase", "15001");
    body["carrierPartyId"] = Value::Null;
    let created = call(
        &router,
        "POST",
        &format!("{BASE}/{doc}/commercial-links"),
        TENANT,
        Some(1),
        Some(Uuid::now_v7()),
        body,
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    assert_eq!(created.2["carrier"]["ownCompany"], true);
    assert_eq!(created.2["carrier"]["partyId"], Value::Null);
    assert_eq!(created.2["data"][0]["carrierTaxId"], "04252011000110");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM parties WHERE tenant_id=$1::uuid")
            .bind(TENANT)
            .fetch_one(&admin)
            .await
            .unwrap(),
        1
    );
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_limit_active_associations_without_forbidding_zero_freight(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let f = fixture(&admin).await;
    let path = format!("{BASE}/{}/commercial-links", f.doc);
    for index in 0..51 {
        let order = Uuid::now_v7();
        sqlx::query("INSERT INTO sales_orders(tenant_id,id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES($1::uuid,$2,$3,'Venda sintética','11222333000181','2026-11-10',10000,'confirmed')").bind(TENANT).bind(order).bind(f.carrier).execute(&admin).await.unwrap();
        let mut body = input(&f, "sale", "0");
        body["orderId"] = json!(order);
        let result = call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(index + 1),
            Some(Uuid::now_v7()),
            body,
        )
        .await;
        assert_eq!(
            result.0,
            if index < 50 {
                StatusCode::CREATED
            } else {
                StatusCode::CONFLICT
            },
            "association {index}"
        );
    }
    let current = call(&router, "GET", &path, TENANT, None, None, Value::Null).await;
    assert_eq!(current.2["data"].as_array().unwrap().len(), 50);
    assert_eq!(current.2["allocatedCents"], "0");
    assert_eq!(current.2["revision"], 51);
    cleanup(&admin, pool, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn cte_links_hide_order_details_after_domain_read_permission_is_revoked(admin: PgPool) {
    let (router, pool, auth, role) = setup(&admin).await;
    let f = fixture(&admin).await;
    let path = format!("{BASE}/{}/commercial-links", f.doc);
    assert_eq!(
        call(
            &router,
            "POST",
            &path,
            TENANT,
            Some(1),
            Some(Uuid::now_v7()),
            input(&f, "sale", "15001")
        )
        .await
        .0,
        StatusCode::CREATED
    );
    sqlx::query("DELETE FROM role_permissions WHERE permission_code='sales.orders.read'")
        .execute(&admin)
        .await
        .unwrap();
    let current = call(&router, "GET", &path, TENANT, None, None, Value::Null).await;
    assert_eq!(current.0, StatusCode::OK);
    assert_eq!(current.2["allocatedCents"], "15001");
    let link = &current.2["data"][0];
    assert_eq!(link["restricted"], true);
    assert_eq!(link["canUnlink"], false);
    for field in ["orderId", "counterpartyName", "orderAmountCents", "orderRevision", "reason"] {
        assert_eq!(link[field], Value::Null, "restricted {field}");
    }
    cleanup(&admin, pool, auth, &role).await;
}
