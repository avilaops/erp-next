//! Homologation-only CT-e capture. Source XML is pending individual verification.
#[path = "cte_distribution_store.rs"]
mod store;
#[path = "cte_distribution_worker.rs"]
pub mod worker;

use super::{FiscalError, certificates, input};
use crate::{
    domains::{DomainChange, DomainError, authorized, command_key, db, record, response, revision},
    platform::{auth::AuthenticatedIdentity, state::AppState, valid_document},
};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Acquire, Postgres, Transaction};
use uuid::Uuid;

pub(super) const READ: &str = "fiscal.cte.read";
pub(super) const QUERY: &str = "fiscal.cte.query";
const STATES: &[&str] = &[
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
    "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/fiscal/cte-distribution/status", get(status))
        .route("/api/v1/fiscal/cte-distribution/query", post(query))
        .route("/api/v1/fiscal/cte-distribution/documents", get(documents))
        .route(
            "/api/v1/fiscal/cte-distribution/documents/{id}",
            get(document),
        )
        .route("/api/v1/fiscal/cte-distribution/runs/{id}", get(run))
}

#[utoipa::path(get,path="/api/v1/fiscal/cte-distribution/status",tag="Fiscal",operation_id="cte_distribution_status",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão CT-e")))]
pub async fn status(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_query) =
        authorized(&state, &headers, &identity, READ, QUERY, false).await?;
    let result = store::snapshot(
        &mut tx,
        tenant,
        can_query && state.fiscal_engine.is_some() && state.certificates.is_some(),
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        result["revision"].as_i64(),
        result,
    ))
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentQuery {
    offset: Option<u32>,
    limit: Option<u32>,
}

#[utoipa::path(get,path="/api/v1/fiscal/cte-distribution/documents",tag="Fiscal",operation_id="cte_distribution_documents",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("offset"=Option<u32>,Query),("limit"=Option<u32>,Query)),responses((status=200,body=Value),(status=403,description="Sem permissão CT-e")))]
pub async fn documents(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(query): Query<DocumentQuery>,
) -> Result<Response, DomainError> {
    let limit = query.limit.unwrap_or(25);
    if !(1..=100).contains(&limit) {
        return Err(DomainError::Invalid("Limite deve estar entre 1 e 100"));
    }
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, QUERY, false).await?;
    let data: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'runId',run_id,'environment','homologation','companyTaxId',company_tax_id,'nsu',nsu,'schema',schema_name,'kind',kind,'xmlSha256',xml_sha256,'verification',verification,'createdAt',created_at) FROM fiscal_cte_distribution_documents WHERE tenant_id=$1 AND environment=2 ORDER BY id DESC LIMIT $2 OFFSET $3")
        .bind(tenant).bind(i64::from(limit)).bind(i64::from(query.offset.unwrap_or(0))).fetch_all(&mut *tx).await.map_err(db)?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM fiscal_cte_distribution_documents WHERE tenant_id=$1 AND environment=2").bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"environment":"homologation","data":data,"total":total}),
    ))
}

#[utoipa::path(get,path="/api/v1/fiscal/cte-distribution/documents/{id}",tag="Fiscal",operation_id="cte_distribution_document",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=Uuid,Path)),responses((status=200,body=Value),(status=404,description="Documento CT-e não encontrado nesta empresa")))]
pub async fn document(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, QUERY, false).await?;
    let result: Value = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'runId',run_id,'environment','homologation','companyTaxId',company_tax_id,'nsu',nsu,'schema',schema_name,'kind',kind,'xml',xml,'xmlSha256',xml_sha256,'verification',verification) FROM fiscal_cte_distribution_documents WHERE tenant_id=$1 AND environment=2 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}

