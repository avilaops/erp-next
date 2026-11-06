use axum::{
    Json,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::json;

const RESOURCE: &str = "https://erp.avilaops.com/mcp";
const AUTHORITY: &str = "https://erp.avilaops.com";

pub async fn protected_resource() -> impl IntoResponse {
    Json(json!({
        "resource": RESOURCE,
        "authorization_servers": [AUTHORITY],
    }))
}

pub async fn authorization_server() -> impl IntoResponse {
    Json(json!({
        "issuer": AUTHORITY,
        "authorization_endpoint": format!("{AUTHORITY}/mcp/oauth/authorize"),
        "token_endpoint": format!("{AUTHORITY}/mcp/oauth/token"),
        "registration_endpoint": format!("{AUTHORITY}/mcp/oauth/register"),
        "code_challenge_methods_supported": ["S256"],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
    }))
}

pub async fn streamable_http(headers: HeaderMap) -> Response {
    if headers
        .get(header::ORIGIN)
        .is_some_and(|origin| origin.as_bytes() != AUTHORITY.as_bytes())
    {
        return StatusCode::FORBIDDEN.into_response();
    }

    (
        StatusCode::UNAUTHORIZED,
        [
            (
                header::WWW_AUTHENTICATE,
                format!(
                    "Bearer resource_metadata=\"{AUTHORITY}/.well-known/oauth-protected-resource/mcp\""
                ),
            ),
            (header::CACHE_CONTROL, "no-store".to_owned()),
        ],
    )
        .into_response()
}
