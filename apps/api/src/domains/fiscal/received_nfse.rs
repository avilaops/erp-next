//! Manual import of national NFS-e XML. No issuance or authority transport.
#[path = "received_nfse_model.rs"]
mod model;

use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State, rejection::{JsonRejection, QueryRejection}},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use time::format_description::well_known::Rfc3339;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use super::{FiscalError, problem};
use crate::{
    domains::{DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response},
    platform::{access, auth::AuthenticatedIdentity, state::AppState, valid_document},
};
pub use model::ReceivedNfseMetadata;

const READ: &str = "fiscal.nfse.read";
const IMPORT: &str = "fiscal.nfse.import";
const SCOPE: &str = "fiscal.received_nfse.import";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/fiscal/received-nfses", get(list))
        .route("/api/v1/fiscal/received-nfses/import", post(import))
        .route("/api/v1/fiscal/received-nfses/{id}", get(get_document))
        .route("/api/v1/fiscal/received-nfses/{id}/xml", get(download_xml))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ImportReceivedNfseInput {
    pub xml: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedNfseSnapshot {
    id: Uuid,
    company_tax_id: String,
    document: ReceivedNfseMetadata,
    created_at: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedNfseDetail {
    tenant_id: Uuid,
    data: ReceivedNfseSnapshot,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedNfsePage {
    tenant_id: Uuid,
    can_import: bool,
    data: Vec<ReceivedNfseSnapshot>,
    total: i64,
}

#[derive(FromRow)]
struct DocumentRow {
    id: Uuid,
    company_tax_id: String,
    metadata: sqlx::types::Json<ReceivedNfseMetadata>,
    created_at: time::OffsetDateTime,
}

impl DocumentRow {
    fn snapshot(self) -> Result<ReceivedNfseSnapshot, DomainError> {
        Ok(ReceivedNfseSnapshot {
            id: self.id,
            company_tax_id: self.company_tax_id,
            document: self.metadata.0,
            created_at: self.created_at.format(&Rfc3339).map_err(|_| access::AccessError::Internal)?,
        })
    }
}

async fn company(tx: &mut Transaction<'_, Postgres>, tenant: Uuid) -> Result<String, DomainError> {
    let tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant).fetch_one(&mut **tx).await.map_err(db)?;
    if tax_id.len() != 14 || !tax_id.bytes().all(|byte| byte.is_ascii_digit()) || !valid_document(&tax_id) {
        return Err(DomainError::Conflict("Configure um CNPJ numérico válido antes da importação nacional"));
    }
    Ok(tax_id)
}

async fn load(tx: &mut Transaction<'_, Postgres>, tenant: Uuid, id: Uuid) -> Result<ReceivedNfseSnapshot, DomainError> {
    sqlx::query_as::<_, DocumentRow>("SELECT id,company_tax_id,metadata,created_at FROM fiscal_received_nfses WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?
        .ok_or(DomainError::NotFound)?.snapshot()
}

fn unavailable() -> Response {
    problem(StatusCode::BAD_GATEWAY, "nfse_inspection_failed", "A inspeção da NFS-e não foi confirmada; nenhum documento foi salvo", json!({}))
}

#[utoipa::path(post, path="/api/v1/fiscal/received-nfses/import",tag="Fiscal",operation_id="import_received_nfse",
    security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),request_body=ImportReceivedNfseInput,
    responses((status=201,body=ReceivedNfseDetail),(status=200,body=ReceivedNfseDetail),
    (status=403,description="Sem permissão de leitura/importação"),(status=409,description="Empresa ou XML conflitante"),
    (status=422,description="XML ou JSON inválido"),(status=428,description="Idempotency-Key obrigatório"),
    (status=502,description="Inspeção não confirmada"),(status=503,description="Motor indisponível")))]
