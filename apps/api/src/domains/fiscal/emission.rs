//! Durable NF-e state machine. The engine owns XML/SEFAZ; PostgreSQL owns identity and state.
use super::{FiscalError, certificates, engine_client::FiscalEngine};
use crate::{
    domains::{
        DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
        revision,
    },
    platform::{access, auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::{FromRow, Postgres, Transaction};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::ToSchema;
use uuid::Uuid;

#[path = "emission_events.rs"]
pub mod events;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/fiscal/issued-nfes", get(list))
        .route("/api/v1/fiscal/nfe/{id}/emission", get(get_document))
        .route("/api/v1/fiscal/nfe/{id}/xml", get(download_xml))
        .route("/api/v1/fiscal/nfe/{id}/consult", post(consult))
        .route("/api/v1/fiscal/nfe/{id}/cancel", post(events::cancel))
        .route(
            "/api/v1/fiscal/nfe/{id}/correction",
            post(events::correction),
        )
        .route("/api/v1/fiscal/nfe/{id}/events", get(events::list))
        .route("/api/v1/fiscal/number-voids", post(events::void_numbers))
        .route(
            "/api/v1/fiscal/order-cancellations/{id}/process",
            post(events::process_order_cancellation),
        )
}

#[derive(FromRow)]
pub(super) struct Document {
    pub id: Uuid,
    pub revision: i64,
    pub status: String,
    pub series: i32,
    pub number: i64,
    pub source_order_id: Option<Uuid>,
    pub issued_at: String,
    pub random_code: String,
    pub access_key: Option<String>,
    pub signed_xml: Option<String>,
    pub authorized_xml: Option<String>,
    pub protocol: Option<String>,
    pub result: Value,
    pub busy: bool,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmissionSnapshot {
    pub tenant_id: Uuid,
    pub id: Uuid,
    pub revision: i64,
    pub status: String,
    pub environment: &'static str,
    pub series: i32,
    pub number: i64,
    pub access_key: Option<String>,
    pub protocol: Option<String>,
    pub result: Value,
    pub source_order_id: Option<Uuid>,
}
impl Document {
    pub(super) fn snapshot(&self, tenant: Uuid) -> Value {
        serde_json::to_value(EmissionSnapshot {
            tenant_id: tenant,
            id: self.id,
            revision: self.revision,
            status: self.status.clone(),
            environment: "homologation",
            series: self.series,
            number: self.number,
            access_key: self.access_key.clone(),
            protocol: self.protocol.clone(),
            result: self.result.clone(),
            source_order_id: self.source_order_id,
        })
        .expect("serializable snapshot")
    }
}
pub(super) async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Document, DomainError> {
    sqlx::query_as("SELECT id,revision,status,series,number,source_order_id,issued_at,random_code,access_key,signed_xml,authorized_xml,protocol,result,coalesce(lease_until>clock_timestamp(),false) AS busy FROM fiscal_nfe_documents WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}
pub(super) fn engine(state: &AppState) -> Result<&FiscalEngine, DomainError> {
    state
        .fiscal_engine
        .as_ref()
        .ok_or(DomainError::Conflict("Motor fiscal não configurado"))
}
pub(super) async fn payload(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<Value, DomainError> {
    let material = certificates::material(state, tx, tenant).await?;
    Ok(
        json!({"environment":"homologation","certificate":{"pkcs12Base64":STANDARD.encode(&material.pkcs12),"password":material.password}}),
    )
}
pub(super) fn now() -> String {
    OffsetDateTime::now_utc().format(&Rfc3339).expect("RFC3339")
}
pub(super) fn available_response() -> Response {
    super::problem(
        StatusCode::SERVICE_UNAVAILABLE,
        "nfe_emission_unavailable",
        "Configure o motor fiscal e um certificado A1 válido para emitir em homologação",
        json!({"environment":"homologation","productionEnabled":false}),
    )
}
pub(super) fn reply(document: &Document, tenant: Uuid) -> Response {
    response(
        if matches!(
            document.status.as_str(),
            "preparing" | "prepared" | "unknown"
        ) {
            StatusCode::ACCEPTED
        } else {
            StatusCode::OK
        },
        Some(document.revision),
        document.snapshot(tenant),
    )
}

#[utoipa::path(post,path="/api/v1/fiscal/nfe/{id}/issue",tag="Fiscal",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=EmissionSnapshot),(status=202,body=EmissionSnapshot),(status=403,description="Sem permissão de emissão"),(status=404,description="Rascunho não encontrado"),(status=409,description="Operação em andamento ou incompatível"),(status=412,description="Revisão desatualizada"),(status=428,description="Revisão e idempotência obrigatórias"),(status=503,description="Motor fiscal ou certificado indisponível")))]
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
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let request = json!({"id":id,"revision":expected});
    let previous = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.nfe.issue",
        &request,
    )
    .await?;
    if let Some(previous) = previous.as_ref().filter(|v| {
        matches!(
            v["status"].as_str(),
            Some("authorized" | "rejected" | "cancelled")
        )
    }) {
        let result = previous.clone();
        let rev = result["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, result));
    }
    let draft = super::load_draft(&mut tx, tenant, id).await?;
    let existing = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM fiscal_nfe_documents WHERE tenant_id=$1 AND id=$2)",
    )
    .bind(tenant)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    if previous.is_none()
        && ((!existing && draft.revision != expected)
            || existing && load(&mut tx, tenant, id).await?.revision != expected)
    {
        return Err(DomainError::StaleRevision.into());
    }
    if existing {
        let document = load(&mut tx, tenant, id).await?;
        if matches!(
            document.status.as_str(),
            "authorized" | "rejected" | "cancelled"
        ) {
            if previous.is_none() {
                remember(
                    &mut tx,
                    tenant,
                    &identity.subject,
                    key,
                    "fiscal.nfe.issue",
                    &request,
                    &document.snapshot(tenant),
                )
                .await?;
            }
            tx.commit().await.map_err(db)?;
            return Ok(reply(&document, tenant));
        }
        if document.busy {
            if previous.is_none() {
                remember(
                    &mut tx,
                    tenant,
                    &identity.subject,
                    key,
                    "fiscal.nfe.issue",
                    &request,
                    &document.snapshot(tenant),
                )
                .await?;
            }
            tx.commit().await.map_err(db)?;
            return Ok(reply(&document, tenant));
        }
    }
    if state.fiscal_engine.is_none() || !certificates::verified(&state, &mut tx, tenant).await? {
        tx.commit().await.map_err(db)?;
        return Ok(available_response());
    }
    if draft.issuer.profile.state != "SP" {
        return Err(DomainError::Conflict("Emissão disponível somente em SP e homologação").into());
    }
    // Revalidate the snapshot and order linkage before permanently allocating a number.
    draft.input.validate(&draft.issuer.profile)?;
    if existing && load(&mut tx, tenant, id).await?.signed_xml.is_none() {
        let document = load(&mut tx, tenant, id).await?;
        if document.series != i32::from(draft.issuer.profile.series)
            || document.source_order_id != draft.input.source_order_id
        {
            return Err(
                DomainError::Conflict("Preserve série e origem da tentativa fiscal").into(),
            );
        }
        super::order_source::validate(&mut tx, tenant, &identity, &draft.input).await?;
        let current = super::prepare(&mut tx, tenant, &draft.input).await?.0;
        if current.company_revision != draft.issuer.company_revision
            || current.profile_revision != draft.issuer.profile_revision
        {
            return Err(DomainError::Conflict(
                "Atualize o rascunho após alterar empresa ou configuração fiscal",
            )
            .into());
        }
    }
    if !existing {
        super::order_source::validate(&mut tx, tenant, &identity, &draft.input).await?;
        if let Some(order_id) = draft.input.source_order_id
            && sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM fiscal_nfe_documents WHERE tenant_id=$1 AND source_order_id=$2 AND status<>'rejected')").bind(tenant).bind(order_id).fetch_one(&mut *tx).await.map_err(db)? {
                return Err(DomainError::Conflict("Pedido já possui documento fiscal ou emissão pendente").into());
        }
        let current = super::prepare(&mut tx, tenant, &draft.input).await?.0;
        if current.company_revision != draft.issuer.company_revision
            || current.profile_revision != draft.issuer.profile_revision
        {
            return Err(DomainError::Conflict(
                "Atualize o rascunho após alterar empresa ou configuração fiscal",
            )
            .into());
        }
        let series = i32::from(draft.issuer.profile.series);
        sqlx::query("INSERT INTO fiscal_number_sequences(tenant_id,environment,series,next_number) VALUES($1,'homologation',$2,1) ON CONFLICT DO NOTHING").bind(tenant).bind(series).execute(&mut *tx).await.map_err(db)?;
        let number: i64=sqlx::query_scalar("UPDATE fiscal_number_sequences SET next_number=next_number+1 WHERE tenant_id=$1 AND environment='homologation' AND series=$2 AND next_number<=999999999 RETURNING next_number-1").bind(tenant).bind(series).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::Conflict("Numeração da série esgotada"))?;
        let random_code = format!("{:08}", (Uuid::now_v7().as_u128() % 100_000_000) as u64);
        sqlx::query("INSERT INTO fiscal_nfe_documents(tenant_id,id,source_order_id,status,series,number,issued_at,random_code,lease_until) VALUES($1,$2,$3,'preparing',$4,$5,$6,$7,clock_timestamp()+interval '120 seconds')").bind(tenant).bind(id).bind(draft.input.source_order_id).bind(series).bind(number).bind(now()).bind(random_code).execute(&mut *tx).await.map_err(db)?;
        record(
            &mut tx,
            tenant,
            &identity,
            &headers,
            DomainChange {
                kind: "fiscal_nfe",
                id,
                event: "fiscal.nfe.requested",
                details: json!({"series":series,"number":number,"environment":"homologation"}),
            },
        )
        .await?;
    } else {
        sqlx::query("UPDATE fiscal_nfe_documents SET lease_until=clock_timestamp()+interval '120 seconds' WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
    }
    let mut document = load(&mut tx, tenant, id).await?;
    if previous.is_none() {
        remember(
            &mut tx,
            tenant,
            &identity.subject,
            key,
            "fiscal.nfe.issue",
            &request,
            &document.snapshot(tenant),
        )
        .await?;
    }
    let mut body = payload(&state, &mut tx, tenant).await?;
    body["issuer"] =
        serde_json::to_value(&draft.issuer).map_err(|_| access::AccessError::Internal)?;
    body["draft"] =
        serde_json::to_value(&draft.input).map_err(|_| access::AccessError::Internal)?;
    body["number"] = json!(document.number);
    body["issuedAt"] = json!(document.issued_at);
    body["randomCode"] = json!(document.random_code);
    tx.commit().await.map_err(db)?;
    let client = engine(&state)?;
    if document.signed_xml.is_none() {
        let prepared = client.call("prepare", body.clone()).await;
        let valid = prepared.as_ref().ok().and_then(|v| {
            validate_prepared(
                v,
                &draft.issuer.tax_id,
                document.series,
                document.number,
                &document.random_code,
            )
            .ok()
        });
        if let Some((access_key, signed_xml)) = valid {
            let mut tx = access::tenant_transaction(&state, tenant).await?;
            sqlx::query("UPDATE fiscal_nfe_documents SET access_key=$3,signed_xml=$4,status='prepared',revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(access_key).bind(signed_xml).execute(&mut *tx).await.map_err(db)?;
            document = load(&mut tx, tenant, id).await?;
            tx.commit().await.map_err(db)?;
        } else {
            let mut result = json!({"code":"preparation_failed","reason":"Motor indisponível ou XML não validado; número reservado para a mesma tentativa"});
            if let Ok(prepared) = prepared
                && prepared["status"] == "blocked"
            {
                let blockers = prepared["blockers"]
                    .as_array()
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .filter(|code| {
                                [
                                    "invalid_fiscal_input",
                                    "tax_rule_scope",
                                    "payments_required",
                                    "municipality_unresolved",
                                    "amount_mismatch",
                                    "certificate_invalid",
                                ]
                                .contains(code)
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                result = json!({"code":"preparation_blocked","blockers":blockers,"reason":"Corrija os dados do rascunho antes de repetir a emissão; número reservado"});
            }
            return finish(
                &state,
                tenant,
                id,
                (&identity, &headers),
                key,
                "preparing",
                result,
            )
            .await;
        }
    } else if document.status == "unknown" {
        body["accessKey"] = json!(document.access_key);
        body["signedXml"] = json!(document.signed_xml);
        match client.call("consult",body.clone()).await {
            Ok(result) if matches!(result["status"].as_str(),Some("authorized"|"cancelled"|"denied"))=>return finish_provider(&state,tenant,id,&identity,&headers,key,result).await,
            Ok(result) if result["status"]=="not_found"=>{},
            _=>return finish(&state,tenant,id,(&identity,&headers),key,"unknown",json!({"code":"reconciliation_pending","reason":"Consulta fiscal sem resultado conclusivo"})).await,
        }
    }
    // This durable boundary precedes the first possibly effective authorization call.
    let mut tx = access::tenant_transaction(&state, tenant).await?;
    sqlx::query("UPDATE fiscal_nfe_documents SET status='unknown',updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    body["accessKey"] = json!(document.access_key);
    body["signedXml"] = json!(document.signed_xml);
    body["batch"] = json!(format!("{:015}", document.number));
    match client.call("authorize",body).await {
        Ok(result)=>finish_provider(&state,tenant,id,&identity,&headers,key,result).await,
        Err(_)=>finish(&state,tenant,id,(&identity,&headers),key,"unknown",json!({"code":"transport_uncertain","reason":"Resultado incerto; consulte antes de retransmitir"})).await,
    }
}

fn validate_prepared(
    value: &Value,
    tax_id: &str,
    series: i32,
    number: i64,
    random_code: &str,
) -> Result<(String, String), DomainError> {
    let invalid = || DomainError::Conflict("Motor retornou XML ou chave incompatível");
    let key = value["accessKey"]
        .as_str()
        .filter(|v| valid_key(v))
        .ok_or_else(invalid)?;
    if !key.starts_with("35")
        || &key[6..20] != tax_id
        || &key[20..22] != "55"
        || key[22..25] != format!("{series:03}")
        || key[25..34] != format!("{number:09}")
        || &key[35..43] != random_code
        || &key[34..35] != "1"
    {
        return Err(invalid());
    }
    let xml = value["signedXml"]
        .as_str()
        .filter(|v| {
            v.len() <= 4 * 1024 * 1024 && !v.contains("<!DOCTYPE") && !v.contains("<!ENTITY")
        })
        .ok_or_else(invalid)?;
    let parsed = roxmltree::Document::parse(xml).map_err(|_| invalid())?;
    let info = parsed
        .descendants()
        .filter(|n| n.has_tag_name(("http://www.portalfiscal.inf.br/nfe", "infNFe")))
        .collect::<Vec<_>>();
    if info.len() != 1
        || info[0].attribute("Id") != Some(format!("NFe{key}").as_str())
        || signature_digest(xml, key).is_none()
    {
        return Err(invalid());
    }
    let child = |name: &str| {
        info[0]
            .descendants()
            .find(|n| n.tag_name().name() == name)
            .and_then(|n| n.text())
    };
    if child("tpAmb") != Some("2")
        || child("mod") != Some("55")
        || child("serie") != Some(series.to_string().as_str())
        || child("nNF") != Some(number.to_string().as_str())
        || child("cNF") != Some(random_code)
        || child("CNPJ") != Some(tax_id)
    {
        return Err(invalid());
    }
    Ok((key.into(), xml.into()))
}

fn valid_key(key: &str) -> bool {
    if key.len() != 44 || !key.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let sum: u32 = key.as_bytes()[..43]
        .iter()
        .rev()
        .enumerate()
        .map(|(index, b)| u32::from(*b - b'0') * (2 + (index % 8) as u32))
        .sum();
    let digit = 11 - sum % 11;
    let digit = if digit >= 10 { 0 } else { digit };
    u32::from(key.as_bytes()[43] - b'0') == digit
}

pub(super) fn safe_result(result: &Value) -> Value {
    let mut safe = json!({});
    for name in ["code", "reason"] {
        if let Some(value) = result[name].as_str() {
            safe[name] = json!(value.chars().take(600).collect::<String>());
        }
    }
    safe
}
async fn finish_provider(
    state: &AppState,
    tenant: Uuid,
    id: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    key: Uuid,
    result: Value,
) -> Result<Response, FiscalError> {
    let status = if result["code"]
        .as_str()
        .is_some_and(|code| ["204", "539", "205", "206", "218"].contains(&code))
    {
        "unknown"
    } else {
        match result["status"].as_str() {
            Some("authorized") => "authorized",
            Some("cancelled") => "cancelled",
            Some("rejected" | "denied") => "rejected",
            _ => "unknown",
        }
    };
    if matches!(status, "authorized" | "cancelled") {
        let mut tx = access::tenant_transaction(state, tenant).await?;
        let document = load(&mut tx, tenant, id).await?;
        let xml = result["xml"].as_str().unwrap_or("");
        let protocol = result["protocol"].as_str().unwrap_or("");
        if protocol.is_empty()
            || protocol.len() > 30
            || !protocol.bytes().all(|b| b.is_ascii_digit())
            || !valid_protocol_xml(
                xml,
                document.access_key.as_deref().unwrap_or(""),
                protocol,
                document.signed_xml.as_deref().unwrap_or(""),
            )
        {
            tx.rollback().await.map_err(db)?;
            return finish(state,tenant,id,(identity,headers),key,"unknown",json!({"code":"invalid_provider_result","reason":"Resposta fiscal sem XML e protocolo coerentes"})).await;
        }
        sqlx::query("UPDATE fiscal_nfe_documents SET authorized_xml=$3,protocol=$4 WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(xml).bind(protocol).execute(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
    }
    finish(
        state,
        tenant,
        id,
        (identity, headers),
        key,
        status,
        safe_result(&result),
    )
    .await
}
fn signature_digest(xml: &str, key: &str) -> Option<Vec<u8>> {
    let document = roxmltree::Document::parse(xml).ok()?;
    let namespace = "http://www.w3.org/2000/09/xmldsig#";
    let references = document
        .descendants()
        .filter(|n| n.has_tag_name((namespace, "Reference")))
        .collect::<Vec<_>>();
    if references.len() != 1
        || references[0].attribute("URI") != Some(format!("#NFe{key}").as_str())
    {
        return None;
    }
    let digests = references[0]
        .children()
        .filter(|n| n.has_tag_name((namespace, "DigestValue")))
        .collect::<Vec<_>>();
    if digests.len() != 1 {
        return None;
    }
    let encoded = digests[0]
        .text()?
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect::<Vec<_>>();
    let bytes = STANDARD.decode(encoded).ok()?;
    if ![20, 32].contains(&bytes.len()) {
        return None;
    }
    Some(bytes)
}
fn valid_protocol_xml(xml: &str, key: &str, protocol: &str, signed_xml: &str) -> bool {
    if xml.len() > 5 * 1024 * 1024 || xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY") {
        return false;
    }
    let Ok(document) = roxmltree::Document::parse(xml) else {
        return false;
    };
    let Ok(inspected) = super::danfe::inspect(xml) else {
        return false;
    };
    if inspected.key != key
        || inspected.environment != "2"
        || signature_digest(xml, key) != signature_digest(signed_xml, key)
        || signature_digest(signed_xml, key).is_none()
    {
        return false;
    }
    let namespace = "http://www.portalfiscal.inf.br/nfe";
    if !document.root_element().has_tag_name((namespace, "nfeProc")) {
        return false;
    }
    let Ok(original) = roxmltree::Document::parse(signed_xml) else {
        return false;
    };
    let nfes = document
        .root_element()
        .children()
        .filter(|n| n.has_tag_name((namespace, "NFe")))
        .collect::<Vec<_>>();
    if nfes.len() != 1
        || !original.root_element().has_tag_name((namespace, "NFe"))
        || xml.get(nfes[0].range()) != signed_xml.get(original.root_element().range())
    {
        return false;
    }
    let infos = document
        .descendants()
        .filter(|n| n.has_tag_name((namespace, "infProt")))
        .collect::<Vec<_>>();
    if infos.len() != 1 {
        return false;
    }
    let child = |name: &str| {
        infos[0]
            .children()
            .find(|n| n.has_tag_name((namespace, name)))
            .and_then(|n| n.text())
    };
    child("chNFe") == Some(key)
        && child("nProt") == Some(protocol)
        && child("tpAmb") == Some("2")
        && matches!(child("cStat"), Some("100" | "150"))
        && document.descendants().any(|n| {
            n.has_tag_name((namespace, "infNFe"))
                && n.attribute("Id") == Some(format!("NFe{key}").as_str())
        })
}
async fn finish(
    state: &AppState,
    tenant: Uuid,
    id: Uuid,
    actor: (&AuthenticatedIdentity, &HeaderMap),
    key: Uuid,
    status: &str,
    result: Value,
) -> Result<Response, FiscalError> {
    let (identity, headers) = actor;
    let mut tx = access::tenant_transaction(state, tenant).await?;
    let current = load(&mut tx, tenant, id).await?;
    let status = if current.status == "cancelled" {
        "cancelled"
    } else {
        status
    };
    sqlx::query("UPDATE fiscal_nfe_documents SET status=$3,result=$4,lease_until=NULL,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(status).bind(&result).execute(&mut *tx).await.map_err(db)?;
    let document = load(&mut tx, tenant, id).await?;
    sqlx::query("UPDATE domain_commands SET result=$4 WHERE tenant_id=$1 AND auth_subject=$2 AND command_key=$3").bind(tenant).bind(&identity.subject).bind(key).bind(document.snapshot(tenant)).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        identity,
        headers,
        DomainChange {
            kind: "fiscal_nfe",
            id,
            event: "fiscal.nfe.reconciled",
            details: json!({"status":status,"revision":document.revision,"result":result}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(reply(&document, tenant))
}

#[utoipa::path(post,path="/api/v1/fiscal/nfe/{id}/consult",tag="Fiscal",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=EmissionSnapshot),(status=202,body=EmissionSnapshot)))]
pub async fn consult(
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
    let key = command_key(&headers)?;
    let request = json!({"id":id,"revision":expected});
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.nfe.consult",
        &request,
    )
    .await?
    {
        let rev = result["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, result));
    }
    let document = load(&mut tx, tenant, id).await?;
    if document.revision != expected {
        return Err(DomainError::StaleRevision.into());
    }
    if document.busy {
        return Err(DomainError::Conflict("Operação fiscal em andamento").into());
    }
    if document.access_key.is_none() {
        return Err(DomainError::Conflict("Documento ainda não possui XML preparado").into());
    }
    engine(&state)?;
    let mut body = payload(&state, &mut tx, tenant).await?;
    body["accessKey"] = json!(document.access_key);
    body["signedXml"] = json!(document.signed_xml);
    sqlx::query("UPDATE fiscal_nfe_documents SET lease_until=clock_timestamp()+interval '120 seconds' WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.nfe.consult",
        &request,
        &document.snapshot(tenant),
    )
    .await?;
    tx.commit().await.map_err(db)?;
    match engine(&state)?.call("consult", body).await {
        Ok(result)
            if matches!(
                result["status"].as_str(),
                Some("authorized" | "cancelled" | "denied")
            ) =>
        {
            finish_provider(&state, tenant, id, &identity, &headers, key, result).await
        }
        Ok(result) => {
            finish(
                &state,
                tenant,
                id,
                (&identity, &headers),
                key,
                &document.status,
                safe_result(&result),
            )
            .await
        }
        Err(_) => {
            finish(
                &state,
                tenant,
                id,
                (&identity, &headers),
                key,
                &document.status,
                json!({"code":"consult_uncertain"}),
            )
            .await
        }
    }
}

#[utoipa::path(get,path="/api/v1/fiscal/nfe/{id}/emission",tag="Fiscal",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=EmissionSnapshot)))]
pub async fn get_document(
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
        false,
    )
    .await?;
    let document = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(document.revision),
        document.snapshot(tenant),
    ))
}
#[utoipa::path(get,path="/api/v1/fiscal/issued-nfes",tag="Fiscal",security(("bearerAuth"=[])),params(super::Page),responses((status=200,description="Documentos emitidos e tentativas duráveis")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(page): Query<super::Page>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.issue",
        false,
    )
    .await?;
    let limit = page.limit.unwrap_or(25);
    if !(1..=100).contains(&limit) {
        return Err(DomainError::Invalid("Limite deve ser de 1 a 100").into());
    }
    let ids=sqlx::query_scalar::<_,Uuid>("SELECT id FROM fiscal_nfe_documents WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3").bind(tenant).bind(page.cursor).bind(limit+1).fetch_all(&mut *tx).await.map_err(db)?;
    let mut data = Vec::new();
    for id in ids.iter().take(limit as usize) {
        data.push(load(&mut tx, tenant, *id).await?.snapshot(tenant));
    }
    let next = if ids.len() > limit as usize {
        ids.get(limit as usize - 1).copied()
    } else {
        None
    };
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data,"nextCursor":next}),
    ))
}
#[utoipa::path(get,path="/api/v1/fiscal/nfe/{id}/xml",operation_id="download_emitted_nfe_xml",tag="Fiscal",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,description="XML fiscal preservado",content_type="application/xml")))]
pub async fn download_xml(
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
        false,
    )
    .await?;
    let document = load(&mut tx, tenant, id).await?;
    let xml = document
        .authorized_xml
        .or(document.signed_xml)
        .ok_or(DomainError::Conflict("XML ainda não preparado"))?;
    tx.commit().await.map_err(db)?;
    let mut reply = xml.into_response();
    reply.headers_mut().insert(
        "content-type",
        HeaderValue::from_static("application/xml; charset=utf-8"),
    );
    reply
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    reply.headers_mut().insert(
        "content-disposition",
        HeaderValue::from_str(&format!("attachment; filename=\"nfe-{id}.xml\""))
            .expect("UUID filename"),
    );
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prepared_document_requires_matching_key_environment_and_xml_signature() {
        let prefix = "3526100425201100011055001000000001112345678";
        let key = (0..10)
            .map(|digit| format!("{prefix}{digit}"))
            .find(|v| valid_key(v))
            .unwrap();
        let xml = format!(
            "<NFe xmlns=\"http://www.portalfiscal.inf.br/nfe\"><infNFe Id=\"NFe{key}\"><ide><mod>55</mod><tpAmb>2</tpAmb><serie>1</serie><nNF>1</nNF><cNF>12345678</cNF></ide><emit><CNPJ>04252011000110</CNPJ></emit></infNFe><Signature xmlns=\"http://www.w3.org/2000/09/xmldsig#\"><SignedInfo><Reference URI=\"#NFe{key}\"><DigestValue>AAAAAAAAAAAAAAAAAAAAAAAAAAA=</DigestValue></Reference></SignedInfo></Signature></NFe>"
        );
        assert!(
            validate_prepared(
                &json!({"accessKey":key,"signedXml":xml}),
                "04252011000110",
                1,
                1,
                "12345678"
            )
            .is_ok()
        );
        assert!(
            validate_prepared(
                &json!({"accessKey":key,"signedXml":xml.replace("<tpAmb>2","<tpAmb>1")}),
                "04252011000110",
                1,
                1,
                "12345678"
            )
            .is_err()
        );
        assert!(
            validate_prepared(
                &json!({"accessKey":key,"signedXml":xml}),
                "99999999999999",
                1,
                1,
                "12345678"
            )
            .is_err()
        );
    }
}
