//! Durable recipient operations. External replies never imply stock or money movement.
#[path = "incoming_reconciliation.rs"]
pub mod reconciliation;
#[path = "incoming_worker.rs"]
pub mod worker;
use super::{FiscalError, certificates, input, received_model};
use crate::{
    domains::{
        DomainChange, DomainError, authorized, command_key, db, decimal, purchasing, record,
        remember, replay, response, revision,
    },
    platform::{access, auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

const PERMISSION: &str = "fiscal.received_nfe.manage";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/fiscal/distribution/status", get(status))
        .route("/api/v1/fiscal/distribution/query", post(query))
        .route("/api/v1/fiscal/distribution/documents", get(documents))
        .route("/api/v1/fiscal/distribution/documents/{nsu}", get(document))
        .route(
            "/api/v1/fiscal/manifestations",
            get(manifestations).post(manifest),
        )
        .route(
            "/api/v1/fiscal/manifestations/{id}",
            get(reconciliation::get),
        )
        .route(
            "/api/v1/fiscal/manifestations/{id}/reconcile",
            post(reconciliation::reconcile),
        )
        .route(
            "/api/v1/fiscal/received-nfes/{id}/purchase",
            get(conversion).post(convert),
        )
}

type CursorRow = (i64, i64, i64, Option<String>, Option<String>, bool);

async fn cursor(tx: &mut Transaction<'_, Postgres>, tenant: Uuid) -> Result<Value, DomainError> {
    let row:Option<CursorRow>=sqlx::query_as("SELECT last_nsu,max_nsu,revision,to_jsonb(next_query_at)#>>'{}',last_code,COALESCE(lease_until>clock_timestamp(),false) FROM fiscal_distribution_cursors WHERE tenant_id=$1 AND environment=2").bind(tenant).fetch_optional(&mut **tx).await.map_err(db)?;
    Ok(match row {
        Some((last, max, revision, next, code, running)) => {
            json!({"tenantId":tenant,"environment":"homologation","lastNsu":format!("{last:015}"),"maxNsu":format!("{max:015}"),"revision":revision,"nextQueryAt":next,"lastCode":code,"running":running})
        }
        None => {
            json!({"tenantId":tenant,"environment":"homologation","lastNsu":"000000000000000","maxNsu":"000000000000000","revision":1,"nextQueryAt":null,"lastCode":null,"running":false})
        }
    })
}

#[utoipa::path(get,path="/api/v1/fiscal/distribution/status",tag="Fiscal",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão fiscal")))]
pub async fn status(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, false).await?;
    let result = cursor(&mut tx, tenant).await?;
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

#[utoipa::path(get,path="/api/v1/fiscal/distribution/documents",tag="Fiscal",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("offset"=Option<u32>,Query),("limit"=Option<u32>,Query)),responses((status=200,body=Value),(status=403,description="Sem permissão fiscal")))]
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
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, false).await?;
    let data:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('nsu',lpad(nsu::text,15,'0'),'schema',schema_name,'kind',kind,'accessKey',access_key,'metadata',metadata,'receivedNfeId',received_nfe_id,'xmlSha256',xml_sha256) FROM fiscal_distribution_documents WHERE tenant_id=$1 AND environment=2 ORDER BY nsu DESC LIMIT $2 OFFSET $3").bind(tenant).bind(i64::from(limit)).bind(i64::from(query.offset.unwrap_or(0))).fetch_all(&mut *tx).await.map_err(db)?;
    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM fiscal_distribution_documents WHERE tenant_id=$1 AND environment=2",
    )
    .bind(tenant)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data,"total":total}),
    ))
}

#[utoipa::path(get,path="/api/v1/fiscal/distribution/documents/{nsu}",tag="Fiscal",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("nsu"=String,Path)),responses((status=200,body=Value),(status=404,description="NSU não encontrado nesta empresa")))]
pub async fn document(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(nsu): Path<String>,
) -> Result<Response, DomainError> {
    let nsu = nsu_value(&nsu)?;
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, false).await?;
    let result:Value=sqlx::query_scalar("SELECT jsonb_build_object('nsu',lpad(nsu::text,15,'0'),'schema',schema_name,'kind',kind,'accessKey',access_key,'metadata',metadata,'receivedNfeId',received_nfe_id,'xml',xml,'xmlSha256',xml_sha256) FROM fiscal_distribution_documents WHERE tenant_id=$1 AND environment=2 AND nsu=$2").bind(tenant).bind(nsu).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}

fn nsu_value(raw: &str) -> Result<i64, DomainError> {
    if raw.len() != 15 || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(DomainError::Invalid("NSU deve conter 15 dígitos"));
    }
    raw.parse()
        .map_err(|_| DomainError::Invalid("NSU inválido"))
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct QueryInput {}

