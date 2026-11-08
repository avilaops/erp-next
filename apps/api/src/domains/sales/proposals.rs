#[path = "proposal_email.rs"]
pub mod email;

use super::proposal_rules as rules;
use crate::domains::{
    DomainChange, DomainError, authorized, catalog, command_key, db, decimal, fixed, record,
    remember, replay, response, revision,
};
use crate::platform::{access::AccessError, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

const READ: &str = "sales.proposals.read";
const MANAGE: &str = "sales.proposals.manage";

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposalItemInput {
    product_id: Uuid,
    quantity: String,
    unit_price: Option<String>,
    structure_color: Option<String>,
    upholstery_color: Option<String>,
    /// Campo legado: armColor representa a cor dos anilheiros.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    arm_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plate_holder_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plate_holder_type: Option<String>,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposalInput {
    customer_id: Uuid,
    valid_until: String,
    payment_terms: String,
    delivery_terms: String,
    notes: String,
    items: Vec<ProposalItemInput>,
}

impl ProposalInput {
    fn normalize_legacy_component_colors(&mut self) -> Result<(), DomainError> {
        for item in &mut self.items {
            let Some(legacy) = item.arm_color.take() else {
                continue;
            };
            if item
                .plate_holder_color
                .as_deref()
                .is_some_and(|current| !current.trim().eq_ignore_ascii_case(legacy.trim()))
            {
                return Err(DomainError::Invalid(
                    "Informe a cor dos anilheiros apenas em plateHolderColor",
                ));
            }
            if item.plate_holder_color.is_none() {
                item.plate_holder_color = Some(legacy);
            }
        }
        Ok(())
    }
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposalSummary {
    id: Uuid,
    number: String,
    version: i32,
    revision: i64,
    customer_id: Uuid,
    customer_name: String,
    customer_tax_id: String,
    valid_until: String,
    payment_terms: String,
    delivery_terms: String,
    notes: String,
    amount: String,
    status: String,
    expired: bool,
    order_id: Option<Uuid>,
    is_current: bool,
    created_at: String,
    sent_at: Option<String>,
    decided_at: Option<String>,
    decided_by: Option<String>,
    decision_reason: Option<String>,
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLine {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    quantity: String,
    unit_price: String,
    catalog_price: String,
    amount: String,
    structure_color: Option<String>,
    upholstery_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plate_holder_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plate_holder_type: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposalSnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: ProposalSummary,
    items: Vec<ProposalLine>,
    versions: Vec<ProposalSummary>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposalList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<ProposalSummary>,
    total: i64,
    offset: u32,
    limit: u32,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct ProposalQuery {
    offset: Option<u32>,
    limit: Option<u32>,
    q: Option<String>,
    status: Option<String>,
}

const SUMMARY: &str = "SELECT p.id,p.number::text AS number,v.version,p.revision,v.customer_id,v.customer_name,v.customer_tax_id,v.valid_until::text AS valid_until,v.payment_terms,v.delivery_terms,v.notes,(v.amount_cents::numeric/100)::numeric(16,2)::text AS amount,v.status,(v.status='sent' AND v.valid_until < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) AS expired,p.order_id,(v.version=p.current_version) AS is_current,v.created_at::text AS created_at,v.sent_at::text AS sent_at,v.decided_at::text AS decided_at,v.decided_by,v.decision_reason FROM sales_proposals p JOIN sales_proposal_versions v ON v.tenant_id=p.tenant_id AND v.proposal_id=p.id";

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    can_edit: bool,
) -> Result<ProposalSnapshot, DomainError> {
    load_version(tx, tenant, id, can_edit, None).await
}

async fn load_version(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    can_edit: bool,
    version: Option<i32>,
) -> Result<ProposalSnapshot, DomainError> {
    let data = sqlx::query_as::<_, ProposalSummary>(&format!(
        "{SUMMARY} WHERE p.tenant_id=$1 AND p.id=$2 AND v.version=COALESCE($3,p.current_version)"
    ))
    .bind(tenant)
    .bind(id)
    .bind(version)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    let items = sqlx::query_as::<_, ProposalLine>("SELECT product_id,sku,name,unit,(quantity_micros::numeric/1000000)::numeric(19,6)::text AS quantity,(price_cents::numeric/100)::numeric(16,2)::text AS unit_price,(catalog_price_cents::numeric/100)::numeric(16,2)::text AS catalog_price,(amount_cents::numeric/100)::numeric(16,2)::text AS amount,structure_color,upholstery_color,plate_holder_color,plate_holder_type FROM sales_proposal_lines WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3 ORDER BY line_number")
        .bind(tenant).bind(id).bind(data.version).fetch_all(&mut **tx).await.map_err(db)?;
    let versions = sqlx::query_as::<_, ProposalSummary>(&format!(
        "{SUMMARY} WHERE p.tenant_id=$1 AND p.id=$2 ORDER BY v.version DESC"
    ))
    .bind(tenant)
    .bind(id)
    .fetch_all(&mut **tx)
    .await
    .map_err(db)?;
    Ok(ProposalSnapshot {
        tenant_id: tenant,
        can_edit,
        data,
        items,
        versions,
    })
}

#[utoipa::path(get,path="/api/v1/proposals",tag="Sales",security(("bearerAuth"=[])),params(ProposalQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ProposalList),(status=403,description="Sem permissão")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<ProposalQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let Query(query) = query.map_err(|_| DomainError::Invalid("Filtros inválidos"))?;
    let (offset, limit) = super::page(super::OrderQuery {
        offset: query.offset,
        limit: query.limit,
    })?;
    let search = rules::text(query.q.as_deref().unwrap_or(""), 160, false)?;
    let status = query.status.unwrap_or_default();
    if ![
        "",
        "draft",
        "sent",
        "accepted",
        "rejected",
        "cancelled",
        "expired",
    ]
    .contains(&status.as_str())
    {
        return Err(DomainError::Invalid("Situação inválida"));
    }
    let filter = " WHERE p.tenant_id=$1 AND v.version=p.current_version AND ($2='' OR strpos(lower(v.customer_name),lower($2))>0 OR p.number::text=$2) AND ($3='' OR ($3='expired' AND v.status='sent' AND v.valid_until < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) OR (v.status=$3 AND ($3<>'sent' OR v.valid_until >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)))";
    let total: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM ({SUMMARY}{filter}) filtered"
    ))
    .bind(tenant)
    .bind(&search)
    .bind(&status)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    let data = sqlx::query_as::<_, ProposalSummary>(&format!(
        "{SUMMARY}{filter} ORDER BY p.created_at DESC,p.id DESC LIMIT $4 OFFSET $5"
    ))
    .bind(tenant)
    .bind(search)
    .bind(status)
    .bind(i64::from(limit))
    .bind(i64::from(offset))
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        ProposalList {
            tenant_id: tenant,
            can_edit,
            data,
            total,
            offset,
            limit,
        },
    ))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct ProposalVersionQuery {
    version: Option<i32>,
}

