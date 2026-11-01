//! Production consumes explicitly declared components from the existing inventory.
//! Reaching "Pronto" records completion only: it creates neither finished-product
//! stock nor financial/industrial-cost postings. Reopening and cancellation reverse
//! exactly the active original component movements, preserving their snapshots.
use super::{
    DomainChange, DomainError, authorized, command_key, db, decimal, fixed, record, remember,
    replay, response, revision,
};
use crate::platform::{
    access::{self, AccessError},
    auth::AuthenticatedIdentity,
    state::AppState,
};
use axum::{
    Extension, Json, Router,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post, put},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateInput {
    order_id: Uuid,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StageMoveInput {
    stage_id: Uuid,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConsumeInput {
    product_id: Uuid,
    quantity: String,
    unit_cost: String,
    reason: String,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReverseInput {
    reason: String,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StageInput {
    name: String,
    kind: String,
    position: i32,
}
#[derive(Default, Deserialize, IntoParams)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[into_params(parameter_in=Query)]
pub struct ProductionQuery {
    order_id: Option<Uuid>,
    offset: Option<u32>,
    limit: Option<u32>,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/production/orders",
            get(list_orders).post(create_orders),
        )
        .route("/api/v1/production/orders/{id}", get(get_order))
        .route("/api/v1/production/orders/{id}/stage", post(move_order))
        .route("/api/v1/production/orders/{id}/consumptions", post(consume))
        .route(
            "/api/v1/production/orders/{id}/consumptions/{movement}/reverse",
            post(reverse_consumption),
        )
        .route(
            "/api/v1/production/stages",
            get(list_stages).post(create_stage),
        )
        .route("/api/v1/production/stages/{id}", put(update_stage))
}

async fn inventory_permission(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
) -> Result<(), DomainError> {
    let rights = access::load_access(tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, "inventory.stock.read")?;
    access::require_permission(&rights, "inventory.stock.manage")?;
    Ok(())
}

/// Called under the tenant lock, also before returning an idempotent cancellation.
/// Original consumption records remain after reversal, so revoked inventory rights
/// cannot be bypassed by replaying an already applied cancellation command.
pub(super) async fn require_cancellation_permissions(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    order_id: Uuid,
) -> Result<(), DomainError> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM production_orders WHERE tenant_id=$1 AND order_id=$2)",
    )
    .bind(tenant)
    .bind(order_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    if !exists {
        return Ok(());
    }
    let rights = access::load_access(tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, "production.read")?;
    access::require_permission(&rights, "production.manage")?;
    let consumed:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM production_consumptions c JOIN production_orders o ON o.tenant_id=c.tenant_id AND o.id=c.production_order_id WHERE o.tenant_id=$1 AND o.order_id=$2)").bind(tenant).bind(order_id).fetch_one(&mut **tx).await.map_err(db)?;
    if consumed {
        inventory_permission(tx, tenant, identity).await?;
    }
    Ok(())
}

async fn defaults(tx: &mut Transaction<'_, Postgres>, tenant: Uuid) -> Result<(), DomainError> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM production_stages WHERE tenant_id=$1)")
            .bind(tenant)
            .fetch_one(&mut **tx)
            .await
            .map_err(db)?;
    if exists {
        return Ok(());
    }
    for (name, position, kind) in [
        ("A produzir", 1, "andamento"),
        ("Corte", 2, "andamento"),
        ("Solda", 3, "andamento"),
        ("Pintura", 4, "andamento"),
        ("Montagem", 5, "andamento"),
        ("Pronto", 1, "pronta"),
    ] {
        sqlx::query("INSERT INTO production_stages(id,tenant_id,name,position,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING").bind(Uuid::now_v7()).bind(tenant).bind(name).bind(position).bind(kind).execute(&mut **tx).await.map_err(db)?;
    }
    Ok(())
}

