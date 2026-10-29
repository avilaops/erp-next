use std::{collections::BTreeMap, env, time::Duration};

use anyhow::{Context, ensure};
use reqwest::{Client, Method, Url};
use serde_json::Value;
use uuid::Uuid;

use super::super::DomainError;

/// Only this server-side adapter knows the provider token. Debug intentionally
/// omits credentials. Templates are explicitly assigned to each ERP tenant.
#[derive(Clone)]
pub struct Docuseal {
    client: Client,
    base: Url,
    token: String,
    webhook_secret: String,
    templates: BTreeMap<Uuid, Vec<i64>>,
    email_ready: bool,
}

impl std::fmt::Debug for Docuseal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Docuseal")
            .field("base", &self.base)
            .finish_non_exhaustive()
    }
}

impl Docuseal {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let Ok(token) = env::var("DOCUSEAL_API_TOKEN") else {
            return Ok(None);
        };
        let endpoint =
            env::var("DOCUSEAL_URL").unwrap_or_else(|_| "https://contrato.avilaops.com".into());
        let base = Url::parse(&endpoint)?;
        ensure!(
            base.scheme() == "https"
                && base.host_str() == Some("contrato.avilaops.com")
                && base.port().is_none()
                && base.username().is_empty()
                && base.password().is_none()
                && base.query().is_none()
                && base.fragment().is_none()
                && base.path() == "/",
            "DOCUSEAL_URL must be our HTTPS installation"
        );
        let webhook_secret =
            env::var("DOCUSEAL_WEBHOOK_SECRET").context("DOCUSEAL_WEBHOOK_SECRET required")?;
        ensure!(
            token.len() >= 16 && webhook_secret.len() >= 32,
            "Invalid DocuSeal credentials"
        );
        let templates: BTreeMap<Uuid, Vec<i64>> = serde_json::from_str(
            &env::var("DOCUSEAL_TENANT_TEMPLATES").context("DOCUSEAL_TENANT_TEMPLATES required")?,
        )?;
        ensure!(
            templates
                .values()
                .all(|ids| !ids.is_empty() && ids.len() <= 20 && ids.iter().all(|id| *id > 0)),
            "Invalid tenant template assignment"
        );
        Ok(Some(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            base,
            token,
            webhook_secret,
            templates,
            email_ready: env::var("DOCUSEAL_EMAIL_READY").as_deref() == Ok("true"),
        }))
    }

    pub fn email_ready(&self) -> bool {
        self.email_ready
    }

    pub fn template_ids(&self, tenant: Uuid) -> &[i64] {
        self.templates
            .get(&tenant)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    pub fn verify_webhook(&self, candidate: &str) -> bool {
        // Compare fixed-size digests without early exit on the first different byte.
        use sha2::{Digest, Sha256};
        let a = Sha256::digest(candidate.as_bytes());
        let b = Sha256::digest(self.webhook_secret.as_bytes());
        a.iter()
            .zip(b.iter())
            .fold(0_u8, |diff, (x, y)| diff | (x ^ y))
            == 0
    }

    pub async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, DomainError> {
        let url = self
            .base
            .join(&format!("api/{path}"))
            .map_err(|_| unavailable())?;
        let mut request = self
            .client
            .request(method, url)
            .header("X-Auth-Token", &self.token);
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().await.map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        let bytes = bounded_body(response, 4 * 1024 * 1024).await?;
        serde_json::from_slice(&bytes).map_err(|_| unavailable())
    }

    pub async fn pdf(&self, raw: &str) -> Result<Vec<u8>, DomainError> {
        let url = Url::parse(raw).map_err(|_| unavailable())?;
        // Do not forward credentials to file URLs or follow redirects. Private
        // network/object-store URLs require an explicit adapter change.
        if url.origin() != self.base.origin()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(DomainError::Conflict(
                "Documento retornou um endereço fora do nosso servidor",
            ));
        }
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        let bytes = bounded_body(response, 20 * 1024 * 1024).await?;
        if !bytes.starts_with(b"%PDF-") {
            return Err(DomainError::Conflict(
                "O provedor não retornou um PDF válido",
            ));
        }
        Ok(bytes)
    }

    #[cfg(test)]
    pub fn for_test(base: Url, tenant: Uuid, email_ready: bool) -> Self {
        Self {
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            base,
            token: "fixture-token".into(),
            webhook_secret: "fixture-webhook-secret".into(),
            templates: BTreeMap::from([(tenant, vec![1])]),
            email_ready,
        }
    }
}

async fn bounded_body(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, DomainError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| unavailable())? {
        if bytes.len() + chunk.len() > limit {
            return Err(DomainError::Conflict(
                "Resposta do provedor excede o limite permitido",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub fn unavailable() -> DomainError {
    DomainError::Conflict(
        "Não foi possível confirmar o resultado no serviço de contratos. Atualize o andamento; não gere outro envio",
    )
}