#[utoipa::path(get,path="/api/v1/proposals/{id}",tag="Sales",security(("bearerAuth"=[])),params(ProposalVersionQuery,("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ProposalSnapshot),(status=404,description="Proposta não encontrada")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    query: Result<Query<ProposalVersionQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let Query(query) = query.map_err(|_| DomainError::Invalid("Versão inválida"))?;
    if query.version.is_some_and(|value| value < 1) {
        return Err(DomainError::Invalid("Versão inválida"));
    }
    let value = load_version(&mut tx, tenant, id, can_edit, query.version).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(value.data.revision), value))
}

struct PreparedLine {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    quantity: i64,
    price: i64,
    catalog_price: i64,
    amount: i64,
    structure_color: Option<String>,
    upholstery_color: Option<String>,
    plate_holder_color: Option<String>,
    plate_holder_type: Option<String>,
}

#[utoipa::path(post,path="/api/v1/proposals/{id}/revise",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=ProposalSnapshot),(status=409,description="Revisão não permitida"),(status=412,description="Versão divergente")))]
pub async fn revise(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let request = serde_json::json!({"id":id,"revision":expected});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "proposal.revised",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(
            StatusCode::OK,
            previous["data"]["revision"].as_i64(),
            previous,
        ));
    }
    let current = load(&mut tx, tenant, id, true).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    let today: time::Date =
        sqlx::query_scalar("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date")
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
    rules::transition(
        &current.data.status,
        rules::Action::Revise,
        super::date(&current.data.valid_until)?,
        today,
        current.data.order_id.is_some(),
    )?;
    let next_version = current
        .data
        .version
        .checked_add(1)
        .ok_or(DomainError::Conflict("Limite de versões atingido"))?;
    sqlx::query("INSERT INTO sales_proposal_versions(tenant_id,proposal_id,version,customer_id,customer_name,customer_tax_id,valid_until,payment_terms,delivery_terms,notes,amount_cents,created_by) SELECT tenant_id,proposal_id,$4,customer_id,customer_name,customer_tax_id,valid_until,payment_terms,delivery_terms,notes,amount_cents,$5 FROM sales_proposal_versions WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3")
        .bind(tenant).bind(id).bind(current.data.version).bind(next_version).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO sales_proposal_lines(tenant_id,proposal_id,version,line_number,product_id,sku,name,unit,quantity_micros,catalog_price_cents,price_cents,amount_cents,structure_color,upholstery_color,plate_holder_color,plate_holder_type) SELECT tenant_id,proposal_id,$4,line_number,product_id,sku,name,unit,quantity_micros,catalog_price_cents,price_cents,amount_cents,structure_color,upholstery_color,plate_holder_color,plate_holder_type FROM sales_proposal_lines WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3")
        .bind(tenant).bind(id).bind(current.data.version).bind(next_version).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE sales_proposal_versions SET status='superseded' WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3")
        .bind(tenant).bind(id).bind(current.data.version).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE sales_proposals SET current_version=$3,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).bind(next_version).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "sales_proposal", id, event: "proposal.revised", details: serde_json::json!({"version":next_version,"revision":expected+1,"previousVersion":current.data.version}) }).await?;
    let value = serde_json::to_value(load(&mut tx, tenant, id, true).await?)
        .map_err(|_| AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "proposal.revised",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(expected + 1), value))
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposalConversion {
    due_date: String,
}

