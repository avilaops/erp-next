use crate::platform::subscriptions::provider::MercadoPago;
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{Request, StatusCode},
    routing::{get, post},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
#[derive(Default)]
struct ProviderState {
    value: Value,
    creates: usize,
    uncertain: bool,
}
type Shared = Arc<Mutex<ProviderState>>;

async fn call(
    router: &Router,
    subject: &str,
    tenant: &str,
    method: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1/company-account{path}"))
                .header("authorization", format!("Bearer {subject}"))
                .header("x-tenant-id", tenant)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    (
        response.status(),
        serde_json::from_slice(&to_bytes(response.into_body(), 100000).await.unwrap()).unwrap(),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn subscriptions_enforce_tenant_permissions_price_confirmation_and_recover_uncertain_creation(
    admin: PgPool,
) {
    let shared = Shared::default();
    shared.lock().unwrap().uncertain = true;
    let mock=Router::new().route("/preapproval",post(|State(s):State<Shared>,Json(body):Json<Value>| async move {
        let mut s=s.lock().unwrap(); s.creates+=1;
        if body["payer_email"] == "rejected@example.test" { return (StatusCode::BAD_REQUEST,Json(json!({"message":"invalid payer"}))); }
        assert_eq!(body["auto_recurring"]["transaction_amount"],60);
        assert_eq!(body["status"],"pending");
        s.value=body;
        s.value["id"]=json!("provider-id");
        s.value["init_point"]=json!("https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=provider-id");
        if s.uncertain { s.uncertain=false; (StatusCode::BAD_GATEWAY,Json(json!({"message":"timeout after creation"}))) } else { (StatusCode::OK,Json(s.value.clone())) }
    })).route("/preapproval/search",get(|State(s):State<Shared>| async move { Json(json!({"results":[s.lock().unwrap().value.clone()]})) }))
      .route("/preapproval/provider-id",get(|State(s):State<Shared>| async move { Json(s.lock().unwrap().value.clone()) }).put(|State(s):State<Shared>,Json(body):Json<Value>| async move {
        let mut s=s.lock().unwrap();
        if let Some(status)=body.get("status") { s.value["status"]=status.clone(); }
        if let Some(amount)=body.get("auto_recurring") { s.value["auto_recurring"]["transaction_amount"]=amount["transaction_amount"].clone(); }
        Json(s.value.clone())
    })).route("/authorized_payments/search",get(|| async { Json(json!({"results":[{"id":1,"preapproval_id":"provider-id","reason":"Mensalidade","transaction_amount":"120.00","currency_id":"BRL","payment":{"status":"approved"}}],"paging":{"total":1}})) })).with_state(shared.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let provider_server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap() });
    let (router, application, server, role) =
        super::company_tests::setup_with_subscriptions(&admin, MercadoPago::fixture(origin)).await;
    let initial = call(&router, "reader", TENANT, "GET", "", Value::Null).await;
    assert_eq!(initial.0, StatusCode::OK);
    assert_eq!(initial.1["canEdit"], false);
    assert_eq!(initial.1["subscriptions"], json!([]));
    assert_eq!(initial.1["plans"][0]["monthlyCents"], 6000);
    let input = json!({"planId":"cobalto","payerEmail":"payer@example.test"});
    assert_eq!(
        call(
            &router,
            "reader",
            TENANT,
            "POST",
            "/checkout",
            input.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "editor",
            "22222222-2222-4222-8222-222222222222",
            "GET",
            "",
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "editor",
            TENANT,
            "POST",
            "/checkout",
            json!({"planId":"cobalto","payerEmail":"payer@example.test","amount":1})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(shared.lock().unwrap().creates, 0);
    assert_eq!(
        call(
            &router,
            "editor",
            TENANT,
            "POST",
            "/checkout",
            input.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&router, "editor", TENANT, "POST", "/checkout", input)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(shared.lock().unwrap().creates, 1);
    let current = call(&router, "editor", TENANT, "GET", "", Value::Null)
        .await
        .1;
    let id = current["subscriptions"][0]["id"].as_str().unwrap();
    assert_eq!(current["subscriptions"][0]["status"], "creating");
    let refreshed = call(
        &router,
        "editor",
        TENANT,
        "POST",
        "/refresh",
        json!({"subscriptionId":id}),
    )
    .await;
    assert_eq!(refreshed.0, StatusCode::OK, "{}", refreshed.1);
    assert_eq!(refreshed.1["status"], "pending");
    assert!(refreshed.1.get("providerId").is_none());
    shared.lock().unwrap().value["status"] = json!("authorized");
    let changed = call(
        &router,
        "editor",
        TENANT,
        "POST",
        "/change-plan",
        json!({"subscriptionId":id,"planId":"titanio-1"}),
    )
    .await;
    assert_eq!(changed.0, StatusCode::OK, "{}", changed.1);
    assert_eq!(changed.1["planId"], "titanio-1");
    let invoices = call(
        &router,
        "reader",
        TENANT,
        "GET",
        &format!("/invoices?subscriptionId={id}&offset=0"),
        Value::Null,
    )
    .await;
    assert_eq!(invoices.0, StatusCode::OK);
    assert_eq!(invoices.1["data"][0]["paymentStatus"], "approved");
    assert_eq!(
        call(
            &router,
            "editor",
            TENANT,
            "POST",
            "/cancel",
            json!({"subscriptionId":id})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let cancelled = call(
        &router,
        "editor",
        TENANT,
        "POST",
        "/cancel",
        json!({"subscriptionId":id,"confirmation":"CANCELAR"}),
    )
    .await;
    assert_eq!(cancelled.0, StatusCode::OK);
    assert_eq!(cancelled.1["status"], "cancelled");
    assert_eq!(
        call(
            &router,
            "reader",
            TENANT,
            "POST",
            "/cancel",
            json!({"subscriptionId":id,"confirmation":"CANCELAR"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "editor",
            TENANT,
            "POST",
            "/checkout",
            json!({"planId":"cobalto","payerEmail":"rejected@example.test"})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let rejected = call(&router, "editor", TENANT, "GET", "", Value::Null)
        .await
        .1;
    assert_eq!(rejected["subscriptions"][0]["status"], "rejected");
    assert_eq!(shared.lock().unwrap().creates, 2);
    let tenant_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tenants WHERE id=$1::uuid)")
            .bind(TENANT)
            .fetch_one(&admin)
            .await
            .unwrap();
    assert!(tenant_exists);
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind("22222222-2222-4222-8222-222222222222")
        .execute(&mut *tx)
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM company_subscriptions")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(count, 0);
    tx.rollback().await.unwrap();
    provider_server.abort();
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