const PROJECTION: &str = "jsonb_build_object('id',o.id,'orderId',o.order_id,'productId',o.product_id,'sku',o.sku,'name',o.name,'unit',o.unit,'quantity',concat(o.quantity_micros/1000000,'.',lpad((o.quantity_micros%1000000)::text,6,'0')),'stageId',s.id,'stageName',s.name,'stageKind',s.kind,'status',o.status,'revision',o.revision,'finishedAt',o.finished_at,'cancelledAt',o.cancelled_at,'cancellationId',o.cancellation_id)";
async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Value, DomainError> {
    sqlx::query_scalar(&format!("SELECT {PROJECTION} FROM production_orders o JOIN production_stages s ON s.tenant_id=o.tenant_id AND s.id=o.stage_id WHERE o.tenant_id=$1 AND o.id=$2"))
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}

#[utoipa::path(get,path="/api/v1/production/orders",tag="Production",security(("bearerAuth"=[])),params(ProductionQuery),responses((status=200,body=Value)))]
pub async fn list_orders(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<ProductionQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(25);
    if offset > 100000 || !(1..=100).contains(&limit) {
        return Err(DomainError::Invalid("Paginação inválida"));
    }
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "production.read",
        "production.manage",
        false,
    )
    .await?;
    let rows:Vec<Value>=sqlx::query_scalar(&format!("SELECT {PROJECTION} FROM production_orders o JOIN production_stages s ON s.tenant_id=o.tenant_id AND s.id=o.stage_id WHERE o.tenant_id=$1 AND ($2::uuid IS NULL OR o.order_id=$2) ORDER BY o.created_at DESC,o.id DESC LIMIT $3 OFFSET $4"))
        .bind(tenant).bind(query.order_id).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM production_orders WHERE tenant_id=$1 AND ($2::uuid IS NULL OR order_id=$2)").bind(tenant).bind(query.order_id).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":rows,"total":total,"offset":offset,"limit":limit}),
    ))
}

#[utoipa::path(get,path="/api/v1/production/orders/{id}",tag="Production",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,body=Value)))]
pub async fn get_order(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "production.read",
        "production.manage",
        false,
    )
    .await?;
    // All domain/access mutations take the tenant FOR UPDATE first. Hold a
    // shared lock while reading the order, history and component ledger so
    // that the response and its ETag describe the same committed revision.
    sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR SHARE")
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, "production.read")?;
    let can_edit = access::require_permission(&rights, "production.manage").is_ok();
    let data = load(&mut tx, tenant, id).await?;
    let history:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'action',action,'stageName',stage_name,'actor',actor_subject,'details',details,'createdAt',created_at) FROM production_history WHERE tenant_id=$1 AND production_order_id=$2 ORDER BY created_at,id").bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    let consumptions:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',c.stock_movement_id,'productId',c.product_id,'sku',c.sku,'name',c.name,'unit',c.unit,'quantity',concat(c.quantity_micros/1000000,'.',lpad((c.quantity_micros%1000000)::text,6,'0')),'unitCost',concat(c.unit_cost_cents/100,'.',lpad((c.unit_cost_cents%100)::text,2,'0')),'amount',concat(c.amount_cents/100,'.',lpad((c.amount_cents%100)::text,2,'0')),'reversed',EXISTS(SELECT 1 FROM stock_movements r WHERE r.tenant_id=c.tenant_id AND r.reverses_id=c.stock_movement_id)) FROM production_consumptions c WHERE c.tenant_id=$1 AND c.production_order_id=$2 ORDER BY c.created_at,c.stock_movement_id").bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    let can_consume = can_edit
        && inventory_permission(&mut tx, tenant, &identity)
            .await
            .is_ok();
    let current = data["revision"].as_i64();
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        current,
        json!({"tenantId":tenant,"canEdit":can_edit,"canConsume":can_consume,"data":data,"history":history,"consumptions":consumptions}),
    ))
}

