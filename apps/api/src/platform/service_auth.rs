use axum::{
    Extension, Json, Router,
    extract::{Path, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domains::{DomainError, authorized, db, response};

use super::{access, auth::AuthenticatedIdentity, state::AppState};

const PERMISSION: &str = "platform.integrations.manage";

#[derive(Clone, Debug)]
pub struct ServiceIdentity {
    pub tenant_id: Uuid,
    pub key_id: Uuid,
    key_hash: Vec<u8>,
}

#[derive(Debug)]
enum ServiceAuthFailure {
    Invalid,
    Internal,
}

impl IntoResponse for ServiceAuthFailure {
    fn into_response(self) -> Response {
        let (status, code, title) = match self {
            Self::Invalid => (
                StatusCode::UNAUTHORIZED,
                "invalid_service_key",
                "Credencial de integração inválida ou revogada",
            ),
            Self::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "service_auth_failed",
                "Não foi possível validar a credencial de integração",
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
                "title": title,
                "status": status.as_u16(),
            })),
        )
            .into_response()
    }
}

pub fn management_routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/integrations/service-keys", get(list).post(create))
        .route(
            "/api/v1/integrations/service-keys/{id}",
            axum::routing::delete(revoke),
        )
}

pub async fn require_service_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    match authenticate(&state, request.headers()).await {
        Ok(identity) => {
            request.extensions_mut().insert(identity);
            next.run(request).await
        }
        Err(error) => error.into_response(),
    }
}

async fn authenticate(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<ServiceIdentity, ServiceAuthFailure> {
    let raw = bearer(headers)?;
    let (tenant_id, _) = parse_key(raw)?;
    let key_hash = Sha256::digest(raw.as_bytes()).to_vec();
    let mut tx = access::tenant_transaction(state, tenant_id)
        .await
        .map_err(|_| ServiceAuthFailure::Internal)?;
    let key_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM service_api_keys WHERE tenant_id=$1 AND key_hash=$2 AND revoked_at IS NULL",
    )
    .bind(tenant_id)
    .bind(&key_hash)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| {
        tracing::error!(%error, "service key lookup failed");
        ServiceAuthFailure::Internal
    })?
    .ok_or(ServiceAuthFailure::Invalid)?;
    sqlx::query("UPDATE service_api_keys SET last_used_at=clock_timestamp() WHERE id=$1")
        .bind(key_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            tracing::error!(%error, "service key usage update failed");
            ServiceAuthFailure::Internal
        })?;
    tx.commit().await.map_err(|error| {
        tracing::error!(%error, "service key authentication commit failed");
        ServiceAuthFailure::Internal
    })?;
    Ok(ServiceIdentity {
        tenant_id,
        key_id,
        key_hash,
    })
}

pub async fn transaction<'a>(
    state: &'a AppState,
    identity: &ServiceIdentity,
) -> Result<Transaction<'a, Postgres>, Response> {
    let mut tx = access::tenant_transaction(state, identity.tenant_id)
        .await
        .map_err(|error| error.into_response())?;
    let valid: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM service_api_keys WHERE id=$1 AND tenant_id=$2 AND key_hash=$3 AND revoked_at IS NULL)",
    )
    .bind(identity.key_id)
    .bind(identity.tenant_id)
    .bind(&identity.key_hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| {
        tracing::error!(%error, "service key revalidation failed");
        ServiceAuthFailure::Internal.into_response()
    })?;
    if !valid {
        return Err(ServiceAuthFailure::Invalid.into_response());
    }
    Ok(tx)
}

fn bearer(headers: &HeaderMap) -> Result<&str, ServiceAuthFailure> {
    let value = headers
        .get(header::AUTHORIZATION)
        .ok_or(ServiceAuthFailure::Invalid)?
        .to_str()
        .map_err(|_| ServiceAuthFailure::Invalid)?;
    let (scheme, token) = value.split_once(' ').ok_or(ServiceAuthFailure::Invalid)?;
    if !scheme.eq_ignore_ascii_case("bearer") || token.trim().is_empty() {
        return Err(ServiceAuthFailure::Invalid);
    }
    Ok(token.trim())
}