#[utoipa::path(post,path="/api/v1/proposals/{id}/convert",tag="Sales",request_body=ProposalConversion,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=ProposalSnapshot),(status=403,description="Exige gestão de propostas e pedidos"),(status=409,description="Conversão não permitida"),(status=412,description="Versão divergente")))]
pub async fn convert(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ProposalConversion>, JsonRejection>,
) -> Result<Response, DomainError> {
    convert_command(state, identity, headers, id, payload, false).await
}

#[utoipa::path(post,path="/api/v1/proposals/{id}/approve-order",tag="Sales",request_body=ProposalConversion,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=ProposalSnapshot),(status=403,description="Exige aprovação e gestão de propostas e pedidos"),(status=409,description="Aprovação não permitida"),(status=412,description="Versão divergente")))]
pub async fn approve_order(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ProposalConversion>, JsonRejection>,
) -> Result<Response, DomainError> {
    convert_command(state, identity, headers, id, payload, true).await
}

async fn convert_command(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Uuid,
    payload: Result<Json<ProposalConversion>, JsonRejection>,
    approve: bool,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let rights = crate::platform::access::load_access(&mut tx, tenant, &identity.subject).await?;
    if approve {
        crate::platform::access::require_permission(&rights, "sales.proposals.decide")?;
    }
    crate::platform::access::require_permission(&rights, "sales.orders.read")?;
    crate::platform::access::require_permission(&rights, "sales.orders.manage")?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let due = super::date(&input.due_date)?;
    let event = if approve {
        "proposal.approved_order"
    } else {
        "proposal.converted"
    };
    let request = serde_json::json!({"id":id,"revision":expected,"dueDate":input.due_date});
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, event, &request).await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(
            StatusCode::OK,
            previous["data"]["revision"].as_i64(),
            previous,
        ));
    }
    let current = load(&mut tx, tenant, id, true).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    let today: time::Date =
        sqlx::query_scalar("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date")
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
    rules::transition(
        &current.data.status,
        if approve {
            rules::Action::ApproveConvert
        } else {
            rules::Action::Convert
        },
        super::date(&current.data.valid_until)?,
        today,
        current.data.order_id.is_some(),
    )?;
    // Do not silently change agreed snapshots to current catalog prices or colors.
    // Inactive customers/products and changed units require commercial review.
    let customer_active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM parties WHERE tenant_id=$1 AND id=$2 AND status='active' AND is_customer)")
        .bind(tenant).bind(current.data.customer_id).fetch_one(&mut *tx).await.map_err(db)?;
    let invalid_products: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sales_proposal_lines l JOIN products p ON p.tenant_id=l.tenant_id AND p.id=l.product_id WHERE l.tenant_id=$1 AND l.proposal_id=$2 AND l.version=$3 AND (p.status<>'active' OR p.unit<>l.unit))")
        .bind(tenant).bind(id).bind(current.data.version).fetch_one(&mut *tx).await.map_err(db)?;
    if !customer_active || invalid_products {
        return Err(DomainError::Conflict(
            "Cliente ou produtos mudaram; revise os cadastros antes de converter",
        ));
    }
    if approve && current.data.status != "accepted" {
        sqlx::query("UPDATE sales_proposal_versions SET status='accepted',sent_at=COALESCE(sent_at,now()),decided_at=now(),decided_by=$4,decision_reason='Aprovação e criação de pedido' WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3")
            .bind(tenant).bind(id).bind(current.data.version).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
        record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "sales_proposal", id, event: "proposal.accepted", details: serde_json::json!({"version":current.data.version,"revision":expected+1,"from":current.data.status,"to":"accepted","approvalAndOrder":true}) }).await?;
    }
    let order = Uuid::now_v7();
    sqlx::query("INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) SELECT $4,tenant_id,customer_id,customer_name,customer_tax_id,$5,amount_cents,'draft' FROM sales_proposal_versions WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3")
        .bind(tenant).bind(id).bind(current.data.version).bind(order).bind(due).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO sales_order_lines(tenant_id,order_id,line_number,product_id,sku,name,unit,quantity_micros,price_cents,amount_cents,structure_color,upholstery_color,plate_holder_color,plate_holder_type) SELECT tenant_id,$4,line_number,product_id,sku,name,unit,quantity_micros,price_cents,amount_cents,structure_color,upholstery_color,plate_holder_color,plate_holder_type FROM sales_proposal_lines WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3")
        .bind(tenant).bind(id).bind(current.data.version).bind(order).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE sales_proposals SET order_id=$3,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).bind(order).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "sales_order", id: order, event: "order.created", details: serde_json::json!({"proposalId":id,"proposalVersion":current.data.version,"revision":1}) }).await?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "sales_proposal", id, event, details: serde_json::json!({"version":current.data.version,"revision":expected+1,"orderId":order}) }).await?;
    let value = serde_json::to_value(load(&mut tx, tenant, id, true).await?)
        .map_err(|_| AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        event,
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(expected + 1), value))
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposalDecision {
    reason: Option<String>,
}