async fn history(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    id: Uuid,
    event: &'static str,
    details: Value,
) -> Result<(), DomainError> {
    sqlx::query("INSERT INTO production_history(id,tenant_id,production_order_id,action,stage_id,stage_name,actor_subject,details) SELECT $1,$2,o.id,$4,s.id,s.name,$5,$6 FROM production_orders o JOIN production_stages s ON s.tenant_id=o.tenant_id AND s.id=o.stage_id WHERE o.tenant_id=$2 AND o.id=$3")
        .bind(Uuid::now_v7()).bind(tenant).bind(id).bind(event).bind(&identity.subject).bind(&details).execute(&mut **tx).await.map_err(db)?;
    record(
        tx,
        tenant,
        identity,
        headers,
        DomainChange {
            kind: "production_order",
            id,
            event,
            details,
        },
    )
    .await
}

#[utoipa::path(post,path="/api/v1/production/orders",tag="Production",security(("bearerAuth"=[])),request_body=CreateInput,responses((status=201,body=Value)))]
pub async fn create_orders(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<CreateInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let key = command_key(&headers)?;
    let input = payload
        .map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?
        .0;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "production.read",
        "production.manage",
        true,
    )
    .await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, "sales.orders.read")?;
    let request = json!({"orderId":input.order_id,"revision":expected});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "production.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, None, previous));
    }
    let (status, current): (String, i64) = sqlx::query_as(
        "SELECT status,revision FROM sales_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(input.order_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    if !["confirmed", "completed"].contains(&status.as_str()) {
        return Err(DomainError::Conflict(
            "Somente pedido confirmado ou concluído entra em produção",
        ));
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM production_orders WHERE tenant_id=$1 AND order_id=$2)",
    )
    .bind(tenant)
    .bind(input.order_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    if exists {
        return Err(DomainError::Conflict("Pedido já enviado à produção"));
    }
    defaults(&mut tx, tenant).await?;
    let stage:Uuid=sqlx::query_scalar("SELECT id FROM production_stages WHERE tenant_id=$1 AND kind='andamento' ORDER BY position,id LIMIT 1").bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    let products:Vec<Uuid>=sqlx::query_scalar("SELECT product_id FROM sales_order_lines WHERE tenant_id=$1 AND order_id=$2 ORDER BY line_number").bind(tenant).bind(input.order_id).fetch_all(&mut *tx).await.map_err(db)?;
    if products.is_empty() {
        return Err(DomainError::Conflict("Pedido sem itens para fabricar"));
    }
    let mut rows = Vec::new();
    for product in products {
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO production_orders(id,tenant_id,order_id,product_id,sku,name,unit,quantity_micros,stage_id) SELECT $1,tenant_id,order_id,product_id,sku,name,unit,quantity_micros,$4 FROM sales_order_lines WHERE tenant_id=$2 AND order_id=$3 AND product_id=$5")
            .bind(id).bind(tenant).bind(input.order_id).bind(stage).bind(product).execute(&mut *tx).await.map_err(db)?;
        history(
            &mut tx,
            tenant,
            &identity,
            &headers,
            id,
            "production.created",
            json!({"orderId":input.order_id,"revision":1}),
        )
        .await?;
        rows.push(load(&mut tx, tenant, id).await?);
    }
    let result = json!({"tenantId":tenant,"data":rows});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "production.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, None, result))
}

