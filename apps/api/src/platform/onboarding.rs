use axum::{
    Extension, Json,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

use super::{access, auth::AuthenticatedIdentity, state::AppState};

#[derive(FromRow, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompanySummary {
    id: Uuid,
    legal_name: String,
    trade_name: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct CompaniesResponse {
    data: Vec<CompanySummary>,
}

#[utoipa::path(get, path = "/api/v1/companies", tag = "Platform",
    security(("bearerAuth" = [])), responses((status = 200, body = CompaniesResponse),
    (status = 401, description = "Credencial inválida"),
    (status = 500, description = "Erro interno"),
    (status = 503, description = "Auth indisponível")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Extension(verified): Extension<super::auth::VerifiedEmail>,
) -> Result<Response, access::AccessError> {
    if verified.0 {
        super::invitations::accept_for_identity(&state, &identity).await?;
    }
    let mut transaction = state
        .database
        .begin()
        .await
        .map_err(access::database_error)?;
    sqlx::query(
        "SELECT set_config('app.tenant_id', '', true), set_config('app.auth_subject', $1, true)",
    )
    .bind(&identity.subject)
    .execute(&mut *transaction)
    .await
    .map_err(access::database_error)?;
    let data = sqlx::query_as::<_, CompanySummary>(
        "SELECT t.id, t.legal_name, t.trade_name FROM tenants t WHERE t.status = 'active' AND EXISTS (SELECT 1 FROM tenant_memberships m JOIN identities i ON i.id = m.identity_id WHERE m.tenant_id = t.id AND m.status = 'active' AND i.auth_subject = $1) ORDER BY t.legal_name, t.id",
    )
    .bind(&identity.subject)
    .fetch_all(&mut *transaction)
    .await
    .map_err(access::database_error)?;
    transaction.commit().await.map_err(access::database_error)?;
    Ok((
        StatusCode::OK,
        [(header::CACHE_CONTROL, "no-store")],
        Json(CompaniesResponse { data }),
    )
        .into_response())
}

#[utoipa::path(post, path = "/api/v1/companies", tag = "Platform",
    request_body = super::CompanyData, security(("bearerAuth" = [])),
    params(("Idempotency-Key" = Uuid, Header)), responses(
    (status = 201, description = "Empresa criada e responsável vinculado"),
    (status = 400, description = "Chave inválida"),
    (status = 401, description = "Credencial inválida"),
    (status = 409, description = "Documento ou chave indisponível"),
    (status = 422, description = "Cadastro inválido"),
    (status = 428, description = "Chave obrigatória"),
    (status = 500, description = "Erro interno"),
    (status = 503, description = "Auth indisponível")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: axum::http::HeaderMap,
    payload: Result<Json<super::CompanyData>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, OnboardingError> {
    let key = headers
        .get("idempotency-key")
        .ok_or_else(|| {
            problem(
                StatusCode::PRECONDITION_REQUIRED,
                "Chave de repetição obrigatória",
            )
        })?
        .to_str()
        .ok()
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(|| problem(StatusCode::BAD_REQUEST, "Chave de repetição inválida"))?;
    let Json(mut data) = payload.map_err(|_| {
        problem(
            StatusCode::UNPROCESSABLE_ENTITY,
            "JSON inválido ou campos desconhecidos",
        )
    })?;
    data.validate().map_err(|errors| {
        OnboardingError(Box::new(
            super::company::CompanyError::Validation(errors).into_response(),
        ))
    })?;
    let request = serde_json::to_value(&data).map_err(|_| internal())?;
    let mut tx = state.database.begin().await.map_err(db)?;
    sqlx::query(
        "SELECT set_config('app.tenant_id', '', true), set_config('app.auth_subject', $1, true)",
    )
    .bind(&identity.subject)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    // Serialize retries for this identity/key without reserving a partially created company.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("{}:{key}", identity.subject))
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let previous = sqlx::query_as::<_, (serde_json::Value, serde_json::Value)>(
        "SELECT request, result FROM company_creation_commands WHERE auth_subject = $1 AND command_key = $2")
        .bind(&identity.subject).bind(key).fetch_optional(&mut *tx).await.map_err(db)?;
    if let Some((previous_request, result)) = previous {
        if previous_request != request {
            return Err(problem(
                StatusCode::CONFLICT,
                "Chave já utilizada com outros dados",
            ));
        }
        tx.commit().await.map_err(db)?;
        return Ok(created(result));
    }
    let tenant_id = Uuid::now_v7();
    sqlx::query("SELECT set_config('app.tenant_id', $1, true)")
        .bind(tenant_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let inserted = sqlx::query("INSERT INTO tenants (id, legal_name, trade_name, tax_id) VALUES ($1, $2, NULLIF($3, ''), $4)")
        .bind(tenant_id).bind(&data.legal_name).bind(&data.trade_name).bind(&data.tax_id)
        .execute(&mut *tx).await;
    if let Err(error) = inserted {
        if error
            .as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            return Err(problem(
                StatusCode::CONFLICT,
                "Documento indisponível para este cadastro",
            ));
        }
        return Err(db(error));
    }
    let identity_id: Uuid = sqlx::query_scalar("INSERT INTO identities (auth_subject, email, display_name) VALUES ($1, $2, $3) ON CONFLICT (auth_subject) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, updated_at = now() RETURNING id")
        .bind(&identity.subject).bind(&identity.email).bind(&identity.name)
        .fetch_one(&mut *tx).await.map_err(db)?;
    let membership_id = Uuid::now_v7();
    let role_id = Uuid::now_v7();
    sqlx::query("INSERT INTO tenant_memberships (id, tenant_id, identity_id) VALUES ($1, $2, $3)")
        .bind(membership_id)
        .bind(tenant_id)
        .bind(identity_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query(
        "INSERT INTO roles (id, tenant_id, code, name) VALUES ($1, $2, 'admin', 'Administrador')",
    )
    .bind(role_id)
    .bind(tenant_id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_code) SELECT $1, code FROM permissions",
    )
    .bind(role_id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query("INSERT INTO membership_roles (membership_id, role_id) VALUES ($1, $2)")
        .bind(membership_id)
        .bind(role_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("INSERT INTO company_profiles (tenant_id, revision, details) VALUES ($1, 1, $2)")
        .bind(tenant_id)
        .bind(&request)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let metadata = serde_json::json!({"revision": 1, "membershipId": membership_id});
    sqlx::query("INSERT INTO audit_log (tenant_id, identity_id, action, entity_type, entity_id, details) VALUES ($1, $2, 'company.created', 'company', $1::text, $3)")
        .bind(tenant_id).bind(identity_id).bind(&metadata).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, 'company', $1::text, 'company.created', $2)")
        .bind(tenant_id).bind(metadata).execute(&mut *tx).await.map_err(db)?;
    let result = serde_json::json!({"tenantId": tenant_id, "revision": 1});
    sqlx::query("INSERT INTO company_creation_commands (auth_subject, command_key, tenant_id, request, result) VALUES ($1, $2, $3, $4, $5)")
        .bind(&identity.subject).bind(key).bind(tenant_id).bind(request).bind(&result)
        .execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(created(result))
}

fn created(value: serde_json::Value) -> Response {
    (
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(value),
    )
        .into_response()
}

fn problem(status: StatusCode, title: &str) -> OnboardingError {
    OnboardingError(Box::new(
        (
            status,
            [
                (header::CACHE_CONTROL, "no-store"),
                (header::CONTENT_TYPE, "application/problem+json"),
            ],
            Json(serde_json::json!({"title":title,"status":status.as_u16()})),
        )
            .into_response(),
    ))
}

fn internal() -> OnboardingError {
    problem(StatusCode::INTERNAL_SERVER_ERROR, "Erro interno")
}

fn db(error: sqlx::Error) -> OnboardingError {
    OnboardingError(Box::new(access::database_error(error).into_response()))
}

pub struct OnboardingError(Box<Response>);

impl IntoResponse for OnboardingError {
    fn into_response(self) -> Response {
        *self.0
    }
}
