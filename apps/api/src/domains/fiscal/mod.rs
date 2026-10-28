pub mod danfe;
pub mod danfe_client;
#[cfg(test)]
pub(crate) mod danfe_test_support;
pub mod model;

use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use super::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    revision,
};
use crate::platform::{CompanyData, access, auth::AuthenticatedIdentity, state::AppState};
use model::{DraftInput, ProfileInput};

const BODY_LIMIT: usize = 1024 * 1024;
const BLOCKERS: &[&str] = &[
    "a1_secret_resolution_and_certificate_validation_not_implemented",
    "current_xsd_and_tax_rules_validation_not_implemented",
    "xml_generation_and_xmldsig_not_implemented",
    "sefaz_transport_and_reconciliation_not_implemented",
    "r2_document_storage_not_implemented",
];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/fiscal/danfe", axum::routing::post(danfe::generate))
        .route("/api/v1/fiscal/config", get(get_profile).put(put_profile))
        .route("/api/v1/fiscal/readiness", get(readiness))
        .route("/api/v1/fiscal/nfe", get(list).post(create))
        .route("/api/v1/fiscal/nfe/{id}", get(get_draft).put(update))
        .route("/api/v1/fiscal/nfe/{id}/issue", axum::routing::post(issue))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
}

pub enum FiscalError {
    Domain(DomainError),
    Json(JsonRejection),
}
impl From<DomainError> for FiscalError {
    fn from(value: DomainError) -> Self {
        Self::Domain(value)
    }
}
impl From<access::AccessError> for FiscalError {
    fn from(value: access::AccessError) -> Self {
        Self::Domain(value.into())
    }
}
impl IntoResponse for FiscalError {
    fn into_response(self) -> Response {
        match self {
            Self::Domain(value) => value.into_response(),
            Self::Json(value) => problem(
                value.status(),
                "invalid_json",
                "Corpo JSON inválido, campos desconhecidos ou limite de 1 MiB excedido",
                serde_json::json!({}),
            ),
        }
    }
}
fn problem(status: StatusCode, code: &str, title: &str, extra: serde_json::Value) -> Response {
    let mut body = serde_json::json!({"type":format!("https://erp.avilaops.com/problems/{code}"),"title":title,"status":status.as_u16()});
    body.as_object_mut()
        .expect("problem object")
        .extend(extra.as_object().expect("extra object").clone());
    let mut result = response(status, None, body);
    result.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("application/problem+json"),
    );
    result
}
fn input<T>(payload: Result<Json<T>, JsonRejection>) -> Result<T, FiscalError> {
    payload.map(|Json(value)| value).map_err(FiscalError::Json)
}
fn expected_revision(headers: &HeaderMap) -> Result<i64, DomainError> {
    if headers
        .get(axum::http::header::IF_MATCH)
        .is_some_and(|value| value == "\"0\"")
    {
        Ok(0)
    } else {
        revision(headers)
    }
}

