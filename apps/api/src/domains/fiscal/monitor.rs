use super::{FiscalError, certificates, distribution, problem, sefaz_client};
use crate::{
    domains::{DomainChange, DomainError, authorized, command_key, db, record, response},
    platform::{access, auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension,
    extract::{Path, Query, State, rejection::QueryRejection},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

const READ: &str = "fiscal.monitor.read";
const MANAGE: &str = "fiscal.monitor.manage";
const MANIFEST: &str = "fiscal.monitor.manifest";
const ZERO: &str = "000000000000000";

#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct MonitorQuery {
    offset: Option<u32>,
    limit: Option<u32>,
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MonitorDocument {
    id: i64,
    nsu: String,
    schema: String,
    kind: String,
    access_key: Option<String>,
    issuer_name: Option<String>,
    total_cents: Option<i64>,
    situation: Option<String>,
    xml_sha256: String,
    received_nfe_id: Option<i64>,
    manifestations: Value,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSnapshot {
    tenant_id: Uuid,
    can_sync: bool,
    can_manifest: bool,
    collection_enabled: bool,
    certificate_ready: bool,
    last_nsu: String,
    max_nsu: String,
    next_query_at: Option<String>,
    last_status: Option<String>,
    last_run: Option<Value>,
    documents: Vec<MonitorDocument>,
    total: i64,
}

#[utoipa::path(get,path="/api/v1/fiscal/monitor",tag="Fiscal",operation_id="get_fiscal_monitor",security(("bearerAuth"=[])),params(MonitorQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=MonitorSnapshot),(status=403,description="Sem permissão"),(status=422,description="Paginação inválida")))]
pub async fn status(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<MonitorQuery>, QueryRejection>,
) -> Result<Response, FiscalError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Paginação inválida"))?
        .0;
    let limit = query.limit.unwrap_or(25);
    if !(1..=100).contains(&limit) {
        return Err(DomainError::Invalid("Limite de 1 a 100 documentos").into());
    }
    let (tenant, mut tx, can_sync) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    let can_manifest = access::require_permission(&rights, MANIFEST).is_ok();
    let control: Option<(String,String,Option<String>,Option<String>)> = sqlx::query_as("SELECT last_nsu,max_nsu,to_char(next_query_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),last_status FROM fiscal_monitor_state WHERE tenant_id=$1")
        .bind(tenant).fetch_optional(&mut *tx).await.map_err(db)?;
    let (last_nsu, max_nsu, next_query_at, last_status) =
        control.unwrap_or((ZERO.into(), ZERO.into(), None, None));
    let certificate_ready = certificates::verified(&state, &mut tx, tenant).await?;
    let last_run = sqlx::query_scalar::<_, Value>("SELECT jsonb_build_object('id',id,'outcome',outcome,'status',status,'documentCount',document_count,'createdAt',created_at,'completedAt',completed_at) FROM fiscal_monitor_runs WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1")
        .bind(tenant).fetch_optional(&mut *tx).await.map_err(db)?;
    let total =
        sqlx::query_scalar("SELECT count(*) FROM fiscal_monitor_documents WHERE tenant_id=$1")
            .bind(tenant)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
    let documents = sqlx::query_as::<_, MonitorDocument>("SELECT d.id,d.nsu,d.schema,d.kind,d.access_key,d.issuer_name,d.total_cents,d.situation,d.xml_sha256,coalesce(d.received_nfe_id,(SELECT n.id FROM fiscal_received_nfes n WHERE n.tenant_id=d.tenant_id AND n.access_key=d.access_key)) AS received_nfe_id,coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'eventType',m.event_type,'outcome',m.outcome,'status',m.status,'protocol',m.protocol) ORDER BY m.created_at) FROM fiscal_monitor_manifestations m WHERE m.tenant_id=d.tenant_id AND m.access_key=d.access_key),'[]'::jsonb) AS manifestations FROM fiscal_monitor_documents d WHERE d.tenant_id=$1 ORDER BY d.nsu DESC LIMIT $2 OFFSET $3")
        .bind(tenant).bind(i64::from(limit)).bind(i64::from(query.offset.unwrap_or(0))).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        MonitorSnapshot {
            tenant_id: tenant,
            can_sync,
            can_manifest,
            collection_enabled: state.monitor.is_some(),
            certificate_ready,
            last_nsu,
            max_nsu,
            next_query_at,
            last_status,
            last_run,
            documents,
            total,
        },
    ))
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    id: Uuid,
    outcome: String,
    status: Option<String>,
    document_count: i32,
}