#[derive(sqlx::FromRow)]
struct ActiveConsumption {
    id: Uuid,
    product_id: Uuid,
    quantity_micros: i64,
}
async fn reverse_active(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    job: Uuid,
    only: Option<Uuid>,
    reason: &str,
) -> Result<Vec<Uuid>, DomainError> {
    let rows=sqlx::query_as::<_,ActiveConsumption>("SELECT m.id,m.product_id,m.quantity_micros FROM stock_movements m JOIN production_consumptions c ON c.tenant_id=m.tenant_id AND c.stock_movement_id=m.id WHERE m.tenant_id=$1 AND m.production_order_id=$2 AND ($3::uuid IS NULL OR m.id=$3) AND m.direction='issue' AND m.reverses_id IS NULL AND NOT EXISTS(SELECT 1 FROM stock_movements r WHERE r.tenant_id=m.tenant_id AND r.reverses_id=m.id) ORDER BY m.product_id,m.id")
        .bind(tenant).bind(job).bind(only).fetch_all(&mut **tx).await.map_err(db)?;
    if only.is_some() && rows.is_empty() {
        return Err(DomainError::Conflict(
            "Consumo não encontrado nesta ordem ou já estornado",
        ));
    }
    if !rows.is_empty() {
        inventory_permission(tx, tenant, identity).await?;
    }
    let mut ids = Vec::new();
    for row in rows {
        let balance:i64=sqlx::query_scalar("SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE").bind(tenant).bind(row.product_id).fetch_one(&mut **tx).await.map_err(db)?;
        let next = balance
            .checked_add(row.quantity_micros)
            .filter(|v| *v <= 999999999999999999)
            .ok_or(DomainError::Conflict("Estorno excede limite de estoque"))?;
        let id = Uuid::now_v7();
        sqlx::query(
            "UPDATE stock_balances SET quantity_micros=$3 WHERE tenant_id=$1 AND product_id=$2",
        )
        .bind(tenant)
        .bind(row.product_id)
        .bind(next)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
        sqlx::query("INSERT INTO stock_movements(id,tenant_id,product_id,direction,quantity_micros,balance_after_micros,reason,reverses_id,production_order_id) VALUES($1,$2,$3,'receipt',$4,$5,$6,$7,$8)").bind(id).bind(tenant).bind(row.product_id).bind(row.quantity_micros).bind(next).bind(reason).bind(row.id).bind(job).execute(&mut **tx).await.map_err(db)?;
        record(tx,tenant,identity,headers,DomainChange{kind:"stock_movement",id,event:"stock.moved",details:json!({"productionOrderId":job,"productId":row.product_id,"direction":"receipt","quantity":decimal(row.quantity_micros,6),"balanceAfter":decimal(next,6),"reversesId":row.id,"reason":reason})}).await?;
        ids.push(id);
    }
    Ok(ids)
}

