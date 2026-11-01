use super::*;
use axum::{Json, extract::rejection::JsonRejection};
use serde::Deserialize;

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EventInput {
    pub text: String,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VoidInput {
    pub year: i32,
    pub series: i32,
    pub first: i64,
    pub last: i64,
    pub text: String,
}
#[derive(FromRow)]
struct Event {
    id: Uuid,
    document_id: Option<Uuid>,
    kind: String,
    sequence: i32,
    revision: i64,
    request: Value,
    status: String,
    result: Value,
    busy: bool,
}
impl Event {
    fn snapshot(&self, tenant: Uuid) -> Value {
        json!({"tenantId":tenant,"id":self.id,"documentId":self.document_id,"kind":self.kind,"sequence":self.sequence,"revision":self.revision,"status":self.status,"request":self.request,"result":self.result})
    }
}
async fn load_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Event, DomainError> {
    sqlx::query_as("SELECT id,document_id,kind,sequence,revision,request,status,result,coalesce(lease_until>clock_timestamp(),false) AS busy FROM fiscal_nfe_events WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}
fn validate_text(text: &str, min: usize, max: usize) -> Result<(), DomainError> {
    let count = text.trim().chars().count();
    if count < min || count > max || text.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Justificativa ou correção fora do tamanho permitido ou com controles",
        ));
    }
    Ok(())
}

#[utoipa::path(post,path="/api/v1/fiscal/nfe/{id}/cancel",operation_id="cancel_emitted_nfe",tag="Fiscal",request_body=EventInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,description="Resultado durável do cancelamento"),(status=202,description="Cancelamento sem confirmação")))]
pub async fn cancel(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    value: Result<Json<EventInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let value = super::super::input(value)?;
    validate_text(&value.text, 15, 255)?;
    document_event(
        &state,
        &identity,
        &headers,
        id,
        "cancelamento",
        &value.text,
        None,
    )
    .await
}
#[utoipa::path(post,path="/api/v1/fiscal/nfe/{id}/correction",tag="Fiscal",request_body=EventInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,description="Resultado durável da CC-e"),(status=202,description="Evento sem confirmação")))]
pub async fn correction(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    value: Result<Json<EventInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let value = super::super::input(value)?;
    validate_text(&value.text, 15, 1000)?;
    document_event(
        &state,
        &identity,
        &headers,
        id,
        "correcao",
        &value.text,
        None,
    )
    .await
}

