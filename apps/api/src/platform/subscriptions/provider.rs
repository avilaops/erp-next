use super::catalog::Plan;
use crate::domains::DomainError;
use reqwest::{Client, Method};
use serde_json::{Value, json};
use std::time::Duration;

#[derive(Clone)]
pub struct MercadoPago {
    http: Client,
    token: String,
    origin: String,
    return_url: String,
}

impl MercadoPago {
    #[cfg(test)]
    pub(crate) fn fixture(origin: String) -> Self {
        assert_eq!(
            reqwest::Url::parse(&origin).unwrap().host_str(),
            Some("127.0.0.1")
        );
        Self {
            http: Client::new(),
            token: "fixture-token".into(),
            origin,
            return_url: "https://erp.example.test/preferencias/empresa/conta/plano".into(),
        }
    }
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let token = std::env::var("ERP_MP_ACCESS_TOKEN").unwrap_or_default();
        if token.trim().is_empty() {
            return Ok(None);
        }
        let return_url = std::env::var("ERP_MP_RETURN_URL")?;
        let url = reqwest::Url::parse(&return_url)?;
        anyhow::ensure!(
            url.scheme() == "https"
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none(),
            "ERP_MP_RETURN_URL must be an HTTPS URL without credentials"
        );
        Ok(Some(Self {
            http: Client::builder()
                .timeout(Duration::from_secs(6))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            token,
            origin: "https://api.mercadopago.com".into(),
            return_url,
        }))
    }

    pub async fn request(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<Value, DomainError> {
        let creation = method == Method::POST && path == "/preapproval";
        let mut request = self
            .http
            .request(method, format!("{}{path}", self.origin))
            .bearer_auth(&self.token)
            .query(query);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|_| provider_error())?;
        if creation && [400, 401, 403, 404, 422].contains(&response.status().as_u16()) {
            return Err(DomainError::Invalid(
                "O Mercado Pago recusou a criação. Confira o e-mail do pagador e a configuração da integração antes de tentar novamente.",
            ));
        }
        if !response.status().is_success() {
            return Err(provider_error());
        }
        response.json().await.map_err(|_| provider_error())
    }

    pub async fn create(
        &self,
        reference: &str,
        plan: &Plan,
        email: &str,
    ) -> Result<Value, DomainError> {
        self.request(Method::POST, "/preapproval", &[], Some(json!({
            "reason": format!("Ávila ERP — {}", plan.name), "external_reference": reference,
            "payer_email": email, "back_url": self.return_url, "status": "pending",
            "auto_recurring": {"frequency":1, "frequency_type":"months", "transaction_amount":plan.monthly_cents / 100, "currency_id":"BRL"}
        }))).await
    }
}

pub fn provider_error() -> DomainError {
    DomainError::Conflict(
        "Não foi possível confirmar a operação no Mercado Pago. Atualize a assinatura antes de tentar novamente.",
    )
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

pub fn checkout_url(value: &Value) -> Option<String> {
    let raw = value.get("init_point")?.as_str()?;
    let url = reqwest::Url::parse(raw).ok()?;
    (url.scheme() == "https"
        && url.host_str() == Some("www.mercadopago.com.br")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.path() == "/subscriptions/checkout")
        .then(|| raw.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_urls_and_ids_cannot_escape_the_allowlist() {
        for raw in [
            "https://evil.test/subscriptions/checkout",
            "https://www.mercadopago.com.br.evil.test/subscriptions/checkout",
            "http://www.mercadopago.com.br/subscriptions/checkout",
            "https://user@www.mercadopago.com.br/subscriptions/checkout",
        ] {
            assert!(checkout_url(&json!({"init_point":raw})).is_none());
        }
        assert!(checkout_url(&json!({"init_point":"https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=test"})).is_some());
        assert!(!valid_id("../payments"));
    }
}
