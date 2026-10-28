use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

use super::company_data::{CompanyData, FieldError};
use super::{access, auth::AuthenticatedIdentity, state::AppState};

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanyResponse {
    tenant_id: Uuid,
    revision: i64,
    can_edit: bool,
    data: CompanyData,
}

#[derive(FromRow)]
struct CompanyRow {
    legal_name: String,
    trade_name: Option<String>,
    tax_id: String,
    revision: i64,
    details: serde_json::Value,
}

#[derive(Debug)]
pub enum CompanyError {
    Access(access::AccessError),
    PreconditionRequired,
    Conflict,
    InvalidEtag,
    Validation(Vec<FieldError>),
    DuplicateTaxId,
}

impl From<access::AccessError> for CompanyError {
    fn from(error: access::AccessError) -> Self {
        Self::Access(error)
    }
}

impl IntoResponse for CompanyError {
    fn into_response(self) -> Response {
        let (status, code, title, errors) = match self {
            Self::Access(error) => return error.into_response(),
            Self::PreconditionRequired => (
                StatusCode::PRECONDITION_REQUIRED,
                "revision_required",
                "Recarregue os dados antes de salvar",
                vec![],
            ),
            Self::Conflict => (
                StatusCode::PRECONDITION_FAILED,
                "revision_conflict",
                "Outra pessoa alterou estes dados. Sua edição foi preservada",
                vec![],
            ),
            Self::InvalidEtag => (
                StatusCode::BAD_REQUEST,
                "invalid_revision",
                "Revisão inválida",
                vec![],
            ),
            Self::Validation(errors) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_error",
                "Confira os campos informados",
                errors,
            ),
            Self::DuplicateTaxId => (
                StatusCode::CONFLICT,
                "tax_id_unavailable",
                "Documento indisponível para este cadastro",
                vec![],
            ),
        };
        (
            status,
            [
                (header::CONTENT_TYPE, "application/problem+json"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            Json(serde_json::json!({
                "type": format!("https://erp.avilaops.com/problems/{code}"),
                "title": title, "status": status.as_u16(), "errors": errors,
            })),
        )
            .into_response()
    }
}

fn revision(headers: &HeaderMap) -> Result<i64, CompanyError> {
    let raw = headers
        .get(header::IF_MATCH)
        .ok_or(CompanyError::PreconditionRequired)?
        .to_str()
        .map_err(|_| CompanyError::InvalidEtag)?;
    raw.strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value >= 0)
        .ok_or(CompanyError::InvalidEtag)
}

fn company_response(
    tenant_id: Uuid,
    row: CompanyRow,
    can_edit: bool,
) -> Result<Response, CompanyError> {
    let mut data: CompanyData =
        serde_json::from_value(row.details).map_err(|_| access::AccessError::Internal)?;
    data.legal_name = row.legal_name;
    data.trade_name = row.trade_name.unwrap_or_default();
    data.tax_id = row.tax_id;
    if data.person_type.is_empty() {
        let length = data
            .tax_id
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .count();
        data.person_type = if length == 11 { "fisica" } else { "juridica" }.to_owned();
    }
    let mut response = Json(CompanyResponse {
        tenant_id,
        revision: row.revision,
        can_edit,
        data,
    })
    .into_response();
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(&format!("\"{}\"", row.revision)).expect("integer ETag"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

async fn load_company(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: Uuid,
) -> Result<CompanyRow, CompanyError> {
    sqlx::query_as::<_, CompanyRow>(
        "SELECT t.legal_name, t.trade_name, t.tax_id, COALESCE(p.revision, 0) AS revision, COALESCE(p.details, '{}'::jsonb) AS details FROM tenants t LEFT JOIN company_profiles p ON p.tenant_id = t.id WHERE t.id = $1"
    ).bind(tenant_id).fetch_one(&mut **transaction).await.map_err(access::database_error).map_err(Into::into)
}

#[utoipa::path(get, path = "/api/v1/company", tag = "Platform",
    security(("bearerAuth" = [])), params(("X-Tenant-Id" = Uuid, Header)),
    responses((status = 200, description = "Empresa ativa e revisão; use o ETag ao salvar", body = CompanyResponse),
        (status = 400, description = "Empresa ausente ou inválida"),
        (status = 401, description = "Credencial inválida"), (status = 403, description = "Sem permissão"),
        (status = 500, description = "Erro interno"), (status = 503, description = "Auth indisponível")))]
