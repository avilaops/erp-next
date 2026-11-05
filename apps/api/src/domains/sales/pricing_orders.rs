//! Atomic draft creation and explicit approval of pricing exceptions.
use super::{pricing, pricing_model::QuoteInput};
use crate::domains::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    revision,
};
use crate::platform::{access, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateInput {
    quote: QuoteInput,
    digest: String,
    customer_id: Uuid,
    due_date: String,
    structure_color: Option<String>,
    upholstery_color: Option<String>,
}

#[utoipa::path(post,path="/api/v1/sales-simulator/{line}/orders",operation_id="create_simulated_order",tag="Sales",security(("bearerAuth"=[])),params(("line"=String,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),request_body=CreateInput,responses((status=201,body=Value),(status=412,description="Simule novamente"),(status=422,description="Condições inválidas")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(code): Path<String>,
    headers: HeaderMap,
    payload: Result<Json<CreateInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        pricing::READ,
        pricing::MANAGE,
        true,
    )
    .await?;
    let Json(input) = payload.map_err(|_| DomainError::Invalid("Dados do pedido inválidos"))?;
    pricing::line(&code)?;
    let request = json!({"line":code,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.simulated",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, Some(1), previous));
    }
    let prepared = pricing::prepare(&mut tx, tenant, &code, &input.quote).await?;
    if prepared.digest != input.digest {
        return Err(DomainError::StaleRevision);
    }
    let order_input = super::OrderInput {
        customer_id: input.customer_id,
        due_date: input.due_date.clone(),
        items: vec![super::OrderItemInput {
            product_id: input.quote.product_id,
            quantity: format!("{}.000000", input.quote.quantity),
            structure_color: input.structure_color,
            upholstery_color: input.upholstery_color,
            arm_color: None,
            plate_holder_color: None,
        }],
    };
    let mut order = super::prepare_order(&mut tx, tenant, &order_input, None).await?;
    order.total = prepared.quote.sale.invoice_total_cents;
    order.lines[0].price = prepared.quote.sale.unit_with_ipi_cents;
    order.lines[0].amount = order.total;
    order.lines[0].sku = prepared.product["sku"]
        .as_str()
        .ok_or(DomainError::Conflict("SKU publicado inválido"))?
        .into();
    order.lines[0].name = prepared.product["name"]
        .as_str()
        .ok_or(DomainError::Conflict("Nome publicado inválido"))?
        .into();
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES($1,$2,$3,$4,$5,$6,$7,'draft')")
        .bind(id).bind(tenant).bind(input.customer_id).bind(&order.customer_name).bind(&order.customer_tax_id).bind(order.due).bind(order.total).execute(&mut *tx).await.map_err(db)?;
    super::store_lines(&mut tx, tenant, id, &order.lines).await?;
    let needs_approval = prepared.quote.sale.needs_approval;
    let snapshot = pricing::redact(prepared, &input.quote, true, tenant);
    sqlx::query("INSERT INTO order_pricing_snapshots(tenant_id,order_id,version_id,snapshot,needs_approval) VALUES($1,$2,$3,$4,$5)")
        .bind(tenant).bind(id).bind(input.quote.version_id).bind(snapshot).bind(needs_approval).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange {
        kind:"sales_order", id, event:"order.created",
        details:json!({"revision":1,"source":"sales_simulator","versionId":input.quote.version_id,"needsApproval":needs_approval}),
    }).await?;
    let result = json!({"tenantId":tenant,"id":id,"revision":1,"status":"draft","needsApproval":needs_approval});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.simulated",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}

#[utoipa::path(get,path="/api/v1/orders/{id}/pricing",operation_id="get_order_pricing",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=404,description="Pedido não encontrado")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        pricing::READ,
        pricing::MANAGE,
        false,
    )
    .await?;
    let order: Option<(i64, String)> =
        sqlx::query_as("SELECT revision,status FROM sales_orders WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?;
    let (revision, status) = order.ok_or(DomainError::NotFound)?;
    let row: Option<(Value,bool,Option<String>)> = sqlx::query_as("SELECT snapshot,needs_approval,approved_by FROM order_pricing_snapshots WHERE tenant_id=$1 AND order_id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
    let director = pricing::sees_costs(&mut tx, tenant, &identity.subject).await?;
    let data = row.map(|(mut snapshot, needs_approval, approved_by)| {
        if !director {
            snapshot
                .as_object_mut()
                .expect("object snapshot")
                .remove("director");
        }
        json!({"snapshot":snapshot,"needsApproval":needs_approval,"approved":approved_by.is_some()})
    });
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        json!({"tenantId":tenant,"canApprove":director && status=="draft","data":data}),
    ))
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ApprovalInput {
    reason: String,
}

#[utoipa::path(post,path="/api/v1/orders/{id}/pricing/approve",operation_id="approve_order_pricing",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),request_body=ApprovalInput,responses((status=200,body=Value),(status=403,description="Exige gestão da empresa"),(status=409,description="Sem exceção pendente"),(status=412,description="Pedido alterado")))]
pub async fn approve(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    payload: Result<Json<ApprovalInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        pricing::READ,
        pricing::DIRECTOR,
        true,
    )
    .await?;
    let Json(input) = payload.map_err(|_| DomainError::Invalid("Informe o motivo da aprovação"))?;
    let reason = input.reason.trim();
    if !(3..=2000).contains(&reason.chars().count()) || reason.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Motivo exige de 3 a 2000 caracteres sem controles",
        ));
    }
    let request = json!({"id":id,"revision":expected,"reason":reason});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.pricing.approved",
        &request,
    )
    .await?
    {
        let revision = previous["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, revision, previous));
    }
    let order: Option<(i64, String)> =
        sqlx::query_as("SELECT revision,status FROM sales_orders WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?;
    let (current, status) = order.ok_or(DomainError::NotFound)?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    if status != "draft" {
        return Err(DomainError::Conflict("Aprovação exige pedido em rascunho"));
    }
    let result = sqlx::query("UPDATE order_pricing_snapshots SET approved_by=$3,approved_at=now(),approval_reason=$4 WHERE tenant_id=$1 AND order_id=$2 AND needs_approval AND approved_by IS NULL")
        .bind(tenant).bind(id).bind(&identity.subject).bind(reason).execute(&mut *tx).await.map_err(db)?;
    if result.rows_affected() != 1 {
        return Err(DomainError::Conflict(
            "Nenhuma exceção pendente neste pedido",
        ));
    }
    let next = expected
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    sqlx::query(
        "UPDATE sales_orders SET revision=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .bind(next)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "sales_order",
            id,
            event: "order.pricing.approved",
            details: json!({"revision":next,"reason":reason}),
        },
    )
    .await?;
    let value = json!({"tenantId":tenant,"id":id,"revision":next,"approved":true});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.pricing.approved",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), value))
}

pub(super) async fn validate_confirmation(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<(), DomainError> {
    let pending: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM order_pricing_snapshots WHERE tenant_id=$1 AND order_id=$2 AND needs_approval AND approved_by IS NULL)")
        .bind(tenant).bind(order).fetch_one(&mut **tx).await.map_err(db)?;
    if pending {
        return Err(DomainError::Conflict(
            "A negociação exige aprovação da gestão antes da confirmação",
        ));
    }
    Ok(())
}