#[derive(FromRow)]
struct ProfileRow {
    revision: i64,
    details: serde_json::Value,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSnapshot {
    tenant_id: Uuid,
    revision: i64,
    can_edit: bool,
    certificate_verified: bool,
    data: Option<ProfileInput>,
}
async fn load_profile(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<Option<ProfileRow>, DomainError> {
    sqlx::query_as("SELECT revision, details FROM fiscal_profiles WHERE tenant_id=$1")
        .bind(tenant)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db)
}
fn profile_data(row: &ProfileRow) -> Result<ProfileInput, DomainError> {
    serde_json::from_value(row.details.clone()).map_err(|_| access::AccessError::Internal.into())
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IssuerSnapshot {
    tax_id: String,
    legal_name: String,
    company_revision: i64,
    company: CompanyData,
    profile_revision: i64,
    profile: ProfileInput,
}
async fn issuer(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    profile: &ProfileInput,
) -> Result<(i64, CompanyData), DomainError> {
    let row = sqlx::query_as::<_, (String, String, i64, serde_json::Value)>(
        "SELECT t.tax_id,t.legal_name,p.revision,p.details FROM tenants t JOIN company_profiles p ON p.tenant_id=t.id WHERE t.id=$1"
    ).bind(tenant).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::Conflict("Preencha os dados da empresa antes da preparação fiscal"))?;
    let mut company: CompanyData =
        serde_json::from_value(row.3).map_err(|_| access::AccessError::Internal)?;
    company.tax_id = row.0;
    company.legal_name = row.1;
    company
        .validate()
        .map_err(|_| DomainError::Conflict("Cadastro da empresa incompleto ou inválido"))?;
    if company.person_type != "juridica"
        || company.tax_id.len() != 14
        || !profile.matches_company(
            &company.state,
            &company.tax_regime,
            &company.state_registration,
        )
    {
        return Err(DomainError::Conflict(
            "Emitente exige CNPJ e UF, IE e CRT coerentes com o cadastro da empresa",
        ));
    }
    Ok((row.2, company))
}

#[utoipa::path(get,path="/api/v1/fiscal/config",tag="Fiscal",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ProfileSnapshot),(status=403,description="Sem permissão fiscal")))]
pub async fn get_profile(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.config.read",
        "fiscal.config.manage",
        false,
    )
    .await?;
    let row = load_profile(&mut tx, tenant).await?;
    let current = row.as_ref().map_or(0, |row| row.revision);
    let data = row.as_ref().map(profile_data).transpose()?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(current),
        ProfileSnapshot {
            tenant_id: tenant,
            revision: current,
            can_edit,
            certificate_verified: false,
            data,
        },
    ))
}
#[utoipa::path(put,path="/api/v1/fiscal/config",tag="Fiscal",request_body=ProfileInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=ProfileSnapshot),(status=403,description="Sem permissão fiscal"),(status=409,description="Empresa incompatível"),(status=412,description="Revisão desatualizada"),(status=413,description="Corpo excede 1 MiB"),(status=422,description="Preparação inválida"),(status=428,description="If-Match obrigatório")))]
pub async fn put_profile(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<ProfileInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.config.read",
        "fiscal.config.manage",
        true,
    )
    .await?;
    let expected = expected_revision(&headers)?;
    let value = input(payload)?;
    value.validate()?;
    issuer(&mut tx, tenant, &value).await?;
    let current = load_profile(&mut tx, tenant)
        .await?
        .map_or(0, |row| row.revision);
    if current != expected {
        return Err(DomainError::StaleRevision.into());
    }
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    let details = serde_json::to_value(&value).map_err(|_| access::AccessError::Internal)?;
    sqlx::query("INSERT INTO fiscal_profiles(tenant_id,revision,environment,details) VALUES($1,$2,'homologation',$3) ON CONFLICT(tenant_id) DO UPDATE SET revision=excluded.revision,details=excluded.details,updated_at=now()")
        .bind(tenant).bind(next).bind(details).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"fiscal_profile",id:tenant,event:"fiscal.profile.updated",details:serde_json::json!({"revision":next,"environment":"homologation","certificateVerified":false})}).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        ProfileSnapshot {
            tenant_id: tenant,
            revision: next,
            can_edit: true,
            certificate_verified: false,
            data: Some(value),
        },
    ))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    tenant_id: Uuid,
    environment: model::Environment,
    model: u8,
    can_transmit: bool,
    production_enabled: bool,
    profile_configured: bool,
    certificate_verified: bool,
    blockers: Vec<String>,
}
#[utoipa::path(get,path="/api/v1/fiscal/readiness",tag="Fiscal",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Readiness),(status=403,description="Sem permissão fiscal")))]
pub async fn readiness(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.manage",
        false,
    )
    .await?;
    let row = load_profile(&mut tx, tenant).await?;
    let mut blockers = BLOCKERS.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>();
    if let Some(row) = row.as_ref() {
        match issuer(&mut tx, tenant, &profile_data(row)?).await {
            Ok(_) => {}
            Err(DomainError::Conflict(_)) => {
                blockers.push("company_and_fiscal_profile_inconsistent".into())
            }
            Err(error) => return Err(error.into()),
        }
    } else {
        blockers.push("fiscal_profile_missing".into());
    }
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        Readiness {
            tenant_id: tenant,
            environment: model::Environment::Homologation,
            model: 55,
            can_transmit: false,
            production_enabled: false,
            profile_configured: row.is_some(),
            certificate_verified: false,
            blockers,
        },
    ))
}

