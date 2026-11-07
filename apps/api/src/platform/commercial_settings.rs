use super::commercial_settings_model::CommercialParameters;
use super::{access, auth::AuthenticatedIdentity, state::AppState};
use crate::domains::{DomainError, db, response, revision};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

async fn transaction<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
    identity: &AuthenticatedIdentity,
    line: &str,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>), DomainError> {
    if !matches!(line, "imported" | "national") {
        return Err(DomainError::Invalid("Linha comercial inválida"));
    }
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
    // Margins and cost policy are confidential even for ordinary company readers.
    access::require_permission(&member, "platform.company.manage")?;
    Ok((tenant, tx))
}
async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    line: &str,
) -> Result<(i64, Option<Value>), DomainError> {
    let row: Option<(i64, Value)> = sqlx::query_as(
        "SELECT revision,parameters FROM commercial_settings WHERE tenant_id=$1 AND product_line=$2")
        .bind(tenant).bind(line).fetch_optional(&mut **tx).await.map_err(db)?;
    Ok(row
        .map(|(revision, data)| (revision, Some(data)))
        .unwrap_or((1, None)))
}

fn snapshot(
    tenant: Uuid,
    line: &str,
    revision: i64,
    data: Option<Value>,
    monthly_expenses_cents: i64,
    suggestion: Option<Value>,
) -> Result<Response, DomainError> {
    let calculation = data
        .as_ref()
        .map(|value| {
            let parameters: CommercialParameters =
                serde_json::from_value(value.clone()).map_err(|_| access::AccessError::Internal)?;
            parameters.simulate()
        })
        .transpose()?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        json!({
            "tenantId": tenant, "line": line, "revision": revision, "data": data,
            "calculation": calculation, "status": "draft", "canEdit": true,
            "monthlyExpensesCents": monthly_expenses_cents, "suggestedDownPayment": suggestion
        }),
    ))
}

#[utoipa::path(get,path="/api/v1/commercial-settings/{line}",operation_id="get_commercial_settings",tag="Sales",security(("bearerAuth"=[])),params(("line"=String,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Parâmetros restritos à gestão")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(line): Path<String>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx) = transaction(&state, &headers, &identity, &line, false).await?;
    let (revision, mut data) = load(&mut tx, tenant, &line).await?;
    let monthly_expenses_cents =
        crate::domains::fixed_expenses::monthly_total(&mut tx, tenant).await?;
    if let Some(value) = data.as_mut() {
        value["monthlyExpensesCents"] = json!(monthly_expenses_cents);
    }
    let suggestion = match &data {
        Some(value) => {
            let p: CommercialParameters =
                serde_json::from_value(value.clone()).map_err(|_| access::AccessError::Internal)?;
            super::price_tables::suggested_down_payment(&mut tx, tenant, &line, &p).await?
        }
        None => None,
    };
    tx.commit().await.map_err(db)?;
    snapshot(
        tenant,
        &line,
        revision,
        data,
        monthly_expenses_cents,
        suggestion,
    )
}

#[utoipa::path(put,path="/api/v1/commercial-settings/{line}",operation_id="put_commercial_settings",tag="Sales",security(("bearerAuth"=[])),params(("line"=String,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),request_body=CommercialParameters,responses((status=200,body=Value),(status=403,description="Exige gestão"),(status=412,description="Revisão alterada"),(status=422,description="Parâmetros inválidos")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(line): Path<String>,
    headers: HeaderMap,
    payload: Result<Json<CommercialParameters>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx) = transaction(&state, &headers, &identity, &line, true).await?;
    let expected = revision(&headers)?;
    let Json(mut parameters) = payload
        .map_err(|_| DomainError::Invalid("Parâmetros inválidos ou campos desconhecidos"))?;
    parameters.monthly_expenses_cents =
        crate::domains::fixed_expenses::monthly_total(&mut tx, tenant).await? as u64;
    parameters.simulate()?;
    let (current, _) = load(&mut tx, tenant, &line).await?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    let monthly_expenses_cents = parameters.monthly_expenses_cents as i64;
    let suggestion =
        super::price_tables::suggested_down_payment(&mut tx, tenant, &line, &parameters).await?;
    let data = serde_json::to_value(parameters).map_err(|_| access::AccessError::Internal)?;
    sqlx::query("INSERT INTO commercial_settings(tenant_id,product_line,parameters,revision) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,product_line) DO UPDATE SET parameters=$3,revision=$4,updated_at=now()")
        .bind(tenant).bind(&line).bind(&data).bind(next).execute(&mut *tx).await.map_err(db)?;
    // Keep confidential margins out of general audit payloads.
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,details) SELECT $1,id,'commercial_settings.updated','commercial_settings',$3 FROM identities WHERE auth_subject=$2")
        .bind(tenant).bind(&identity.subject).bind(json!({"line":line,"previousRevision":current,"revision":next}))
        .execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    snapshot(
        tenant,
        &line,
        next,
        Some(data),
        monthly_expenses_cents,
        suggestion,
    )
}

#[utoipa::path(post,path="/api/v1/commercial-settings/{line}/preview",operation_id="preview_commercial_settings",tag="Sales",security(("bearerAuth"=[])),params(("line"=String,Path),("X-Tenant-Id"=Uuid,Header)),request_body=CommercialParameters,responses((status=200,body=Value),(status=403,description="Exige gestão"),(status=422,description="Parâmetros inviáveis")))]
pub async fn preview(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(line): Path<String>,
    headers: HeaderMap,
    payload: Result<Json<CommercialParameters>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx) = transaction(&state, &headers, &identity, &line, false).await?;
    let Json(mut parameters) = payload
        .map_err(|_| DomainError::Invalid("Parâmetros inválidos ou campos desconhecidos"))?;
    parameters.monthly_expenses_cents =
        crate::domains::fixed_expenses::monthly_total(&mut tx, tenant).await? as u64;
    let calculation = parameters.simulate()?;
    let suggestion =
        super::price_tables::suggested_down_payment(&mut tx, tenant, &line, &parameters).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"line":line,"calculation":calculation,"suggestedDownPayment":suggestion}),
    ))
}