#[utoipa::path(post,path="/api/v1/fiscal/distribution/query",tag="Fiscal",request_body=QueryInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=Value),(status=409,description="Consulta em andamento ou intervalo obrigatório"),(status=412,description="Revisão desatualizada"),(status=428,description="Revisão e chave obrigatórias")))]
pub async fn query(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<QueryInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    input(payload)?;
    let rev = revision(&headers)?;
    let key = command_key(&headers)?;
    let result = run_distribution(&state, &identity, &headers, rev, key).await?;
    Ok(response(
        StatusCode::OK,
        result["revision"].as_i64(),
        result,
    ))
}

/// One explicitly authorized cycle; usable by the scheduler with the opted-in
/// actor's identity and current tenant headers. Authorization is reloaded each time.
pub async fn run_distribution(
    state: &AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    expected_revision: i64,
    key: Uuid,
) -> Result<Value, DomainError> {
    let (tenant, mut tx, _) =
        authorized(state, headers, identity, PERMISSION, PERMISSION, true).await?;
    if let Some(previous)=sqlx::query_scalar::<_,Value>("SELECT COALESCE(result,jsonb_build_object('runId',id,'status',status,'revision',(SELECT revision FROM fiscal_distribution_cursors WHERE tenant_id=$1 AND environment=2))) FROM fiscal_distribution_runs WHERE tenant_id=$1 AND auth_subject=$2 AND command_key=$3").bind(tenant).bind(&identity.subject).bind(key).fetch_optional(&mut *tx).await.map_err(db)? {tx.commit().await.map_err(db)?;return Ok(previous);}
    sqlx::query("INSERT INTO fiscal_distribution_cursors(tenant_id,environment) VALUES($1,2) ON CONFLICT DO NOTHING").bind(tenant).execute(&mut *tx).await.map_err(db)?;
    let (last,rev,blocked):(i64,i64,bool)=sqlx::query_as("SELECT last_nsu,revision,COALESCE(next_query_at>clock_timestamp(),false) OR COALESCE(lease_until>clock_timestamp(),false) FROM fiscal_distribution_cursors WHERE tenant_id=$1 AND environment=2 FOR UPDATE").bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    if rev != expected_revision {
        return Err(DomainError::StaleRevision);
    }
    if blocked {
        return Err(DomainError::Conflict(
            "Consulta fiscal em andamento ou em intervalo obrigatório",
        ));
    }
    let engine = state
        .fiscal_engine
        .as_ref()
        .ok_or(DomainError::Conflict("Motor fiscal não configurado"))?;
    let tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    let certificate = certificates::material(state, &mut tx, tenant).await?;
    let id = Uuid::now_v7();
    sqlx::query("UPDATE fiscal_distribution_cursors SET lease_id=$2,lease_until=clock_timestamp()+interval '120 seconds',revision=revision+1 WHERE tenant_id=$1 AND environment=2").bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE fiscal_distribution_runs SET status='unknown' WHERE tenant_id=$1 AND status='running'").bind(tenant).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO fiscal_distribution_runs(id,tenant_id,environment,auth_subject,command_key,requested_nsu,status) VALUES($1,$2,2,$3,$4,$5,'running')").bind(id).bind(tenant).bind(&identity.subject).bind(key).bind(last).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        identity,
        headers,
        DomainChange {
            kind: "fiscal_distribution",
            id,
            event: "fiscal.distribution.requested",
            details: json!({"environment":"homologation","lastNsu":format!("{last:015}")}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    let reply=engine.call("distribute",json!({"environment":"homologation","issuerTaxId":tax_id,"lastNsu":format!("{last:015}"),"certificate":{"pkcs12Base64":STANDARD.encode(&certificate.pkcs12),"password":certificate.password}})).await;
    let mut tx = access::tenant_transaction(state, tenant).await?;
    sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let owns:bool=sqlx::query_scalar("SELECT COALESCE(lease_id=$2,false) FROM fiscal_distribution_cursors WHERE tenant_id=$1 AND environment=2 FOR UPDATE").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    if !owns {
        return Err(DomainError::Conflict(
            "A concessão da consulta expirou; consulte o estado atual",
        ));
    }
    let raw = reply.ok();
    let parsed = raw
        .as_ref()
        .ok_or(DomainError::Invalid("Resposta fiscal incerta"))
        .and_then(|value| parse_batch(value, &tax_id, last));
    let (run_status, code, new_last, new_max, delay) = match parsed {
        Ok(batch) => {
            for doc in batch.documents {
                persist_document(&mut tx, tenant, identity, headers, &doc).await?;
            }
            (
                "completed",
                batch.code,
                batch.last,
                batch.max,
                if batch.cooldown { 3600_i32 } else { 1 },
            )
        }
        Err(_) => (
            if raw.is_some() { "failed" } else { "unknown" },
            "invalid_or_unknown".to_owned(),
            last,
            last,
            if raw
                .as_ref()
                .is_some_and(|r| matches!(r["code"].as_str(), Some("137" | "656")))
            {
                3600
            } else {
                60
            },
        ),
    };
    sqlx::query("UPDATE fiscal_distribution_cursors SET last_nsu=$2,max_nsu=GREATEST(max_nsu,$3),last_code=$4,lease_id=NULL,lease_until=NULL,next_query_at=clock_timestamp()+make_interval(secs=>$5),revision=revision+1 WHERE tenant_id=$1 AND environment=2").bind(tenant).bind(new_last).bind(new_max).bind(&code).bind(delay as f64).execute(&mut *tx).await.map_err(db)?;
    let mut result = cursor(&mut tx, tenant).await?;
    result["runId"] = json!(id);
    result["status"] = json!(run_status);
    sqlx::query(
        "UPDATE fiscal_distribution_runs SET status=$3,response=$4,result=$5 WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .bind(run_status)
    .bind(&raw)
    .bind(&result)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    record(
        &mut tx,
        tenant,
        identity,
        headers,
        DomainChange {
            kind: "fiscal_distribution",
            id,
            event: "fiscal.distribution.result",
            details: json!({"status":run_status,"code":code,"lastNsu":format!("{new_last:015}")}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    let (_, tx, _) = authorized(state, headers, identity, PERMISSION, PERMISSION, false).await?;
    tx.commit().await.map_err(db)?;
    Ok(result)
}

struct Batch {
    code: String,
    last: i64,
    max: i64,
    cooldown: bool,
    documents: Vec<DistributedDocument>,
}
struct DistributedDocument {
    nsu: i64,
    schema: String,
    kind: String,
    key: String,
    xml: String,
    metadata: Value,
}

fn parse_batch(value: &Value, recipient: &str, last: i64) -> Result<Batch, DomainError> {
    let field = |name: &str| {
        value[name]
            .as_str()
            .ok_or(DomainError::Invalid("Resposta de distribuição inválida"))
    };
    let code = field("code")?.to_owned();
    if !["137", "138", "656"].contains(&code.as_str()) {
        return Err(DomainError::Invalid("Distribuição recusada"));
    }
    let next = if code == "656" {
        last
    } else {
        nsu_value(field("lastNsu")?)?
    };
    let max = nsu_value(field("maxNsu")?)?.max(if code == "656" { last } else { 0 });
    if next < last || max < next {
        return Err(DomainError::Invalid("Cursor de distribuição inconsistente"));
    }
    let raw = value["documents"]
        .as_array()
        .ok_or(DomainError::Invalid("Lote de distribuição ausente"))?;
    if raw.len() > 50 || (code != "138" && !raw.is_empty()) {
        return Err(DomainError::Invalid("Quantidade de documentos inválida"));
    }
    let mut documents = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for item in raw {
        let nsu = nsu_value(
            item["nsu"]
                .as_str()
                .ok_or(DomainError::Invalid("NSU ausente"))?,
        )?;
        if nsu <= last || nsu > next || !seen.insert(nsu) {
            return Err(DomainError::Invalid("NSU duplicado ou fora do cursor"));
        }
        let xml = item["xml"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 921600)
            .ok_or(DomainError::Invalid(
                "Documento fiscal ausente ou muito grande",
            ))?;
        let kind = item["kind"]
            .as_str()
            .ok_or(DomainError::Invalid("Tipo fiscal ausente"))?;
        let schema = item["schema"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 120)
            .ok_or(DomainError::Invalid("Schema fiscal ausente"))?;
        if !matches!((kind,schema), ("full",s) if s.starts_with("procNFe_"))
            && !matches!((kind,schema),("event",s) if s.starts_with("procEventoNFe_"))
            && !matches!((kind,schema),("summary",s) if s.starts_with("resNFe_"))
        {
            return Err(DomainError::Invalid(
                "Schema não corresponde ao tipo de documento",
            ));
        }
        let (key, metadata) = inspect_distributed(xml, kind, recipient)?;
        documents.push(DistributedDocument {
            nsu,
            schema: schema.to_owned(),
            kind: kind.to_owned(),
            key,
            xml: xml.to_owned(),
            metadata,
        });
    }
    if code == "138" && (documents.is_empty() || seen.last() != Some(&next)) {
        return Err(DomainError::Invalid(
            "Lote incompleto para o cursor informado",
        ));
    }
    Ok(Batch {
        code: code.clone(),
        last: next,
        max,
        cooldown: code == "137" || code == "656" || next == max,
        documents,
    })
}

fn inspect_distributed(
    xml: &str,
    kind: &str,
    recipient: &str,
) -> Result<(String, Value), DomainError> {
    if kind == "full" {
        let m = received_model::inspect_received(xml, recipient).map_err(DomainError::Invalid)?;
        if m.environment != "2" {
            return Err(DomainError::Invalid("Documento fora de homologação"));
        }
        return Ok((
            m.key.clone(),
            json!({"issuerDocument":m.issuer,"issuerName":m.issuer_name,"recipientDocument":m.recipient,"totalCents":m.total_cents,"number":m.number,"series":m.series}),
        ));
    }
    let doc = roxmltree::Document::parse_with_options(
        xml,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: 100_000,
            ..Default::default()
        },
    )
    .map_err(|_| DomainError::Invalid("XML distribuído inválido"))?;
    let root = doc.root_element();
    let ns = "http://www.portalfiscal.inf.br/nfe";
    if root.tag_name().namespace() != Some(ns)
        || !matches!(
            (kind, root.tag_name().name()),
            ("summary", "resNFe") | ("event", "resEvento") | ("event", "procEventoNFe")
        )
    {
        return Err(DomainError::Invalid("Tipo do XML distribuído incompatível"));
    }
    let scalar = |name: &str| -> Result<String, DomainError> {
        let mut matches = doc.descendants().filter(|n| n.has_tag_name((ns, name)));
        let node = matches
            .next()
            .ok_or(DomainError::Invalid("Campo distribuído ausente"))?;
        if matches.next().is_some() || node.children().any(|n| !n.is_text()) {
            return Err(DomainError::Invalid("Campo distribuído ambíguo"));
        }
        Ok(node
            .text()
            .ok_or(DomainError::Invalid("Campo distribuído vazio"))?
            .to_owned())
    };
    // procEventoNFe repeats identity fields in request and response. Parse only
    // a validated response identity rather than choosing an arbitrary first node.
    let key = if root.tag_name().name() == "procEventoNFe" {
        let keys: Vec<_> = doc
            .descendants()
            .filter(|n| n.has_tag_name((ns, "chNFe")))
            .collect();
        let first = keys
            .first()
            .and_then(|n| n.text())
            .ok_or(DomainError::Invalid("Evento sem chave"))?;
        if keys
            .iter()
            .any(|n| n.text() != Some(first) || n.children().any(|c| !c.is_text()))
        {
            return Err(DomainError::Invalid("Chave divergente no evento"));
        }
        first.to_owned()
    } else {
        scalar("chNFe")?
    };
    if !valid_access_key(&key) {
        return Err(DomainError::Invalid("Chave distribuída inválida"));
    }
    if kind == "summary" {
        let issuer = scalar("CNPJ")?;
        if issuer != key[6..20] {
            return Err(DomainError::Invalid("Emitente do resumo incompatível"));
        }
        let total = crate::domains::fixed(&scalar("vNF")?, 2)?;
        let name = scalar("xNome")?;
        let issued = scalar("dhEmi")?;
        if name.trim().is_empty()
            || name.chars().count() > 200
            || time::OffsetDateTime::parse(&issued, &time::format_description::well_known::Rfc3339)
                .is_err()
        {
            return Err(DomainError::Invalid("Nome ou data do resumo inválido"));
        }
        return Ok((
            key,
            json!({"issuerDocument":issuer,"issuerName":name,"totalCents":total,"issuedAt":issued}),
        ));
    }
    let types: Vec<_> = doc
        .descendants()
        .filter(|n| n.has_tag_name((ns, "tpEvento")))
        .filter_map(|n| n.text())
        .collect();
    if types.is_empty()
        || types
            .iter()
            .any(|t| *t != types[0] || t.len() != 6 || !t.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(DomainError::Invalid("Tipo de evento inválido"));
    }
    for amb in doc.descendants().filter(|n| n.has_tag_name((ns, "tpAmb"))) {
        if amb.text() != Some("2") {
            return Err(DomainError::Invalid("Evento fora de homologação"));
        }
    }
    Ok((key, json!({"eventType":types[0]})))
}

fn valid_access_key(key: &str) -> bool {
    if key.len() != 44 || !key.bytes().all(|b| b.is_ascii_digit()) || &key[20..22] != "55" {
        return false;
    }
    let sum: u32 = key.as_bytes()[..43]
        .iter()
        .rev()
        .enumerate()
        .map(|(index, digit)| u32::from(*digit - b'0') * (2 + (index % 8) as u32))
        .sum();
    let remainder = sum % 11;
    let check = if remainder < 2 { 0 } else { 11 - remainder };
    u32::from(key.as_bytes()[43] - b'0') == check
}

async fn persist_document(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    doc: &DistributedDocument,
) -> Result<(), DomainError> {
    let digest = format!("{:x}", Sha256::digest(doc.xml.as_bytes()));
    if let Some(previous)=sqlx::query_as::<_,(String,String,String)>("SELECT xml_sha256,kind,schema_name FROM fiscal_distribution_documents WHERE tenant_id=$1 AND environment=2 AND nsu=$2").bind(tenant).bind(doc.nsu).fetch_optional(&mut **tx).await.map_err(db)? {
        if previous!=(digest,doc.kind.clone(),doc.schema.clone()){return Err(DomainError::Conflict("NSU já armazenado com conteúdo diferente"));}return Ok(());
    }
    let received = if doc.kind == "full" {
        let recipient: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
            .bind(tenant)
            .fetch_one(&mut **tx)
            .await
            .map_err(db)?;
        let m =
            received_model::inspect_received(&doc.xml, &recipient).map_err(DomainError::Invalid)?;
        let previous: Option<(i64, String)> = sqlx::query_as(
            "SELECT id,xml_sha256 FROM fiscal_received_nfes WHERE tenant_id=$1 AND access_key=$2",
        )
        .bind(tenant)
        .bind(&doc.key)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db)?;
        match previous {
            Some((id, hash)) => {
                if hash != digest {
                    return Err(DomainError::Conflict("Nota já importada com outro XML"));
                }
                Some(id)
            }
            None => {
                let issued = time::OffsetDateTime::parse(
                    &m.issued_at,
                    &time::format_description::well_known::Rfc3339,
                )
                .map_err(|_| DomainError::Invalid("Data fiscal inválida"))?;
                Some(sqlx::query_scalar::<_,i64>("INSERT INTO fiscal_received_nfes(tenant_id,access_key,issuer_document,issuer_name,recipient_document,number,series,issued_at,total_cents,item_count,environment,xml,xml_sha256,imported_by_identity_id) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,2,$11,$12,id FROM identities WHERE auth_subject=$13 RETURNING id").bind(tenant).bind(&m.key).bind(&m.issuer).bind(&m.issuer_name).bind(&m.recipient).bind(i64::from(m.number)).bind(i32::from(m.series)).bind(issued).bind(m.total_cents).bind(i32::from(m.item_count)).bind(&doc.xml).bind(&digest).bind(&identity.subject).fetch_one(&mut **tx).await.map_err(db)?)
            }
        }
    } else {
        None
    };
    sqlx::query("INSERT INTO fiscal_distribution_documents(tenant_id,environment,nsu,schema_name,kind,access_key,xml,xml_sha256,metadata,received_nfe_id) VALUES($1,2,$2,$3,$4,$5,$6,$7,$8,$9)").bind(tenant).bind(doc.nsu).bind(&doc.schema).bind(&doc.kind).bind(&doc.key).bind(&doc.xml).bind(digest).bind(&doc.metadata).bind(received).execute(&mut **tx).await.map_err(db)?;
    if doc.kind == "event" {
        reconciliation::consume(tx, tenant, identity, headers, doc.nsu, &doc.xml).await?;
    }
    Ok(())
}

#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestInput {
    access_key: String,
    kind: String,
    justification: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestQuery {
    access_key: Option<String>,
}

#[utoipa::path(get,path="/api/v1/fiscal/manifestations",tag="Fiscal",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("accessKey"=Option<String>,Query)),responses((status=200,body=Value),(status=403,description="Sem permissão fiscal")))]
pub async fn manifestations(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(query): Query<ManifestQuery>,
) -> Result<Response, DomainError> {
    if query
        .access_key
        .as_deref()
        .is_some_and(|key| !valid_access_key(key))
    {
        return Err(DomainError::Invalid("Chave de manifestação inválida"));
    }
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, false).await?;
    let data:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'accessKey',access_key,'kind',kind,'status',status,'revision',revision,'issuedAt',issued_at,'result',response) FROM fiscal_recipient_manifestations WHERE tenant_id=$1 AND environment=2 AND ($2::text IS NULL OR access_key=$2) ORDER BY issued_at DESC LIMIT 100").bind(tenant).bind(query.access_key).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data}),
    ))
}