/// The commercial cancellation owns this transaction and inserts its cancellation
/// document before commit; the deferred FK keeps the production linkage atomic.
pub(super) async fn cancel_for_order(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    order_id: Uuid,
    cancellation_id: Uuid,
    reason: &str,
) -> Result<Value, DomainError> {
    require_cancellation_permissions(tx, tenant, identity, order_id).await?;
    let rows:Vec<(Uuid,String,i64)>=sqlx::query_as("SELECT id,status,revision FROM production_orders WHERE tenant_id=$1 AND order_id=$2 ORDER BY id FOR UPDATE").bind(tenant).bind(order_id).fetch_all(&mut **tx).await.map_err(db)?;
    let mut ids = Vec::new();
    let mut movements = Vec::new();
    for (id, status, current) in rows {
        if status == "cancelled" {
            continue;
        }
        movements.extend(reverse_active(tx, tenant, identity, headers, id, None, reason).await?);
        let next = current.checked_add(1).ok_or(AccessError::Internal)?;
        sqlx::query("UPDATE production_orders SET status='cancelled',cancelled_at=clock_timestamp(),cancellation_id=$3,revision=$4,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(cancellation_id).bind(next).execute(&mut **tx).await.map_err(db)?;
        history(tx,tenant,identity,headers,id,"production.cancelled",json!({"orderId":order_id,"cancellationId":cancellation_id,"reason":reason,"previousStatus":status,"revision":next})).await?;
        ids.push(id);
    }
    Ok(
        json!({"status":if ids.is_empty(){"not_required"}else{"applied"},"applied":!ids.is_empty(),"cancelledCount":ids.len(),"orderIds":ids,"stockMovementIds":movements}),
    )
}

#[derive(Serialize)]
enum Action {
    Move(StageMoveInput),
    Consume(ConsumeInput),
    Reverse(Uuid, ReverseInput),
}

async fn mutate(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Uuid,
    action: Action,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "production.read",
        "production.manage",
        true,
    )
    .await?;
    if matches!(action, Action::Consume(_) | Action::Reverse(_, _)) {
        inventory_permission(&mut tx, tenant, &identity).await?;
    }
    let request = json!({"id":id,"revision":expected,"action":action});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "production.change",
        &request,
    )
    .await?
    {
        if previous["stockMovementIds"]
            .as_array()
            .is_some_and(|ids| !ids.is_empty())
        {
            inventory_permission(&mut tx, tenant, &identity).await?;
        }
        let current = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, current, previous));
    }
    let (status,current,previous_stage,finished_product):(String,i64,Uuid,Uuid)=sqlx::query_as("SELECT status,revision,stage_id,product_id FROM production_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    if status == "cancelled" {
        return Err(DomainError::Conflict(
            "Ordem cancelada não volta para a fábrica",
        ));
    }
    let sale_status:String=sqlx::query_scalar("SELECT s.status FROM sales_orders s JOIN production_orders o ON o.tenant_id=s.tenant_id AND o.order_id=s.id WHERE o.tenant_id=$1 AND o.id=$2").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    if !["confirmed", "completed"].contains(&sale_status.as_str()) {
        return Err(DomainError::Conflict(
            "Pedido comercial não está ativo para produção",
        ));
    }
    let next = current.checked_add(1).ok_or(AccessError::Internal)?;
    let (event, details, movements) = match action {
        Action::Move(input) => {
            let kind: String = sqlx::query_scalar(
                "SELECT kind FROM production_stages WHERE tenant_id=$1 AND id=$2",
            )
            .bind(tenant)
            .bind(input.stage_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?
            .ok_or(DomainError::NotFound)?;
            if input.stage_id == previous_stage {
                return Err(DomainError::Conflict("Ordem já está nesta etapa"));
            }
            let movements = if status == "ready" && kind == "andamento" {
                reverse_active(
                    &mut tx,
                    tenant,
                    &identity,
                    &headers,
                    id,
                    None,
                    "Reabertura da ordem de produção",
                )
                .await?
            } else {
                Vec::new()
            };
            let state = if kind == "pronta" { "ready" } else { "open" };
            sqlx::query("UPDATE production_orders SET stage_id=$3,status=$4,finished_at=CASE WHEN $4='ready' THEN COALESCE(finished_at,clock_timestamp()) ELSE NULL END WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(input.stage_id).bind(state).execute(&mut *tx).await.map_err(db)?;
            (
                "production.stage_changed",
                json!({"previousStageId":previous_stage,"stageId":input.stage_id,"previousStatus":status,"status":state,"revision":next,"stockMovementIds":movements}),
                movements,
            )
        }
        Action::Consume(mut input) => {
            if status != "open" {
                return Err(DomainError::Conflict(
                    "Reabra a ordem pronta antes de registrar novos consumos",
                ));
            }
            let quantity = fixed(&input.quantity, 6)?;
            let cost = fixed(&input.unit_cost, 2)?;
            input.reason = input.reason.trim().to_owned();
            validate_reason(&input.reason)?;
            if quantity == 0 || input.product_id == finished_product {
                return Err(DomainError::Invalid(
                    "Componente deve ser distinto do produto fabricado e ter quantidade positiva",
                ));
            }
            let amount =
                i64::try_from((i128::from(quantity) * i128::from(cost) + 500000) / 1000000)
                    .ok()
                    .filter(|v| *v <= 99999999999999)
                    .ok_or(DomainError::Invalid("Custo total excede limite permitido"))?;
            let (sku, name, unit, product_status): (String, String, String, String) =
                sqlx::query_as(
                    "SELECT sku,name,unit,status FROM products WHERE tenant_id=$1 AND id=$2",
                )
                .bind(tenant)
                .bind(input.product_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db)?
                .ok_or(DomainError::NotFound)?;
            if product_status != "active" {
                return Err(DomainError::Conflict("Componente precisa estar ativo"));
            }
            let balance:i64=sqlx::query_scalar("SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE").bind(tenant).bind(input.product_id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::Conflict("Componente sem saldo de estoque"))?;
            let balance_after =
                balance
                    .checked_sub(quantity)
                    .filter(|v| *v >= 0)
                    .ok_or(DomainError::Conflict(
                        "Saldo físico insuficiente para consumo",
                    ))?;
            if balance_after < super::sales::reserved(&mut tx, tenant, input.product_id).await? {
                return Err(DomainError::Conflict(
                    "Saldo disponível insuficiente: componente reservado em vendas",
                ));
            }
            let movement = Uuid::now_v7();
            sqlx::query(
                "UPDATE stock_balances SET quantity_micros=$3 WHERE tenant_id=$1 AND product_id=$2",
            )
            .bind(tenant)
            .bind(input.product_id)
            .bind(balance_after)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
            sqlx::query("INSERT INTO stock_movements(id,tenant_id,product_id,direction,quantity_micros,balance_after_micros,reason,production_order_id) VALUES($1,$2,$3,'issue',$4,$5,$6,$7)").bind(movement).bind(tenant).bind(input.product_id).bind(quantity).bind(balance_after).bind(&input.reason).bind(id).execute(&mut *tx).await.map_err(db)?;
            sqlx::query("INSERT INTO production_consumptions(tenant_id,production_order_id,stock_movement_id,product_id,sku,name,unit,quantity_micros,unit_cost_cents,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)").bind(tenant).bind(id).bind(movement).bind(input.product_id).bind(sku).bind(name).bind(unit).bind(quantity).bind(cost).bind(amount).execute(&mut *tx).await.map_err(db)?;
            record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"stock_movement",id:movement,event:"stock.moved",details:json!({"productionOrderId":id,"productId":input.product_id,"direction":"issue","quantity":decimal(quantity,6),"balanceAfter":decimal(balance_after,6),"reason":input.reason})}).await?;
            (
                "production.consumed",
                json!({"stockMovementId":movement,"productId":input.product_id,"quantity":decimal(quantity,6),"unitCost":decimal(cost,2),"amount":decimal(amount,2),"revision":next}),
                vec![movement],
            )
        }
        Action::Reverse(movement, input) => {
            validate_reason(input.reason.trim())?;
            let movements = reverse_active(
                &mut tx,
                tenant,
                &identity,
                &headers,
                id,
                Some(movement),
                input.reason.trim(),
            )
            .await?;
            (
                "production.consumption_reversed",
                json!({"reversesId":movement,"stockMovementIds":movements,"reason":input.reason.trim(),"revision":next}),
                movements,
            )
        }
    };
    sqlx::query("UPDATE production_orders SET revision=$3,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(next).execute(&mut *tx).await.map_err(db)?;
    history(&mut tx, tenant, &identity, &headers, id, event, details).await?;
    let result = json!({"tenantId":tenant,"data":load(&mut tx,tenant,id).await?,"stockMovementIds":movements});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "production.change",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}

