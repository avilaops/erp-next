use axum::{body::Body, http::Request};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

use super::router;
use crate::platform::{auth::AuthClient, state::AppState};

fn app() -> axum::Router {
    let database = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@127.0.0.1:1/erp_next")
        .unwrap();
    router(AppState::new(
        database,
        AuthClient::new("http://127.0.0.1:1/oauth/userinfo".to_owned()),
    ))
}

#[tokio::test]
async fn mcp_challenges_anonymous_clients_before_database_access() {
    let response = app()
        .oneshot(Request::builder().method("POST").uri("/mcp")
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .body(Body::from(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}"#)).unwrap())
        .await.unwrap();
    assert_eq!(response.status(), 401);
    assert!(
        response.headers()["www-authenticate"]
            .to_str()
            .unwrap()
            .contains("resource_metadata=")
    );
}

#[tokio::test]
async fn mcp_resource_discovery_is_public_without_database_access() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/.well-known/oauth-protected-resource/mcp")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let bytes = axum::body::to_bytes(response.into_body(), 16384)
        .await
        .unwrap();
    let document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(document["resource"], "https://erp.avilaops.com/mcp");
    assert_eq!(
        document["authorization_servers"][0],
        "https://erp.avilaops.com"
    );
}

#[tokio::test]
async fn mcp_rejects_cross_origin_requests_before_authentication() {
    let response = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("origin", "https://attacker.invalid")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
}

#[tokio::test]
async fn mcp_authorization_discovery_requires_s256_and_announces_registration() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/.well-known/oauth-authorization-server")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let bytes = axum::body::to_bytes(response.into_body(), 16384)
        .await
        .unwrap();
    let document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        document["code_challenge_methods_supported"],
        serde_json::json!(["S256"])
    );
    assert_eq!(
        document["registration_endpoint"],
        "https://erp.avilaops.com/mcp/oauth/register"
    );
}

