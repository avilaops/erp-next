use super::{
    access, administrators, auth::AuthenticatedIdentity, mail::SmtpMailer, state::AppState,
};
use crate::{
    domains::fiscal::certificate_crypto::SealedCertificate,
    domains::{DomainError, db, response},
};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use utoipa::ToSchema;
use zeroize::Zeroize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SmtpSecurity {
    Starttls,
    Tls,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MailSettingsData {
    pub enabled: bool,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub security: SmtpSecurity,
    pub username: String,
    pub from_name: String,
    pub from_address: String,
    pub password_set: bool,
}

impl Default for MailSettingsData {
    fn default() -> Self {
        Self {
            enabled: false,
            name: String::new(),
            host: String::new(),
            port: 587,
            security: SmtpSecurity::Starttls,
            username: String::new(),
            from_name: String::new(),
            from_address: String::new(),
            password_set: false,
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum MailSettingsSource {
    Platform,
    Environment,
    Unconfigured,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MailSettingsSnapshot {
    pub revision: i64,
    pub source: MailSettingsSource,
    pub can_manage: bool,
    pub encryption_ready: bool,
    pub data: MailSettingsData,
}

// Intentionally has no Debug/Serialize implementation: this DTO owns a secret.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MailSettingsUpdate {
    pub enabled: bool,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub security: SmtpSecurity,
    pub username: String,
    pub from_name: String,
    pub from_address: String,
    #[serde(default)]
    #[schema(write_only = true, format = Password)]
    pub password: Option<String>,
}

impl Drop for MailSettingsUpdate {
    fn drop(&mut self) {
        if let Some(value) = self.password.as_mut() {
            value.zeroize();
        }
    }
}

fn clean(value: &str, maximum: usize) -> bool {
    value.len() <= maximum && !value.chars().any(char::is_control)
}

// This singleton starts at revision zero before its first persisted save.
// Keep the positive-only revision contract for existing domain documents.
fn settings_revision(headers: &HeaderMap) -> Result<i64, DomainError> {
    headers
        .get(axum::http::header::IF_MATCH)
        .ok_or(DomainError::RevisionRequired)?
        .to_str()
        .ok()
        .and_then(|raw| raw.strip_prefix('"'))
        .and_then(|raw| raw.strip_suffix('"'))
        .filter(|raw| !raw.is_empty() && raw.bytes().all(|c| c.is_ascii_digit()))
        .and_then(|raw| raw.parse::<i64>().ok())
        .ok_or(DomainError::InvalidRevision)
}

impl MailSettingsUpdate {
    fn validate(&self) -> Result<MailSettingsData, DomainError> {
        let host = self.host.trim();
        let username = self.username.trim();
        if !clean(&self.name, 120)
            || !clean(&self.from_name, 160)
            || !clean(&self.from_address, 254)
            || !clean(&self.username, 320)
            || !clean(&self.host, 253)
            || self.port == 0
        {
            return Err(DomainError::Invalid("Configuração SMTP inválida"));
        }
        if !host.is_empty()
            && (!host.is_ascii()
                || host.split('.').any(|label| {
                    label.is_empty()
                        || label.len() > 63
                        || label.starts_with('-')
                        || label.ends_with('-')
                        || !label
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
                }))
        {
            return Err(DomainError::Invalid(
                "Informe somente o nome do servidor SMTP",
            ));
        }
        if !self.from_address.trim().is_empty()
            && self.from_address.trim().parse::<lettre::Address>().is_err()
        {
            return Err(DomainError::Invalid("E-mail do remetente inválido"));
        }
        if self.enabled
            && (host.is_empty() || username.is_empty() || self.from_address.trim().is_empty())
        {
            return Err(DomainError::Invalid(
                "Informe servidor, usuário e e-mail do remetente",
            ));
        }
        if self
            .password
            .as_ref()
            .is_some_and(|p| p.len() > 4096 || p.contains('\0'))
        {
            return Err(DomainError::Invalid("Senha SMTP inválida"));
        }
        Ok(MailSettingsData {
            enabled: self.enabled,
            name: self.name.trim().to_owned(),
            host: host.to_ascii_lowercase(),
            port: self.port,
            security: self.security,
            username: username.to_owned(),
            from_name: self.from_name.trim().to_owned(),
            from_address: self.from_address.trim().to_owned(),
            password_set: false,
        })
    }
}

fn secret_context(data: &MailSettingsData) -> String {
    // JSON framing avoids ambiguous contexts when usernames contain separators.
    serde_json::json!([
        "platform.smtp.v1",
        data.host,
        data.port,
        data.security,
        data.username
    ])
    .to_string()
}

#[derive(sqlx::FromRow)]
struct Stored {
    data: serde_json::Value,
    revision: i64,
    secret_context: Option<String>,
    secret_key_id: Option<String>,
    secret_nonce: Option<Vec<u8>>,
    secret_ciphertext: Option<Vec<u8>>,
}

impl Stored {
    fn data(&self) -> Result<MailSettingsData, DomainError> {
        let mut data: MailSettingsData =
            serde_json::from_value(self.data.clone()).map_err(|_| access::AccessError::Internal)?;
        data.password_set = self.secret_ciphertext.is_some();
        Ok(data)
    }
    fn sealed(&self) -> Option<SealedCertificate> {
        Some(SealedCertificate {
            key_id: self.secret_key_id.clone()?,
            nonce: self.secret_nonce.clone()?,
            ciphertext: self.secret_ciphertext.clone()?,
        })
    }
}

async fn load(tx: &mut Transaction<'_, Postgres>) -> Result<Option<Stored>, DomainError> {
    sqlx::query_as("SELECT data,revision,secret_context,secret_key_id,secret_nonce,secret_ciphertext FROM platform_mail_settings WHERE singleton")
        .fetch_optional(&mut **tx).await.map_err(db)
}

async fn authorized<'a>(
    state: &'a AppState,
    identity: &AuthenticatedIdentity,
    write: bool,
) -> Result<Transaction<'a, Postgres>, DomainError> {
    let mut tx = state.database.begin().await.map_err(db)?;
    if write {
        // Serialize creation as well as updates, then recheck administrator rights.
        sqlx::query("SELECT pg_advisory_xact_lock(7189423471020331)")
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    if !administrators::authorized(&mut tx, &identity.subject).await? {
        return Err(access::AccessError::Forbidden.into());
    }
    Ok(tx)
}

fn snapshot(state: &AppState, stored: Option<&Stored>) -> Result<Response, DomainError> {
    let (revision, source, data) = match stored {
        Some(row) => (row.revision, MailSettingsSource::Platform, row.data()?),
        None => match &state.mail {
            Some(mail) => (0, MailSettingsSource::Environment, mail.settings().clone()),
            None => (
                0,
                MailSettingsSource::Unconfigured,
                MailSettingsData::default(),
            ),
        },
    };
    Ok(response(
        StatusCode::OK,
        Some(revision),
        MailSettingsSnapshot {
            revision,
            source,
            can_manage: true,
            encryption_ready: state.certificates.is_some(),
            data,
        },
    ))
}

#[utoipa::path(get,path="/api/v1/platform/mail-settings",operation_id="get_platform_mail_settings",tag="Platform",security(("bearerAuth"=[])),responses((status=200,body=MailSettingsSnapshot),(status=403,description="Restrito aos administradores da plataforma")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
) -> Result<Response, DomainError> {
    let mut tx = authorized(&state, &identity, false).await?;
    let stored = load(&mut tx).await?;
    tx.commit().await.map_err(db)?;
    snapshot(&state, stored.as_ref())
}

#[utoipa::path(put,path="/api/v1/platform/mail-settings",operation_id="put_platform_mail_settings",tag="Platform",security(("bearerAuth"=[])),params(("If-Match"=String,Header)),request_body=MailSettingsUpdate,responses((status=200,body=MailSettingsSnapshot),(status=403,description="Restrito aos administradores da plataforma"),(status=412,description="Revisão alterada"),(status=422,description="Configuração inválida")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<MailSettingsUpdate>, JsonRejection>,
) -> Result<Response, DomainError> {
    let mut tx = authorized(&state, &identity, true).await?;
    let expected = settings_revision(&headers)?;
    let Json(update) = payload
        .map_err(|_| DomainError::Invalid("Configuração SMTP inválida ou campos desconhecidos"))?;
    let mut data = update.validate()?;
    if data.enabled && state.certificates.is_none() {
        return Err(DomainError::Invalid(
            "A criptografia da plataforma precisa estar configurada antes de ativar o SMTP",
        ));
    }
    let previous = load(&mut tx).await?;
    let current = previous.as_ref().map_or(0, |row| row.revision);
    if expected != current {
        return Err(DomainError::StaleRevision);
    }
    let context = secret_context(&data);
    let supplied = update.password.as_ref().filter(|p| !p.is_empty());
    let old_secret = previous.as_ref().and_then(Stored::sealed);
    if old_secret.is_some()
        && previous.as_ref().and_then(|p| p.secret_context.as_deref()) != Some(context.as_str())
        && supplied.is_none()
    {
        return Err(DomainError::Invalid(
            "Informe uma nova senha ao alterar servidor, porta, segurança ou usuário",
        ));
    }
    let sealed = if let Some(password) = supplied {
        let vault = state.certificates.as_ref().ok_or(DomainError::Invalid(
            "A criptografia da plataforma precisa estar configurada antes de salvar uma senha SMTP",
        ))?;
        Some(
            vault
                .seal_settings_secret(&context, password.as_bytes())
                .map_err(|_| access::AccessError::Internal)?,
        )
    } else {
        old_secret
    };
    if data.enabled && sealed.is_none() {
        return Err(DomainError::Invalid(
            "Informe a senha SMTP para ativar o envio",
        ));
    }
    data.password_set = sealed.is_some();
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    let value = serde_json::to_value(&data).map_err(|_| access::AccessError::Internal)?;
    sqlx::query("INSERT INTO platform_mail_settings(singleton,data,revision,secret_context,secret_key_id,secret_nonce,secret_ciphertext) VALUES(true,$1,$2,$3,$4,$5,$6) ON CONFLICT(singleton) DO UPDATE SET data=EXCLUDED.data,revision=EXCLUDED.revision,secret_context=EXCLUDED.secret_context,secret_key_id=EXCLUDED.secret_key_id,secret_nonce=EXCLUDED.secret_nonce,secret_ciphertext=EXCLUDED.secret_ciphertext,updated_at=now()")
        .bind(&value).bind(next).bind(sealed.as_ref().map(|_|context.as_str())).bind(sealed.as_ref().map(|s|s.key_id.as_str()))
        .bind(sealed.as_ref().map(|s|s.nonce.as_slice())).bind(sealed.as_ref().map(|s|s.ciphertext.as_slice())).execute(&mut *tx).await.map_err(db)?;
    let stored = load(&mut tx).await?;
    tx.commit().await.map_err(db)?;
    snapshot(&state, stored.as_ref())
}

/// Resolves on every send. This function only reads settings and builds a local
/// transport: no SMTP connection, delivery attempt, or database write is made.
#[cfg(test)]
pub async fn resolve(state: &AppState) -> Result<Option<SmtpMailer>, DomainError> {
    let mut tx = state.database.begin().await.map_err(db)?;
    let mail = resolve_in(state, &mut tx).await?;
    tx.commit().await.map_err(db)?;
    Ok(mail)
}

/// Uses an already authorized command transaction so replay handling can precede
/// configuration lookup without reserving a second pool connection.
pub async fn resolve_in(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
) -> Result<Option<SmtpMailer>, DomainError> {
    let stored = load(tx).await?;
    let Some(stored) = stored else {
        return Ok(state.mail.clone());
    };
    let data = stored.data()?;
    if !data.enabled {
        return Ok(None);
    }
    let unavailable = || {
        DomainError::Conflict(
            "A configuração SMTP da plataforma está indisponível. Revise as Preferências",
        )
    };
    let vault = state.certificates.as_ref().ok_or_else(unavailable)?;
    let sealed = stored.sealed().ok_or_else(unavailable)?;
    let context = secret_context(&data);
    if stored.secret_context.as_deref() != Some(context.as_str()) {
        return Err(unavailable());
    }
    let plaintext = vault
        .open_settings_secret(&context, &sealed)
        .map_err(|_| unavailable())?;
    let password = std::str::from_utf8(&plaintext).map_err(|_| unavailable())?;
    SmtpMailer::configured(
        &data.host,
        data.port,
        data.security,
        &data.username,
        password,
        &data.from_name,
        &data.from_address,
    )
    .map(|mut mail| {
        mail.set_settings(data);
        Some(mail)
    })
    .map_err(|_| unavailable())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::HeaderValue, response::IntoResponse};
    use serde_json::{Value, json};

    fn payload() -> Value {
        json!({"enabled":true,"name":"Central","host":"smtp.example.test","port":587,
            "security":"starttls","username":"user","fromName":"Empresa São José",
            "fromAddress":"sales@example.test","password":"test-password-never-debug"})
    }

    #[test]
    fn mail_settings_revision_accepts_initial_zero_and_positive_strong_etags() {
        for (raw, expected) in [
            ("\"0\"", 0),
            ("\"1\"", 1),
            ("\"123\"", 123),
            ("\"9223372036854775807\"", i64::MAX),
        ] {
            let mut headers = HeaderMap::new();
            headers.insert(axum::http::header::IF_MATCH, HeaderValue::from_static(raw));
            assert_eq!(settings_revision(&headers).unwrap(), expected);
        }
    }

    #[test]
    fn mail_settings_revision_preserves_missing_428_and_malformed_400() {
        let missing = settings_revision(&HeaderMap::new()).unwrap_err();
        assert!(matches!(missing, DomainError::RevisionRequired));
        assert_eq!(
            missing.into_response().status(),
            StatusCode::PRECONDITION_REQUIRED
        );
        for raw in [
            "",
            "0",
            "\"\"",
            "\"-1\"",
            "W/\"0\"",
            "*",
            "\"one\"",
            "\"1.2\"",
            "\"0\", \"1\"",
            "\"9223372036854775808\"",
        ] {
            let mut headers = HeaderMap::new();
            headers.insert(axum::http::header::IF_MATCH, HeaderValue::from_static(raw));
            let malformed = settings_revision(&headers).unwrap_err();
            assert!(matches!(malformed, DomainError::InvalidRevision), "{raw}");
            assert_eq!(
                malformed.into_response().status(),
                StatusCode::BAD_REQUEST,
                "{raw}"
            );
        }
    }

    #[test]
    fn mail_settings_reject_header_injection_urls_invalid_ports_and_plaintext_security() {
        for (field, invalid_value) in [
            ("host", json!("smtp://smtp.example.test")),
            ("host", json!("smtp.example.test:587")),
            ("host", json!("smtp.example.test\r\nEHLO attacker")),
            ("host", json!("a..example.test")),
            ("fromName", json!("Empresa\r\nBcc: attacker@example.test")),
            (
                "fromAddress",
                json!("sales@example.test\nBcc:attacker@example.test"),
            ),
            ("fromAddress", json!("Someone <sales@example.test>")),
            ("username", json!("user\u{0000}more")),
            ("port", json!(0)),
            ("port", json!(65536)),
            ("security", json!("none")),
            ("security", json!("plaintext")),
        ] {
            let mut value = payload();
            value[field] = invalid_value;
            // Deserialization and semantic validation are both acceptable
            // rejection paths, and neither echoes user input in an error.
            if let Ok(update) = serde_json::from_value::<MailSettingsUpdate>(value) {
                assert!(update.validate().is_err(), "accepted invalid {field}");
            }
        }
    }

    #[test]
    fn mail_settings_normalize_host_without_rewriting_secret_or_username_case() {
        let mut value = payload();
        value["host"] = json!(" SMTP.Example.Test ");
        value["username"] = json!(" CaseSensitiveUser ");
        let update: MailSettingsUpdate = serde_json::from_value(value).unwrap();
        let data = update.validate().unwrap();
        assert_eq!(data.host, "smtp.example.test");
        assert_eq!(data.username, "CaseSensitiveUser");
        assert!(
            !serde_json::to_string(&data)
                .unwrap()
                .contains("test-password")
        );
    }

    #[test]
    fn mail_settings_transport_debug_does_not_include_secret_for_either_tls_mode() {
        for security in [SmtpSecurity::Starttls, SmtpSecurity::Tls] {
            let mail = SmtpMailer::configured(
                "smtp.example.test",
                if security == SmtpSecurity::Tls {
                    465
                } else {
                    587
                },
                security,
                "user",
                "test-password-never-debug",
                "Empresa",
                "sales@example.test",
            )
            .unwrap();
            assert!(!format!("{mail:?}").contains("test-password"));
            assert!(
                !serde_json::to_string(mail.settings())
                    .unwrap()
                    .contains("test-password")
            );
        }
    }
}
