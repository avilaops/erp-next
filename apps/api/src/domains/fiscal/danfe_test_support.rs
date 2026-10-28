//! Loopback MCP fixture. Its positive validation answers are test doubles, not fiscal attestations.
use super::danfe_client::DanfeClient;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

pub const KEY: &str = "35261004252011000110550010000000011000000017";
pub const PDF: &str = include_str!("../../../tests/fixtures/danfe-provider-synthetic.b64");
pub type Calls = Arc<Mutex<Vec<String>>>;
struct Provider {
    mode: &'static str,
    calls: Calls,
}

async fn handle(
    State(state): State<Arc<Provider>>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Response {
    if headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        != Some("Bearer fixture-mcp-token")
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let method = request["method"].as_str().unwrap_or("");
    let name = if method == "tools/call" {
        request["params"]["name"].as_str().unwrap_or("")
    } else {
        method
    };
    state.calls.lock().unwrap().push(name.to_owned());
    if method != "initialize"
        && headers
            .get("mcp-session-id")
            .and_then(|value| value.to_str().ok())
            != Some("fixture-session")
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if method == "notifications/initialized" {
        return StatusCode::ACCEPTED.into_response();
    }
    let result = if method == "initialize" {
        json!({"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}})
    } else {
        let value = match name {
            "fiscal_validar_xml_fiscal" => {
                json!({"valido":state.mode != "schema-invalid","tipo":"nfe","modelo":"55","documento":"nfeProc","chave_acesso":KEY})
            }
            "fiscal_validar_assinatura_nfe" => {
                json!({"assinatura_valida":state.mode != "signature-invalid"})
            }
            "fiscal_gerar_danfe" => {
                json!({"modelo":55,"chave_acesso":if state.mode == "wrong-key" {"0"}else{KEY},"pdf_base64":if state.mode == "invalid-pdf" {STANDARD.encode(b"Not a PDF")}else{PDF.trim().to_owned()}})
            }
            _ => return StatusCode::NOT_FOUND.into_response(),
        };
        if state.mode == "tool-error" {
            json!({"isError":true,"content":[{"type":"text","text":"private-sentinel-error"}]})
        } else if state.mode == "structured" {
            json!({"structuredContent":value,"content":[]})
        } else {
            json!({"content":[{"type":"text","text":value.to_string()}]})
        }
    };
    let message = json!({"jsonrpc":"2.0","id":request["id"],"result":result});
    let mut response = if state.mode == "sse" {
        (
            [("content-type", "text/event-stream")],
            format!("event: message\r\ndata: {message}\r\n\r\n"),
        )
            .into_response()
    } else {
        Json(message).into_response()
    };
    if method == "initialize" {
        response
            .headers_mut()
            .insert("mcp-session-id", "fixture-session".parse().unwrap());
    }
    response
}
pub async fn provider(mode: &'static str) -> (DanfeClient, tokio::task::JoinHandle<()>, Calls) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let state = Arc::new(Provider {
        mode,
        calls: calls.clone(),
    });
    let server = Router::new()
        .route(
            "/mcp",
            post(handle).delete(
                |State(state): State<Arc<Provider>>, headers: HeaderMap| async move {
                    assert_eq!(headers["mcp-session-id"], "fixture-session");
                    state.calls.lock().unwrap().push("DELETE".to_owned());
                    StatusCode::NO_CONTENT
                },
            ),
        )
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let process = tokio::spawn(async move {
        axum::serve(listener, server).await.unwrap();
    });
    (
        DanfeClient::new(&format!("http://{address}/mcp"), "fixture-mcp-token", None).unwrap(),
        process,
        calls,
    )
}
