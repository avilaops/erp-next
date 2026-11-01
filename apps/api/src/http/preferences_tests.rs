use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";

async fn call(
    router: &Router,
    method: &str,
    subject: &str,
    tenant: &str,
    etag: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri("/api/v1/preferences")
        .header("x-tenant-id", tenant)
        .header("content-type", "application/json");
    if !subject.is_empty() {
        request = request.header("authorization", format!("Bearer {subject}"));
    }
    if let Some(etag) = etag {
        request = request.header("if-match", etag);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body =
        serde_json::from_slice(&to_bytes(response.into_body(), 100000).await.unwrap()).unwrap();
    (status, body)
}

#[sqlx::test(migrations = "../../migrations")]
async fn personal_preferences_persist_and_isolate_owner_tenant_and_revisions(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    let (status, initial) = call(&router, "GET", "editor", TENANT, None, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(initial["data"]["productPageSize"], 25);
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            TENANT,
            None,
            json!({"productPageSize":10})
        )
        .await
        .0,
        StatusCode::PRECONDITION_REQUIRED
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            TENANT,
            Some("\"1\""),
            json!({"productPageSize":11})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            TENANT,
            Some("\"1\""),
            json!({"productPageSize":10,"authSubject":"reader"})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, saved) = call(
        &router,
        "PUT",
        "editor",
        TENANT,
        Some("\"1\""),
        json!({"productPageSize":10}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["revision"], 2);
    assert_eq!(
        call(&router, "GET", "editor", TENANT, None, Value::Null)
            .await
            .1["data"]["productPageSize"],
        10
    );
    assert_eq!(
        call(&router, "GET", "reader", TENANT, None, Value::Null)
            .await
            .1["data"]["productPageSize"],
        25
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            "editor",
            TENANT,
            Some("\"1\""),
            json!({"productPageSize":50})
        )
        .await
        .0,
        StatusCode::PRECONDITION_FAILED
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            "reader",
            TENANT,
            Some("\"1\""),
            json!({"productPageSize":100})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&router, "GET", "", TENANT, None, Value::Null).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&router, "GET", "disabled", TENANT, None, Value::Null)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &router,
            "GET",
            "editor",
            "22222222-2222-4222-8222-222222222222",
            None,
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut tx = application.begin().await.unwrap();
    sqlx::query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.auth_subject','reader',true)",
    )
    .bind(TENANT)
    .execute(&mut *tx)
    .await
    .unwrap();
    let visible: Vec<i32> =
        sqlx::query_scalar("SELECT product_page_size FROM personal_preferences")
            .fetch_all(&mut *tx)
            .await
            .unwrap();
    assert_eq!(visible, vec![100], "RLS must hide the editor's preference");
    tx.rollback().await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='preferences.updated'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        2
    );
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn dashboard_layout_persists_without_legacy_writes_erasing_it(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    let layout = json!({
        "favoritePaths": ["/compras/pedidos", "/vendas/pedidos"],
        "charts": ["Pedidos de venda"],
        "period": "30D"
    });
    let (status, saved) = call(
        &router,
        "PUT",
        "editor",
        TENANT,
        Some("\"1\""),
        json!({"productPageSize":25,"dashboardLayout":layout}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["data"]["dashboardLayout"], layout);
    let (status, _) = call(
        &router,
        "PUT",
        "editor",
        TENANT,
        Some("\"2\""),
        json!({"productPageSize":50}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let stored = call(&router, "GET", "editor", TENANT, None, Value::Null)
        .await
        .1;
    assert_eq!(stored["data"]["dashboardLayout"], layout);
    assert_eq!(stored["data"]["productPageSize"], 50);
    let other = call(&router, "GET", "reader", TENANT, None, Value::Null)
        .await
        .1;
    assert_ne!(other["data"]["dashboardLayout"], layout);
    let stale = call(
        &router,
        "PUT",
        "editor",
        TENANT,
        Some("\"2\""),
        json!({"productPageSize":25,"dashboardLayout":layout}),
    )
    .await;
    assert_eq!(stale.0, StatusCode::PRECONDITION_FAILED);
    for invalid in [
        json!({"favoritePaths":["/compras/pedidos","/compras/pedidos"],"charts":[],"period":"30D"}),
        json!({"favoritePaths":["https://example.invalid"],"charts":[],"period":"30D"}),
        json!({"favoritePaths":[],"charts":["Unknown"],"period":"30D"}),
        json!({"favoritePaths":[],"charts":[],"period":"forever"}),
    ] {
        let response = call(
            &router,
            "PUT",
            "editor",
            TENANT,
            Some("\"3\""),
            json!({"productPageSize":25,"dashboardLayout":invalid}),
        )
        .await;
        assert_eq!(
            response.0,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{:?}",
            response.1
        );
    }
    let mut tx = application.begin().await.unwrap();
    sqlx::query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.auth_subject','reader',true)",
    )
    .bind(TENANT)
    .execute(&mut *tx)
    .await
    .unwrap();
    let visible: i64 =
        sqlx::query_scalar("SELECT count(*) FROM personal_preferences WHERE auth_subject='editor'")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(visible, 0);
    tx.rollback().await.unwrap();
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