#[utoipa::path(post,path="/api/v1/proposals/{id}/{action}",tag="Sales",request_body=ProposalDecision,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("action"=String,Path,description="send, accept, reject ou cancel"),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=ProposalSnapshot),(status=403,description="Sem permissão"),(status=409,description="Transição não permitida"),(status=412,description="Versão divergente")))]
pub async fn decide(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path((id, action)): Path<(Uuid, String)>,
    payload: Result<Json<ProposalDecision>, JsonRejection>,
) -> Result<Response, DomainError> {
    let action = match action.as_str() {
        "send" => rules::Action::Send,
        "accept" => rules::Action::Accept,
        "reject" => rules::Action::Reject,
        "cancel" => rules::Action::Cancel,
        _ => return Err(DomainError::NotFound),
    };
    let permission = if matches!(action, rules::Action::Accept | rules::Action::Reject) {
        "sales.proposals.decide"
    } else {
        MANAGE
    };
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, READ, permission, true).await?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let reason = rules::text(
        input.reason.as_deref().unwrap_or(""),
        2000,
        matches!(action, rules::Action::Reject | rules::Action::Cancel),
    )?;
    let event = match action {
        rules::Action::Send => "proposal.sent",
        rules::Action::Accept => "proposal.accepted",
        rules::Action::Reject => "proposal.rejected",
        rules::Action::Cancel => "proposal.cancelled",
        _ => unreachable!(),
    };
    let request = serde_json::json!({"id":id,"revision":expected,"reason":reason});
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, event, &request).await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(
            StatusCode::OK,
            previous["data"]["revision"].as_i64(),
            previous,
        ));
    }
    let current = load(&mut tx, tenant, id, false).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    let today: time::Date =
        sqlx::query_scalar("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date")
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
    let next = rules::transition(
        &current.data.status,
        action,
        super::date(&current.data.valid_until)?,
        today,
        current.data.order_id.is_some(),
    )?;
    sqlx::query("UPDATE sales_proposal_versions SET status=$4,sent_at=CASE WHEN $4='sent' THEN now() ELSE sent_at END,decided_at=CASE WHEN $4<>'sent' THEN now() ELSE decided_at END,decided_by=CASE WHEN $4<>'sent' THEN $5 ELSE decided_by END,decision_reason=CASE WHEN $4<>'sent' THEN $6 ELSE decision_reason END WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3")
        .bind(tenant).bind(id).bind(current.data.version).bind(next).bind(&identity.subject).bind(reason).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE sales_proposals SET revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "sales_proposal", id, event, details: serde_json::json!({"version":current.data.version,"revision":expected+1,"from":current.data.status,"to":next}) }).await?;
    let rights = crate::platform::access::load_access(&mut tx, tenant, &identity.subject).await?;
    let can_edit = crate::platform::access::require_permission(&rights, MANAGE).is_ok();
    let value = serde_json::to_value(load(&mut tx, tenant, id, can_edit).await?)
        .map_err(|_| AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        event,
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(expected + 1), value))
}