pub async fn import(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<ImportReceivedNfseInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    // Authorize before parsing or inspecting untrusted XML. Do not retain locks during I/O.
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, IMPORT, true).await?;
    let Json(input) = payload.map_err(|_| DomainError::Invalid("JSON inválido; envie somente xml em corpo de até 2 MiB"))?;
    if input.xml.is_empty() || input.xml.len() > model::MAX_XML || input.xml.contains('\0') {
        return Err(DomainError::Invalid("XML vazio, inválido ou acima de 1 MiB").into());
    }
    let key = command_key(&headers)?;
    let tax_id = company(&mut tx, tenant).await?;
    let hash = format!("{:x}", Sha256::digest(input.xml.as_bytes()));
    let request = json!({"xmlSha256":hash,"companyTaxId":tax_id});
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, SCOPE, &request).await? {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, previous));
    }
    tx.commit().await.map_err(db)?;
    let Some(engine) = state.fiscal_engine.as_ref() else {
        return Ok(problem(StatusCode::SERVICE_UNAVAILABLE, "nfse_engine_unavailable", "Motor de inspeção nacional não configurado", json!({})));
    };
    let result = match engine.call("inspect-nfse", json!({"xml":input.xml,"recipientTaxId":tax_id})).await {
        Ok(value) => value,
        Err(_) => return Ok(unavailable()),
    };
    if result["status"] == "blocked" {
        if result["blockers"] == json!(["invalid_nfse_xml"]) {
            return Ok(problem(StatusCode::UNPROCESSABLE_ENTITY, "invalid_nfse_xml", "XML nacional recusado pela inspeção de leiaute e identidade", json!({})));
        }
        return Ok(unavailable());
    }
    let data = match model::correlate(result, &input.xml, &tax_id) {
        Ok(value) => value,
        Err(_) => return Ok(unavailable()),
    };
    let (_, mut tx, _) = authorized(&state, &headers, &identity, READ, IMPORT, true).await?;
    if company(&mut tx, tenant).await? != tax_id {
        return Err(DomainError::Conflict("O CNPJ da empresa mudou durante a inspeção; confira a empresa e tente novamente").into());
    }
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, SCOPE, &request).await? {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, previous));
    }
    let previous: Option<(Uuid, String)> = sqlx::query_as("SELECT id,xml_sha256 FROM fiscal_received_nfses WHERE tenant_id=$1 AND source=$2 AND environment=$3 AND access_key=$4")
        .bind(tenant).bind(&data.source).bind(&data.environment).bind(&data.access_key)
        .fetch_optional(&mut *tx).await.map_err(db)?;
    let (id, status) = if let Some((id, previous_hash)) = previous {
        if previous_hash != hash {
            return Err(DomainError::Conflict("Já existe outro XML para esta chave nacional e ambiente; o arquivo original foi preservado").into());
        }
        (id, StatusCode::OK)
    } else {
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO fiscal_received_nfses(tenant_id,id,source,environment,access_key,company_tax_id,xml,xml_sha256,metadata,auth_subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(tenant).bind(id).bind(&data.source).bind(&data.environment).bind(&data.access_key)
            .bind(&tax_id).bind(&input.xml).bind(&hash).bind(sqlx::types::Json(&data)).bind(&identity.subject)
            .execute(&mut *tx).await.map_err(db)?;
        record(&mut tx, tenant, &identity, &headers, DomainChange {
            kind: "fiscal_received_nfse", id, event: "fiscal.received_nfse.imported",
            details: json!({"id":id,"source":data.source,"environment":data.environment,"xmlSha256":hash,"verification":"signature_and_current_status_pending"}),
        }).await?;
        (id, StatusCode::CREATED)
    };
    let detail = ReceivedNfseDetail { tenant_id: tenant, data: load(&mut tx, tenant, id).await? };
    let result = serde_json::to_value(detail).map_err(|_| access::AccessError::Internal)?;
    remember(&mut tx, tenant, &identity.subject, key, SCOPE, &request, &result).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(status, None, result))
}

#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct ReceivedNfseQuery {
    offset: Option<u32>,
    limit: Option<u32>,
}

#[utoipa::path(get,path="/api/v1/fiscal/received-nfses",tag="Fiscal",operation_id="list_received_nfses",
    security(("bearerAuth"=[])),params(ReceivedNfseQuery,("X-Tenant-Id"=Uuid,Header)),
    responses((status=200,body=ReceivedNfsePage),(status=403,description="Sem permissão NFS-e"),(status=422,description="Filtros inválidos")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<ReceivedNfseQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query.map_err(|_| DomainError::Invalid("Filtros inválidos"))?.0;
    let limit = query.limit.unwrap_or(25);
    if !(1..=100).contains(&limit) {
        return Err(DomainError::Invalid("Limite deve estar entre 1 e 100"));
    }
    let (tenant, mut tx, can_import) = authorized(&state, &headers, &identity, READ, IMPORT, false).await?;
    let rows = sqlx::query_as::<_, DocumentRow>("SELECT id,company_tax_id,metadata,created_at FROM fiscal_received_nfses WHERE tenant_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3")
        .bind(tenant).bind(i64::from(limit)).bind(i64::from(query.offset.unwrap_or(0)))
        .fetch_all(&mut *tx).await.map_err(db)?;
    let data = rows.into_iter().map(DocumentRow::snapshot).collect::<Result<Vec<_>, _>>()?;
    let total = sqlx::query_scalar("SELECT count(*) FROM fiscal_received_nfses WHERE tenant_id=$1")
        .bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, ReceivedNfsePage { tenant_id: tenant, can_import: can_import && state.fiscal_engine.is_some(), data, total }))
}

#[utoipa::path(get,path="/api/v1/fiscal/received-nfses/{id}",tag="Fiscal",operation_id="get_received_nfse",
    security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),
    responses((status=200,body=ReceivedNfseDetail),(status=403,description="Sem permissão NFS-e"),(status=404,description="Documento não encontrado nesta empresa")))]
pub async fn get_document(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, IMPORT, false).await?;
    let data = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, ReceivedNfseDetail { tenant_id: tenant, data }))
}

#[utoipa::path(get,path="/api/v1/fiscal/received-nfses/{id}/xml",tag="Fiscal",operation_id="download_received_nfse_xml",
    security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),
    responses((status=200,body=String,content_type="application/xml",description="XML original, assinatura e situação atual não verificadas"),
    (status=403,description="Sem permissão NFS-e"),(status=404,description="Documento não encontrado nesta empresa")))]
pub async fn download_xml(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, IMPORT, false).await?;
    let (key, xml, hash): (String, String, String) = sqlx::query_as("SELECT access_key,xml,xml_sha256 FROM fiscal_received_nfses WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    let mut result = Response::new(axum::body::Body::from(xml));
    for (name, value) in [
        (header::CONTENT_TYPE, "application/xml; charset=utf-8".to_owned()),
        (header::CONTENT_DISPOSITION, format!("attachment; filename=\"NFSE-{key}.xml\"")),
        (header::CACHE_CONTROL, "no-store".to_owned()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
        (header::HeaderName::from_static("x-xml-sha256"), hash),
    ] {
        result.headers_mut().insert(name, HeaderValue::from_str(&value).map_err(|_| access::AccessError::Internal)?);
    }
    Ok(result)
}