async fn document_event(
    state: &AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    id: Uuid,
    kind: &str,
    text: &str,
    source: Option<Uuid>,
) -> Result<Response, FiscalError> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = normalized.as_str();
    validate_text(text, 15, if kind == "cancelamento" { 255 } else { 1000 })?;
    let (tenant, mut tx, _) = authorized(
        state,
        headers,
        identity,
        "fiscal.nfe.read",
        "fiscal.nfe.issue",
        true,
    )
    .await?;
    let expected = revision(headers)?;
    let key = command_key(headers)?;
    let scope = if kind == "cancelamento" {
        "fiscal.nfe.cancel"
    } else {
        "fiscal.nfe.correction"
    };
    let request =
        json!({"id":id,"revision":expected,"kind":kind,"text":text,"sourceCancellationId":source});
    let previous = replay(&mut tx, tenant, &identity.subject, key, scope, &request).await?;
    let document = load(&mut tx, tenant, id).await?;
    let event = if let Some(previous) = previous {
        let event_id = previous["id"]
            .as_str()
            .and_then(|v| Uuid::parse_str(v).ok())
            .ok_or(access::AccessError::Internal)?;
        let event = load_event(&mut tx, tenant, event_id).await?;
        if event.status == "registered" || event.status == "rejected" || event.busy {
            tx.commit().await.map_err(db)?;
            return Ok(event_reply(&event, tenant));
        }
        event
    } else {
        if document.revision != expected {
            return Err(DomainError::StaleRevision.into());
        }
        if document.status != "authorized" {
            return Err(DomainError::Conflict("Eventos exigem NF-e autorizada").into());
        }
        if document.busy {
            return Err(DomainError::Conflict("Há operação fiscal em andamento").into());
        }
        if sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM fiscal_nfe_events WHERE tenant_id=$1 AND document_id=$2 AND status IN ('pending','unknown'))").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?{return Err(DomainError::Conflict("Reconcilie o evento fiscal pendente repetindo sua chave de idempotência").into());}
        let sequence = if kind == "cancelamento" {
            1
        } else {
            sqlx::query_scalar::<_,i32>("SELECT coalesce(max(sequence),0)+1 FROM fiscal_nfe_events WHERE tenant_id=$1 AND document_id=$2 AND kind='correcao'").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?
        };
        if sequence > 20 {
            return Err(DomainError::Conflict("Limite de vinte CC-e atingido").into());
        }
        if kind=="cancelamento"&&sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM fiscal_nfe_events WHERE tenant_id=$1 AND document_id=$2 AND kind='cancelamento' AND status<>'rejected')").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?{return Err(DomainError::Conflict("Já existe solicitação de cancelamento; repita a chave original").into());}
        let issuer: Value = sqlx::query_scalar(
            "SELECT issuer_snapshot FROM fiscal_nfe_drafts WHERE tenant_id=$1 AND id=$2",
        )
        .bind(tenant)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        let company_tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
            .bind(tenant)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        if issuer["taxId"] != company_tax_id || issuer["profile"]["state"] != "SP" {
            return Err(DomainError::Conflict(
                "Emitente e certificado devem corresponder ao documento em SP",
            )
            .into());
        }
        let event_id = Uuid::now_v7();
        let provider_request = json!({"accessKey":document.access_key,"kind":kind,"sequence":sequence,"text":text,"protocol":document.protocol,"issuedAt":now(),"issuerTaxId":issuer["taxId"],"state":"SP","sourceCancellationId":source});
        sqlx::query("INSERT INTO fiscal_nfe_events(tenant_id,id,document_id,kind,sequence,request) VALUES($1,$2,$3,$4,$5,$6)").bind(tenant).bind(event_id).bind(id).bind(kind).bind(sequence).bind(provider_request).execute(&mut *tx).await.map_err(db)?;
        let event = load_event(&mut tx, tenant, event_id).await?;
        remember(
            &mut tx,
            tenant,
            &identity.subject,
            key,
            scope,
            &request,
            &event.snapshot(tenant),
        )
        .await?;
        record(&mut tx,tenant,identity,headers,DomainChange{kind:"fiscal_event",id:event_id,event:"fiscal.nfe.event.requested",details:json!({"documentId":id,"kind":kind,"sequence":sequence,"sourceCancellationId":source})}).await?;
        event
    };
    engine(state)?;
    let mut body = payload(state, &mut tx, tenant).await?;
    body.as_object_mut()
        .expect("object")
        .extend(event.request.as_object().expect("object").clone());
    body.as_object_mut()
        .expect("object")
        .remove("sourceCancellationId");
    sqlx::query("UPDATE fiscal_nfe_events SET lease_until=clock_timestamp()+interval '120 seconds',status='unknown' WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(event.id).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE fiscal_nfe_documents SET lease_until=clock_timestamp()+interval '120 seconds' WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    if event.status == "unknown" {
        // A prior delivery may have succeeded even though its reply was lost.
        // Recover the authority's receipt before deciding whether any resend is safe.
        let mut consult_body = body.clone();
        consult_body["signedXml"] = json!(document.signed_xml);
        let result=match engine(state)?.call("consult",consult_body).await {
            Ok(consultation)=>consultation["events"].as_array().and_then(|events|events.iter().find(|candidate|candidate["kind"]==event.kind&&candidate["sequence"].as_i64()==Some(i64::from(event.sequence))&&candidate["text"].as_str().is_some_and(|value|value.split_whitespace().eq(text.split_whitespace())))).map(|candidate|{let mut result=candidate.clone();result["registered"]=json!(true);result}).unwrap_or_else(||json!({"code":"event_reconciliation_pending","reason":"Consulta sem recibo correspondente; evento preservado sem retransmissão"})),
            Err(_)=>json!({"code":"event_reconciliation_pending","reason":"Consulta fiscal indisponível; evento preservado sem retransmissão"}),
        };
        return finish_event(state, tenant, event, identity, headers, key, Ok(result)).await;
    }
    let result = engine(state)?.call("event", body).await;
    finish_event(state, tenant, event, identity, headers, key, result).await
}

