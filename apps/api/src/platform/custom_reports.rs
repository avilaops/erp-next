use super::{auth::AuthenticatedIdentity, state::AppState};
use crate::domains::{DomainChange, DomainError, authorized, db, record, response, revision};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sqlx::FromRow;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(FromRow, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomReport {
    id: Uuid,
    name: String,
    dataset: String,
    columns: Value,
    filters: Value,
    visibility: String,
    revision: i64,
    created_at: String,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomReportInput {
    name: String,
    dataset: String,
    columns: Vec<String>,
    #[serde(default)]
    filters: Map<String, Value>,
    #[serde(default = "private_visibility")]
    visibility: String,
}

fn private_visibility() -> String {
    "private".into()
}

fn dataset_contract(dataset: &str) -> Option<(&'static str, &'static [&'static str])> {
    match dataset {
        "products" => Some(("catalog.products.read", &["code", "name", "status"])),
        "parties" => Some((
            "catalog.parties.read",
            &["name", "document", "kind", "status"],
        )),
        "sales_orders" => Some((
            "sales.orders.read",
            &["number", "customer", "status", "issued_at", "total"],
        )),
        "stock_movements" => Some((
            "inventory.stock.read",
            &["occurred_at", "product", "warehouse", "quantity", "kind"],
        )),
        "audit_log" => Some((
            "platform.audit.read",
            &["created_at", "actor", "action", "entity_type"],
        )),
        _ => None,
    }
}

fn validate(input: &mut CustomReportInput) -> Result<&'static str, DomainError> {
    input.name = input.name.trim().to_string();
    if input.name.is_empty() || input.name.len() > 120 || input.name.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Nome deve ter entre 1 e 120 caracteres",
        ));
    }
    let (permission, allowed) =
        dataset_contract(&input.dataset).ok_or(DomainError::Invalid("Fonte de dados inválida"))?;
    let mut seen = HashSet::new();
    input.columns.retain(|column| seen.insert(column.clone()));
    if input.columns.is_empty()
        || input.columns.len() > allowed.len()
        || input
            .columns
            .iter()
            .any(|column| !allowed.contains(&column.as_str()))
    {
        return Err(DomainError::Invalid(
            "Selecione somente colunas permitidas para a fonte",
        ));
    }
    if !matches!(input.visibility.as_str(), "private" | "tenant") {
        return Err(DomainError::Invalid("Visibilidade inválida"));
    }
    if input.filters.len() > allowed.len()
        || input.filters.iter().any(|(key, value)| {
            !allowed.contains(&key.as_str())
                || !matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_))
                || value
                    .as_str()
                    .is_some_and(|text| text.len() > 200 || text.chars().any(char::is_control))
        })
    {
        return Err(DomainError::Invalid(
            "Filtros contêm campo ou valor inválido",
        ));
    }
    Ok(permission)
}

async fn require_dataset_permission(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    permission: &str,
) -> Result<(), DomainError> {
    let rights = super::access::load_access(tx, tenant, &identity.subject).await?;
    super::access::require_permission(&rights, permission)?;
    Ok(())
}

async fn row(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<CustomReport, DomainError> {
    sqlx::query_as("SELECT id,name,dataset,columns,filters,visibility,revision,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') created_at FROM system_config.report_definitions WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}

#[utoipa::path(get,path="/api/v1/system/custom-reports",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=serde_json::Value),(status=403,description="Sem permissão")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "system.reports.read",
        "system.reports.manage",
        false,
    )
    .await?;
    let data: Vec<CustomReport> = sqlx::query_as("SELECT id,name,dataset,columns,filters,visibility,revision,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') created_at FROM system_config.report_definitions WHERE tenant_id=$1 ORDER BY name,id")
        .bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data,"canEdit":can_edit}),
    ))
}

#[utoipa::path(post,path="/api/v1/system/custom-reports",tag="Platform",security(("bearerAuth"=[])),request_body=CustomReportInput,responses((status=201,body=CustomReport),(status=422,description="Dados inválidos")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<CustomReportInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.reports.read",
        "system.reports.manage",
        true,
    )
    .await?;
    let Json(mut input) = payload
        .map_err(|_| DomainError::Invalid("Relatório inválido ou contém campos desconhecidos"))?;
    let dataset_permission = validate(&mut input)?;
    require_dataset_permission(&mut tx, tenant, &identity, dataset_permission).await?;
    let id = Uuid::now_v7();
    let inserted = sqlx::query("INSERT INTO system_config.report_definitions(tenant_id,id,name,dataset,columns,filters,owner_identity_id,visibility) SELECT $1,$2,$3,$4,$5,$6,i.id,$7 FROM identities i JOIN tenant_memberships m ON m.identity_id=i.id AND m.tenant_id=$1 AND m.status='active' WHERE i.auth_subject=$8")
        .bind(tenant).bind(id).bind(&input.name).bind(&input.dataset).bind(json!(input.columns)).bind(Value::Object(input.filters)).bind(&input.visibility).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?.rows_affected();
    if inserted == 0 {
        return Err(super::access::AccessError::Forbidden.into());
    }
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "custom_report",
            id,
            event: "custom_report.created",
            details: json!({"dataset":input.dataset,"visibility":input.visibility}),
        },
    )
    .await?;
    let data = row(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::CREATED,
        Some(data.revision),
        json!({"tenantId":tenant,"data":data}),
    ))
}

#[utoipa::path(put,path="/api/v1/system/custom-reports/{id}",tag="Platform",security(("bearerAuth"=[])),request_body=CustomReportInput,responses((status=200,body=CustomReport),(status=412,description="Revisão alterada")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    payload: Result<Json<CustomReportInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.reports.read",
        "system.reports.manage",
        true,
    )
    .await?;
    let Json(mut input) = payload
        .map_err(|_| DomainError::Invalid("Relatório inválido ou contém campos desconhecidos"))?;
    let dataset_permission = validate(&mut input)?;
    require_dataset_permission(&mut tx, tenant, &identity, dataset_permission).await?;
    let changed = sqlx::query("UPDATE system_config.report_definitions SET name=$3,dataset=$4,columns=$5,filters=$6,visibility=$7,revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$8")
        .bind(tenant).bind(id).bind(&input.name).bind(&input.dataset).bind(json!(input.columns)).bind(Value::Object(input.filters)).bind(&input.visibility).bind(expected).execute(&mut *tx).await.map_err(db)?.rows_affected();
    if changed == 0 {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM system_config.report_definitions WHERE tenant_id=$1 AND id=$2)").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
        return Err(if exists {
            DomainError::StaleRevision
        } else {
            DomainError::NotFound
        });
    }
    let data = row(&mut tx, tenant, id).await?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind:"custom_report", id, event:"custom_report.updated", details:json!({"revision":data.revision,"dataset":input.dataset,"visibility":input.visibility}) }).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data.revision),
        json!({"tenantId":tenant,"data":data}),
    ))
}
