use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{
    Client, Url,
    header::{ACCEPT, AUTHORIZATION, HeaderMap, HeaderValue},
};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

const MAX_RESPONSE: usize = 12 * 1024 * 1024;
const MAX_PDF: usize = 8 * 1024 * 1024;
const PROTOCOL: &str = "2025-06-18";

#[derive(Debug, PartialEq)]
pub enum RenderError {
    Invalid,
    Gateway,
}

#[derive(Clone)]
pub struct DanfeClient {
    client: Client,
    endpoint: Url,
    ca_bundle: Option<Arc<str>>,
}
impl std::fmt::Debug for DanfeClient {
    fn fmt(&self, output: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        output.write_str("DanfeClient { credentials: [REDACTED] }")
    }
}
impl DanfeClient {
    pub fn new(endpoint: &str, token: &str, ca_bundle: Option<String>) -> anyhow::Result<Self> {
        let endpoint = Url::parse(endpoint)?;
        anyhow::ensure!(
            endpoint.scheme() == "https"
                || (endpoint.scheme() == "http"
                    && [Some("127.0.0.1"), Some("[::1]")].contains(&endpoint.host_str())),
            "DANFE_MCP_URL requires HTTPS or literal loopback HTTP"
        );
        anyhow::ensure!(
            endpoint.username().is_empty()
                && endpoint.password().is_none()
                && endpoint.query().is_none()
                && endpoint.fragment().is_none(),
            "DANFE_MCP_URL must not include credentials or query parameters"
        );
        anyhow::ensure!(!token.trim().is_empty(), "DANFE_MCP_TOKEN is required");
        let mut headers = HeaderMap::new();
        let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))?;
        authorization.set_sensitive(true);
        headers.insert(AUTHORIZATION, authorization);
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/json, text/event-stream"),
        );
        let client = Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            .build()?;
        Ok(Self {
            client,
            endpoint,
            ca_bundle: ca_bundle.map(Arc::from),
        })
    }

    async fn rpc(
        &self,
        session: &mut Option<HeaderValue>,
        protocol: &str,
        message: Value,
    ) -> Result<Value, RenderError> {
        let name = match message["params"]["name"].as_str() {
            Some("fiscal_validar_xml_fiscal") => Some("fiscal_validar_xml_fiscal"),
            Some("fiscal_validar_assinatura_nfe") => Some("fiscal_validar_assinatura_nfe"),
            Some("fiscal_gerar_danfe") => Some("fiscal_gerar_danfe"),
            _ => None,
        };
        let operation = self.rpc_untraced(session, protocol, message);
        match name {
            Some(name) => crate::platform::langfuse::observe(
                name,
                "tool",
                operation,
                |result| result["isError"] == true,
            )
            .await,
            None => operation.await,
        }
    }

    async fn rpc_untraced(
        &self,
        session: &mut Option<HeaderValue>,
        protocol: &str,
        message: Value,
    ) -> Result<Value, RenderError> {
        let id = message.get("id").cloned();
        let mut request = self
            .client
            .post(self.endpoint.clone())
            .header("MCP-Protocol-Version", protocol)
            .json(&message);
        if let Some(session) = session.as_ref() {
            request = request.header("Mcp-Session-Id", session);
        }
        let mut response = request.send().await.map_err(|_| RenderError::Gateway)?;
        if !response.status().is_success() {
            return Err(RenderError::Gateway);
        }
        if message["method"] == "initialize"
            && let Some(value) = response.headers().get("Mcp-Session-Id")
        {
            if value.as_bytes().is_empty()
                || value.as_bytes().len() > 256
                || !value
                    .as_bytes()
                    .iter()
                    .all(|byte| (0x21..=0x7e).contains(byte))
            {
                return Err(RenderError::Gateway);
            }
            *session = Some(value.clone());
        }
        if id.is_none() {
            return if response.status() == 202 || response.status() == 204 {
                Ok(Value::Null)
            } else {
                Err(RenderError::Gateway)
            };
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_owned();
        if !content_type.starts_with("application/json")
            && !content_type.starts_with("text/event-stream")
        {
            return Err(RenderError::Gateway);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| RenderError::Gateway)? {
            if bytes.len() + chunk.len() > MAX_RESPONSE {
                return Err(RenderError::Gateway);
            }
            bytes.extend_from_slice(&chunk);
            if content_type.starts_with("text/event-stream") {
                // A final response can arrive while the server keeps the stream open.
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    let text = text.replace("\r\n", "\n");
                    if let Some((complete, _)) = text.rsplit_once("\n\n") {
                        for event in complete.split("\n\n") {
                            if let Some(value) = sse_value(event, id.as_ref().expect("request id"))?
                            {
                                return rpc_result(value, id.as_ref().expect("request id"));
                            }
                        }
                    }
                }
            }
        }
        let value: Value = if content_type.starts_with("application/json") {
            serde_json::from_slice(&bytes).map_err(|_| RenderError::Gateway)?
        } else {
            let text = std::str::from_utf8(&bytes)
                .map_err(|_| RenderError::Gateway)?
                .replace("\r\n", "\n");
            let mut found = None;
            for event in text.split("\n\n") {
                if let Some(value) = sse_value(event, id.as_ref().expect("request id"))? {
                    found = Some(value);
                    break;
                }
            }
            found.ok_or(RenderError::Gateway)?
        };
        rpc_result(value, id.as_ref().expect("request id"))
    }

    pub async fn render(&self, xml: &str, key: &str) -> Result<Vec<u8>, RenderError> {
        crate::platform::langfuse::observe(
            "render-danfe",
            "span",
            self.render_untraced(xml, key),
            |_| false,
        )
        .await
    }

    async fn render_untraced(&self, xml: &str, key: &str) -> Result<Vec<u8>, RenderError> {
        let mut session = None;
        let mut protocol = PROTOCOL.to_owned();
        let result = tokio::time::timeout(Duration::from_secs(50), async {
            let initialized = self.rpc(&mut session, PROTOCOL, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":PROTOCOL,"capabilities":{},"clientInfo":{"name":"erp-next-danfe","version":env!("CARGO_PKG_VERSION")}}})).await?;
            protocol = initialized["protocolVersion"].as_str().filter(|value| ["2025-03-26", "2025-06-18", "2025-11-25"].contains(value)).ok_or(RenderError::Gateway)?.to_owned();
            self.rpc(&mut session, &protocol, json!({"jsonrpc":"2.0","method":"notifications/initialized"})).await?;
            let schema = tool_value(self.rpc(&mut session, &protocol, call(2, "fiscal_validar_xml_fiscal", json!({"xml_content":xml,"tipo":"nfe"}))).await?)?;
            if schema["valido"] == false { return Err(RenderError::Invalid); }
            if schema["valido"] != true || schema["tipo"] != "nfe" || schema["modelo"] != "55" || schema["documento"] != "nfeProc" || schema["chave_acesso"] != key { return Err(RenderError::Gateway); }
            let mut arguments = json!({"xml_content":xml});
            if let Some(bundle) = &self.ca_bundle { arguments["ca_bundle"] = Value::String(bundle.to_string()); }
            let signature = tool_value(self.rpc(&mut session, &protocol, call(3, "fiscal_validar_assinatura_nfe", arguments)).await?)?;
            if signature["assinatura_valida"] == false { return Err(RenderError::Invalid); }
            if signature["assinatura_valida"] != true { return Err(RenderError::Gateway); }
            let document = tool_value(self.rpc(&mut session, &protocol, call(4, "fiscal_gerar_danfe", json!({"xml_content":xml}))).await?)?;
            if document["modelo"] != 55 || document["chave_acesso"] != key { return Err(RenderError::Gateway); }
            let encoded = document["pdf_base64"].as_str().filter(|value| value.len() <= MAX_RESPONSE).ok_or(RenderError::Gateway)?;
            let pdf = STANDARD.decode(encoded).map_err(|_| RenderError::Gateway)?;
            if pdf.len() < 100 || pdf.len() > MAX_PDF || !pdf.starts_with(b"%PDF-") || !pdf[pdf.len().saturating_sub(1024)..].windows(5).any(|bytes| bytes == b"%%EOF") { return Err(RenderError::Gateway); }
            Ok(pdf)
        }).await.unwrap_or(Err(RenderError::Gateway));
        if let Some(session) = session {
            // Session cleanup is best effort; it must never retry rendering or issuance.
            let _ = self
                .client
                .delete(self.endpoint.clone())
                .header("Mcp-Session-Id", session)
                .header("MCP-Protocol-Version", &protocol)
                .timeout(Duration::from_secs(2))
                .send()
                .await;
        }
        result
    }
}
fn call(id: u32, name: &str, arguments: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":arguments}})
}
fn rpc_result(value: Value, id: &Value) -> Result<Value, RenderError> {
    if value["jsonrpc"] != "2.0" || value.get("id") != Some(id) || value.get("error").is_some() {
        return Err(RenderError::Gateway);
    }
    value.get("result").cloned().ok_or(RenderError::Gateway)
}
fn sse_value(event: &str, id: &Value) -> Result<Option<Value>, RenderError> {
    let data = event
        .lines()
        .filter_map(|line| {
            line.strip_prefix("data:")
                .map(|value| value.strip_prefix(' ').unwrap_or(value))
        })
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() {
        return Ok(None);
    }
    let value: Value = serde_json::from_str(&data).map_err(|_| RenderError::Gateway)?;
    Ok((value.get("id") == Some(id)).then_some(value))
}
fn tool_value(result: Value) -> Result<Value, RenderError> {
    if result["isError"] == true {
        return Err(RenderError::Gateway);
    }
    if let Some(value) = result
        .get("structuredContent")
        .filter(|value| value.is_object())
    {
        return Ok(value.clone());
    }
    let blocks = result["content"].as_array().ok_or(RenderError::Gateway)?;
    if blocks.len() != 1 || blocks[0]["type"] != "text" {
        return Err(RenderError::Gateway);
    }
    serde_json::from_str(blocks[0]["text"].as_str().ok_or(RenderError::Gateway)?)
        .map_err(|_| RenderError::Gateway)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::fiscal::{
        danfe::FIXTURE,
        danfe_test_support::{KEY, PDF, provider},
    };
    #[tokio::test]
    async fn json_sse_and_structured_results_validate_before_rendering_and_close_the_session() {
        for mode in ["json", "sse", "structured"] {
            let (client, server, calls) = provider(mode).await;
            let pdf = client.render(FIXTURE, KEY).await.unwrap();
            server.abort();
            assert_eq!(pdf, STANDARD.decode(PDF.trim()).unwrap());
            assert_eq!(
                *calls.lock().unwrap(),
                [
                    "initialize",
                    "notifications/initialized",
                    "fiscal_validar_xml_fiscal",
                    "fiscal_validar_assinatura_nfe",
                    "fiscal_gerar_danfe",
                    "DELETE"
                ]
            );
        }
    }
    #[tokio::test]
    async fn schema_and_signature_refusals_never_reach_the_renderer() {
        for mode in ["schema-invalid", "signature-invalid"] {
            let (client, server, calls) = provider(mode).await;
            let result = client.render(FIXTURE, KEY).await;
            server.abort();
            assert_eq!(result, Err(RenderError::Invalid));
            assert!(
                !calls
                    .lock()
                    .unwrap()
                    .contains(&"fiscal_gerar_danfe".to_owned())
            );
            assert_eq!(
                calls.lock().unwrap().last().map(String::as_str),
                Some("DELETE")
            );
        }
    }
    #[tokio::test]
    async fn provider_errors_invalid_pdf_and_wrong_invoice_are_not_successful_downloads() {
        for mode in ["tool-error", "invalid-pdf", "wrong-key"] {
            let (client, server, _) = provider(mode).await;
            let result = client.render(FIXTURE, KEY).await;
            server.abort();
            assert_eq!(result, Err(RenderError::Gateway));
            assert!(!format!("{result:?}").contains("private-sentinel"));
        }
    }
    #[test]
    fn credentials_and_untrusted_redirect_targets_are_not_accepted_or_exposed() {
        for endpoint in [
            "http://public.example/mcp",
            "https://user:pass@example.test/mcp",
            "https://example.test/mcp?token=x",
        ] {
            assert!(DanfeClient::new(endpoint, "private-token", None).is_err());
        }
        let client = DanfeClient::new("https://example.test/mcp", "private-token", None).unwrap();
        assert!(!format!("{client:?}").contains("private-token"));
        assert!(sse_value("data: not-json", &json!(2)).is_err());
        assert!(rpc_result(json!({"jsonrpc":"2.0","id":3,"result":{}}), &json!(2)).is_err());
    }
}
