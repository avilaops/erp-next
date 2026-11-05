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
pub struct LabelTemplate {
    id: Uuid,
    name: String,
    width_mm: f64,
    height_mm: f64,
    layout: serde_json::Value,
    revision: i64,
    created_at: String,
}

#[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LabelElement {
    kind: String,
    field: String,
    #[serde(default)]
    label: String,
    x_mm: f64,
    y_mm: f64,
    width_mm: f64,
    height_mm: f64,
    #[serde(default = "default_font_size")]
    font_size_pt: f64,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LabelTemplateInput {
    name: String,
    width_mm: f64,
    height_mm: f64,
    source: String,
    elements: Vec<LabelElement>,
}

fn default_font_size() -> f64 {
    10.0
}

fn source_fields(source: &str) -> Option<&'static [&'static str]> {
    match source {
        "product" => Some(&["code", "name", "unit", "price"]),
        "party" => Some(&["name", "document", "kind"]),
        "sales_order" => Some(&["number", "customer", "issued_at", "total"]),
        _ => None,
    }
}

fn validate(input: &mut LabelTemplateInput) -> Result<(), DomainError> {
    input.name = input.name.trim().to_string();
    if input.name.is_empty() || input.name.len() > 120 || input.name.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Nome deve ter entre 1 e 120 caracteres",
        ));
    }
    if !input.width_mm.is_finite()
        || !input.height_mm.is_finite()
        || !(10.0..=300.0).contains(&input.width_mm)
        || !(10.0..=300.0).contains(&input.height_mm)
    {
        return Err(DomainError::Invalid(
            "Largura e altura devem estar entre 10 e 300 mm",
        ));
    }
    let fields = source_fields(&input.source)
        .ok_or(DomainError::Invalid("Fonte de dados da etiqueta inválida"))?;
    if input.elements.is_empty() || input.elements.len() > 32 {
        return Err(DomainError::Invalid(
            "A etiqueta deve conter entre 1 e 32 elementos",
        ));
    }
    for element in &mut input.elements {
        element.label = element.label.trim().to_string();
        if !matches!(element.kind.as_str(), "text" | "barcode") {
            return Err(DomainError::Invalid("Tipo de elemento inválido"));
        }
        if !fields.contains(&element.field.as_str()) {
            return Err(DomainError::Invalid(
                "Campo não autorizado para a fonte selecionada",
            ));
        }
        if element.label.len() > 80 || element.label.chars().any(char::is_control) {
            return Err(DomainError::Invalid(
                "Rótulo do elemento deve ter até 80 caracteres",
            ));
        }
        let values = [
            element.x_mm,
            element.y_mm,
            element.width_mm,
            element.height_mm,
            element.font_size_pt,
        ];
        if values.iter().any(|value| !value.is_finite())
            || element.x_mm < 0.0
            || element.y_mm < 0.0
            || element.width_mm <= 0.0
            || element.height_mm <= 0.0
            || element.x_mm + element.width_mm > input.width_mm
            || element.y_mm + element.height_mm > input.height_mm
            || !(4.0..=72.0).contains(&element.font_size_pt)
        {
            return Err(DomainError::Invalid(
                "Elemento fora dos limites da etiqueta",
            ));
        }
    }
    Ok(())
}

async fn row(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<LabelTemplate, DomainError> {
    sqlx::query_as("SELECT id,name,width_mm::float8 width_mm,height_mm::float8 height_mm,layout,revision,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') created_at FROM system_config.label_templates WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}

#[utoipa::path(get,path="/api/v1/system/label-templates",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=serde_json::Value),(status=403,description="Sem permissão")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "system.labels.manage",
        "system.labels.manage",
        false,
    )
    .await?;
    let data: Vec<LabelTemplate> = sqlx::query_as("SELECT id,name,width_mm::float8 width_mm,height_mm::float8 height_mm,layout,revision,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') created_at FROM system_config.label_templates WHERE tenant_id=$1 ORDER BY name,id")
        .bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data,"canEdit":can_edit}),
    ))
}

#[utoipa::path(post,path="/api/v1/system/label-templates",tag="Platform",security(("bearerAuth"=[])),request_body=LabelTemplateInput,responses((status=201,body=LabelTemplate),(status=422,description="Dados inválidos")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<LabelTemplateInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.labels.manage",
        "system.labels.manage",
        true,
    )
    .await?;
    let Json(mut input) = payload.map_err(|_| {
        DomainError::Invalid("Modelo de etiqueta inválido ou contém campos desconhecidos")
    })?;
    validate(&mut input)?;
    let id = Uuid::now_v7();
    let layout = json!({"source":input.source,"elements":input.elements});
    sqlx::query("INSERT INTO system_config.label_templates(tenant_id,id,name,width_mm,height_mm,layout) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(tenant).bind(id).bind(&input.name).bind(input.width_mm).bind(input.height_mm).bind(&layout).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "label_template",
            id,
            event: "label_template.created",
            details: json!({"name":input.name}),
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

#[utoipa::path(put,path="/api/v1/system/label-templates/{id}",tag="Platform",security(("bearerAuth"=[])),request_body=LabelTemplateInput,responses((status=200,body=LabelTemplate),(status=412,description="Revisão alterada")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    payload: Result<Json<LabelTemplateInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.labels.manage",
        "system.labels.manage",
        true,
    )
    .await?;
    let Json(mut input) = payload.map_err(|_| {
        DomainError::Invalid("Modelo de etiqueta inválido ou contém campos desconhecidos")
    })?;
    validate(&mut input)?;
    let layout = json!({"source":input.source,"elements":input.elements});
    let changed=sqlx::query("UPDATE system_config.label_templates SET name=$3,width_mm=$4,height_mm=$5,layout=$6,revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$7")
        .bind(tenant).bind(id).bind(&input.name).bind(input.width_mm).bind(input.height_mm).bind(&layout).bind(expected).execute(&mut *tx).await.map_err(db)?.rows_affected();
    if changed == 0 {
        let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM system_config.label_templates WHERE tenant_id=$1 AND id=$2)").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
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
            kind: "label_template",
            id,
            event: "label_template.updated",
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