#[utoipa::path(post,path="/api/v1/fiscal/manifestations",tag="Fiscal",request_body=ManifestInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=Value),(status=404,description="Nota ausente nesta empresa"),(status=409,description="Manifestação já solicitada"),(status=428,description="Revisão e chave obrigatórias")))]
pub async fn manifest(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<ManifestInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let request = input(payload)?;
    let rev = revision(&headers)?;
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, true).await?;
    let request_value =
        serde_json::to_value(&request).map_err(|_| access::AccessError::Internal)?;
    if let Some((saved,id))=sqlx::query_as::<_,(Value,Uuid)>("SELECT request,id FROM fiscal_recipient_manifestations WHERE tenant_id=$1 AND auth_subject=$2 AND command_key=$3").bind(tenant).bind(&identity.subject).bind(key).fetch_optional(&mut *tx).await.map_err(db)? {
        if saved!=request_value{return Err(DomainError::Conflict("Chave já usada com outra manifestação").into());}let result=reconciliation::load(&mut tx,tenant,id).await?;tx.commit().await.map_err(db)?;return Ok(response(StatusCode::OK,result["revision"].as_i64(),result));
    }
    if rev != 1 {
        return Err(DomainError::StaleRevision.into());
    }
    if !valid_access_key(&request.access_key)
        || !["ciencia", "confirmacao", "desconhecimento", "nao_realizada"]
            .contains(&request.kind.as_str())
    {
        return Err(DomainError::Invalid("Chave ou manifestação inválida").into());
    }
    if request.kind == "nao_realizada"
        && !request
            .justification
            .as_ref()
            .is_some_and(|s| (15..=255).contains(&s.trim().chars().count()))
    {
        return Err(DomainError::Invalid(
            "Operação não realizada exige justificativa de 15 a 255 caracteres",
        )
        .into());
    }
    if request
        .justification
        .as_ref()
        .is_some_and(|s| s.chars().count() > 255)
    {
        return Err(DomainError::Invalid("Justificativa muito longa").into());
    }
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_received_nfes WHERE tenant_id=$1 AND access_key=$2 AND environment=2 UNION ALL SELECT 1 FROM fiscal_distribution_documents WHERE tenant_id=$1 AND access_key=$2 AND environment=2)").bind(tenant).bind(&request.access_key).fetch_one(&mut *tx).await.map_err(db)?;
    if !exists {
        return Err(DomainError::NotFound.into());
    }
    let previous:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_recipient_manifestations WHERE tenant_id=$1 AND environment=2 AND access_key=$2 AND kind=$3)").bind(tenant).bind(&request.access_key).bind(&request.kind).fetch_one(&mut *tx).await.map_err(db)?;
    if previous {
        return Err(DomainError::Conflict(
            "Manifestação já solicitada; consulte o resultado antes de reenviar",
        )
        .into());
    }
    let engine = state
        .fiscal_engine
        .as_ref()
        .ok_or(DomainError::Conflict("Motor fiscal não configurado"))?;
    let certificate = certificates::material(&state, &mut tx, tenant).await?;
    let tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    let id = Uuid::now_v7();
    let issued = time::OffsetDateTime::now_utc();
    let issued_at = issued
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| access::AccessError::Internal)?;
    sqlx::query("INSERT INTO fiscal_recipient_manifestations(id,tenant_id,environment,access_key,kind,justification,auth_subject,command_key,request,status,issued_at) VALUES($1,$2,2,$3,$4,$5,$6,$7,$8,'pending',$9)").bind(id).bind(tenant).bind(&request.access_key).bind(&request.kind).bind(&request.justification).bind(&identity.subject).bind(key).bind(request_value).bind(issued).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "recipient_manifestation",
            id,
            event: "fiscal.manifestation.requested",
            details: json!({"accessKey":request.access_key,"kind":request.kind}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    let reply=engine.call("manifest",json!({"environment":"homologation","issuerTaxId":tax_id,"accessKey":request.access_key,"kind":request.kind,"justification":request.justification,"issuedAt":issued_at,"certificate":{"pkcs12Base64":STANDARD.encode(&certificate.pkcs12),"password":certificate.password}})).await.ok();
    let result_status = manifestation_status(reply.as_ref());
    let mut tx = access::tenant_transaction(&state, tenant).await?;
    sqlx::query("UPDATE fiscal_recipient_manifestations SET status=$3,response=$4,revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND status='pending'").bind(tenant).bind(id).bind(result_status).bind(&reply).execute(&mut *tx).await.map_err(db)?;
    let result = reconciliation::load(&mut tx, tenant, id).await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "recipient_manifestation",
            id,
            event: "fiscal.manifestation.result",
            details: json!({"status":result["status"]}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    let (_, tx, _) = authorized(&state, &headers, &identity, PERMISSION, PERMISSION, false).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        result["revision"].as_i64(),
        result,
    ))
}