pub async fn get_company(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, CompanyError> {
    let tenant_id = access::tenant_id(&headers)?;
    let mut transaction = access::tenant_transaction(&state, tenant_id).await?;
    let rights = access::load_access(&mut transaction, tenant_id, &identity.subject).await?;
    access::require_permission(&rights, "platform.company.read")?;
    let can_edit = access::require_permission(&rights, "platform.company.manage").is_ok();
    let row = load_company(&mut transaction, tenant_id).await?;
    transaction.commit().await.map_err(access::database_error)?;
    company_response(tenant_id, row, can_edit)
}

#[utoipa::path(put, path = "/api/v1/company", tag = "Platform", request_body = CompanyData,
    security(("bearerAuth" = [])), params(("X-Tenant-Id" = Uuid, Header), ("If-Match" = String, Header)),
    responses((status = 200, description = "Cadastro persistido com auditoria e outbox", body = CompanyResponse),
        (status = 400, description = "Empresa ou revisão inválida"), (status = 401, description = "Credencial inválida"),
        (status = 403, description = "Sem permissão"), (status = 409, description = "Documento indisponível"),
        (status = 412, description = "Outra revisão já foi gravada"), (status = 422, description = "Campos inválidos"),
        (status = 428, description = "If-Match obrigatório"), (status = 500, description = "Erro interno"),
        (status = 503, description = "Auth indisponível")))]
pub async fn put_company(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<CompanyData>, JsonRejection>,
) -> Result<Response, CompanyError> {
    let tenant_id = access::tenant_id(&headers)?;
    let expected = revision(&headers)?;
    let mut transaction = access::tenant_transaction(&state, tenant_id).await?;
    // Use the same lock order as access changes, then load the current rights.
    sqlx::query("SELECT id FROM tenants WHERE id = $1 FOR UPDATE")
        .bind(tenant_id)
        .execute(&mut *transaction)
        .await
        .map_err(access::database_error)?;
    let rights = access::load_access(&mut transaction, tenant_id, &identity.subject).await?;
    access::require_permission(&rights, "platform.company.manage")?;
    access::require_permission(&rights, "platform.company.read")?;
    let Json(mut data) = payload.map_err(|_| {
        CompanyError::Validation(vec![FieldError {
            field: "body".into(),
            message: "JSON inválido ou campos desconhecidos".into(),
        }])
    })?;
    data.validate().map_err(CompanyError::Validation)?;
    let previous = load_company(&mut transaction, tenant_id).await?;
    if previous.revision != expected {
        return Err(CompanyError::Conflict);
    }
    let result = sqlx::query("UPDATE tenants SET legal_name = $2, trade_name = NULLIF($3, ''), tax_id = $4, updated_at = now() WHERE id = $1")
        .bind(tenant_id).bind(&data.legal_name).bind(&data.trade_name).bind(&data.tax_id)
        .execute(&mut *transaction).await;
    if let Err(error) = result {
        if error
            .as_database_error()
            .is_some_and(|error| error.is_unique_violation())
        {
            return Err(CompanyError::DuplicateTaxId);
        }
        return Err(access::database_error(error).into());
    }
    let next = previous
        .revision
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    let details = serde_json::to_value(&data).map_err(|_| access::AccessError::Internal)?;
    sqlx::query("INSERT INTO company_profiles (tenant_id, revision, details) VALUES ($1, $2, $3) ON CONFLICT (tenant_id) DO UPDATE SET revision = EXCLUDED.revision, details = EXCLUDED.details, updated_at = now()")
        .bind(tenant_id).bind(next).bind(details).execute(&mut *transaction).await.map_err(access::database_error)?;
    let request_id = headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok());
    let metadata = serde_json::json!({"previousRevision": expected, "revision": next});
    sqlx::query("INSERT INTO audit_log (tenant_id, identity_id, action, entity_type, entity_id, request_id, details) SELECT $1, id, 'company.updated', 'company', $1::text, $3, $4 FROM identities WHERE auth_subject = $2")
        .bind(tenant_id).bind(&identity.subject).bind(request_id).bind(&metadata)
        .execute(&mut *transaction).await.map_err(access::database_error)?;
    sqlx::query("INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, 'company', $1::text, 'company.updated', $2)")
        .bind(tenant_id).bind(metadata).execute(&mut *transaction).await.map_err(access::database_error)?;
    let row = load_company(&mut transaction, tenant_id).await?;
    transaction.commit().await.map_err(access::database_error)?;
    company_response(tenant_id, row, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revisions_require_a_single_strong_etag() {
        let mut headers = HeaderMap::new();
        assert!(matches!(
            revision(&headers),
            Err(CompanyError::PreconditionRequired)
        ));
        for invalid in ["*", "W/\"1\"", "1", "\"-1\"", "\"1\", \"2\""] {
            headers.insert(header::IF_MATCH, invalid.parse().unwrap());
            assert!(matches!(revision(&headers), Err(CompanyError::InvalidEtag)));
        }
        headers.insert(header::IF_MATCH, "\"0\"".parse().unwrap());
        assert_eq!(revision(&headers).unwrap(), 0);
    }
}
