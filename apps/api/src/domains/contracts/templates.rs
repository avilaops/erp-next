//! Private editable models. Saving a draft never mutates a signing request.
use crate::{
    domains::{
        DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
        revision,
    },
    platform::{auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;
use uuid::Uuid;
pub mod import;
use import::{catalog, import_template};

const READ: &str = "sales.orders.read";
const MANAGE: &str = "platform.integrations.manage";

#[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Definition {
    name: String,
    pages: u32,
    roles: Vec<String>,
    fields: Vec<Field>,
}
#[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Field {
    id: Uuid,
    name: String,
    kind: String,
    role: String,
    required: bool,
    page: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Save {
    definition: Definition,
    pdf_base64: Option<String>,
}

impl Definition {
    fn validate(&self) -> Result<(), DomainError> {
        let valid_text =
            |s: &str| !s.trim().is_empty() && s.len() <= 200 && !s.chars().any(char::is_control);
        let mut roles = HashSet::new();
        let mut names = HashSet::new();
        let mut ids = HashSet::new();
        if !valid_text(&self.name)
            || !(1..=100).contains(&self.pages)
            || self.roles.is_empty()
            || self.roles.len() > 10
            || self
                .roles
                .iter()
                .any(|r| !valid_text(r) || !roles.insert(r))
            || self.fields.len() > 100
        {
            return Err(DomainError::Invalid(
                "Nome, páginas ou participantes do modelo inválidos",
            ));
        }
        for f in &self.fields {
            if !valid_text(&f.name)
                || !names.insert(&f.name)
                || !ids.insert(f.id)
                || !roles.contains(&f.role)
                || !["text", "signature", "initials", "date", "number"].contains(&f.kind.as_str())
                || f.page == 0
                || f.page > self.pages
                || [f.x, f.y, f.width, f.height]
                    .iter()
                    .any(|v| !v.is_finite() || *v < 0.0 || *v > 100.0)
                || f.width <= 0.0
                || f.height <= 0.0
                || f.x + f.width > 100.0
                || f.y + f.height > 100.0
            {
                return Err(DomainError::Invalid(
                    "Confira nomes únicos, participantes e posições dos campos dentro da página",
                ));
            }
        }
        Ok(())
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/contract-template-drafts", get(list))
        .route("/api/v1/contract-template-drafts/catalog", get(catalog))
        .route(
            "/api/v1/contract-template-drafts/{id}/import",
            axum::routing::post(import_template),
        )
        .route(
            "/api/v1/contract-template-drafts/{id}",
            get(detail).post(save),
        )
        .route("/api/v1/contract-template-drafts/{id}/pdf", get(pdf))
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024))
}

#[utoipa::path(get,path="/api/v1/contract-template-drafts",operation_id="template_drafts_list",tag="Sales",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403)))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',definition->>'name','revision',revision,'updatedAt',updated_at) FROM commercial_template_drafts WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 100")
        .bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":edit,"data":rows}),
    ))
}

#[utoipa::path(get,path="/api/v1/contract-template-drafts/{id}",operation_id="template_drafts_detail",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403),(status=404)))]
pub async fn detail(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let (definition, rev): (Value, i64) = sqlx::query_as(
        "SELECT definition,revision FROM commercial_template_drafts WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(rev),
        json!({"tenantId":tenant,"canEdit":edit,"id":id,"definition":definition,"revision":rev}),
    ))
}

#[utoipa::path(post,path="/api/v1/contract-template-drafts/{id}",operation_id="template_drafts_save",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header),("If-Match"=Option<String>,Header)),request_body=Save,responses((status=200,body=Value),(status=403),(status=409),(status=412),(status=422),(status=428)))]
pub async fn save(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<Save>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    input.definition.validate()?;
    let bytes = input
        .pdf_base64
        .as_ref()
        .map(|value| {
            STANDARD
                .decode(value)
                .map_err(|_| DomainError::Invalid("PDF inválido"))
        })
        .transpose()?;
    if bytes
        .as_ref()
        .is_some_and(|bytes| bytes.len() > 5 * 1024 * 1024 || !bytes.starts_with(b"%PDF-"))
    {
        return Err(DomainError::Invalid("Envie um PDF de até 5 MiB"));
    }
    // Store only a content digest in command history, not a second copy of the PDF.
    let request = json!({"id":id,"definition":input.definition,"pdfHash":bytes.as_ref().map(|b| super::model::digest(b))});
    // Serializes creation as well as changes; the primary key alone cannot lock a missing row.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("template:{tenant}:{id}"))
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    if let Some(value) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "template.draft.save",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, value["revision"].as_i64(), value));
    }
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT revision FROM commercial_template_drafts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?;
    let definition = serde_json::to_value(&input.definition)
        .map_err(|_| DomainError::Invalid("Modelo inválido"))?;
    let rev = if let Some(current) = existing {
        if revision(&headers)? != current {
            return Err(DomainError::StaleRevision);
        }
        sqlx::query("UPDATE commercial_template_drafts SET definition=$3,pdf=COALESCE($4,pdf),revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2")
            .bind(tenant).bind(id).bind(&definition).bind(bytes).execute(&mut *tx).await.map_err(db)?;
        current + 1
    } else {
        if headers.contains_key(header::IF_MATCH) {
            return Err(DomainError::StaleRevision);
        }
        let bytes = bytes.ok_or(DomainError::Invalid("Selecione o PDF do novo modelo"))?;
        sqlx::query("INSERT INTO commercial_template_drafts(tenant_id,id,definition,pdf) VALUES($1,$2,$3,$4)")
            .bind(tenant).bind(id).bind(&definition).bind(bytes).execute(&mut *tx).await.map_err(db)?;
        1
    };
    let value =
        json!({"tenantId":tenant,"canEdit":true,"id":id,"definition":definition,"revision":rev});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "contract_template_draft",
            id,
            event: "contract_template.draft_saved",
            details: json!({"revision":rev,"fieldCount":input.definition.fields.len()}),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "template.draft.save",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(rev), value))
}

#[utoipa::path(get,path="/api/v1/contract-template-drafts/{id}/pdf",operation_id="template_drafts_pdf",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,content_type="application/pdf"),(status=403),(status=404)))]
pub async fn pdf(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let bytes: Vec<u8> = sqlx::query_scalar(
        "SELECT pdf FROM commercial_template_drafts WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/pdf"),
            (header::CACHE_CONTROL, "no-store"),
            (
                header::CONTENT_DISPOSITION,
                "inline; filename=\"modelo.pdf\"",
            ),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn definition() -> Definition {
        Definition {
            name: "Contrato".into(),
            pages: 1,
            roles: vec!["Cliente".into()],
            fields: vec![Field {
                id: Uuid::new_v4(),
                name: "cliente_nome".into(),
                kind: "text".into(),
                role: "Cliente".into(),
                required: true,
                page: 1,
                x: 5.0,
                y: 10.0,
                width: 80.0,
                height: 5.0,
            }],
        }
    }
    #[test]
    fn rejects_fields_outside_page_or_unknown_signer() {
        let mut value = definition();
        assert!(value.validate().is_ok());
        value.fields[0].width = 100.0;
        assert!(value.validate().is_err());
        value.fields[0].width = 80.0;
        value.fields[0].role = "Outro".into();
        assert!(value.validate().is_err());
    }
    #[test]
    fn rejects_duplicate_names_and_nonfinite_positions() {
        let mut value = definition();
        value.fields.push(value.fields[0].clone());
        assert!(value.validate().is_err());
        value.fields.pop();
        value.fields[0].x = f64::NAN;
        assert!(value.validate().is_err());
    }
}
