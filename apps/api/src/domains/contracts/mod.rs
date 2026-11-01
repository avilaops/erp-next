pub mod api;
mod model;
pub mod provider;
mod sync;
pub mod templates;

use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    revision,
};
use crate::platform::{access, auth::AuthenticatedIdentity, state::AppState};
use model::Generate;
use provider::Docuseal;

const READ: &str = "sales.orders.read";
const MANAGE: &str = "sales.orders.manage";
const SEND: &str = "sales.contracts.send";

pub fn routes() -> Router<AppState> {
    Router::new()
        .merge(templates::routes())
        .route("/api/v1/commercial-contracts", get(list).post(generate))
        .route("/api/v1/commercial-contracts/options/{id}", get(options))
        .route("/api/v1/commercial-contracts/{id}", get(detail))
        .route("/api/v1/commercial-contracts/{id}/review", post(review))
        .route("/api/v1/commercial-contracts/{id}/send", post(send))
        .route("/api/v1/commercial-contracts/{id}/sync", post(refresh))
        .route("/api/v1/commercial-contracts/{id}/files/{file}", get(file))
}

fn provider(state: &AppState) -> Result<&Docuseal, DomainError> {
    state.contracts.as_ref().ok_or(DomainError::Conflict(
        "Integração de contratos ainda não configurada para esta instalação",
    ))
}

async fn can_send(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
) -> Result<bool, DomainError> {
    let rights = access::load_access(tx, tenant, &identity.subject).await?;
    Ok(access::require_permission(&rights, SEND).is_ok())
}

#[derive(Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Filter {
    order_id: Option<Uuid>,
    customer_id: Option<Uuid>,
    offset: Option<i64>,
}

#[utoipa::path(get,path="/api/v1/commercial-contracts",operation_id="contracts_list",tag="Sales",security(("bearerAuth"=[])),params(Filter,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=api::ContractList),(status=403,description="Sem permissão")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(filter): Query<Filter>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let offset = filter.offset.unwrap_or(0);
    if !(0..=100000).contains(&offset) {
        return Err(DomainError::Invalid("Página inválida"));
    }
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM commercial_contracts WHERE tenant_id=$1 AND ($2::uuid IS NULL OR order_id=$2) AND ($3::uuid IS NULL OR customer_id=$3)")
        .bind(tenant).bind(filter.order_id).bind(filter.customer_id).fetch_one(&mut *tx).await.map_err(db)?;
    let data: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'orderId',order_id,'customerId',customer_id,'customerName',snapshot->'customer'->>'name','templateName',template_name,'status',status,'problem',problem,'createdAt',created_at,'revision',revision) FROM commercial_contracts WHERE tenant_id=$1 AND ($2::uuid IS NULL OR order_id=$2) AND ($3::uuid IS NULL OR customer_id=$3) ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET $4")
        .bind(tenant).bind(filter.order_id).bind(filter.customer_id).bind(offset).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        api::checked::<api::ContractList>(
            json!({"tenantId":tenant,"canEdit":edit,"data":data,"total":total}),
        )?,
    ))
}

#[utoipa::path(get,path="/api/v1/commercial-contracts/options/{id}",operation_id="contracts_options",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=api::ContractOptions),(status=403,description="Sem permissão")))]
pub async fn options(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let snapshot = model::snapshot(&mut tx, tenant, id).await?;
    let published_revisions: Vec<(i64,i64)> = sqlx::query_as("SELECT external_id,draft_revision FROM commercial_template_versions WHERE tenant_id=$1 AND external_id IS NOT NULL").bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    let ids = if let Some(provider) = &state.contracts {
        templates::publish::template_ids(&mut tx, tenant, provider).await?
    } else {
        Vec::new()
    };
    tx.commit().await.map_err(db)?;
    let mut templates = Vec::new();
    let configured = !ids.is_empty();
    if let Some(provider) = &state.contracts {
        for id in ids {
            let template = provider
                .request(Method::GET, &format!("templates/{id}"), None)
                .await?;
            if !template["archived_at"].is_null() {
                continue;
            }
            let name = if let Some((_, revision)) = published_revisions
                .iter()
                .find(|(external, _)| *external == id)
            {
                format!(
                    "{} · revisão {revision} (ERP)",
                    template["name"].as_str().unwrap_or("Modelo")
                )
            } else {
                template["name"].as_str().unwrap_or("Modelo").to_owned()
            };
            templates.push(json!({"id":id,"name":name,"updatedAt":template["updated_at"],"roles":template["submitters"],"fields":model::editable_fields(&template)}));
        }
    }
    Ok(response(
        StatusCode::OK,
        None,
        api::checked::<api::ContractOptions>(
            json!({"tenantId":tenant,"canEdit":edit,"configured":configured,"emailReady":state.contracts.as_ref().is_some_and(Docuseal::email_ready),"defaults":model::defaults(&snapshot),"snapshot":snapshot,"templates":templates}),
        )?,
    ))
}

