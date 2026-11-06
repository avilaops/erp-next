use super::{auth::AuthenticatedIdentity, state::AppState};
use crate::domains::{DomainChange, DomainError, authorized, db, record, response, revision};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(FromRow, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomField {
    id: Uuid,
    entity_type: String,
    code: String,
    label: String,
    value_type: String,
    required: bool,
    choices: serde_json::Value,
    status: String,
    revision: i64,
    created_at: String,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomFieldInput {
    entity_type: String,
    code: String,
    label: String,
    value_type: String,
    #[serde(default)]
    required: bool,
    #[serde(default)]
    choices: Vec<String>,
    #[serde(default = "active")]
    status: String,
}

fn active() -> String {
    "active".into()
}

fn validate(input: &mut CustomFieldInput) -> Result<(), DomainError> {
    input.label = input.label.trim().to_string();
    if !matches!(
        input.entity_type.as_str(),
        "product" | "party" | "sales_order"
    ) {
        return Err(DomainError::Invalid(
            "Entidade de campo customizado inválida",
        ));
    }
    if input.code.is_empty()
        || input.code.len() > 63
        || !input
            .code
            .bytes()
            .enumerate()
            .all(|(i, c)| c.is_ascii_lowercase() || (i > 0 && (c.is_ascii_digit() || c == b'_')))
    {
        return Err(DomainError::Invalid(
            "Código deve começar com letra minúscula e usar apenas letras, números ou sublinhado",
        ));
    }
    if input.label.is_empty()
        || input.label.len() > 120
        || input.label.chars().any(char::is_control)
    {
        return Err(DomainError::Invalid(
            "Nome deve ter entre 1 e 120 caracteres",
        ));
    }
    if !matches!(
        input.value_type.as_str(),
        "text" | "number" | "boolean" | "date" | "choice"
    ) {
        return Err(DomainError::Invalid("Tipo de valor inválido"));
    }
    if !matches!(input.status.as_str(), "active" | "archived") {
        return Err(DomainError::Invalid("Situação inválida"));
    }
    if input.value_type == "choice" {
        input.choices = input
            .choices
            .iter()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .collect();
        if input.choices.is_empty()
            || input.choices.len() > 100
            || input
                .choices
                .iter()
                .any(|v| v.len() > 120 || v.chars().any(char::is_control))
        {
            return Err(DomainError::Invalid("Informe de 1 a 100 opções válidas"));
        }
        input.choices.sort();
        input.choices.dedup();
    } else if !input.choices.is_empty() {
        return Err(DomainError::Invalid(
            "Opções são permitidas somente em campos de seleção",
        ));
    }
    Ok(())
}

async fn row(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<CustomField, DomainError> {
    sqlx::query_as("SELECT id,entity_type,code,label,value_type,required,choices,status,revision,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') created_at FROM system_config.custom_fields WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}

#[utoipa::path(get,path="/api/v1/system/custom-fields",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=serde_json::Value),(status=403,description="Sem permissão")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "system.custom_fields.read",
        "system.custom_fields.manage",
        false,
    )
    .await?;
    let data: Vec<CustomField> = sqlx::query_as("SELECT id,entity_type,code,label,value_type,required,choices,status,revision,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') created_at FROM system_config.custom_fields WHERE tenant_id=$1 ORDER BY status,label,id")
        .bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data,"canEdit":can_edit}),
    ))
}

#[utoipa::path(post,path="/api/v1/system/custom-fields",tag="Platform",security(("bearerAuth"=[])),request_body=CustomFieldInput,responses((status=201,body=CustomField),(status=422,description="Dados inválidos")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<CustomFieldInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.custom_fields.read",
        "system.custom_fields.manage",
        true,
    )
    .await?;
    let Json(mut input) = payload.map_err(|_| {
        DomainError::Invalid("Campo customizado inválido ou contém campos desconhecidos")
    })?;
    validate(&mut input)?;
    let id = Uuid::now_v7();
    let result=sqlx::query("INSERT INTO system_config.custom_fields(tenant_id,id,entity_type,code,label,value_type,required,choices,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(tenant).bind(id).bind(&input.entity_type).bind(&input.code).bind(&input.label).bind(&input.value_type).bind(input.required).bind(json!(input.choices)).bind(&input.status).execute(&mut *tx).await;
    if let Err(error) = result {
        if error.as_database_error().and_then(|e| e.code()).as_deref() == Some("23505") {
            return Err(DomainError::Conflict(
                "Já existe um campo com este código para a entidade",
            ));
        }
        return Err(db(error));
    }
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "custom_field",
            id,
            event: "custom_field.created",
            details: json!({"entityType":input.entity_type,"code":input.code}),
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

#[utoipa::path(put,path="/api/v1/system/custom-fields/{id}",tag="Platform",security(("bearerAuth"=[])),request_body=CustomFieldInput,responses((status=200,body=CustomField),(status=412,description="Revisão alterada")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    payload: Result<Json<CustomFieldInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.custom_fields.read",
        "system.custom_fields.manage",
        true,
    )
    .await?;
    let Json(mut input) = payload.map_err(|_| {
        DomainError::Invalid("Campo customizado inválido ou contém campos desconhecidos")
    })?;
    validate(&mut input)?;
    let changed=sqlx::query("UPDATE system_config.custom_fields SET label=$3,required=$4,status=$5,revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$6 AND entity_type=$7 AND code=$8 AND value_type=$9 AND choices=$10")
        .bind(tenant).bind(id).bind(&input.label).bind(input.required).bind(&input.status).bind(expected).bind(&input.entity_type).bind(&input.code).bind(&input.value_type).bind(json!(input.choices)).execute(&mut *tx).await.map_err(db)?.rows_affected();
    if changed == 0 {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM system_config.custom_fields WHERE tenant_id=$1 AND id=$2)",
        )
        .bind(tenant)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        return Err(if exists {
            DomainError::StaleRevision
        } else {
            DomainError::NotFound
        });
    }
    let data = row(&mut tx, tenant, id).await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "custom_field",
            id,
            event: if input.status == "archived" {
                "custom_field.archived"
            } else {
                "custom_field.updated"
            },
            details: json!({"revision":data.revision}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data.revision),
        json!({"tenantId":tenant,"data":data}),
    ))
}
