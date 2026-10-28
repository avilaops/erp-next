pub mod catalog;
pub mod finance;
pub mod fiscal;
pub mod inventory;
pub mod parties;
mod party_complements;
pub mod reference_data;
pub mod sales;
pub mod staff;

use crate::platform::{access, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Json,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Debug)]
pub enum DomainError {
    Access(access::AccessError),
    Invalid(&'static str),
    NotFound,
    Conflict(&'static str),
    RevisionRequired,
    InvalidRevision,
    StaleRevision,
    CommandRequired,
}
impl From<access::AccessError> for DomainError {
    fn from(value: access::AccessError) -> Self {
        Self::Access(value)
    }
}
impl IntoResponse for DomainError {
    fn into_response(self) -> Response {
        let (status, code, title) = match self {
            Self::Access(error) => return error.into_response(),
            Self::Invalid(title) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_input", title),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "not_found",
                "Registro não encontrado nesta empresa",
            ),
            Self::Conflict(title) => (StatusCode::CONFLICT, "domain_conflict", title),
            Self::RevisionRequired => (
                StatusCode::PRECONDITION_REQUIRED,
                "revision_required",
                "Recarregue o cadastro antes de salvar",
            ),
            Self::InvalidRevision => (
                StatusCode::BAD_REQUEST,
                "invalid_revision",
                "Revisão inválida",
            ),
            Self::StaleRevision => (
                StatusCode::PRECONDITION_FAILED,
                "revision_conflict",
                "Outra pessoa alterou o cadastro. Sua edição foi preservada",
            ),
            Self::CommandRequired => (
                StatusCode::PRECONDITION_REQUIRED,
                "idempotency_required",
                "Informe Idempotency-Key para confirmar esta operação",
            ),
        };
        (status, [(header::CONTENT_TYPE, "application/problem+json"), (header::CACHE_CONTROL, "no-store")],
            Json(serde_json::json!({"type":format!("https://erp.avilaops.com/problems/{code}"),"title":title,"status":status.as_u16()}))).into_response()
    }
}
pub fn db(error: sqlx::Error) -> DomainError {
    access::database_error(error).into()
}
pub async fn authorized<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
    identity: &AuthenticatedIdentity,
    read: &str,
    manage: &str,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>, bool), DomainError> {
    let tenant = access::tenant_id(headers)?;
    let mut tx = access::tenant_transaction(state, tenant).await?;
    // Same lock order as access management: serialize tenant writes, then recheck rights.
    if write {
        sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, read)?;
    let can_edit = access::require_permission(&rights, manage).is_ok();
    if write && !can_edit {
        return Err(access::AccessError::Forbidden.into());
    }
    Ok((tenant, tx, can_edit))
}
pub fn response(status: StatusCode, revision: Option<i64>, value: impl Serialize) -> Response {
    let mut reply = (status, Json(value)).into_response();
    reply
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(value) = revision {
        reply.headers_mut().insert(
            header::ETAG,
            HeaderValue::from_str(&format!("\"{value}\"")).expect("integer ETag"),
        );
    }
    reply
}
pub fn revision(headers: &HeaderMap) -> Result<i64, DomainError> {
    headers
        .get(header::IF_MATCH)
        .ok_or(DomainError::RevisionRequired)?
        .to_str()
        .ok()
        .and_then(|raw| raw.strip_prefix('"'))
        .and_then(|raw| raw.strip_suffix('"'))
        .filter(|raw| !raw.is_empty() && raw.bytes().all(|c| c.is_ascii_digit()))
        .and_then(|raw| raw.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .ok_or(DomainError::InvalidRevision)
}
pub fn command_key(headers: &HeaderMap) -> Result<Uuid, DomainError> {
    headers
        .get("idempotency-key")
        .ok_or(DomainError::CommandRequired)?
        .to_str()
        .ok()
        .and_then(|raw| Uuid::parse_str(raw).ok())
        .ok_or(DomainError::Invalid("Idempotency-Key deve ser UUID"))
}
pub async fn replay(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    subject: &str,
    key: Uuid,
    scope: &str,
    request: &serde_json::Value,
) -> Result<Option<serde_json::Value>, DomainError> {
    let previous = sqlx::query_as::<_, (String, serde_json::Value, serde_json::Value)>("SELECT scope, request, result FROM domain_commands WHERE tenant_id=$1 AND auth_subject=$2 AND command_key=$3")
        .bind(tenant).bind(subject).bind(key).fetch_optional(&mut **tx).await.map_err(db)?;
    match previous {
        Some((kind, payload, result)) if kind == scope && payload == *request => Ok(Some(result)),
        Some(_) => Err(DomainError::Conflict(
            "Esta chave de idempotência já foi usada com outros dados",
        )),
        None => Ok(None),
    }
}
pub async fn remember(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    subject: &str,
    key: Uuid,
    scope: &str,
    request: &serde_json::Value,
    result: &serde_json::Value,
) -> Result<(), DomainError> {
    sqlx::query("INSERT INTO domain_commands(tenant_id,auth_subject,command_key,scope,request,result) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(tenant).bind(subject).bind(key).bind(scope).bind(request).bind(result).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
pub struct DomainChange {
    pub kind: &'static str,
    pub id: Uuid,
    pub event: &'static str,
    pub details: serde_json::Value,
}

pub async fn record(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    change: DomainChange,
) -> Result<(), DomainError> {
    let DomainChange {
        kind,
        id,
        event,
        details,
    } = change;
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,entity_id,request_id,details) SELECT $1,id,$3,$4,$5,$6,$7 FROM identities WHERE auth_subject=$2")
        .bind(tenant).bind(&identity.subject).bind(event).bind(kind).bind(id.to_string()).bind(headers.get("x-request-id").and_then(|h|h.to_str().ok())).bind(&details).execute(&mut **tx).await.map_err(db)?;
    sqlx::query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,$2,$3,$4,$5)")
        .bind(tenant).bind(kind).bind(id.to_string()).bind(event).bind(details).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
/// Exact nonnegative fixed-point transport; at most 12 whole digits.
pub fn fixed(raw: &str, scale: usize) -> Result<i64, DomainError> {
    let (whole, fraction) = raw.split_once('.').ok_or(DomainError::Invalid(
        "Informe decimal com ponto e escala fixa",
    ))?;
    if whole.is_empty()
        || whole.len() > 12
        || (whole.len() > 1 && whole.starts_with('0'))
        || fraction.len() != scale
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|c| c.is_ascii_digit())
    {
        return Err(DomainError::Invalid(
            "Decimal inválido ou fora da escala permitida",
        ));
    }
    format!("{whole}{fraction}")
        .parse()
        .map_err(|_| DomainError::Invalid("Valor fora do limite"))
}
pub fn decimal(value: i64, scale: u32) -> String {
    let factor = 10_i64.pow(scale);
    format!(
        "{}.{:0width$}",
        value / factor,
        value % factor,
        width = scale as usize
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_fixed_point_rejects_rounding_coercion_and_overflow() {
        assert_eq!(fixed("0.01", 2).unwrap(), 1);
        assert_eq!(decimal(333333, 6), "0.333333");
        for raw in [
            "1e2",
            "-1.00",
            "1,00",
            "01.00",
            "0.001",
            "NaN",
            "9999999999999.00",
        ] {
            assert!(fixed(raw, 2).is_err(), "{raw}");
        }
    }
}