fn event_reply(event: &Event, tenant: Uuid) -> Response {
    response(
        if matches!(event.status.as_str(), "pending" | "unknown") {
            StatusCode::ACCEPTED
        } else {
            StatusCode::OK
        },
        Some(event.revision),
        event.snapshot(tenant),
    )
}
async fn finish_event(
    state: &AppState,
    tenant: Uuid,
    event: Event,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    key: Uuid,
    result: Result<Value, super::super::engine_client::EngineError>,
) -> Result<Response, FiscalError> {
    let result=result.unwrap_or_else(|_|json!({"code":"transport_uncertain","reason":"Evento sem confirmação; repita a mesma solicitação para reconciliar"}));
    let registered = result["registered"] == true && valid_event_result(&event, &result);
    let status = if registered {
        "registered"
    } else if result["registered"] == false
        && result["code"].as_str().is_some_and(|v| {
            !v.is_empty() && !["108", "109", "128", "136", "573", "999"].contains(&v)
        })
    {
        "rejected"
    } else {
        "unknown"
    };
    let mut saved = safe_result(&result);
    if registered {
        saved["protocol"] = result["protocol"].clone();
        saved["xml"] = result["xml"].clone();
    }
    let mut tx = access::tenant_transaction(state, tenant).await?;
    sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("UPDATE fiscal_nfe_events SET status=$3,result=$4,revision=revision+1,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(event.id).bind(status).bind(&saved).execute(&mut *tx).await.map_err(db)?;
    if let Some(document_id) = event.document_id {
        sqlx::query("UPDATE fiscal_nfe_documents SET status=CASE WHEN $3 THEN 'cancelled' ELSE status END,revision=revision+1,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(document_id).bind(registered&&event.kind=="cancelamento").execute(&mut *tx).await.map_err(db)?;
    }
    let current = load_event(&mut tx, tenant, event.id).await?;
    sqlx::query("UPDATE domain_commands SET result=$4 WHERE tenant_id=$1 AND auth_subject=$2 AND command_key=$3").bind(tenant).bind(&identity.subject).bind(key).bind(current.snapshot(tenant)).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,identity,headers,DomainChange{kind:"fiscal_event",id:event.id,event:"fiscal.nfe.event.reconciled",details:json!({"documentId":event.document_id,"kind":event.kind,"status":status,"sourceCancellationId":event.request["sourceCancellationId"]})}).await?;
    tx.commit().await.map_err(db)?;
    Ok(event_reply(&current, tenant))
}

fn valid_event_result(event: &Event, result: &Value) -> bool {
    let Some(protocol) = result["protocol"]
        .as_str()
        .filter(|v| !v.is_empty() && v.len() <= 30 && v.bytes().all(|b| b.is_ascii_digit()))
    else {
        return false;
    };
    let Some(xml) = result["xml"].as_str().filter(|v| {
        !v.is_empty()
            && v.len() <= 5 * 1024 * 1024
            && !v.contains("<!DOCTYPE")
            && !v.contains("<!ENTITY")
    }) else {
        return false;
    };
    let Ok(document) = roxmltree::Document::parse(xml) else {
        return false;
    };
    let namespace = "http://www.portalfiscal.inf.br/nfe";
    let receipt_name = if event.kind == "inutilizacao" {
        "retInutNFe"
    } else {
        "retEvento"
    };
    let receipts = document
        .descendants()
        .filter(|n| n.has_tag_name((namespace, receipt_name)))
        .collect::<Vec<_>>();
    if receipts.len() != 1 {
        return false;
    }
    let matches = |name: &str, value: &str| {
        receipts[0]
            .descendants()
            .any(|n| n.has_tag_name((namespace, name)) && n.text() == Some(value))
    };
    if !matches("nProt", protocol) || !matches("tpAmb", "2") {
        return false;
    }
    if event.kind == "inutilizacao" {
        matches("CNPJ", event.request["issuerTaxId"].as_str().unwrap_or(""))
            && matches("serie", &event.request["series"].to_string())
            && matches("nNFIni", &event.request["first"].to_string())
            && matches("nNFFin", &event.request["last"].to_string())
            && matches("cStat", "102")
    } else {
        matches("chNFe", event.request["accessKey"].as_str().unwrap_or(""))
            && matches(
                "tpEvento",
                if event.kind == "cancelamento" {
                    "110111"
                } else {
                    "110110"
                },
            )
            && matches("nSeqEvento", &event.sequence.to_string())
            && (matches("cStat", "135") || event.kind == "cancelamento" && matches("cStat", "155"))
    }
}

#[utoipa::path(post,path="/api/v1/fiscal/number-voids",tag="Fiscal",request_body=VoidInput,security(("bearerAuth"=[])),params(("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,description="Inutilização confirmada ou rejeitada"),(status=202,description="Inutilização pendente")))]
pub async fn void_numbers(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    value: Result<Json<VoidInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let value = super::super::input(value)?;
    validate_text(&value.text, 15, 255)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.issue",
        true,
    )
    .await?;
    let expected = super::super::expected_revision(&headers)?;
    let key = command_key(&headers)?;
    let request = serde_json::to_value(&value).map_err(|_| access::AccessError::Internal)?;
    let previous = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.nfe.void",
        &request,
    )
    .await?;
    let event = if let Some(previous) = previous {
        let event = load_event(
            &mut tx,
            tenant,
            previous["id"]
                .as_str()
                .and_then(|v| Uuid::parse_str(v).ok())
                .ok_or(access::AccessError::Internal)?,
        )
        .await?;
        if event.status == "registered" || event.status == "rejected" || event.busy {
            tx.commit().await.map_err(db)?;
            return Ok(event_reply(&event, tenant));
        }
        event
    } else {
        if expected != 0 {
            return Err(DomainError::StaleRevision.into());
        }
        if value.year != OffsetDateTime::now_utc().year()
            || !(1..=999).contains(&value.series)
            || value.first < 1
            || value.last < value.first
            || value.last > 999999999
            || value.last - value.first > 9999
        {
            return Err(DomainError::Invalid(
                "Informe ano atual, série válida e faixa de até dez mil números",
            )
            .into());
        }
        let profile = super::super::load_profile(&mut tx, tenant)
            .await?
            .ok_or(DomainError::Conflict("Configure o perfil fiscal"))?;
        let profile = super::super::profile_data(&profile)?;
        let (_, company) = super::super::issuer(&mut tx, tenant, &profile).await?;
        if profile.state != "SP" || i32::from(profile.series) != value.series {
            return Err(DomainError::Conflict(
                "Inutilização exige série configurada e emitente SP",
            )
            .into());
        }
        if sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM fiscal_nfe_documents WHERE tenant_id=$1 AND series=$2 AND number BETWEEN $3 AND $4)").bind(tenant).bind(value.series).bind(value.first).bind(value.last).fetch_one(&mut *tx).await.map_err(db)?{return Err(DomainError::Conflict("Faixa contém número já atribuído a documento fiscal").into());}
        if sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM fiscal_nfe_events WHERE tenant_id=$1 AND kind='inutilizacao' AND status<>'rejected' AND (request->>'series')::int=$2 AND (request->>'first')::bigint<=$4 AND (request->>'last')::bigint>=$3)").bind(tenant).bind(value.series).bind(value.first).bind(value.last).fetch_one(&mut *tx).await.map_err(db)?{return Err(DomainError::Conflict("Faixa já solicitada; repita a chave original").into());}
        sqlx::query("INSERT INTO fiscal_number_sequences(tenant_id,environment,series,next_number) VALUES($1,'homologation',$2,1) ON CONFLICT DO NOTHING").bind(tenant).bind(value.series).execute(&mut *tx).await.map_err(db)?;
        let next:i64=sqlx::query_scalar("SELECT next_number FROM fiscal_number_sequences WHERE tenant_id=$1 AND environment='homologation' AND series=$2").bind(tenant).bind(value.series).fetch_one(&mut *tx).await.map_err(db)?;
        if value.first > next {
            return Err(DomainError::Conflict(
                "A faixa deve começar na próxima numeração ou cobrir uma lacuna anterior",
            )
            .into());
        }
        // Reserve the range even while SEFAZ is uncertain. A timeout cannot free these numbers.
        sqlx::query("UPDATE fiscal_number_sequences SET next_number=greatest(next_number,$3+1) WHERE tenant_id=$1 AND environment='homologation' AND series=$2").bind(tenant).bind(value.series).bind(value.last).execute(&mut *tx).await.map_err(db)?;
        let event_id = Uuid::now_v7();
        let mut provider = request.clone();
        provider["state"] = json!("SP");
        provider["issuerTaxId"] = json!(company.tax_id);
        provider["issuedAt"] = json!(now());
        sqlx::query("INSERT INTO fiscal_nfe_events(tenant_id,id,kind,sequence,request) VALUES($1,$2,'inutilizacao',1,$3)").bind(tenant).bind(event_id).bind(provider).execute(&mut *tx).await.map_err(db)?;
        let event = load_event(&mut tx, tenant, event_id).await?;
        remember(
            &mut tx,
            tenant,
            &identity.subject,
            key,
            "fiscal.nfe.void",
            &request,
            &event.snapshot(tenant),
        )
        .await?;
        event
    };
    engine(&state)?;
    if event.status == "unknown" {
        tx.commit().await.map_err(db)?;
        return Ok(event_reply(&event, tenant));
    }
    let mut body = payload(&state, &mut tx, tenant).await?;
    body.as_object_mut()
        .expect("object")
        .extend(event.request.as_object().expect("object").clone());
    sqlx::query("UPDATE fiscal_nfe_events SET status='unknown',lease_until=clock_timestamp()+interval '120 seconds' WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(event.id).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"fiscal_event",id:event.id,event:"fiscal.number_void.requested",details:json!({"year":value.year,"series":value.series,"first":value.first,"last":value.last})}).await?;
    tx.commit().await.map_err(db)?;
    let result = engine(&state)?.call("void", body).await;
    finish_event(&state, tenant, event, &identity, &headers, key, result).await
}