fn validate_reason(reason: &str) -> Result<(), DomainError> {
    if !(3..=500).contains(&reason.chars().count()) || reason.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Motivo exige de 3 a 500 caracteres sem controles",
        ));
    }
    Ok(())
}

#[utoipa::path(post,path="/api/v1/production/orders/{id}/stage",tag="Production",security(("bearerAuth"=[])),request_body=StageMoveInput,params(("id"=Uuid,Path)),responses((status=200,body=Value)))]
pub async fn move_order(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<StageMoveInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    mutate(
        state,
        identity,
        headers,
        id,
        Action::Move(
            payload
                .map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?
                .0,
        ),
    )
    .await
}
#[utoipa::path(post,path="/api/v1/production/orders/{id}/consumptions",tag="Production",security(("bearerAuth"=[])),request_body=ConsumeInput,params(("id"=Uuid,Path)),responses((status=200,body=Value)))]
pub async fn consume(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ConsumeInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    mutate(
        state,
        identity,
        headers,
        id,
        Action::Consume(
            payload
                .map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?
                .0,
        ),
    )
    .await
}
#[utoipa::path(post,path="/api/v1/production/orders/{id}/consumptions/{movement}/reverse",tag="Production",security(("bearerAuth"=[])),request_body=ReverseInput,params(("id"=Uuid,Path),("movement"=Uuid,Path)),responses((status=200,body=Value)))]
pub async fn reverse_consumption(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path((id, movement)): Path<(Uuid, Uuid)>,
    payload: Result<Json<ReverseInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    mutate(
        state,
        identity,
        headers,
        id,
        Action::Reverse(
            movement,
            payload
                .map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?
                .0,
        ),
    )
    .await
}

