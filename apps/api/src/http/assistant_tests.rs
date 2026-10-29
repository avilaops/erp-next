use super::company_tests::{cleanup, setup};
use crate::{
    domains::assistant::InferenceClient,
    platform::{auth::AuthClient, state::AppState},
};
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::{get, post},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

async fn request(router: &Router, tenant: &str, question: &str) -> axum::response::Response {
    router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/assistant")
                .header("authorization", "Bearer editor")
                .header("x-tenant-id", tenant)
                .header("content-type", "application/json")
                .body(Body::from(json!({"questions":[question]}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn events(response: axum::response::Response) -> Vec<Value> {
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
    String::from_utf8(bytes.to_vec())
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[sqlx::test(migrations = "../../migrations")]
async fn assistant_reads_only_authorized_tenant_data_and_reports_failures(admin: PgPool) {
    let (_, application, auth_server, role) = setup(&admin).await;
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) VALUES ('99999999-9999-4999-8999-999999999999','catalog.products.read'), ('99999999-9999-4999-8999-999999999999','inventory.stock.read');
        INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status) VALUES
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','SKU-123','Produto de teste','UN',1234,'active'),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','SKU-123','SEGREDO OUTRA EMPRESA','UN',99999,'active');
        INSERT INTO stock_balances(tenant_id,product_id,quantity_micros) VALUES ('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',42000000);")
        .execute(&admin).await.unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let model = tokio::spawn(async move {
        axum::serve(listener, Router::new()
            .route("/userinfo", get(|| async { Json(json!({"sub":"editor","email":"editor@example.test"})) }))
            .route("/api/chat", post(|Json(body): Json<Value>| async move {
                if body["tools"].as_array().unwrap().is_empty() {
                    // The summary cannot invoke new tools or receive another tenant's rows.
                    assert!(!body.to_string().contains("SEGREDO OUTRA EMPRESA"));
                    return Ok(Json(json!({"done":true,"message":{"content":"Consulte as fontes confirmadas."}})));
                }
                let question = body["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap();
                if question == "offline" { return Err(StatusCode::SERVICE_UNAVAILABLE); }
                if question == "slow" { tokio::time::sleep(std::time::Duration::from_secs(10)).await; }
                let (name, args) = match question {
                    "stock" => ("consultar_estoque", json!({"q":"SKU-123"})),
                    "missing" => ("buscar_produtos", json!({"q":"NONEXISTENT"})),
                    "injection" => ("buscar_produtos", json!({"q":"SKU-123","tenantId":"other"})),
                    "write" => ("alterar_preco", json!({"q":"SKU-123"})),
                    "navigation" => ("localizar_funcionalidade", json!({"q":"produtos"})),
                    _ => ("buscar_produtos", json!({"q":"SKU-123"})),
                };
                Ok(Json(json!({"done":true,"message":{"content":"","tool_calls":[{"function":{"name":name,"arguments":args}}]}})))
            }))).await.unwrap();
    });
    let state = AppState::new(
        application.clone(),
        AuthClient::new(format!("http://{address}/userinfo")),
    )
    .with_assistant(Some(
        InferenceClient::new(&format!("http://{address}"), "fixture".into()).unwrap(),
    ));
    let router = super::router(state);
    assert_eq!(
        request(&router, OTHER, "product").await.status(),
        StatusCode::FORBIDDEN
    );
    let product = events(request(&router, TENANT, "product").await).await;
    let source = &product.iter().find(|e| e["type"] == "source").unwrap()["source"];
    assert_eq!(source["total"], 1);
    assert_eq!(source["data"][0]["basePrice"], "12.34");
    assert_eq!(
        source["data"][0]["href"],
        "/cadastros/produtos/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    );
    assert!(!format!("{product:?}").contains("SEGREDO OUTRA EMPRESA"));
    let stock = events(request(&router, TENANT, "stock").await).await;
    assert_eq!(
        stock.iter().find(|e| e["type"] == "source").unwrap()["source"]["data"][0]["available"],
        "42.000000"
    );
    let navigation = events(request(&router, TENANT, "navigation").await).await;
    assert_eq!(
        navigation.iter().find(|e| e["type"] == "source").unwrap()["source"]["data"][0]["href"],
        "/cadastros/produtos"
    );
    let missing = events(request(&router, TENANT, "missing").await).await;
    assert_eq!(
        missing.iter().find(|e| e["type"] == "answer").unwrap()["kind"],
        "erp"
    );
    for question in ["write", "injection", "offline"] {
        let failed = events(request(&router, TENANT, question).await).await;
        assert!(failed.iter().any(|e| e["type"] == "error"));
        assert!(
            !failed
                .iter()
                .any(|e| e["type"] == "answer" || e["type"] == "source")
        );
    }
    // A disconnected client releases the single inference slot.
    let slow = request(&router, TENANT, "slow").await;
    assert_eq!(
        request(&router, TENANT, "product").await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    drop(slow);
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(
        events(request(&router, TENANT, "product").await)
            .await
            .iter()
            .any(|e| e["type"] == "source")
    );
    sqlx::query("DELETE FROM role_permissions WHERE role_id='99999999-9999-4999-8999-999999999999' AND permission_code='catalog.products.read'").execute(&admin).await.unwrap();
    for question in ["product", "navigation"] {
        let denied = events(request(&router, TENANT, question).await).await;
        assert_eq!(
            denied.iter().find(|e| e["type"] == "error").unwrap()["status"],
            403
        );
        assert!(
            !denied
                .iter()
                .any(|e| e["type"] == "source" || e["type"] == "answer")
        );
    }
    let price: i64 = sqlx::query_scalar(
        "SELECT price_cents FROM products WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(price, 1234);
    model.abort();
    cleanup(&admin, application, auth_server, &role).await;
}