#[utoipa::path(get,path="/api/v1/commercial-contracts/{id}",operation_id="contracts_detail",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=api::ContractDetail),(status=404,description="Contrato não encontrado")))]
pub async fn detail(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let send = can_send(&mut tx, tenant, &identity).await?;
    let result = sync::detail(
        &mut tx,
        tenant,
        id,
        edit,
        send,
        state.contracts.as_ref().is_some_and(Docuseal::email_ready),
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(result)
}

#[utoipa::path(post,path="/api/v1/commercial-contracts",operation_id="contracts_generate",tag="Sales",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),request_body=Generate,responses((status=200,body=api::ContractDetail),(status=409,description="Contrato em conferência"),(status=422,description="Campos inválidos")))]
pub async fn generate(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Json(mut input): Json<Generate>,
) -> Result<Response, DomainError> {
    let provider = provider(&state)?;
    let key = command_key(&headers)?;
    let original =
        serde_json::to_value(&input).map_err(|_| DomainError::Invalid("Contrato inválido"))?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "contract.generate",
        &original,
    )
    .await?
    {
        let id = previous["id"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .ok_or(DomainError::NotFound)?;
        tx.commit().await.map_err(db)?;
        return reconcile_response(&state, &identity, &headers, tenant, id).await;
    }
    if !templates::publish::template_ids(&mut tx, tenant, provider)
        .await?
        .contains(&input.template_id)
    {
        return Err(access::AccessError::Forbidden.into());
    }
    let snapshot = model::snapshot(&mut tx, tenant, input.order_id).await?;
    let template = provider
        .request(
            Method::GET,
            &format!("templates/{}", input.template_id),
            None,
        )
        .await?;
    if !template["archived_at"].is_null() {
        return Err(DomainError::Conflict("Modelo arquivado"));
    }
    model::validate(&mut input, &template, &snapshot)?;
    let fingerprint = model::digest(
        json!({"request":input,"snapshot":snapshot})
            .to_string()
            .as_bytes(),
    );
    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM commercial_contracts WHERE tenant_id=$1 AND fingerprint=$2",
    )
    .bind(tenant)
    .bind(&fingerprint)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?;
    let id = existing.unwrap_or_else(Uuid::now_v7);
    if existing.is_none() {
        let customer: Uuid = snapshot["customer"]["id"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .ok_or(DomainError::NotFound)?;
        sqlx::query("INSERT INTO commercial_contracts(id,tenant_id,customer_id,order_id,template_id,template_name,template_snapshot,snapshot,recipients,fields,fingerprint,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'creation_requested')")
            .bind(id).bind(tenant).bind(customer).bind(input.order_id).bind(input.template_id).bind(template["name"].as_str().unwrap_or("Contrato"))
            .bind(&template).bind(snapshot).bind(json!(input.recipients)).bind(json!(input.fields)).bind(fingerprint).execute(&mut *tx).await.map_err(db)?;
        record(
            &mut tx,
            tenant,
            &identity,
            &headers,
            DomainChange {
                kind: "commercial_contract",
                id,
                event: "contract.generation_requested",
                details: json!({"orderId":input.order_id,"templateId":input.template_id}),
            },
        )
        .await?;
    }
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "contract.generate",
        &original,
        &json!({"id":id}),
    )
    .await?;
    let contract = model::load(&mut tx, tenant, id).await?;
    // Commit the dispatch claim BEFORE network I/O. A timeout, crash or repeated
    // command may only reconcile this correlation, never POST it again.
    tx.commit().await.map_err(db)?;
    if existing.is_none() {
        let _ = provider
            .request(
                Method::POST,
                "submissions",
                Some(&model::submission_body(&contract)),
            )
            .await;
    }
    reconcile_response(&state, &identity, &headers, tenant, id).await
}