fn manifestation_status(reply: Option<&Value>) -> &'static str {
    let Some(reply) = reply else {
        return "unknown";
    };
    let code = reply["code"].as_str().unwrap_or("");
    if reply["registered"] == true
        && ["135", "136"].contains(&code)
        && reply["protocol"]
            .as_str()
            .is_some_and(|s| s.len() == 15 && s.bytes().all(|b| b.is_ascii_digit()))
    {
        "accepted"
    } else if reply["registered"] == false
        && code.len() == 3
        && code.bytes().all(|b| b.is_ascii_digit())
        && !["108", "109", "128", "135", "136", "573"].contains(&code)
    {
        "rejected"
    } else {
        "unknown"
    }
}

#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemMapping {
    item_number: i32,
    product_id: Uuid,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversionInput {
    supplier_id: Uuid,
    due_date: String,
    items: Vec<ItemMapping>,
}

#[utoipa::path(get,path="/api/v1/fiscal/received-nfes/{id}/purchase",tag="Fiscal",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=i64,Path)),responses((status=200,body=Value),(status=404,description="Nota ausente nesta empresa")))]
pub async fn conversion(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, false).await?;
    let (xml, recipient): (String, String) = sqlx::query_as(
        "SELECT xml,recipient_document FROM fiscal_received_nfes WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    let items =
        received_model::inspect_purchase_items(&xml, &recipient).map_err(DomainError::Invalid)?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    let can_convert = access::require_permission(&rights, "purchasing.orders.read").is_ok()
        && access::require_permission(&rights, "purchasing.orders.manage").is_ok();
    let link:Option<Uuid>=sqlx::query_scalar("SELECT purchase_order_id FROM fiscal_received_purchase_links WHERE tenant_id=$1 AND received_nfe_id=$2").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
    let costs:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('itemNumber',item_number,'productId',product_id,'unit',unit,'quantityMicros',quantity_micros,'unitCostCents',unit_cost_cents,'merchandiseCents',merchandise_cents,'landedCents',landed_cents,'components',components) FROM fiscal_received_item_costs WHERE tenant_id=$1 AND received_nfe_id=$2 ORDER BY item_number").bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    let rev = if link.is_some() { 2 } else { 1 };
    Ok(response(
        StatusCode::OK,
        Some(rev),
        json!({"receivedNfeId":id,"revision":rev,"purchaseOrderId":link,"costs":costs,"items":items,"canConvert":can_convert}),
    ))
}