async fn current_run(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    key: Uuid,
    subject: &str,
) -> Result<Option<Run>, DomainError> {
    let row = sqlx::query_as::<_, (String, Uuid, String, Option<String>, i32)>("SELECT auth_subject,id,outcome,status,document_count FROM fiscal_monitor_runs WHERE tenant_id=$1 AND command_key=$2")
        .bind(tenant).bind(key).fetch_optional(&mut **tx).await.map_err(db)?;
    row.map(|(actor, id, outcome, status, document_count)| {
        if actor != subject {
            Err(DomainError::Conflict("Chave de consulta já utilizada"))
        } else {
            Ok(Run {
                id,
                outcome,
                status,
                document_count,
            })
        }
    })
    .transpose()
}

#[utoipa::path(post,path="/api/v1/fiscal/monitor/sync",tag="Fiscal",operation_id="sync_fiscal_monitor",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=202,body=Run),(status=403,description="Sem permissão"),(status=409,description="Cadastro ou comando incompatível"),(status=428,description="Idempotency-Key obrigatório"),(status=429,description="Intervalo de consulta"),(status=503,description="Coleta desativada")))]
pub async fn sync(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let key = command_key(&headers)?;
    if let Some(run) = current_run(&mut tx, tenant, key, &identity.subject).await? {
        tx.commit().await.map_err(db)?;
        let mut result = response(StatusCode::ACCEPTED, None, run);
        result
            .headers_mut()
            .insert("idempotency-replayed", HeaderValue::from_static("true"));
        return Ok(result);
    }
    let Some(service) = state.monitor.as_ref() else {
        return Ok(unavailable());
    };
    let material = certificates::active_material(&state, &mut tx, tenant).await?;
    let (tax_id, uf): (String, Option<String>) = sqlx::query_as("SELECT t.tax_id,p.details->>'state' FROM tenants t LEFT JOIN company_profiles p ON p.tenant_id=t.id WHERE t.id=$1")
        .bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    let uf = uf.ok_or(DomainError::Conflict(
        "Preencha a UF no cadastro da empresa",
    ))?;
    sqlx::query(
        "INSERT INTO fiscal_monitor_state(tenant_id,tax_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    )
    .bind(tenant)
    .bind(&tax_id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    let (stored_tax, cursor, wait): (String,String,bool) = sqlx::query_as("SELECT tax_id,last_nsu,coalesce(next_query_at>clock_timestamp(),false) FROM fiscal_monitor_state WHERE tenant_id=$1 FOR UPDATE")
        .bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    if stored_tax != tax_id {
        return Err(DomainError::Conflict(
            "CNPJ mudou após iniciar o cursor fiscal; revise a empresa",
        )
        .into());
    }
    if wait {
        let mut result = problem(
            StatusCode::TOO_MANY_REQUESTS,
            "fiscal_distribution_wait",
            "Aguarde o intervalo da próxima consulta fiscal",
            json!({}),
        );
        result
            .headers_mut()
            .insert("retry-after", HeaderValue::from_static("3600"));
        return Ok(result);
    }
    let body = sefaz_client::envelope(&tax_id, &uf, &cursor).map_err(DomainError::Invalid)?;
    let chain = state
        .certificates
        .as_ref()
        .ok_or(access::AccessError::Internal)?
        .transport_certificates(&material)
        .map_err(DomainError::Invalid)?;
    let client = service
        .client(&material, &chain)
        .map_err(DomainError::Invalid)?;
    drop(material);
    let run_id = Uuid::now_v7();
    sqlx::query("INSERT INTO fiscal_monitor_runs(id,tenant_id,command_key,auth_subject,cursor_before) VALUES($1,$2,$3,$4,$5)")
        .bind(run_id).bind(tenant).bind(key).bind(&identity.subject).bind(&cursor).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE fiscal_monitor_state SET next_query_at=clock_timestamp()+interval '1 hour',updated_at=clock_timestamp() WHERE tenant_id=$1")
        .bind(tenant).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "fiscal_monitor_run",
            id: run_id,
            event: "fiscal.monitor.requested",
            details: json!({"cursor":cursor}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    let batch = service
        .send(&client, false, body)
        .await
        .and_then(|xml| distribution::parse(&xml, &cursor, &tax_id));
    let result = apply(
        &state, &identity, &headers, tenant, run_id, &cursor, &tax_id, batch,
    )
    .await;
    match result {
        Ok(run) => Ok(response(StatusCode::ACCEPTED, None, run)),
        Err(error) => {
            // Keep the reservation after transport, validation, authorization or persistence failures.
            let mut tx = access::tenant_transaction(&state, tenant).await?;
            sqlx::query("UPDATE fiscal_monitor_runs SET outcome='failed',completed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2 AND outcome='pending'")
                .bind(tenant).bind(run_id).execute(&mut *tx).await.map_err(db)?;
            tx.commit().await.map_err(db)?;
            Err(error)
        }
    }
}
#[allow(clippy::too_many_arguments)]
async fn apply(
    state: &AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    tenant: Uuid,
    run: Uuid,
    cursor: &str,
    tax: &str,
    batch: Result<distribution::Batch, &'static str>,
) -> Result<Run, FiscalError> {
    let (_, mut tx, _) = authorized(state, headers, identity, READ, MANAGE, true).await?;
    let batch = match batch {
        Ok(value) => value,
        Err(_) => {
            sqlx::query("UPDATE fiscal_monitor_runs SET outcome='failed',completed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2 AND outcome='pending'").bind(tenant).bind(run).execute(&mut *tx).await.map_err(db)?;
            record(
                &mut tx,
                tenant,
                identity,
                headers,
                DomainChange {
                    kind: "fiscal_monitor_run",
                    id: run,
                    event: "fiscal.monitor.failed",
                    details: json!({"cursorPreserved":true}),
                },
            )
            .await?;
            tx.commit().await.map_err(db)?;
            return Ok(Run {
                id: run,
                outcome: "failed".into(),
                status: None,
                document_count: 0,
            });
        }
    };
    let current: (String,String,String) = sqlx::query_as("SELECT s.last_nsu,s.tax_id,t.tax_id FROM fiscal_monitor_state s JOIN tenants t ON t.id=s.tenant_id WHERE s.tenant_id=$1")
        .bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    if current.0 != cursor || current.1 != tax || current.2 != tax {
        return Err(DomainError::Conflict(
            "Empresa ou cursor mudou durante a consulta; lote não aplicado",
        )
        .into());
    }
    super::monitor_store::save_batch(&mut tx, tenant, run, identity, headers, &batch).await?;
    record(&mut tx,tenant,identity,headers,DomainChange {kind:"fiscal_monitor_run",id:run,event:"fiscal.monitor.applied",details:json!({"status":batch.status,"lastNsu":batch.last_nsu,"documents":batch.documents.len()})}).await?;
    tx.commit().await.map_err(db)?;
    Ok(Run {
        id: run,
        outcome: "applied".into(),
        status: Some(batch.status),
        document_count: batch.documents.len() as i32,
    })
}
pub(super) fn unavailable() -> Response {
    problem(
        StatusCode::SERVICE_UNAVAILABLE,
        "fiscal_monitor_disabled",
        "Coleta e manifestação na SEFAZ não estão habilitadas neste ambiente",
        json!({}),
    )
}

#[utoipa::path(get,path="/api/v1/fiscal/monitor/documents/{id}/xml",tag="Fiscal",operation_id="download_monitor_xml",security(("bearerAuth"=[])),params(("id"=i64,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=String,content_type="application/xml"),(status=403,description="Sem permissão"),(status=404,description="Documento ausente")))]
pub async fn download_xml(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let (nsu, xml, hash): (String, String, String) = sqlx::query_as(
        "SELECT nsu,xml,xml_sha256 FROM fiscal_monitor_documents WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    let mut result = Response::new(axum::body::Body::from(xml));
    for (name, value) in [
        ("content-type", "application/xml; charset=utf-8".into()),
        ("cache-control", "no-store".into()),
        ("x-content-type-options", "nosniff".into()),
        ("x-xml-sha256", hash),
        (
            "content-disposition",
            format!("attachment; filename=\"DFE-{nsu}.xml\""),
        ),
    ] {
        result.headers_mut().insert(
            axum::http::HeaderName::from_static(name),
            HeaderValue::from_str(&value).expect("validated metadata"),
        );
    }
    Ok(result)
}

pub use super::manifestation::manifest;