async fn reconcile_response(
    state: &AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    tenant: Uuid,
    id: Uuid,
) -> Result<Response, DomainError> {
    let (_, mut tx, edit) = authorized(state, headers, identity, READ, MANAGE, false).await?;
    let contract = model::load(&mut tx, tenant, id).await?;
    if let Err(error) = sync::reconcile(&mut tx, &contract, provider(state)?).await {
        // Database errors abort the transaction and must not masquerade as a
        // persisted provider warning. The caller can safely repeat reconciliation.
        if matches!(error, DomainError::Access(_)) {
            return Err(error);
        }
        let message = match error {
            DomainError::Conflict(message) => message,
            _ => "Não foi possível atualizar o andamento",
        };
        sqlx::query("UPDATE commercial_contracts SET problem=$3 WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(id)
            .bind(message)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    let send = can_send(&mut tx, tenant, identity).await?;
    let result = sync::detail(
        &mut tx,
        tenant,
        id,
        edit,
        send,
        state.contracts.as_ref().is_some_and(Docuseal::email_ready),
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(result)
}

#[utoipa::path(post,path="/api/v1/commercial-contracts/{id}/sync",operation_id="contracts_sync",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),request_body=Value,responses((status=200,body=api::ContractDetail)))]
pub async fn refresh(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(_): Json<Value>,
) -> Result<Response, DomainError> {
    let tenant = access::tenant_id(&headers)?;
    reconcile_response(&state, &identity, &headers, tenant, id).await
}

#[utoipa::path(post,path="/api/v1/commercial-contracts/{id}/review",operation_id="contracts_review",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),request_body=Value,responses((status=200,body=api::ContractDetail),(status=412,description="Revisão desatualizada")))]
pub async fn review(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(_): Json<Value>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if !can_send(&mut tx, tenant, &identity).await? {
        return Err(access::AccessError::Forbidden.into());
    }
    let request = json!({"id":id,"revision":revision(&headers)?});
    let replayed = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "contract.review",
        &request,
    )
    .await?
    .is_some();
    let contract = model::load(&mut tx, tenant, id).await?;
    if !replayed {
        if contract.revision != revision(&headers)? {
            return Err(DomainError::StaleRevision);
        }
        if contract.status != "created" || contract.problem.is_some() {
            return Err(DomainError::Conflict(
                "A prévia precisa estar disponível e sem pendências antes da revisão",
            ));
        }
        let previews: i64 = sqlx::query_scalar("SELECT count(*) FROM commercial_contract_files WHERE tenant_id=$1 AND contract_id=$2 AND kind='preview'").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
        if previews == 0 {
            return Err(DomainError::Conflict("Aguarde a prévia do documento"));
        }
        sqlx::query("UPDATE commercial_contracts SET status='reviewed',reviewed_by=$3,reviewed_at=now(),revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2")
            .bind(tenant).bind(id).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
        record(
            &mut tx,
            tenant,
            &identity,
            &headers,
            DomainChange {
                kind: "commercial_contract",
                id,
                event: "contract.reviewed",
                details: request.clone(),
            },
        )
        .await?;
        remember(
            &mut tx,
            tenant,
            &identity.subject,
            key,
            "contract.review",
            &request,
            &json!({"id":id}),
        )
        .await?;
    }
    let result = sync::detail(
        &mut tx,
        tenant,
        id,
        true,
        true,
        state.contracts.as_ref().is_some_and(Docuseal::email_ready),
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(result)
}

async fn ensure_active_order(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<(), DomainError> {
    let status: String =
        sqlx::query_scalar("SELECT status FROM sales_orders WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(order)
            .fetch_optional(&mut **tx)
            .await
            .map_err(db)?
            .ok_or(DomainError::NotFound)?;
    if status == "cancelled" {
        return Err(DomainError::Conflict(
            "O pedido foi cancelado; o contrato não pode ser enviado",
        ));
    }
    Ok(())
}

#[utoipa::path(post,path="/api/v1/commercial-contracts/{id}/send",operation_id="contracts_send",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),request_body=Value,responses((status=200,body=api::ContractDetail),(status=409,description="Revisão necessária"),(status=403,description="Sem permissão de envio")))]
pub async fn send(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(_): Json<Value>,
) -> Result<Response, DomainError> {
    let provider = provider(&state)?;
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if !can_send(&mut tx, tenant, &identity).await? {
        return Err(access::AccessError::Forbidden.into());
    }
    let request = json!({"id":id,"revision":revision(&headers)?});
    let previous = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "contract.send",
        &request,
    )
    .await?;
    let contract = model::load(&mut tx, tenant, id).await?;
    if previous.is_some() || contract.send_requested_at.is_some() {
        ensure_active_order(&mut tx, tenant, contract.order_id).await?;
        tx.commit().await.map_err(db)?;
        return reconcile_response(&state, &identity, &headers, tenant, id).await;
    }
    if contract.revision != revision(&headers)? {
        return Err(DomainError::StaleRevision);
    }
    if contract.status != "reviewed" {
        return Err(DomainError::Conflict(
            "Revise o documento e os destinatários antes do envio",
        ));
    }
    ensure_active_order(&mut tx, tenant, contract.order_id).await?;
    // The portal silently uses a test mailer when SMTP is absent.
    // Only explicitly validated email configuration may initiate invitations.
    if !provider.email_ready() {
        return Err(DomainError::Conflict(
            "O envio de e-mail do portal ainda não foi validado. A prévia e a revisão continuam disponíveis",
        ));
    }
    // Recheck provider ownership and state before claiming transmission.
    sync::reconcile(&mut tx, &contract, provider).await?;
    let contract = model::load(&mut tx, tenant, id).await?;
    if contract.status != "reviewed" || contract.problem.is_some() {
        return Err(DomainError::Conflict(
            "O estado mudou no provedor. Confira o andamento antes do envio",
        ));
    }
    sync::verify_preview(&mut tx, &contract, provider).await?;
    sqlx::query("UPDATE commercial_contracts SET status='send_requested',send_requested_at=now(),revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "contract.send",
        &request,
        &json!({"id":id}),
    )
    .await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "commercial_contract",
            id,
            event: "contract.send_requested",
            details: json!({"externalId":contract.external_id}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    for recipient in contract.progress.as_array().into_iter().flatten() {
        let recipient_id = recipient["id"].as_i64().ok_or_else(provider::unavailable)?;
        // Exactly one dispatch attempt. Even a non-2xx response can follow an
        // accepted request; the next action is reconciliation, never blind retry.
        let _ = provider
            .request(
                Method::PUT,
                &format!("submitters/{recipient_id}"),
                Some(&json!({"send_email":true})),
            )
            .await;
    }
    reconcile_response(&state, &identity, &headers, tenant, id).await
}

#[utoipa::path(get,path="/api/v1/commercial-contracts/{id}/files/{file}",operation_id="contracts_file",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("file"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,description="PDF privado preservado"),(status=404,description="Documento não encontrado")))]
pub async fn file(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path((id, file)): Path<(Uuid, Uuid)>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let content: Vec<u8> = sqlx::query_scalar("SELECT content FROM commercial_contract_files WHERE tenant_id=$1 AND contract_id=$2 AND id=$3")
        .bind(tenant).bind(id).bind(file).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/pdf"),
            (header::CACHE_CONTROL, "no-store"),
            (header::CONTENT_DISPOSITION, "inline; filename=contrato.pdf"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        content,
    )
        .into_response())
}

#[utoipa::path(post,path="/api/v1/webhooks/contracts/{tenant}",operation_id="contracts_webhook",tag="Sales",params(("tenant"=Uuid,Path),("X-Avila-Contract-Secret"=String,Header)),request_body=Value,responses((status=204,description="Evento reconciliado"),(status=403,description="Segredo inválido"),(status=503,description="Repetir evento mais tarde")))]
pub async fn webhook(
    State(state): State<AppState>,
    Path(tenant): Path<Uuid>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Response, DomainError> {
    let provider = provider(&state)?;
    if !provider.verify_webhook(
        headers
            .get("x-avila-contract-secret")
            .and_then(|s| s.to_str().ok())
            .unwrap_or(""),
    ) {
        return Err(access::AccessError::Forbidden.into());
    }
    let kind = payload["event_type"]
        .as_str()
        .filter(|s| s.starts_with("submission.") || s.starts_with("form."))
        .ok_or(DomainError::Invalid("Evento inválido"))?;
    let external = if kind.starts_with("submission.") {
        payload["data"]["id"].as_i64()
    } else {
        payload["data"]["submission_id"]
            .as_i64()
            .or_else(|| payload["data"]["submission"]["id"].as_i64())
    }
    .ok_or(DomainError::Invalid("Solicitação ausente"))?;
    let mut tx = access::tenant_transaction(&state, tenant).await?;
    let id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM commercial_contracts WHERE tenant_id=$1 AND external_id=$2",
    )
    .bind(tenant)
    .bind(external)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?;
    // A creation webhook can arrive before the creation response is reconciled.
    // Returning 503 asks the provider to retry; it never creates a new contract.
    let Some(id) = id else {
        return Ok((
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::RETRY_AFTER, "30")],
        )
            .into_response());
    };
    let digest = model::digest(payload.to_string().as_bytes());
    let contract = model::load(&mut tx, tenant, id).await?;
    let duplicate: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM commercial_contract_webhooks WHERE tenant_id=$1 AND contract_id=$2 AND digest=$3)").bind(tenant).bind(id).bind(&digest).fetch_one(&mut *tx).await.map_err(db)?;
    if !duplicate {
        // Ignore event ordering and claims: fetch the current authenticated state.
        if sync::reconcile(&mut tx, &contract, provider).await.is_err() {
            return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
        sqlx::query("INSERT INTO commercial_contract_webhooks(tenant_id,contract_id,digest,event_type) VALUES($1,$2,$3,$4)").bind(tenant).bind(id).bind(digest).bind(kind).execute(&mut *tx).await.map_err(db)?;
    }
    tx.commit().await.map_err(db)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