#[utoipa::path(post,path="/api/v1/fiscal/received-nfes/{id}/purchase",tag="Fiscal",request_body=ConversionInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=i64,Path),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=Value),(status=403,description="Sem permissão fiscal ou de compra"),(status=409,description="Fornecedor ou unidade incompatível"),(status=412,description="Revisão desatualizada"),(status=422,description="Mapeamento, quantidade ou custo inválido"),(status=428,description="Revisão e chave obrigatórias")))]
pub async fn convert(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    payload: Result<Json<ConversionInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let request = input(payload)?;
    let rev = revision(&headers)?;
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, true).await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, "purchasing.orders.read")?;
    access::require_permission(&rights, "purchasing.orders.manage")?;
    let value = json!({"receivedNfeId":id,"mapping":request});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.received.convert",
        &value,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, Some(2), previous));
    }
    let (xml,issuer,recipient,environment):(String,String,String,i16)=sqlx::query_as("SELECT xml,issuer_document,recipient_document,environment FROM fiscal_received_nfes WHERE tenant_id=$1 AND id=$2 FOR SHARE").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let linked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_received_purchase_links WHERE tenant_id=$1 AND received_nfe_id=$2)").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    if rev != if linked { 2 } else { 1 } {
        return Err(DomainError::StaleRevision.into());
    }
    if linked {
        return Err(DomainError::Conflict("Nota já convertida em compra").into());
    }
    let tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    if tax_id != recipient || environment != 2 {
        return Err(
            DomainError::Conflict("Destinatário ou ambiente não corresponde à empresa").into(),
        );
    }
    let supplier:String=sqlx::query_scalar("SELECT tax_id FROM parties WHERE tenant_id=$1 AND id=$2 AND is_supplier AND status='active'").bind(tenant).bind(request.supplier_id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::Conflict("Selecione fornecedor ativo desta empresa"))?;
    if supplier != issuer {
        return Err(DomainError::Conflict("Fornecedor mapeado não corresponde ao emitente").into());
    }
    let items =
        received_model::inspect_purchase_items(&xml, &tax_id).map_err(DomainError::Invalid)?;
    if items.len() != request.items.len() || items.len() > 100 {
        return Err(DomainError::Invalid(
            "Mapeie todos os itens fiscais, até 100 produtos distintos",
        )
        .into());
    }
    let mut mapping = std::collections::BTreeMap::new();
    let mut products = std::collections::HashSet::new();
    for item in &request.items {
        if mapping.insert(item.item_number, item.product_id).is_some()
            || !products.insert(item.product_id)
        {
            return Err(DomainError::Invalid("Item ou produto mapeado mais de uma vez").into());
        }
    }
    let mut purchase_items = Vec::new();
    for item in &items {
        let product = *mapping
            .get(&item.number)
            .ok_or(DomainError::Invalid("Item fiscal sem produto mapeado"))?;
        let unit: String = sqlx::query_scalar(
            "SELECT unit FROM products WHERE tenant_id=$1 AND id=$2 AND status='active'",
        )
        .bind(tenant)
        .bind(product)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::Conflict(
            "Produto mapeado não está ativo nesta empresa",
        ))?;
        if unit != item.unit {
            return Err(DomainError::Conflict(
                "Unidade do produto não corresponde à unidade comercial do XML",
            )
            .into());
        }
        purchase_items.push((
            product,
            decimal(item.quantity_micros, 6),
            decimal(item.unit_cost_cents, 2),
        ));
    }
    let purchase = purchasing::create_fiscal_draft(
        &mut tx,
        tenant,
        request.supplier_id,
        request.due_date,
        purchase_items,
    )
    .await?;
    let purchase = serde_json::to_value(purchase).map_err(|_| access::AccessError::Internal)?;
    let purchase_id: Uuid = serde_json::from_value(purchase["data"]["id"].clone())
        .map_err(|_| access::AccessError::Internal)?;
    sqlx::query("INSERT INTO fiscal_received_purchase_links(tenant_id,received_nfe_id,purchase_order_id,supplier_id) VALUES($1,$2,$3,$4)").bind(tenant).bind(id).bind(purchase_id).bind(request.supplier_id).execute(&mut *tx).await.map_err(db)?;
    for item in items {
        sqlx::query("INSERT INTO fiscal_received_item_costs(tenant_id,received_nfe_id,item_number,product_id,purchase_order_id,unit,quantity_micros,unit_cost_cents,merchandise_cents,landed_cents,components) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)").bind(tenant).bind(id).bind(item.number).bind(mapping[&item.number]).bind(purchase_id).bind(item.unit).bind(item.quantity_micros).bind(item.unit_cost_cents).bind(item.merchandise_cents).bind(item.landed_cents).bind(item.components).execute(&mut *tx).await.map_err(db)?;
    }
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "purchase_order",
            id: purchase_id,
            event: "purchase.created",
            details: json!({"revision":1,"receivedNfeId":id,"origin":"fiscal_received_nfe"}),
        },
    )
    .await?;
    let result =
        json!({"receivedNfeId":id,"revision":2,"purchaseOrderId":purchase_id,"purchase":purchase});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.received.convert",
        &value,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(2), result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uncertain_manifestation_is_never_success_or_blind_retry() {
        assert_eq!(manifestation_status(None), "unknown");
        assert_eq!(
            manifestation_status(Some(&json!({"registered":true,"code":"135"}))),
            "unknown"
        );
        assert_eq!(
            manifestation_status(Some(
                &json!({"registered":true,"code":"135","protocol":"135260000000001"})
            )),
            "accepted"
        );
        assert_eq!(
            manifestation_status(Some(&json!({"registered":false,"code":"573"}))),
            "unknown"
        );
        assert_eq!(
            manifestation_status(Some(&json!({"registered":false,"code":"580"}))),
            "rejected"
        );
    }
    #[test]
    fn distribution_cooldown_and_invalid_document_do_not_advance() {
        for code in ["137", "656"] {
            let batch=parse_batch(&json!({"code":code,"lastNsu":"000000000000000","maxNsu":"000000000000000","documents":[]}),"19131243000197",0).unwrap();
            assert!(batch.cooldown);
            assert_eq!(batch.last, 0);
        }
        assert!(parse_batch(&json!({"code":"138","lastNsu":"000000000000001","maxNsu":"000000000000001","documents":[{"nsu":"000000000000001","kind":"full","schema":"procNFe_v4.00.xsd","xml":"<broken/>"}]}),"19131243000197",0).is_err());
        assert!(parse_batch(&json!({"code":"138","lastNsu":"000000000000001","maxNsu":"000000000000001","documents":[]}),"19131243000197",0).is_err());
    }
}