#[utoipa::path(get,path="/api/v1/fiscal/nfe/{id}/events",tag="Fiscal",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,description="Eventos persistidos")))]
pub async fn list(
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
    load(&mut tx, tenant, id).await?;
    let ids=sqlx::query_scalar::<_,Uuid>("SELECT id FROM fiscal_nfe_events WHERE tenant_id=$1 AND document_id=$2 ORDER BY created_at,id").bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    let mut data = Vec::new();
    for event_id in ids {
        data.push(
            load_event(&mut tx, tenant, event_id)
                .await?
                .snapshot(tenant),
        );
    }
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data}),
    ))
}

#[utoipa::path(post,path="/api/v1/fiscal/order-cancellations/{id}/process",tag="Fiscal",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,description="Cancelamento fiscal processado"),(status=202,description="Confirmação fiscal pendente")))]
pub async fn process_order_cancellation(
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
    let (order_id, reason): (Uuid, String) = sqlx::query_as(
        "SELECT order_id,reason FROM sales_order_cancellations WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    let documents=sqlx::query_scalar::<_,Uuid>("SELECT id FROM fiscal_nfe_documents WHERE tenant_id=$1 AND source_order_id=$2 AND status<>'rejected'").bind(tenant).bind(order_id).fetch_all(&mut *tx).await.map_err(db)?;
    if documents.len() != 1 {
        return Err(DomainError::Conflict(
            "Pedido exige exatamente um documento fiscal vinculado para processar cancelamento",
        )
        .into());
    }
    validate_text(&reason, 15, 255)?;
    tx.commit().await.map_err(db)?;
    document_event(
        &state,
        &identity,
        &headers,
        documents[0],
        "cancelamento",
        &reason,
        Some(id),
    )
    .await
}