fn parse_key(raw: &str) -> Result<(Uuid, &str), ServiceAuthFailure> {
    let tail = raw
        .strip_prefix("erp_")
        .ok_or(ServiceAuthFailure::Invalid)?;
    let (tenant, secret) = tail.split_once('_').ok_or(ServiceAuthFailure::Invalid)?;
    let tenant = Uuid::parse_str(tenant).map_err(|_| ServiceAuthFailure::Invalid)?;
    if secret.len() != 64 || !secret.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ServiceAuthFailure::Invalid);
    }
    Ok((tenant, secret))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateServiceKeyInput {
    name: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedServiceKey {
    id: Uuid,
    name: String,
    key_prefix: String,
    key: String,
    #[schema(value_type = String, format = DateTime)]
    created_at: time::OffsetDateTime,
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct ServiceKeySummary {
    id: Uuid,
    name: String,
    key_prefix: String,
    #[schema(value_type = String, format = DateTime)]
    created_at: time::OffsetDateTime,
    #[schema(value_type = Option<String>, format = DateTime)]
    last_used_at: Option<time::OffsetDateTime>,
    #[schema(value_type = Option<String>, format = DateTime)]
    revoked_at: Option<time::OffsetDateTime>,
}

#[derive(Serialize, ToSchema)]
struct ServiceKeyPage {
    data: Vec<ServiceKeySummary>,
}

#[utoipa::path(post, path="/api/v1/integrations/service-keys", tag="Platform",
    request_body=CreateServiceKeyInput, security(("bearerAuth"=[])),
    params(("X-Tenant-Id"=Uuid,Header)), responses((status=201,body=CreatedServiceKey),
    (status=403,description="Sem permissão"),(status=422,description="Nome inválido")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Json(input): Json<CreateServiceKeyInput>,
) -> Result<Response, DomainError> {
    let name = input.name.trim();
    if !(3..=100).contains(&name.chars().count()) {
        return Err(DomainError::Invalid(
            "Nome da credencial deve ter entre 3 e 100 caracteres",
        ));
    }
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, true).await?;
    let id = Uuid::now_v7();
    let secret = format!("{}{}", Uuid::now_v7().simple(), Uuid::now_v7().simple());
    let key = format!("erp_{tenant}_{secret}");
    let key_prefix = format!("erp_{tenant}_{}", &secret[..8]);
    let key_hash = Sha256::digest(key.as_bytes()).to_vec();
    let created_at: time::OffsetDateTime = sqlx::query_scalar(
        "INSERT INTO service_api_keys(id,tenant_id,name,key_prefix,key_hash,created_by_identity_id) SELECT $1,$2,$3,$4,$5,id FROM identities WHERE auth_subject=$6 RETURNING created_at",
    )
    .bind(id)
    .bind(tenant)
    .bind(name)
    .bind(&key_prefix)
    .bind(key_hash)
    .bind(&identity.subject)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    audit(
        &mut tx,
        tenant,
        &identity,
        &headers,
        id,
        "platform.service_key.created",
        serde_json::json!({"name":name,"keyPrefix":&key_prefix}),
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::CREATED,
        None,
        CreatedServiceKey {
            id,
            name: name.to_owned(),
            key_prefix,
            key,
            created_at,
        },
    ))
}

#[utoipa::path(get, path="/api/v1/integrations/service-keys", tag="Platform",
    security(("bearerAuth"=[])), params(("X-Tenant-Id"=Uuid,Header)),
    responses((status=200,body=ServiceKeyPage),(status=403,description="Sem permissão")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (_, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, false).await?;
    let data = sqlx::query_as::<_, ServiceKeySummary>(
        "SELECT id,name,key_prefix,created_at,last_used_at,revoked_at FROM service_api_keys ORDER BY created_at DESC,id DESC",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, ServiceKeyPage { data }))
}

#[utoipa::path(delete, path="/api/v1/integrations/service-keys/{id}", tag="Platform",
    security(("bearerAuth"=[])), params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),
    responses((status=204,description="Credencial revogada"),(status=403,description="Sem permissão"),
    (status=404,description="Credencial não encontrada")))]
pub async fn revoke(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, true).await?;
    let changed = sqlx::query(
        "UPDATE service_api_keys SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL",
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    if changed.rows_affected() == 0 {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM service_api_keys WHERE id=$1)")
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db)?;
        if !exists {
            return Err(DomainError::NotFound);
        }
    } else {
        audit(
            &mut tx,
            tenant,
            &identity,
            &headers,
            id,
            "platform.service_key.revoked",
            serde_json::json!({}),
        )
        .await?;
    }
    tx.commit().await.map_err(db)?;
    let mut result = StatusCode::NO_CONTENT.into_response();
    result
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(result)
}

async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    id: Uuid,
    event: &'static str,
    details: serde_json::Value,
) -> Result<(), DomainError> {
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,entity_id,request_id,details) SELECT $1,id,$3,'service_api_key',$4,$5,$6 FROM identities WHERE auth_subject=$2")
        .bind(tenant).bind(&identity.subject).bind(event).bind(id.to_string())
        .bind(headers.get("x-request-id").and_then(|value| value.to_str().ok())).bind(&details)
        .execute(&mut **tx).await.map_err(db)?;
    sqlx::query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'service_api_key',$2,$3,$4)")
        .bind(tenant).bind(id.to_string()).bind(event).bind(details)
        .execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_key_parser_is_strict_and_tenant_bound() {
        let tenant = Uuid::now_v7();
        let secret = "a".repeat(64);
        assert_eq!(
            parse_key(&format!("erp_{tenant}_{secret}")).unwrap().0,
            tenant
        );
        for invalid in [
            format!("{tenant}_{secret}"),
            format!("erp_{tenant}_short"),
            format!("erp_{tenant}_{}", "z".repeat(64)),
            format!("erp_invalid_{secret}"),
        ] {
            assert!(parse_key(&invalid).is_err());
        }
    }
}
