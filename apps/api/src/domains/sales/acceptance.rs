//! Commercial commitment and title origination, without physical stock effects.
use super::{OrderSnapshot, checkout, negotiation, pricing_orders, settings};
use crate::domains::{
    DomainChange, DomainError, authorized, catalog, command_key, db, record, remember, replay,
    response, revision,
};
use crate::platform::{access::AccessError, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde_json::json;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

// Private to the sales domain: both initial commercial commitments use these
// guards. Physical availability remains the confirmation orchestrator's concern.
pub(super) async fn validate_commercial_acceptance(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: &OrderSnapshot,
) -> Result<(), DomainError> {
    let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM parties WHERE tenant_id=$1 AND id=$2 AND is_customer AND status='active')")
        .bind(tenant).bind(order.data.customer_id).fetch_one(&mut **tx).await.map_err(db)?;
    if !active {
        return Err(DomainError::Conflict(
            "O cliente precisa estar ativo para esta operação",
        ));
    }
    negotiation::require_approval(tx, tenant, order.data.id).await?;
    pricing_orders::validate_confirmation(tx, tenant, order.data.id).await?;
    settings::validate_confirmation(tx, tenant, order).await?;
    validate_products(tx, tenant, order).await
}

// Commercial conditions are frozen at acceptance. Fulfillment still checks
// the current product identity/status/unit without repricing that agreement.
pub(super) async fn validate_products(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: &OrderSnapshot,
) -> Result<(), DomainError> {
    for item in &order.items {
        let product = catalog::load(tx, tenant, item.product_id).await?;
        if product.data.unit != item.unit {
            return Err(DomainError::Conflict(
                "Unidade do produto mudou desde o rascunho. Cancele e recrie o pedido",
            ));
        }
        if product.data.status != "active" {
            return Err(DomainError::Conflict(
                "O produto precisa estar ativo para esta operação",
            ));
        }
    }
    Ok(())
}

#[utoipa::path(post,path="/api/v1/orders/{id}/accept",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=OrderSnapshot),(status=403,description="Sem permissão"),(status=409,description="Checkout ou condições comerciais em conflito"),(status=412,description="Revisão divergente"),(status=428,description="Precondições obrigatórias")))]
pub async fn accept(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "sales.orders.read",
        "sales.orders.manage",
        true,
    )
    .await?;
    let request = json!({"id":id,"revision":expected});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.accept",
        &request,
    )
    .await?
    {
        let revision = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, revision, previous));
    }
    let current = super::load(&mut tx, tenant, id, true).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if current.data.status != "draft" {
        return Err(DomainError::Conflict(
            "Somente pedidos em rascunho podem ser aceitos",
        ));
    }
    if current.checkout.is_none() {
        return Err(DomainError::Conflict(
            "Aceitar encomenda exige condições completas de entrada e parcelas",
        ));
    }
    validate_commercial_acceptance(&mut tx, tenant, &current).await?;
    checkout::originate_on_acceptance(&mut tx, tenant, id, &identity, &headers).await?;
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    sqlx::query("UPDATE sales_orders SET status='accepted',revision=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).bind(next).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind:"sales_order", id, event:"order.accepted", details:json!({"previousRevision":expected,"revision":next,"previousStatus":"draft","status":"accepted"}) }).await?;
    let value = serde_json::to_value(super::load(&mut tx, tenant, id, true).await?)
        .map_err(|_| AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.accept",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), value))
}
