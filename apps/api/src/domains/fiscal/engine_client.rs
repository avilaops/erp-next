use reqwest::{
    Client, Url,
    header::{AUTHORIZATION, HeaderMap, HeaderValue},
};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, PartialEq)]
pub enum EngineError {
    Unavailable,
    InvalidResponse,
}
#[derive(Clone)]
pub struct FiscalEngine {
    client: Client,
    endpoint: Url,
}
impl std::fmt::Debug for FiscalEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FiscalEngine { credentials: [REDACTED] }")
    }
}

impl FiscalEngine {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let endpoint = std::env::var("ERP_FISCAL_ENGINE_URL")
            .ok()
            .filter(|v| !v.trim().is_empty());
        let token = std::env::var("ERP_FISCAL_ENGINE_TOKEN")
            .ok()
            .filter(|v| !v.trim().is_empty());
        match (endpoint, token) {
            (None, None) => Ok(None),
            (Some(endpoint), Some(token)) => Self::new(&endpoint, &token).map(Some),
            _ => anyhow::bail!(
                "ERP_FISCAL_ENGINE_URL and ERP_FISCAL_ENGINE_TOKEN must be configured together"
            ),
        }
    }
    pub fn new(endpoint: &str, token: &str) -> anyhow::Result<Self> {
        let endpoint =
            Url::parse(endpoint).map_err(|_| anyhow::anyhow!("Invalid fiscal engine URL"))?;
        anyhow::ensure!(
            endpoint.scheme() == "https"
                || endpoint.scheme() == "http"
                    && matches!(endpoint.host_str(), Some("127.0.0.1" | "[::1]")),
            "Fiscal engine requires HTTPS or literal loopback HTTP"
        );
        anyhow::ensure!(
            endpoint.username().is_empty()
                && endpoint.password().is_none()
                && endpoint.query().is_none()
                && endpoint.fragment().is_none()
                && matches!(endpoint.path(), "" | "/"),
            "Fiscal engine URL must be an origin without credentials"
        );
        anyhow::ensure!(!token.trim().is_empty(), "Fiscal engine token required");
        let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| anyhow::anyhow!("Invalid fiscal engine token"))?;
        authorization.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, authorization);
        let client = Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(45))
            .build()?;
        Ok(Self { client, endpoint })
    }
    pub async fn call(&self, operation: &str, payload: Value) -> Result<Value, EngineError> {
        if ![
            "prepare",
            "authorize",
            "consult",
            "event",
            "void",
            "distribute",
            "manifest",
        ]
        .contains(&operation)
        {
            return Err(EngineError::InvalidResponse);
        }
        let url = self
            .endpoint
            .join(&format!("/v1/{operation}"))
            .map_err(|_| EngineError::InvalidResponse)?;
        let mut response = self
            .client
            .post(url)
            .json(&payload)
            .send()
            .await
            .map_err(|_| EngineError::Unavailable)?;
        if !response.status().is_success() {
            return Err(EngineError::Unavailable);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| EngineError::Unavailable)?
        {
            if bytes.len() + chunk.len() > 12 * 1024 * 1024 {
                return Err(EngineError::InvalidResponse);
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| EngineError::InvalidResponse)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn engine_credentials_are_redacted_and_only_configured_secure_origins_are_accepted() {
        for endpoint in [
            "http://example.test",
            "http://localhost:8000",
            "https://user:secret@example.test",
            "https://example.test?token=x",
            "https://example.test/path",
        ] {
            assert!(FiscalEngine::new(endpoint, "synthetic-secret").is_err());
        }
        let client = FiscalEngine::new("https://example.test", "synthetic-secret").unwrap();
        assert!(!format!("{client:?}").contains("synthetic-secret"));
    }
    #[tokio::test]
    async fn engine_redirects_and_invalid_json_never_become_fiscal_results() {
        use axum::{Router, http::StatusCode, routing::post};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new()
                    .route(
                        "/v1/prepare",
                        post(|| async {
                            (
                                StatusCode::TEMPORARY_REDIRECT,
                                [("location", "http://127.0.0.1:1/private")],
                            )
                        }),
                    )
                    .route("/v1/consult", post(|| async { "not-json" })),
            )
            .await
            .unwrap();
        });
        let client = FiscalEngine::new(&format!("http://{address}"), "synthetic-secret").unwrap();
        assert_eq!(
            client.call("prepare", serde_json::json!({})).await,
            Err(EngineError::Unavailable)
        );
        assert_eq!(
            client.call("consult", serde_json::json!({})).await,
            Err(EngineError::InvalidResponse)
        );
        server.abort();
    }
}
