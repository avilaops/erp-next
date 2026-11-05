mod client;
mod company_fields;
pub mod model;
mod parse;
pub mod registration;
#[cfg(test)]
mod tests;

pub use client::RegistryClient;
pub use registration::lookup_registration;

use crate::{
    domains::{DomainError, authorized, db, response},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use model::{LookupContext, LookupInput, LookupReply};

#[utoipa::path(post, path = "/api/v1/registry-lookups", request_body = LookupInput,
    responses((status = 200, body = LookupReply), (status = 401), (status = 403), (status = 409), (status = 422)),
    tag = "Catalog", security(("bearerAuth" = [])))]
pub async fn lookup(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    input: Result<Json<LookupInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let mut input = input
        .map_err(|_| DomainError::Invalid("Envie os parâmetros da consulta cadastral"))?
        .0;
    let (read, manage) = match input.context {
        LookupContext::Company => ("platform.company.read", "platform.company.manage"),
        LookupContext::Party => ("catalog.parties.read", "catalog.parties.manage"),
    };
    let (tenant, tx, _) = authorized(&state, &headers, &identity, read, manage, false).await?;
    tx.commit().await.map_err(db)?;
    input.normalize()?;
    let client = state.registry.as_ref().ok_or(DomainError::Conflict(
        "Consulta cadastral indisponível. Continue o preenchimento manual",
    ))?;
    let result = client.lookup(tenant, &input).await;
    // Rights may have been revoked while waiting for a provider.
    let (_, tx, _) = authorized(&state, &headers, &identity, read, manage, false).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}