#[utoipa::path(post,path="/api/v1/proposals",tag="Sales",request_body=ProposalInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=ProposalSnapshot),(status=403,description="Sem permissão"),(status=422,description="Proposta inválida")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<ProposalInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    save_draft(state, identity, headers, None, payload).await
}

#[utoipa::path(put,path="/api/v1/proposals/{id}",tag="Sales",request_body=ProposalInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=ProposalSnapshot),(status=409,description="Somente rascunhos podem ser editados"),(status=412,description="Versão divergente")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ProposalInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    save_draft(state, identity, headers, Some(id), payload).await
}

async fn save_draft(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    existing_id: Option<Uuid>,
    payload: Result<Json<ProposalInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = existing_id.map(|_| revision(&headers)).transpose()?;
    let scope = if existing_id.is_some() {
        "proposal.update"
    } else {
        "proposal.create"
    };
    let status = if existing_id.is_some() {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    input.normalize_legacy_component_colors()?;
    let request = serde_json::json!({"id":existing_id,"revision":expected,"input":input});
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, scope, &request).await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(
            status,
            previous["data"]["revision"].as_i64(),
            previous,
        ));
    }
    let previous = match existing_id {
        Some(id) => {
            let value = load(&mut tx, tenant, id, true).await?;
            if Some(value.data.revision) != expected {
                return Err(DomainError::StaleRevision);
            }
            if value.data.status != "draft" || value.data.order_id.is_some() {
                return Err(DomainError::Conflict(
                    "Somente rascunhos podem ser editados",
                ));
            }
            Some(value)
        }
        None => None,
    };
    let validity = super::date(&input.valid_until)?;
    let payment = rules::text(&input.payment_terms, 2000, true)?;
    let delivery = rules::text(&input.delivery_terms, 2000, true)?;
    let notes = rules::text(&input.notes, 10000, false)?;
    if input.items.is_empty() || input.items.len() > 100 {
        return Err(DomainError::Invalid("Proposta exige de 1 a 100 itens"));
    }
    let customer = sqlx::query_as::<_, (String, String)>("SELECT legal_name,tax_id FROM parties WHERE tenant_id=$1 AND id=$2 AND is_customer AND status='active'")
        .bind(tenant).bind(input.customer_id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::Conflict("Selecione um cliente ativo desta empresa"))?;
    let mut seen = std::collections::HashSet::new();
    let mut lines = Vec::new();
    for item in &input.items {
        if !seen.insert(item.product_id) {
            return Err(DomainError::Invalid(
                "Agrupe a quantidade de cada produto em um único item",
            ));
        }
        let product = catalog::load(&mut tx, tenant, item.product_id).await?;
        let saved = previous.as_ref().and_then(|value| {
            value
                .items
                .iter()
                .find(|line| line.product_id == item.product_id)
        });
        if saved.is_some_and(|line| line.unit != product.data.unit) {
            return Err(DomainError::Conflict(
                "Unidade do produto mudou; revise o item",
            ));
        }
        if product.data.status != "active" {
            return Err(DomainError::Conflict(
                "Selecione produtos ativos desta empresa",
            ));
        }
        let structure_color = super::select_color(
            item.structure_color.as_deref(),
            product.data.structure_colors.as_deref().unwrap_or_default(),
            saved.and_then(|line| line.structure_color.as_deref()),
        )?;
        let plate_holder_color = super::select_color(
            item.plate_holder_color.as_deref(),
            product
                .data
                .plate_holder_colors
                .as_deref()
                .unwrap_or_default(),
            saved.and_then(|line| line.plate_holder_color.as_deref()),
        )?;
        let plate_holder_type = super::select_color(
            item.plate_holder_type.as_deref(),
            product
                .data
                .plate_holder_types
                .as_deref()
                .unwrap_or_default(),
            saved.and_then(|line| line.plate_holder_type.as_deref()),
        )?;
        let upholstery_color = super::select_color(
            item.upholstery_color.as_deref(),
            product
                .data
                .upholstery_colors
                .as_deref()
                .unwrap_or_default(),
            saved.and_then(|line| line.upholstery_color.as_deref()),
        )?;
        let agreed_price = saved
            .map(|line| line.unit_price.as_str())
            .unwrap_or(&product.data.base_price);
        let requested_price = item.unit_price.as_deref().unwrap_or(agreed_price);
        if fixed(requested_price, 2)? != fixed(agreed_price, 2)? {
            let rights =
                crate::platform::access::load_access(&mut tx, tenant, &identity.subject).await?;
            crate::platform::access::require_permission(&rights, "sales.proposals.negotiate")?;
        }
        let (quantity, price, amount) = rules::line_amount(&item.quantity, requested_price)?;
        lines.push(PreparedLine {
            product_id: item.product_id,
            sku: saved
                .map(|line| line.sku.clone())
                .unwrap_or(product.data.sku),
            name: saved
                .map(|line| line.name.clone())
                .unwrap_or(product.data.name),
            unit: product.data.unit,
            quantity,
            price,
            catalog_price: fixed(
                saved
                    .map(|line| line.catalog_price.as_str())
                    .unwrap_or(&product.data.base_price),
                2,
            )?,
            amount,
            structure_color,
            upholstery_color,
            plate_holder_color,
            plate_holder_type,
        });
    }
    let total = rules::total(lines.iter().map(|line| line.amount))?;
    let id = existing_id.unwrap_or_else(Uuid::now_v7);
    let version = previous
        .as_ref()
        .map(|value| value.data.version)
        .unwrap_or(1);
    let new_revision = expected.map(|value| value + 1).unwrap_or(1);
    if existing_id.is_none() {
        sqlx::query("INSERT INTO sales_proposals(id,tenant_id) VALUES($1,$2)")
            .bind(id)
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        sqlx::query("INSERT INTO sales_proposal_versions(tenant_id,proposal_id,version,customer_id,customer_name,customer_tax_id,valid_until,payment_terms,delivery_terms,notes,amount_cents,created_by) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(tenant).bind(id).bind(input.customer_id).bind(customer.0).bind(customer.1).bind(validity).bind(payment).bind(delivery).bind(notes).bind(total).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    } else {
        let customer = match previous.as_ref() {
            Some(value) if value.data.customer_id == input.customer_id => (
                value.data.customer_name.clone(),
                value.data.customer_tax_id.clone(),
            ),
            _ => customer,
        };
        sqlx::query("UPDATE sales_proposal_versions SET customer_id=$4,customer_name=$5,customer_tax_id=$6,valid_until=$7,payment_terms=$8,delivery_terms=$9,notes=$10,amount_cents=$11 WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3")
            .bind(tenant).bind(id).bind(version).bind(input.customer_id).bind(customer.0).bind(customer.1).bind(validity).bind(payment).bind(delivery).bind(notes).bind(total).execute(&mut *tx).await.map_err(db)?;
        sqlx::query(
            "DELETE FROM sales_proposal_lines WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3",
        )
        .bind(tenant)
        .bind(id)
        .bind(version)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        sqlx::query("UPDATE sales_proposals SET revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2")
            .bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
    }
    for (index, line) in lines.iter().enumerate() {
        sqlx::query("INSERT INTO sales_proposal_lines(tenant_id,proposal_id,version,line_number,product_id,sku,name,unit,quantity_micros,catalog_price_cents,price_cents,amount_cents,structure_color,upholstery_color,plate_holder_color,plate_holder_type) VALUES($1,$2,$13,$3,$4,$5,$6,$7,$8,$14,$9,$10,$11,$12,$15,$16)")
            .bind(tenant).bind(id).bind((index+1) as i32).bind(line.product_id).bind(&line.sku).bind(&line.name).bind(&line.unit).bind(line.quantity).bind(line.price).bind(line.amount).bind(&line.structure_color).bind(&line.upholstery_color).bind(version).bind(line.catalog_price).bind(&line.plate_holder_color).bind(&line.plate_holder_type).execute(&mut *tx).await.map_err(db)?;
    }
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "sales_proposal", id, event: if existing_id.is_some() { "proposal.updated" } else { "proposal.created" }, details: serde_json::json!({"revision":new_revision,"version":version,"amount":decimal(total,2),"items":lines.len()}) }).await?;
    let value = serde_json::to_value(load(&mut tx, tenant, id, true).await?)
        .map_err(|_| AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        scope,
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(status, Some(new_revision), value))
}
