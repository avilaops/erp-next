use super::{access, auth::AuthenticatedIdentity, state::AppState};
use crate::domains::{DomainError, db, response, revision};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinancialSettingsInput {
    default_payment_method: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FinancialSettingsData {
    default_payment_method: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FinancialSettingsSnapshot {
    tenant_id: Uuid,
    revision: i64,
    can_edit: bool,
    data: FinancialSettingsData,
}

async fn transaction<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
    identity: &AuthenticatedIdentity,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>, bool), DomainError> {
    let tenant = access::tenant_id(headers)?;
    let mut tx = access::tenant_transaction(state, tenant).await?;
    if write {
        sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    let member = access::load_access(&mut tx, tenant, &identity.subject).await?;
    let can_edit = member
        .permissions
        .iter()
        .any(|p| p == "platform.company.manage");
    if write {
        access::require_permission(&member, "platform.company.manage")?;
    } else if !member.permissions.iter().any(|p| {
        [
            "platform.company.read",
            "finance.receivables.read",
            "finance.payables.read",
        ]
        .contains(&p.as_str())
    }) {
        return Err(access::AccessError::Forbidden.into());
    }
    Ok((tenant, tx, can_edit))
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<(i64, String), DomainError> {
    Ok(sqlx::query_as(
        "SELECT revision,default_payment_method FROM financial_settings WHERE tenant_id=$1",
    )
    .bind(tenant)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .unwrap_or((1, "bank_transfer".into())))
}

#[utoipa::path(get,path="/api/v1/financial-settings",operation_id="get_financial_settings",tag="Finance",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=FinancialSettingsSnapshot),(status=403,description="Sem acesso à configuração")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = transaction(&state, &headers, &identity, false).await?;
    let (revision, method) = load(&mut tx, tenant).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        FinancialSettingsSnapshot {
            tenant_id: tenant,
            revision,
            can_edit,
            data: FinancialSettingsData {
                default_payment_method: method,
            },
        },
    ))
}

#[utoipa::path(put,path="/api/v1/financial-settings",operation_id="put_financial_settings",tag="Finance",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),request_body=FinancialSettingsInput,responses((status=200,body=FinancialSettingsSnapshot),(status=403,description="Exige gestão da empresa"),(status=412,description="Revisão alterada"),(status=422,description="Configuração inválida")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<FinancialSettingsInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let Json(input) = payload
        .map_err(|_| DomainError::Invalid("Configuração inválida ou campos desconhecidos"))?;
    if !["cash", "bank_transfer", "card", "other"].contains(&input.default_payment_method.as_str())
    {
        return Err(DomainError::Invalid("Meio declarado inválido"));
    }
    let (tenant, mut tx, can_edit) = transaction(&state, &headers, &identity, true).await?;
    let (current, previous) = load(&mut tx, tenant).await?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    sqlx::query("INSERT INTO financial_settings(tenant_id,default_payment_method,revision) VALUES($1,$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET default_payment_method=$2,revision=$3,updated_at=now()")
        .bind(tenant).bind(&input.default_payment_method).bind(next).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,details) SELECT $1,id,'financial_settings.updated','financial_settings',$3 FROM identities WHERE auth_subject=$2")
        .bind(tenant).bind(&identity.subject).bind(json!({"previousRevision":current,"revision":next,"previousMethod":previous,"defaultPaymentMethod":input.default_payment_method})).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        FinancialSettingsSnapshot {
            tenant_id: tenant,
            revision: next,
            can_edit,
            data: FinancialSettingsData {
                default_payment_method: input.default_payment_method,
            },
        },
    ))
}