#[utoipa::path(get,path="/api/v1/fiscal/cte-distribution/runs/{id}",tag="Fiscal",operation_id="cte_distribution_run",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=Uuid,Path)),responses((status=200,body=Value),(status=404,description="Execução CT-e não encontrada nesta empresa")))]
pub async fn run(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, QUERY, false).await?;
    let result: Value = sqlx::query_scalar("SELECT jsonb_build_object('runId',id,'environment','homologation','companyTaxId',company_tax_id,'requestedNsu',requested_nsu,'status',status,'code',code,'documentCount',document_count,'createdAt',created_at,'completedAt',completed_at,'result',result) FROM fiscal_cte_distribution_runs WHERE tenant_id=$1 AND environment=2 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct QueryInput {}

#[utoipa::path(post,path="/api/v1/fiscal/cte-distribution/query",tag="Fiscal",operation_id="cte_distribution_query",request_body=QueryInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão CT-e"),(status=409,description="Consulta indisponível, em andamento ou em intervalo obrigatório"),(status=412,description="Revisão desatualizada"),(status=428,description="Revisão e chave obrigatórias")))]
pub async fn query(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<QueryInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    input(payload)?;
    let result = run_distribution(
        &state,
        &identity,
        &headers,
        revision(&headers)?,
        command_key(&headers)?,
    )
    .await?;
    Ok(response(
        StatusCode::OK,
        result["revision"].as_i64(),
        result,
    ))
}

/// Each explicit call reserves one durable batch, releasing SQL locks before mTLS.
pub async fn run_distribution(
    state: &AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    expected_revision: i64,
    key: Uuid,
) -> Result<Value, DomainError> {
    let (tenant, mut tx, _) = authorized(state, headers, identity, READ, QUERY, true).await?;
    let previous: Option<(Uuid, String, Option<Value>)> = sqlx::query_as("SELECT id,status,result FROM fiscal_cte_distribution_runs WHERE tenant_id=$1 AND auth_subject=$2 AND command_key=$3")
        .bind(tenant).bind(&identity.subject).bind(key).fetch_optional(&mut *tx).await.map_err(db)?;
    if let Some((id, status, saved)) = previous {
        let result = if let Some(saved) = saved {
            saved
        } else {
            let mut result = store::snapshot(&mut tx, tenant, true).await?;
            result["runId"] = json!(id);
            result["status"] = json!(status);
            result
        };
        tx.commit().await.map_err(db)?;
        return Ok(result);
    }
    let engine = state
        .fiscal_engine
        .as_ref()
        .ok_or(DomainError::Conflict("Motor fiscal não configurado"))?;
    let (tax_id, author_state): (String, Option<String>) = sqlx::query_as("SELECT t.tax_id,p.details->>'state' FROM tenants t LEFT JOIN company_profiles p ON p.tenant_id=t.id WHERE t.id=$1")
        .bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    let author_state = author_state
        .filter(|value| STATES.contains(&value.as_str()))
        .ok_or(DomainError::Conflict(
            "Preencha a UF da empresa antes da consulta CT-e",
        ))?;
    if !valid_document(&tax_id, "juridica") || !tax_id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(DomainError::Conflict(
            "A distribuição CT-e exige CNPJ válido da empresa",
        ));
    }
    sqlx::query("INSERT INTO fiscal_cte_distribution_state(tenant_id,environment,company_tax_id) VALUES($1,2,$2) ON CONFLICT DO NOTHING").bind(tenant).bind(&tax_id).execute(&mut *tx).await.map_err(db)?;
    let (last, cursor_tax_id, rev, blocked): (String,String,i64,bool) = sqlx::query_as("SELECT last_nsu,company_tax_id,revision,COALESCE(next_query_at>clock_timestamp(),false) OR COALESCE(lease_until>clock_timestamp(),false) FROM fiscal_cte_distribution_state WHERE tenant_id=$1 AND environment=2 FOR UPDATE")
        .bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    if cursor_tax_id != tax_id {
        return Err(DomainError::Conflict(
            "O CNPJ da empresa mudou; o cursor CT-e anterior não pode ser reutilizado",
        ));
    }
    if rev != expected_revision {
        return Err(DomainError::StaleRevision);
    }
    if blocked {
        return Err(DomainError::Conflict(
            "Consulta CT-e em andamento ou em intervalo obrigatório",
        ));
    }
    let certificate = certificates::material(state, &mut tx, tenant).await?;
    let id = Uuid::now_v7();
    sqlx::query("UPDATE fiscal_cte_distribution_runs SET status='unknown',completed_at=clock_timestamp() WHERE tenant_id=$1 AND status='running'").bind(tenant).execute(&mut *tx).await.map_err(db)?;
    // A crash after sending must not bypass the consumption pause on the next lease.
    sqlx::query("UPDATE fiscal_cte_distribution_state SET lease_id=$2,lease_until=clock_timestamp()+interval '120 seconds',next_query_at=clock_timestamp()+interval '1 hour',revision=revision+1 WHERE tenant_id=$1 AND environment=2")
        .bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO fiscal_cte_distribution_runs(tenant_id,id,environment,company_tax_id,author_state,auth_subject,command_key,requested_nsu,status) VALUES($1,$2,2,$3,$4,$5,$6,$7,'running')")
        .bind(tenant).bind(id).bind(&tax_id).bind(&author_state).bind(&identity.subject).bind(key).bind(&last).execute(&mut *tx).await.map_err(db)?;
    audit(
        &mut tx,
        tenant,
        id,
        identity,
        headers,
        "fiscal.cte.distribution.requested",
        json!({"environment":"homologation","lastNsu":last}),
    )
    .await?;
    tx.commit().await.map_err(db)?;

    let reply = engine.call("distribute-cte", json!({"environment":"homologation","issuerTaxId":tax_id,"authorState":author_state,"lastNsu":last,"certificate":{"pkcs12Base64":STANDARD.encode(&certificate.pkcs12),"password":certificate.password}})).await;
    // Rights and source identity are checked again after the external wait.
    let (_, mut tx, can_query) = authorized(state, headers, identity, READ, QUERY, true).await?;
    let current_tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    if current_tax_id != tax_id {
        return Err(DomainError::Conflict(
            "O CNPJ da empresa mudou durante a consulta CT-e",
        ));
    }
    let owns: bool = sqlx::query_scalar("SELECT COALESCE(lease_id=$2 AND lease_until>clock_timestamp(),false) FROM fiscal_cte_distribution_state WHERE tenant_id=$1 AND environment=2 FOR UPDATE")
        .bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    if !owns {
        return Err(DomainError::Conflict(
            "A concessão da consulta CT-e expirou; confira a execução atual",
        ));
    }
    let (mut outcome, mut code, mut next, mut maximum, mut delay, mut count) = (
        "unknown",
        "transport_uncertain".to_owned(),
        None,
        None,
        3600_i32,
        0_i32,
    );
    if let Ok(value) = reply {
        match store::parse_batch(value, &last) {
            Ok(batch) if batch.next_nsu.is_some() => {
                let mut savepoint = tx.begin().await.map_err(db)?;
                match store::save_documents(&mut savepoint, tenant, id, &tax_id, &batch.documents)
                    .await
                {
                    Ok(()) => {
                        savepoint.commit().await.map_err(db)?;
                        outcome = "completed";
                        code = batch.code;
                        delay = if code == "137" || batch.last_nsu == batch.max_nsu {
                            3600
                        } else {
                            2
                        };
                        count = batch.documents.len() as i32;
                        next = Some(batch.last_nsu);
                        maximum = Some(batch.max_nsu);
                    }
                    Err(_) => {
                        savepoint.rollback().await.map_err(db)?;
                        outcome = "failed";
                        code = "persistence_failed".to_owned();
                    }
                }
            }
            Ok(batch) => {
                outcome = "rejected";
                code = batch.code;
            }
            Err(_) => {
                outcome = "failed";
                code = "invalid_batch".to_owned();
            }
        }
    }
    sqlx::query("UPDATE fiscal_cte_distribution_state SET last_nsu=COALESCE($2,last_nsu),max_nsu=GREATEST(max_nsu,COALESCE($3,max_nsu)),last_code=$4,lease_id=NULL,lease_until=NULL,next_query_at=clock_timestamp()+make_interval(secs=>$5),revision=revision+1 WHERE tenant_id=$1 AND environment=2")
        .bind(tenant).bind(next).bind(maximum).bind(&code).bind(f64::from(delay)).execute(&mut *tx).await.map_err(db)?;
    let mut result = store::snapshot(&mut tx, tenant, can_query).await?;
    result["runId"] = json!(id);
    result["status"] = json!(outcome);
    result["documentCount"] = json!(count);
    sqlx::query("UPDATE fiscal_cte_distribution_runs SET status=$3,code=$4,document_count=$5,result=$6,completed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2 AND status='running'")
        .bind(tenant).bind(id).bind(outcome).bind(&code).bind(count).bind(&result).execute(&mut *tx).await.map_err(db)?;
    audit(
        &mut tx,
        tenant,
        id,
        identity,
        headers,
        "fiscal.cte.distribution.finished",
        json!({"status":outcome,"code":code,"documentCount":count}),
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(result)
}

async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    event: &'static str,
    details: Value,
) -> Result<(), DomainError> {
    record(
        tx,
        tenant,
        identity,
        headers,
        DomainChange {
            kind: "fiscal_cte_distribution",
            id,
            event,
            details,
        },
    )
    .await
}
