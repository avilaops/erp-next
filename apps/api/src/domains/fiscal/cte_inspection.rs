//! Offline, audited inspection of an immutable captured CT-e; no cursor writes.
#[path = "cte_inspection_model.rs"]
mod model;

use axum::{
    Extension, Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, Postgres, Transaction};
use time::format_description::well_known::Rfc3339;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{FiscalError, problem};
use crate::{
    domains::{
        DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    },
    platform::{access, auth::AuthenticatedIdentity, state::AppState, valid_document},
};
pub use model::ReceivedCteMetadata;

pub(crate) struct CteCommercialFacts {
    pub carrier_tax_id: String,
    pub carrier_name: Option<String>,
    pub service_cents: i64,
}
pub(crate) fn commercial_facts(
    mut metadata: serde_json::Value,
    xml: &str,
    company: &str,
) -> Result<CteCommercialFacts, ()> {
    metadata
        .as_object_mut()
        .ok_or(())?
        .insert("xml".to_owned(), json!(xml));
    model::correlate(metadata, xml, company)?.commercial_facts()
}

const READ: &str = "fiscal.cte.read";
const INSPECT: &str = "fiscal.cte.inspect";
const SCOPE: &str = "fiscal.cte.inspect";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/fiscal/cte-distribution/documents/{id}/inspection",
            get(get_inspection),
        )
        .route(
            "/api/v1/fiscal/cte-distribution/documents/{id}/inspect",
            post(inspect),
        )
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct InspectCteInput {}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CteInspectionSnapshot {
    id: Uuid,
    document_id: Uuid,
    source_xml_sha256: String,
    inspector_version: String,
    document: ReceivedCteMetadata,
    created_at: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CteInspectionDetail {
    tenant_id: Uuid,
    document_id: Uuid,
    source_xml_sha256: String,
    can_inspect: bool,
    data: Option<CteInspectionSnapshot>,
}

#[derive(FromRow)]
struct Source {
    id: Uuid,
    company_tax_id: String,
    schema_name: String,
    kind: String,
    xml: String,
    xml_sha256: String,
}
impl Source {
    fn supported(&self) -> bool {
        self.kind == "full" && self.schema_name == "procCTe_v4.00.xsd"
    }
}
#[derive(FromRow)]
struct Row {
    id: Uuid,
    document_id: Uuid,
    source_xml_sha256: String,
    inspector_version: String,
    metadata: sqlx::types::Json<ReceivedCteMetadata>,
    created_at: time::OffsetDateTime,
}
impl Row {
    fn snapshot(self) -> Result<CteInspectionSnapshot, DomainError> {
        Ok(CteInspectionSnapshot {
            id: self.id,
            document_id: self.document_id,
            source_xml_sha256: self.source_xml_sha256,
            inspector_version: self.inspector_version,
            document: self.metadata.0,
            created_at: self
                .created_at
                .format(&Rfc3339)
                .map_err(|_| access::AccessError::Internal)?,
        })
    }
}

async fn source(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Source, DomainError> {
    sqlx::query_as("SELECT id,company_tax_id,schema_name,kind,xml,xml_sha256 FROM fiscal_cte_distribution_documents WHERE tenant_id=$1 AND id=$2 AND environment=2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}
async fn company(tx: &mut Transaction<'_, Postgres>, tenant: Uuid) -> Result<String, DomainError> {
    sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)
}
fn matches_company(current: &str, source: &Source) -> bool {
    current == source.company_tax_id
        && current.bytes().all(|b| b.is_ascii_digit())
        && valid_document(current, "juridica")
}
async fn cached(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    source: &Source,
) -> Result<Option<CteInspectionSnapshot>, DomainError> {
    let row: Option<Row> = sqlx::query_as("SELECT id,document_id,source_xml_sha256,inspector_version,metadata,created_at FROM fiscal_cte_inspections WHERE tenant_id=$1 AND document_id=$2 AND source_xml_sha256=$3 AND inspector_version=$4")
        .bind(tenant).bind(source.id).bind(&source.xml_sha256).bind(model::VERSION).fetch_optional(&mut **tx).await.map_err(db)?;
    row.map(Row::snapshot).transpose()
}
fn detail(
    tenant: Uuid,
    source: &Source,
    can_inspect: bool,
    data: Option<CteInspectionSnapshot>,
) -> CteInspectionDetail {
    CteInspectionDetail {
        tenant_id: tenant,
        document_id: source.id,
        source_xml_sha256: source.xml_sha256.clone(),
        can_inspect,
        data,
    }
}
fn unconfirmed() -> Response {
    problem(
        StatusCode::BAD_GATEWAY,
        "cte_inspection_failed",
        "A conferência CT-e não foi confirmada; o XML original foi preservado",
        json!({}),
    )
}

#[utoipa::path(get,path="/api/v1/fiscal/cte-distribution/documents/{id}/inspection",tag="Fiscal",operation_id="get_cte_inspection",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=Uuid,Path)),responses((status=200,body=CteInspectionDetail),(status=403,description="Sem permissão CT-e"),(status=404,description="Arquivo ausente nesta empresa")))]
pub async fn get_inspection(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_inspect) =
        authorized(&state, &headers, &identity, READ, INSPECT, false).await?;
    let source = source(&mut tx, tenant, id).await?;
    let current = company(&mut tx, tenant).await?;
    let data = cached(&mut tx, tenant, &source).await?;
    let capable = can_inspect
        && source.supported()
        && matches_company(&current, &source)
        && (state.fiscal_engine.is_some() || data.is_some());
    let result = detail(tenant, &source, capable, data);
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}

#[utoipa::path(post,path="/api/v1/fiscal/cte-distribution/documents/{id}/inspect",tag="Fiscal",operation_id="inspect_received_cte",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header),("id"=Uuid,Path)),request_body=InspectCteInput,responses((status=201,body=CteInspectionDetail),(status=200,body=CteInspectionDetail),(status=403,description="Sem leitura e conferência CT-e"),(status=404,description="Arquivo ausente nesta empresa"),(status=409,description="Empresa ou comando conflitante"),(status=422,description="XML inválido ou perfil não coberto"),(status=428,description="Idempotency-Key obrigatório"),(status=502,description="Conferência não confirmada"),(status=503,description="Motor indisponível")))]
pub async fn inspect(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<InspectCteInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, INSPECT, true).await?;
    let Json(InspectCteInput {}) = payload.map_err(|_| {
        DomainError::Invalid(
            "Envie somente um objeto JSON vazio para conferir o arquivo preservado",
        )
    })?;
    let key = command_key(&headers)?;
    let original = source(&mut tx, tenant, id).await?;
    let tax_id = company(&mut tx, tenant).await?;
    if !matches_company(&tax_id, &original) {
        return Err(DomainError::Conflict(
            "O CNPJ atual diverge da coleta; confira a identidade da empresa antes de inspecionar",
        )
        .into());
    }
    if !original.supported() {
        return Ok(problem(
            StatusCode::UNPROCESSABLE_ENTITY,
            "cte_profile_unsupported",
            "Formato preservado fora do perfil de conferência disponível",
            json!({}),
        ));
    }
    let request = json!({"documentId":id,"xmlSha256":original.xml_sha256,"companyTaxId":tax_id,"inspectorVersion":model::VERSION,"profile":model::PROFILE});
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, SCOPE, &request).await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, previous));
    }
    if let Some(existing) = cached(&mut tx, tenant, &original).await? {
        let result = serde_json::to_value(detail(tenant, &original, true, Some(existing)))
            .map_err(|_| access::AccessError::Internal)?;
        remember(
            &mut tx,
            tenant,
            &identity.subject,
            key,
            SCOPE,
            &request,
            &result,
        )
        .await?;
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    tx.commit().await.map_err(db)?;
    let Some(engine) = state.fiscal_engine.as_ref() else {
        return Ok(problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "cte_inspector_unavailable",
            "Motor de conferência CT-e não configurado",
            json!({}),
        ));
    };
    let result = match engine
        .call(
            "inspect-cte",
            json!({"xml":original.xml,"companyTaxId":tax_id,"environment":"homologation"}),
        )
        .await
    {
        Ok(value) => value,
        Err(_) => return Ok(unconfirmed()),
    };
    if result["status"] == "blocked" {
        let code = if result["blockers"] == json!(["invalid_cte_xml"]) {
            Some("invalid_cte_xml")
        } else if result["blockers"] == json!(["cte_profile_unsupported"]) {
            Some("cte_profile_unsupported")
        } else {
            None
        };
        return Ok(match code {
            Some(code) => problem(
                StatusCode::UNPROCESSABLE_ENTITY,
                code,
                "Arquivo preservado, mas não conferido pelo perfil CT-e disponível",
                json!({}),
            ),
            None => unconfirmed(),
        });
    }
    let metadata = match model::correlate(result, &original.xml, &tax_id) {
        Ok(value) if value.xml_sha256 == original.xml_sha256 => value,
        _ => return Ok(unconfirmed()),
    };
    let (_, mut tx, _) = authorized(&state, &headers, &identity, READ, INSPECT, true).await?;
    let current = company(&mut tx, tenant).await?;
    let source = source(&mut tx, tenant, id).await?;
    if current != tax_id
        || !matches_company(&current, &source)
        || source.xml_sha256 != original.xml_sha256
        || source.xml != original.xml
    {
        return Err(DomainError::Conflict(
            "Empresa ou arquivo mudou durante a conferência; nenhum resultado foi gravado",
        )
        .into());
    }
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, SCOPE, &request).await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, previous));
    }
    let existing = cached(&mut tx, tenant, &source).await?;
    let created = existing.is_none();
    let data = if let Some(existing) = existing {
        existing
    } else {
        let inspection_id = Uuid::now_v7();
        let row: Row = sqlx::query_as("INSERT INTO fiscal_cte_inspections(tenant_id,id,document_id,source_xml_sha256,inspector_version,schema_release,metadata,inspected_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,document_id,source_xml_sha256,inspector_version,metadata,created_at")
            .bind(tenant).bind(inspection_id).bind(id).bind(&source.xml_sha256).bind(model::VERSION).bind(model::PROFILE).bind(sqlx::types::Json(metadata)).bind(&identity.subject).fetch_one(&mut *tx).await.map_err(db)?;
        record(&mut tx,tenant,&identity,&headers,DomainChange { kind: "fiscal_cte_inspection", id: inspection_id, event: "fiscal.cte.inspected", details: json!({"documentId":id,"xmlSha256":source.xml_sha256,"inspectorVersion":model::VERSION,"profile":model::PROFILE}) }).await?;
        row.snapshot()?
    };
    let result = serde_json::to_value(detail(tenant, &source, true, Some(data)))
        .map_err(|_| access::AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        SCOPE,
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        None,
        result,
    ))
}