#[utoipa::path(get,path="/api/v1/production/stages",tag="Production",security(("bearerAuth"=[])),responses((status=200,body=Value)))]
pub async fn list_stages(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "production.read",
        "production.manage",
        false,
    )
    .await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'kind',kind,'position',position,'revision',revision) FROM production_stages WHERE tenant_id=$1 ORDER BY (kind='pronta'),position,id").bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":rows}),
    ))
}

async fn save_stage(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Option<Uuid>,
    mut input: StageInput,
) -> Result<Response, DomainError> {
    let expected = if id.is_some() {
        Some(revision(&headers)?)
    } else {
        None
    };
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "production.read",
        "production.manage",
        true,
    )
    .await?;
    input.name = input.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if !(2..=40).contains(&input.name.chars().count())
        || !(1..=10000).contains(&input.position)
        || !["andamento", "pronta"].contains(&input.kind.as_str())
    {
        return Err(DomainError::Invalid(
            "Informe nome de 2 a 40 caracteres, tipo e posição válida",
        ));
    }
    let request = json!({"id":id,"revision":expected,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "production.stage",
        &request,
    )
    .await?
    {
        let current = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(
            if id.is_some() {
                StatusCode::OK
            } else {
                StatusCode::CREATED
            },
            current,
            previous,
        ));
    }
    defaults(&mut tx, tenant).await?;
    let target = id.unwrap_or_else(Uuid::now_v7);
    let next = if let Some(expected) = expected {
        let (kind, current): (String, i64) = sqlx::query_as(
            "SELECT kind,revision FROM production_stages WHERE tenant_id=$1 AND id=$2",
        )
        .bind(tenant)
        .bind(target)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::NotFound)?;
        if current != expected {
            return Err(DomainError::StaleRevision);
        }
        if kind != input.kind {
            return Err(DomainError::Conflict(
                "Tipo da etapa é preservado; crie outra etapa de andamento",
            ));
        }
        expected.checked_add(1).ok_or(AccessError::Internal)?
    } else {
        if input.kind != "andamento" {
            return Err(DomainError::Conflict("A etapa Pronto é única e já existe"));
        }
        1
    };
    let duplicate:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM production_stages WHERE tenant_id=$1 AND lower(btrim(name))=lower($2) AND id<>$3)").bind(tenant).bind(&input.name).bind(target).fetch_one(&mut *tx).await.map_err(db)?;
    if duplicate {
        return Err(DomainError::Conflict("Já existe etapa com este nome"));
    }
    sqlx::query("INSERT INTO production_stages(id,tenant_id,name,kind,position,revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,position=EXCLUDED.position,revision=EXCLUDED.revision WHERE production_stages.tenant_id=EXCLUDED.tenant_id")
        .bind(target).bind(tenant).bind(&input.name).bind(&input.kind).bind(input.position).bind(next).execute(&mut *tx).await.map_err(db)?;
    let result = json!({"tenantId":tenant,"data":{"id":target,"name":input.name,"kind":input.kind,"position":input.position,"revision":next}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "production_stage",
            id: target,
            event: "production.stage_saved",
            details: result["data"].clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "production.stage",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        if id.is_some() {
            StatusCode::OK
        } else {
            StatusCode::CREATED
        },
        Some(next),
        result,
    ))
}
#[utoipa::path(post,path="/api/v1/production/stages",tag="Production",security(("bearerAuth"=[])),request_body=StageInput,responses((status=201,body=Value)))]
pub async fn create_stage(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<StageInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    save_stage(
        state,
        identity,
        headers,
        None,
        payload
            .map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?
            .0,
    )
    .await
}
#[utoipa::path(put,path="/api/v1/production/stages/{id}",tag="Production",security(("bearerAuth"=[])),request_body=StageInput,params(("id"=Uuid,Path)),responses((status=200,body=Value)))]
pub async fn update_stage(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<StageInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    save_stage(
        state,
        identity,
        headers,
        Some(id),
        payload
            .map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?
            .0,
    )
    .await
}
