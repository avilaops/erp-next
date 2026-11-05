use super::model::{LookupContext, LookupInput, LookupKind, LookupStatus, RegistryData};
use crate::{
    domains::{DomainError, response},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::Response,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RegistrationLookupInput {
    pub value: String,
}

/// No tenant is created or selected by this read-only registration lookup.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationLookupReply {
    pub value: String,
    pub status: LookupStatus,
    pub data: Option<RegistryData>,
    pub source: Option<String>,
    pub source_updated_at: Option<String>,
    pub fetched_at: String,
    pub expires_at: Option<String>,
    pub warnings: Vec<String>,
}

#[utoipa::path(post, path = "/api/v1/company-registration/lookup", request_body = RegistrationLookupInput,
    responses((status = 200, body = RegistrationLookupReply), (status = 401), (status = 409), (status = 422)),
    tag = "Platform", security(("bearerAuth" = [])))]
pub async fn lookup_registration(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    payload: Result<Json<RegistrationLookupInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let Json(payload) =
        payload.map_err(|_| DomainError::Invalid("Informe somente o CNPJ da empresa"))?;
    let mut input = LookupInput {
        kind: LookupKind::Cnpj,
        context: LookupContext::Company,
        value: payload.value,
        state: None,
    };
    input.normalize()?;
    let client = state.registry.as_ref().ok_or(DomainError::Conflict(
        "Consulta cadastral indisponível. Continue o preenchimento manual",
    ))?;
    // Identity-scoped cache and budget, with the same global provider quotas as tenant lookups.
    let reply = client.lookup_registration(&identity.subject, &input).await;
    Ok(response(
        StatusCode::OK,
        None,
        RegistrationLookupReply {
            value: reply.value,
            status: reply.status,
            data: reply.data,
            source: reply.source,
            source_updated_at: reply.source_updated_at,
            fetched_at: reply.fetched_at,
            expires_at: reply.expires_at,
            warnings: reply.warnings,
        },
    ))
}
