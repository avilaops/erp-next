use super::{
    DomainChange, DomainError, authorized, catalog, command_key, db, decimal, fixed, record,
    remember, replay, response,
};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{
        Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

pub(super) struct OrderIssue {
    pub order_id: Uuid,
    pub product_id: Uuid,
}

/// The sales orchestrator supplies its authorized tenant transaction; inventory owns the ledger writes.
pub(super) async fn issue_reserved_order(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    input: OrderIssue,
) -> Result<(), DomainError> {
    let (quantity, unit) =
        super::sales::reserved_line(tx, tenant, input.order_id, input.product_id).await?;
    let product = catalog::load(tx, tenant, input.product_id).await?;
    if product.data.status != "active" || product.data.unit != unit {
        return Err(DomainError::Conflict(
            "O produto precisa estar ativo e conservar a unidade do pedido",
        ));
    }
    let balance = sqlx::query_scalar::<_, i64>("SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE")
        .bind(tenant).bind(input.product_id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::Conflict("Saldo insuficiente"))?;
    let held = super::sales::reserved(tx, tenant, input.product_id).await?;
    if quantity <= 0 || held < quantity || balance < held {
        return Err(DomainError::Conflict(
            "Saldo reservado insuficiente para concluir o pedido",
        ));
    }
    let next = balance
        .checked_sub(quantity)
        .filter(|value| *value >= 0)
        .ok_or(DomainError::Conflict("Saldo insuficiente"))?;
    sqlx::query(
        "UPDATE stock_balances SET quantity_micros=$3 WHERE tenant_id=$1 AND product_id=$2",
    )
    .bind(tenant)
    .bind(input.product_id)
    .bind(next)
    .execute(&mut **tx)
    .await
    .map_err(db)?;
    let movement = Uuid::now_v7();
    sqlx::query("INSERT INTO stock_movements(id,tenant_id,product_id,direction,quantity_micros,balance_after_micros,reason,source_order_id) VALUES($1,$2,$3,'issue',$4,$5,$6,$7)")
        .bind(movement).bind(tenant).bind(input.product_id).bind(quantity).bind(next)
        .bind(format!("Conclusão comercial do pedido {}", input.order_id)).bind(input.order_id).execute(&mut **tx).await.map_err(db)?;
    record(tx, tenant, identity, headers, DomainChange { kind: "stock_movement", id: movement, event: "stock.moved",
        details: serde_json::json!({"orderId":input.order_id,"productId":input.product_id,"direction":"issue","quantity":decimal(quantity,6),"balanceAfter":decimal(next,6)}) }).await?;
    Ok(())
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Stock {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    status: String,
    quantity: String,
    reserved: String,
    available: String,
}
#[derive(FromRow)]
struct StockRow {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    status: String,
    quantity_micros: i64,
    reserved_micros: i64,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StockList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<Stock>,
    total: i64,
    offset: u32,
    limit: u32,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MovementInput {
    product_id: Uuid,
    direction: String,
    quantity: String,
    reason: String,
    reverses_id: Option<Uuid>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Movement {
    id: Uuid,
    product_id: Uuid,
    direction: String,
    quantity: String,
    balance_after: String,
    reason: String,
    reverses_id: Option<Uuid>,
    source_order_id: Option<Uuid>,
    occurred_at: String,
}
#[derive(FromRow)]
struct MovementRow {
    id: Uuid,
    product_id: Uuid,
    direction: String,
    quantity_micros: i64,
    balance_after_micros: i64,
    reason: String,
    reverses_id: Option<Uuid>,
    source_order_id: Option<Uuid>,
    occurred_at: String,
}
impl From<MovementRow> for Movement {
    fn from(row: MovementRow) -> Self {
        Self {
            id: row.id,
            product_id: row.product_id,
            direction: row.direction,
            quantity: decimal(row.quantity_micros, 6),
            balance_after: decimal(row.balance_after_micros, 6),
            reason: row.reason,
            reverses_id: row.reverses_id,
            source_order_id: row.source_order_id,
            occurred_at: row.occurred_at,
        }
    }
}
#[derive(Deserialize, IntoParams)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MovementQuery {
    product_id: Uuid,
    offset: Option<u32>,
    limit: Option<u32>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MovementList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<Movement>,
    total: i64,
    offset: u32,
    limit: u32,
}

#[utoipa::path(get,path="/api/v1/stock",tag="Inventory",security(("bearerAuth"=[])),params(catalog::ProductQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=StockList),(status=403,description="Sem permissão"),(status=422,description="Filtros inválidos")))]
pub async fn balances(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<catalog::ProductQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let (q, offset, limit) = catalog::page(&query)?;
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "inventory.stock.read",
        "inventory.stock.manage",
        false,
    )
    .await?;
    let rows=sqlx::query_as::<_,StockRow>("SELECT p.id AS product_id,p.sku,p.name,p.unit,p.status,COALESCE(b.quantity_micros,0) AS quantity_micros,COALESCE((SELECT sum(l.quantity_micros) FROM sales_order_lines l JOIN sales_orders o ON o.tenant_id=l.tenant_id AND o.id=l.order_id WHERE l.tenant_id=p.tenant_id AND l.product_id=p.id AND o.status='confirmed'),0)::bigint AS reserved_micros FROM products p LEFT JOIN stock_balances b ON b.tenant_id=p.tenant_id AND b.product_id=p.id WHERE p.tenant_id=$1 AND ($2::text IS NULL OR p.status=$2) AND (strpos(lower(p.name),lower($3))>0 OR strpos(lower(p.sku),lower($3))>0) ORDER BY p.name,p.id LIMIT $4 OFFSET $5")
        .bind(tenant).bind(&query.status).bind(&q).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total=sqlx::query_scalar("SELECT count(*) FROM products WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND (strpos(lower(name),lower($3))>0 OR strpos(lower(sku),lower($3))>0)")
        .bind(tenant).bind(&query.status).bind(q).fetch_one(&mut *tx).await.map_err(db)?;
    let data = rows
        .into_iter()
        .map(|r| {
            if r.reserved_micros > r.quantity_micros {
                return Err(crate::platform::access::AccessError::Internal.into());
            }
            Ok(Stock {
                product_id: r.product_id,
                sku: r.sku,
                name: r.name,
                unit: r.unit,
                status: r.status,
                quantity: decimal(r.quantity_micros, 6),
                reserved: decimal(r.reserved_micros, 6),
                available: decimal(r.quantity_micros - r.reserved_micros, 6),
            })
        })
        .collect::<Result<Vec<_>, DomainError>>()?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        StockList {
            tenant_id: tenant,
            can_edit,
            data,
            total,
            offset,
            limit,
        },
    ))
}
#[utoipa::path(get,path="/api/v1/stock/movements",tag="Inventory",security(("bearerAuth"=[])),params(MovementQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=MovementList),(status=403,description="Sem permissão"),(status=404,description="Produto não encontrado"),(status=422,description="Filtros inválidos")))]
pub async fn history(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<MovementQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Informe productId válido"))?
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
        "inventory.stock.read",
        "inventory.stock.manage",
        false,
    )
    .await?;
    catalog::load(&mut tx, tenant, query.product_id).await?;
    let rows=sqlx::query_as::<_,MovementRow>("SELECT id,product_id,direction,quantity_micros,balance_after_micros,reason,reverses_id,source_order_id,created_at::text AS occurred_at FROM stock_movements WHERE tenant_id=$1 AND product_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4")
        .bind(tenant).bind(query.product_id).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total = sqlx::query_scalar(
        "SELECT count(*) FROM stock_movements WHERE tenant_id=$1 AND product_id=$2",
    )
    .bind(tenant)
    .bind(query.product_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        MovementList {
            tenant_id: tenant,
            can_edit,
            data: rows.into_iter().map(Into::into).collect(),
            total,
            offset,
            limit,
        },
    ))
}
#[utoipa::path(post,path="/api/v1/stock/movements",tag="Inventory",request_body=MovementInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=Movement),(status=403,description="Sem permissão"),(status=404,description="Produto ou movimento não encontrado"),(status=409,description="Saldo insuficiente, estorno ou comando em conflito"),(status=422,description="Movimento inválido"),(status=428,description="Chave obrigatória")))]
pub async fn post_movement(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<MovementInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "inventory.stock.read",
        "inventory.stock.manage",
        true,
    )
    .await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let quantity = fixed(&input.quantity, 6)?;
    input.reason = input.reason.trim().to_owned();
    if quantity == 0
        || !["receipt", "issue"].contains(&input.direction.as_str())
        || !(3..=500).contains(&input.reason.chars().count())
    {
        return Err(DomainError::Invalid(
            "Informe direção, quantidade positiva com seis casas e motivo de 3 a 500 caracteres",
        ));
    }
    let request =
        serde_json::to_value(&input).map_err(|_| crate::platform::access::AccessError::Internal)?;
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "stock.movement",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, None, previous));
    }
    let product = catalog::load(&mut tx, tenant, input.product_id).await?;
    if product.data.status != "active" {
        return Err(DomainError::Conflict(
            "Reative o produto antes de movimentar o estoque",
        ));
    }
    if let Some(original) = input.reverses_id {
        let row=sqlx::query_as::<_,(Uuid,String,i64,Option<Uuid>,Option<Uuid>)>("SELECT product_id,direction,quantity_micros,reverses_id,source_order_id FROM stock_movements WHERE tenant_id=$1 AND id=$2")
            .bind(tenant).bind(original).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
        if row.4.is_some() {
            return Err(DomainError::Conflict(
                "Movimento de pedido exige um fluxo próprio de devolução, ainda não disponível",
            ));
        }
        if row.0 != input.product_id
            || row.1 == input.direction
            || row.2 != quantity
            || row.3.is_some()
        {
            return Err(DomainError::Conflict(
                "Estorno exige o mesmo produto e quantidade, com direção oposta a um movimento original",
            ));
        }
        if sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM stock_movements WHERE tenant_id=$1 AND reverses_id=$2)",
        )
        .bind(tenant)
        .bind(original)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?
        {
            return Err(DomainError::Conflict("Movimento já estornado"));
        }
    }
    sqlx::query(
        "INSERT INTO stock_balances(tenant_id,product_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    )
    .bind(tenant)
    .bind(input.product_id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    let previous=sqlx::query_scalar::<_,i64>("SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE").bind(tenant).bind(input.product_id).fetch_one(&mut *tx).await.map_err(db)?;
    let next = if input.direction == "receipt" {
        previous.checked_add(quantity)
    } else {
        previous.checked_sub(quantity)
    }
    .filter(|value| (0..=999999999999999999).contains(value))
    .ok_or(DomainError::Conflict(
        "Saldo insuficiente ou limite de estoque excedido",
    ))?;
    let reserved = super::sales::reserved(&mut tx, tenant, input.product_id).await?;
    if next < reserved {
        return Err(DomainError::Conflict(
            "Saldo disponível insuficiente: parte do estoque está reservada em pedidos",
        ));
    }
    sqlx::query(
        "UPDATE stock_balances SET quantity_micros=$3 WHERE tenant_id=$1 AND product_id=$2",
    )
    .bind(tenant)
    .bind(input.product_id)
    .bind(next)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    let id = Uuid::now_v7();
    let row=sqlx::query_as::<_,MovementRow>("INSERT INTO stock_movements(id,tenant_id,product_id,direction,quantity_micros,balance_after_micros,reason,reverses_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,product_id,direction,quantity_micros,balance_after_micros,reason,reverses_id,source_order_id,created_at::text AS occurred_at")
        .bind(id).bind(tenant).bind(input.product_id).bind(&input.direction).bind(quantity).bind(next).bind(&input.reason).bind(input.reverses_id).fetch_one(&mut *tx).await.map_err(db)?;
    let result = serde_json::to_value(Movement::from(row))
        .map_err(|_| crate::platform::access::AccessError::Internal)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange { kind: "stock_movement", id, event: "stock.moved", details: serde_json::json!({"productId":input.product_id,"direction":input.direction,"quantity":input.quantity,"balanceAfter":decimal(next,6),"reversesId":input.reverses_id}) }).await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "stock.movement",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, None, result))
}