async fn json_call(
    app: &axum::Router,
    method: &str,
    path: &str,
    actor: Option<&str>,
    value: serde_json::Value,
) -> (u16, serde_json::Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream");
    if let Some(actor) = actor {
        request = request.header("authorization", format!("Bearer {actor}"));
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(value.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = axum::body::to_bytes(response.into_body(), 32_000_000)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

async fn token_call(app: &axum::Router, fields: &[(&str, &str)]) -> (u16, serde_json::Value) {
    let mut url = reqwest::Url::parse("https://erp.invalid").unwrap();
    for (key, value) in fields {
        url.query_pairs_mut().append_pair(key, value);
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mcp/oauth/token")
                .header("content-type", "application/x-www-form-urlencoded")
                .body(Body::from(url.query().unwrap_or("").to_owned()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = axum::body::to_bytes(response.into_body(), 16384)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn mcp_oauth_pkce_refresh_replay_and_existing_permissions(admin: sqlx::PgPool) {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use serde_json::json;
    use sha2::{Digest, Sha256};
    let (app, pool, server, _role) = super::company_tests::setup(&admin).await;
    let (status, client) = json_call(&app, "POST", "/mcp/oauth/register", None,
        json!({"client_name":"MCP fixture","redirect_uris":["https://client.example/callback"],"token_endpoint_auth_method":"none"})).await;
    assert_eq!(status, 201);
    let client_id = client["client_id"].as_str().unwrap();
    let verifier = "a".repeat(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let request = json!({"client_id":client_id,"redirect_uri":"https://client.example/callback","response_type":"code", "code_challenge":challenge,"code_challenge_method":"S256","scope":"erp.read erp.write","resource":"https://erp.avilaops.com/mcp","state":"fixture-state"});
    let (status, granted) =
        json_call(&app, "POST", "/mcp/oauth/grant", Some("reader"), request).await;
    assert_eq!(status, 201);
    let redirect = reqwest::Url::parse(granted["redirect_uri"].as_str().unwrap()).unwrap();
    let params: std::collections::HashMap<_, _> = redirect.query_pairs().into_owned().collect();
    assert_eq!(params["state"], "fixture-state");
    let code = params["code"].as_str();
    let (status, _) = token_call(
        &app,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("redirect_uri", "https://attacker.example/callback"),
            ("code_verifier", verifier.as_str()),
            ("resource", "https://erp.avilaops.com/mcp"),
        ],
    )
    .await;
    assert_eq!(
        status, 400,
        "redirect must match the authorization request exactly"
    );
    let (status, _) = token_call(
        &app,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("redirect_uri", "https://client.example/callback"),
            ("code_verifier", verifier.as_str()),
            ("resource", "https://other.example/mcp"),
        ],
    )
    .await;
    assert_eq!(
        status, 400,
        "a token cannot be requested for another resource"
    );
    let (status, _) = token_call(
        &app,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("redirect_uri", "https://client.example/callback"),
            (
                "code_verifier",
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ),
            ("resource", "https://erp.avilaops.com/mcp"),
        ],
    )
    .await;
    assert_eq!(status, 400, "code requires the original PKCE verifier");
    let fields = [
        ("grant_type", "authorization_code"),
        ("client_id", client_id),
        ("code", code),
        ("redirect_uri", "https://client.example/callback"),
        ("code_verifier", verifier.as_str()),
        ("resource", "https://erp.avilaops.com/mcp"),
    ];
    let (status, token) = token_call(&app, &fields).await;
    assert_eq!(status, 200);
    let access_token = token["access_token"].as_str().unwrap();
    assert_eq!(token["token_type"], "Bearer");
    assert_eq!(
        token_call(&app, &fields).await.0,
        400,
        "code must be single use"
    );
    let (status, init) = json_call(&app,"POST","/mcp",Some(access_token),json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}})).await;
    assert_eq!(status, 200);
    assert!(init["result"]["capabilities"]["tools"].is_object());
    for version in ["2025-03-26", "2025-06-18", "2025-11-25"] {
        let (_, init) = json_call(&app,"POST","/mcp",Some(access_token),json!({"jsonrpc":"2.0","id":101,"method":"initialize","params":{"protocolVersion":version,"capabilities":{},"clientInfo":{"name":"test","version":"1"}}})).await;
        assert_eq!(init["result"]["protocolVersion"], version);
    }
    // Request all catalog pages and exercise real business authorization.
    let mut tools = Vec::new();
    let mut cursor = serde_json::Value::Null;
    loop {
        let mut params = json!({});
        if !cursor.is_null() {
            params["cursor"] = cursor.clone();
        }
        let (_, result) = json_call(
            &app,
            "POST",
            "/mcp",
            Some(access_token),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":params}),
        )
        .await;
        tools.extend(
            result["result"]["tools"]
                .as_array()
                .unwrap()
                .iter()
                .cloned(),
        );
        cursor = result["result"]["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    assert!(tools.len() > 150, "full ERP catalog, not just fiscal tools");
    for path in [
        "/api/v1/fiscal/nfe/{id}/consult",
        "/api/v1/fiscal/nfe/{id}/emission",
        "/api/v1/fiscal/issued-nfes",
        "/api/v1/fiscal/nfe/{id}/xml",
    ] {
        let tool = tools
            .iter()
            .find(|t| t["_meta"]["erp/path"] == path)
            .unwrap();
        assert!(
            tool["inputSchema"]["properties"]["tenant_id"].is_object(),
            "{path}"
        );
        assert!(
            tool["inputSchema"]["required"]
                .as_array()
                .unwrap()
                .contains(&json!("tenant_id")),
            "{path}"
        );
    }
    let get_company = tools
        .iter()
        .find(|t| t["_meta"]["erp/path"] == "/api/v1/company" && t["_meta"]["erp/method"] == "GET")
        .unwrap();
    let (_,read)=json_call(&app,"POST","/mcp",Some(access_token),json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":get_company["name"],"arguments":{"tenant_id":"11111111-1111-4111-8111-111111111111"}}})).await;
    assert_eq!(read["result"]["structuredContent"]["status"], 200);
    let (_,isolated)=json_call(&app,"POST","/mcp",Some(access_token),json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":get_company["name"],"arguments":{"tenant_id":"22222222-2222-4222-8222-222222222222"}}})).await;
    assert_eq!(isolated["result"]["structuredContent"]["status"], 403);
    assert_eq!(isolated["result"]["isError"], true);
    let put_company = tools
        .iter()
        .find(|t| t["_meta"]["erp/path"] == "/api/v1/company" && t["_meta"]["erp/method"] == "PUT")
        .unwrap();
    let (_,denied)=json_call(&app,"POST","/mcp",Some(access_token),json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":put_company["name"],"arguments":{"tenant_id":"11111111-1111-4111-8111-111111111111","headers":{"If-Match":"\"1\""},"body":{}}}})).await;
    assert_eq!(denied["result"]["structuredContent"]["status"], 403);
    let refresh = token["refresh_token"].as_str().unwrap();
    let fields = [
        ("grant_type", "refresh_token"),
        ("client_id", client_id),
        ("refresh_token", refresh),
        ("resource", "https://erp.avilaops.com/mcp"),
    ];
    let (status, renewed) = token_call(&app, &fields).await;
    assert_eq!(status, 200);
    assert_ne!(renewed["refresh_token"], token["refresh_token"]);
    assert_eq!(
        token_call(&app, &fields).await.0,
        400,
        "refresh replay revokes the grant"
    );
    assert_eq!(
        json_call(
            &app,
            "POST",
            "/mcp",
            renewed["access_token"].as_str(),
            json!({"jsonrpc":"2.0","id":6,"method":"ping"})
        )
        .await
        .0,
        401
    );
    server.abort();
    pool.close().await;
}

#[tokio::test]
async fn mcp_registration_rejects_unsafe_redirects_without_touching_storage() {
    use serde_json::json;
    for uri in [
        "http://example.com/callback",
        "https://client.example/callback#fragment",
        "https://user:password@client.example/callback",
        "javascript:alert(1)",
        "https://client.example/*",
    ] {
        assert_eq!(
            json_call(
                &app(),
                "POST",
                "/mcp/oauth/register",
                None,
                json!({"redirect_uris":[uri]})
            )
            .await
            .0,
            400,
            "{uri}"
        );
    }
}

#[tokio::test]
async fn oauth_browser_preflights_allow_only_configured_origins() {
    for path in [
        "/mcp/oauth/register",
        "/mcp/oauth/token",
        "/mcp/oauth/revoke",
    ] {
        let response = app()
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri(path)
                    .header("origin", "https://chatgpt.com")
                    .header("access-control-request-method", "POST")
                    .header(
                        "access-control-request-headers",
                        "authorization,content-type",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 204, "{path}");
        assert_eq!(
            response.headers()["access-control-allow-origin"],
            "https://chatgpt.com"
        );
        assert!(
            response.headers()["access-control-allow-headers"]
                .to_str()
                .unwrap()
                .contains("Authorization")
        );
        let denied = app()
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri(path)
                    .header("origin", "https://attacker.invalid")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied.status(), 403);
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn confidential_client_authentication_read_scope_and_revocation(admin: sqlx::PgPool) {
    use base64::{
        Engine,
        engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    };
    use serde_json::json;
    use sha2::{Digest, Sha256};
    let (app, pool, server, _) = super::company_tests::setup(&admin).await;
    let (_,client)=json_call(&app,"POST","/mcp/oauth/register",None,json!({"redirect_uris":["https://client.example/callback"],"token_endpoint_auth_method":"client_secret_basic"})).await;
    let client_id = client["client_id"].as_str().unwrap();
    let secret = client["client_secret"].as_str().unwrap();
    let verifier = "v".repeat(64);
    let (_,grant)=json_call(&app,"POST","/mcp/oauth/grant",Some("editor"),json!({"client_id":client_id,"redirect_uri":"https://client.example/callback","response_type":"code","code_challenge":URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),"code_challenge_method":"S256","scope":"erp.read","resource":"https://erp.avilaops.com/mcp"})).await;
    let redirect = reqwest::Url::parse(grant["redirect_uri"].as_str().unwrap()).unwrap();
    let code = redirect
        .query_pairs()
        .find(|(key, _)| key == "code")
        .unwrap()
        .1
        .into_owned();
    let fields = [
        ("grant_type", "authorization_code"),
        ("client_id", client_id),
        ("client_secret", secret),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("redirect_uri", "https://client.example/callback"),
        ("resource", "https://erp.avilaops.com/mcp"),
    ];
    assert_eq!(
        token_call(&app, &fields).await.0,
        401,
        "Basic client cannot use secret_post"
    );
    let mut url = reqwest::Url::parse("https://erp.invalid").unwrap();
    for (key, value) in fields {
        if key != "client_secret" {
            url.query_pairs_mut().append_pair(key, value);
        }
    }
    let basic = format!("Basic {}", STANDARD.encode(format!("{client_id}:{secret}")));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mcp/oauth/token")
                .header("content-type", "application/x-www-form-urlencoded")
                .header("authorization", &basic)
                .body(Body::from(url.query().unwrap().to_owned()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let bytes = axum::body::to_bytes(response.into_body(), 16384)
        .await
        .unwrap();
    let token: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let access = token["access_token"].as_str().unwrap();
    let (_, list) = json_call(
        &app,
        "POST",
        "/mcp",
        Some(access),
        json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
    )
    .await;
    assert!(
        list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["annotations"]["readOnlyHint"] == true)
    );
    // The scope check also applies to calls by known name, independently of listing.
    let (_,write)=json_call(&app,"POST","/mcp",Some(access),json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"erp_put_company","arguments":{}}})).await;
    assert_eq!(write["result"]["structuredContent"]["status"], 403);
    url.set_query(None);
    url.query_pairs_mut()
        .append_pair("token", access)
        .append_pair("client_id", client_id);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mcp/oauth/revoke")
                .header("content-type", "application/x-www-form-urlencoded")
                .header("authorization", basic)
                .body(Body::from(url.query().unwrap().to_owned()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        json_call(
            &app,
            "POST",
            "/mcp",
            Some(access),
            json!({"jsonrpc":"2.0","id":3,"method":"ping"})
        )
        .await
        .0,
        401
    );
    let plaintext: i64 = sqlx::query_scalar("SELECT count(*) FROM mcp_oauth_tokens WHERE hash=$1")
        .bind(access)
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(plaintext, 0, "tokens must never be stored in plaintext");
    server.abort();
    pool.close().await;
}