#[derive(FromRow)]
struct DraftRow {
    id: Uuid,
    revision: i64,
    issuer_snapshot: serde_json::Value,
    details: serde_json::Value,
    products_total_cents: i64,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    id: Uuid,
    revision: i64,
    status: String,
    issuer: IssuerSnapshot,
    input: DraftInput,
    products_total: String,
    fiscal_validation_complete: bool,
}
impl TryFrom<DraftRow> for Draft {
    type Error = DomainError;
    fn try_from(row: DraftRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            revision: row.revision,
            status: "draft".into(),
            issuer: serde_json::from_value(row.issuer_snapshot)
                .map_err(|_| access::AccessError::Internal)?,
            input: serde_json::from_value(row.details)
                .map_err(|_| access::AccessError::Internal)?,
            products_total: model::products_total(row.products_total_cents),
            fiscal_validation_complete: false,
        })
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DraftSnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: Draft,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DraftPage {
    data: Vec<Draft>,
    next_cursor: Option<Uuid>,
}
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Page {
    cursor: Option<Uuid>,
    limit: Option<i64>,
}

async fn load_draft(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Draft, DomainError> {
    let row = sqlx::query_as::<_,DraftRow>("SELECT id,revision,issuer_snapshot,details,products_total_cents FROM fiscal_nfe_drafts WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    row.try_into()
}

#[utoipa::path(get,path="/api/v1/fiscal/nfe",tag="Fiscal",security(("bearerAuth"=[])),params(Page,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=DraftPage),(status=403,description="Sem permissão fiscal"),(status=422,description="Paginação inválida")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(page): Query<Page>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.manage",
        false,
    )
    .await?;
    let limit = page.limit.unwrap_or(25);
    if !(1..=100).contains(&limit) {
        return Err(DomainError::Invalid("Limite deve ser de 1 a 100").into());
    }
    let rows=sqlx::query_as::<_,DraftRow>("SELECT id,revision,issuer_snapshot,details,products_total_cents FROM fiscal_nfe_drafts WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3")
        .bind(tenant).bind(page.cursor).bind(limit+1).fetch_all(&mut *tx).await.map_err(db)?;
    let has_more = rows.len() > limit as usize;
    let data = rows
        .into_iter()
        .take(limit as usize)
        .map(Draft::try_from)
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = if has_more {
        data.last().map(|v| v.id)
    } else {
        None
    };
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        DraftPage { data, next_cursor },
    ))
}
#[utoipa::path(get,path="/api/v1/fiscal/nfe/{id}",tag="Fiscal",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=DraftSnapshot),(status=403,description="Sem permissão fiscal"),(status=404,description="Rascunho não encontrado")))]
pub async fn get_draft(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.manage",
        false,
    )
    .await?;
    let data = load_draft(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data.revision),
        DraftSnapshot {
            tenant_id: tenant,
            can_edit,
            data,
        },
    ))
}

