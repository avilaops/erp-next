use super::{access, auth::AuthenticatedIdentity, state::AppState};
use crate::domains::{DomainError, db, response, revision};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Preferences {
    product_page_size: i32,
}

async fn transaction<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
    identity: &AuthenticatedIdentity,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>), DomainError> {
    let tenant = access::tenant_id(headers)?;
    let mut tx = access::tenant_transaction(state, tenant).await?;
    if write {
        sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    access::load_access(&mut tx, tenant, &identity.subject).await?;
    sqlx::query("SELECT set_config('app.auth_subject',$1,true)")
        .bind(&identity.subject)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    Ok((tenant, tx))
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    subject: &str,
) -> Result<(i64, i32), DomainError> {
    Ok(sqlx::query_as("SELECT revision,product_page_size FROM personal_preferences WHERE tenant_id=$1 AND auth_subject=$2")
        .bind(tenant).bind(subject).fetch_optional(&mut **tx).await.map_err(db)?.unwrap_or((1,25)))
}

#[utoipa::path(get,path="/api/v1/preferences",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=serde_json::Value),(status=403,description="Sem vínculo ativo")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx) = transaction(&state, &headers, &identity, false).await?;
    let (revision, size) = load(&mut tx, tenant, &identity.subject).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        json!({"tenantId":tenant,"revision":revision,"data":{"productPageSize":size}}),
    ))
}

#[utoipa::path(put,path="/api/v1/preferences",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),request_body=Preferences,responses((status=200,body=serde_json::Value),(status=412,description="Revisão alterada"),(status=422,description="Preferência inválida")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<Preferences>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let Json(input) = payload
        .map_err(|_| DomainError::Invalid("Preferências inválidas ou campos desconhecidos"))?;
    if ![10, 25, 50, 100].contains(&input.product_page_size) {
        return Err(DomainError::Invalid(
            "Escolha 10, 25, 50 ou 100 produtos por página",
        ));
    }
    let (tenant, mut tx) = transaction(&state, &headers, &identity, true).await?;
    let (current, _) = load(&mut tx, tenant, &identity.subject).await?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    sqlx::query("INSERT INTO personal_preferences(tenant_id,auth_subject,product_page_size,revision) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,auth_subject) DO UPDATE SET product_page_size=$3,revision=$4,updated_at=now()")
        .bind(tenant).bind(&identity.subject).bind(input.product_page_size).bind(next).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,details) SELECT $1,id,'preferences.updated','personal_preferences',$3 FROM identities WHERE auth_subject=$2")
        .bind(tenant).bind(&identity.subject).bind(json!({"previousRevision":current,"revision":next,"productPageSize":input.product_page_size})).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        json!({"tenantId":tenant,"revision":next,"data":{"productPageSize":input.product_page_size}}),
    ))
}