async fn prepare(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    value: &DraftInput,
) -> Result<(IssuerSnapshot, i64), DomainError> {
    let row = load_profile(tx, tenant)
        .await?
        .ok_or(DomainError::Conflict(
            "Configure a preparação fiscal antes de criar o rascunho",
        ))?;
    let profile = profile_data(&row)?;
    let total = value.validate(&profile)?;
    let (company_revision, company) = issuer(tx, tenant, &profile).await?;
    Ok((
        IssuerSnapshot {
            tax_id: company.tax_id.clone(),
            legal_name: company.legal_name.clone(),
            company_revision,
            company,
            profile_revision: row.revision,
            profile,
        },
        total,
    ))
}
#[utoipa::path(post,path="/api/v1/fiscal/nfe",tag="Fiscal",request_body=DraftInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=DraftSnapshot),(status=403,description="Sem permissão fiscal"),(status=409,description="Configuração ausente, incompatível ou chave reutilizada"),(status=413,description="Corpo excede 1 MiB"),(status=422,description="Dados inválidos"),(status=428,description="Idempotency-Key obrigatório")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<DraftInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.manage",
        true,
    )
    .await?;
    let key = command_key(&headers)?;
    let value = input(payload)?;
    let request = serde_json::to_value(&value).map_err(|_| access::AccessError::Internal)?;
    // Replay the original command before revalidating against a possibly changed profile.
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.nfe.draft.create",
        &request,
    )
    .await?
    {
        let rev = result["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        let mut reply = response(StatusCode::CREATED, rev, result);
        reply
            .headers_mut()
            .insert("idempotency-replayed", HeaderValue::from_static("true"));
        return Ok(reply);
    }
    let (issuer, total) = prepare(&mut tx, tenant, &value).await?;
    let id = Uuid::now_v7();
    let issuer_json = serde_json::to_value(&issuer).map_err(|_| access::AccessError::Internal)?;
    sqlx::query("INSERT INTO fiscal_nfe_drafts(tenant_id,id,environment,model,profile_revision,company_revision,issuer_snapshot,details,products_total_cents) VALUES($1,$2,'homologation',55,$3,$4,$5,$6,$7)")
        .bind(tenant).bind(id).bind(issuer.profile_revision).bind(issuer.company_revision).bind(issuer_json).bind(&request).bind(total).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "nfe_draft",
            id,
            event: "fiscal.nfe.draft.created",
            details: serde_json::json!({"revision":1,"environment":"homologation","model":55}),
        },
    )
    .await?;
    let result = serde_json::to_value(DraftSnapshot {
        tenant_id: tenant,
        can_edit: true,
        data: load_draft(&mut tx, tenant, id).await?,
    })
    .map_err(|_| access::AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.nfe.draft.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}
#[utoipa::path(put,path="/api/v1/fiscal/nfe/{id}",tag="Fiscal",request_body=DraftInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=DraftSnapshot),(status=403,description="Sem permissão fiscal"),(status=404,description="Rascunho não encontrado"),(status=409,description="Empresa incompatível"),(status=412,description="Revisão desatualizada"),(status=413,description="Corpo excede 1 MiB"),(status=422,description="Dados inválidos"),(status=428,description="If-Match obrigatório")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<DraftInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.manage",
        true,
    )
    .await?;
    let expected = revision(&headers)?;
    let current = load_draft(&mut tx, tenant, id).await?;
    if current.revision != expected {
        return Err(DomainError::StaleRevision.into());
    }
    let value = input(payload)?;
    let (issuer, total) = prepare(&mut tx, tenant, &value).await?;
    let next = expected
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    sqlx::query("UPDATE fiscal_nfe_drafts SET revision=$3,profile_revision=$4,company_revision=$5,issuer_snapshot=$6,details=$7,products_total_cents=$8,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).bind(next).bind(issuer.profile_revision).bind(issuer.company_revision).bind(serde_json::to_value(issuer).map_err(|_|access::AccessError::Internal)?).bind(serde_json::to_value(value).map_err(|_|access::AccessError::Internal)?).bind(total).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "nfe_draft",
            id,
            event: "fiscal.nfe.draft.updated",
            details: serde_json::json!({"previousRevision":expected,"revision":next}),
        },
    )
    .await?;
    let data = load_draft(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        DraftSnapshot {
            tenant_id: tenant,
            can_edit: true,
            data,
        },
    ))
}

/// A guard, not an emission adapter. No number, outbox request, XML or network call.
#[utoipa::path(post,path="/api/v1/fiscal/nfe/{id}/issue",tag="Fiscal",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=403,description="Sem permissão para emissão"),(status=404,description="Rascunho não encontrado"),(status=412,description="Revisão desatualizada"),(status=428,description="Revisão e idempotência obrigatórias"),(status=503,description="Emissão indisponível: adaptadores fiscais ainda não implementados")))]
pub async fn issue(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.issue",
        true,
    )
    .await?;
    let expected = revision(&headers)?;
    command_key(&headers)?;
    let draft = load_draft(&mut tx, tenant, id).await?;
    if draft.revision != expected {
        return Err(DomainError::StaleRevision.into());
    }
    tx.commit().await.map_err(db)?;
    Ok(problem(
        StatusCode::SERVICE_UNAVAILABLE,
        "nfe_emission_unavailable",
        "Emissão de NF-e ainda indisponível; rascunho preservado e nenhuma transmissão realizada",
        serde_json::json!({"environment":"homologation","productionEnabled":false,"blockers":BLOCKERS}),
    ))
}
