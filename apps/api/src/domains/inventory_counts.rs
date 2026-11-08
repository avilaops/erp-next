use super::{
    DomainChange, DomainError, authorized, catalog, command_key, db, decimal, record, remember,
    replay, response,
};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
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

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CountQuery {
    offset: Option<u32>,
    limit: Option<u32>,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CountInput {
    reference: String,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LineInput {
    product_id: Uuid,
    counted_quantity: String,
    note: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Count {
    id: Uuid,
    status: String,
    reference: String,
    revision: i64,
    created_by: String,
    approved_by: Option<String>,
    created_at: String,
    approved_at: Option<String>,
    line_count: i64,
    counted_lines: i64,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CountLine {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    expected_quantity: String,
    counted_quantity: Option<String>,
    note: Option<String>,
    counted_at: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CountList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<Count>,
    total: i64,
    offset: u32,
    limit: u32,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CountDetail {
    tenant_id: Uuid,
    can_edit: bool,
    count: Count,
    lines: Vec<CountLine>,
}

#[derive(FromRow)]
struct CountRow {
    id: Uuid,
    status: String,
    reference: String,
    revision: i64,
    created_by: String,
    approved_by: Option<String>,
    created_at: String,
    approved_at: Option<String>,
    line_count: i64,
    counted_lines: i64,
}

fn count_from(row: CountRow) -> Count {
    Count {
        id: row.id,
        status: row.status,
        reference: row.reference,
        revision: row.revision,
        created_by: row.created_by,
        approved_by: row.approved_by,
        created_at: row.created_at,
        approved_at: row.approved_at,
        line_count: row.line_count,
        counted_lines: row.counted_lines,
    }
}

async fn load_count(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Count, DomainError> {
    sqlx::query_as::<_, CountRow>("SELECT c.id,c.status,c.reference,c.revision,c.created_by,c.approved_by,c.created_at::text,c.approved_at::text,COUNT(l.product_id)::bigint,COUNT(l.counted_quantity_micros)::bigint FROM inventory_counts c LEFT JOIN inventory_count_lines l ON l.tenant_id=c.tenant_id AND l.count_id=c.id WHERE c.tenant_id=$1 AND c.id=$2 GROUP BY c.id")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.map(count_from).ok_or(DomainError::NotFound)
}

pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<CountQuery>, QueryRejection>,
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
        "inventory.counts.read",
        "inventory.counts.manage",
        false,
    )
    .await?;
    let rows = sqlx::query_as::<_, CountRow>("SELECT c.id,c.status,c.reference,c.revision,c.created_by,c.approved_by,c.created_at::text,c.approved_at::text,COUNT(l.product_id)::bigint,COUNT(l.counted_quantity_micros)::bigint FROM inventory_counts c LEFT JOIN inventory_count_lines l ON l.tenant_id=c.tenant_id AND l.count_id=c.id WHERE c.tenant_id=$1 GROUP BY c.id ORDER BY c.created_at DESC,c.id DESC LIMIT $2 OFFSET $3")
        .bind(tenant).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_counts WHERE tenant_id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        CountList {
            tenant_id: tenant,
            can_edit,
            data: rows.into_iter().map(count_from).collect(),
            total,
            offset,
            limit,
        },
    ))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<CountInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    input.reference = input.reference.trim().to_owned();
    if !(2..=120).contains(&input.reference.chars().count()) {
        return Err(DomainError::Invalid(
            "Informe uma referência entre 2 e 120 caracteres",
        ));
    }
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "inventory.counts.read",
        "inventory.counts.manage",
        true,
    )
    .await?;
    let request =
        serde_json::to_value(&input).map_err(|_| crate::platform::access::AccessError::Internal)?;
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "inventory.count.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, None, previous));
    }
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO inventory_counts(id,tenant_id,reference,created_by) VALUES($1,$2,$3,$4)",
    )
    .bind(id)
    .bind(tenant)
    .bind(&input.reference)
    .bind(&identity.subject)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query("INSERT INTO inventory_count_lines(tenant_id,count_id,product_id,expected_quantity_micros) SELECT $1,$2,p.id,COALESCE(b.quantity_micros,0) FROM products p LEFT JOIN stock_balances b ON b.tenant_id=p.tenant_id AND b.product_id=p.id WHERE p.tenant_id=$1 AND p.status='active'").bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
    let result = serde_json::to_value(load_count(&mut tx, tenant, id).await?)
        .map_err(|_| crate::platform::access::AccessError::Internal)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "inventory_count",
            id,
            event: "inventory.count.created",
            details: serde_json::json!({"reference": input.reference}),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "inventory.count.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, None, result))
}

pub async fn detail(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "inventory.counts.read",
        "inventory.counts.manage",
        false,
    )
    .await?;
    let count = load_count(&mut tx, tenant, id).await?;
    let rows = sqlx::query_as::<_, (Uuid,String,String,String,i64,Option<i64>,Option<String>,Option<String>)>("SELECT l.product_id,p.sku,p.name,p.unit,l.expected_quantity_micros,l.counted_quantity_micros,l.note,l.counted_at::text FROM inventory_count_lines l JOIN products p ON p.tenant_id=l.tenant_id AND p.id=l.product_id WHERE l.tenant_id=$1 AND l.count_id=$2 ORDER BY p.name,p.id").bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    let lines = rows
        .into_iter()
        .map(
            |(product_id, sku, name, unit, expected, counted, note, counted_at)| CountLine {
                product_id,
                sku,
                name,
                unit,
                expected_quantity: decimal(expected, 6),
                counted_quantity: counted.map(|value| decimal(value, 6)),
                note,
                counted_at,
            },
        )
        .collect();
    Ok(response(
        StatusCode::OK,
        None,
        CountDetail {
            tenant_id: tenant,
            can_edit,
            count,
            lines,
        },
    ))
}

pub async fn count_line(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<LineInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let counted = crate::domains::fixed(&input.counted_quantity, 6)?;
    input.note = input.note.map(|v| v.trim().to_owned());
    if input.note.as_ref().is_some_and(|v| v.len() > 500) {
        return Err(DomainError::Invalid("Observação muito longa"));
    }
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "inventory.counts.read",
        "inventory.counts.manage",
        true,
    )
    .await?;
    let request =
        serde_json::to_value(&input).map_err(|_| crate::platform::access::AccessError::Internal)?;
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "inventory.count.line",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::NO_CONTENT, None, previous));
    }
    let count = load_count(&mut tx, tenant, id).await?;
    if count.status != "open" {
        return Err(DomainError::Conflict(
            "Este inventário não está aberto para contagem",
        ));
    }
    catalog::load(&mut tx, tenant, input.product_id).await?;
    sqlx::query("UPDATE inventory_count_lines SET counted_quantity_micros=$4,note=$5,counted_at=clock_timestamp() WHERE tenant_id=$1 AND count_id=$2 AND product_id=$3").bind(tenant).bind(id).bind(input.product_id).bind(counted).bind(input.note).execute(&mut *tx).await.map_err(db)?;
    if sqlx::query(
        "SELECT 1 FROM inventory_count_lines WHERE tenant_id=$1 AND count_id=$2 AND product_id=$3",
    )
    .bind(tenant)
    .bind(id)
    .bind(input.product_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .is_none()
    {
        return Err(DomainError::NotFound);
    }
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "inventory_count", id, event: "inventory.count.line_counted", details: serde_json::json!({"productId": input.product_id, "countedQuantity": input.counted_quantity}) }).await?;
    let result = serde_json::json!({ "countId": id, "productId": input.product_id });
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "inventory.count.line",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::NO_CONTENT, None, result))
}

pub async fn approve(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "inventory.counts.read",
        "inventory.counts.manage",
        true,
    )
    .await?;
    let request = serde_json::json!({ "countId": id });
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "inventory.count.approve",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, previous));
    }
    let count = load_count(&mut tx, tenant, id).await?;
    if count.status != "open" {
        return Err(DomainError::Conflict("Este inventário já foi encerrado"));
    }
    let missing: i64 = sqlx::query_scalar("SELECT count(*) FROM inventory_count_lines WHERE tenant_id=$1 AND count_id=$2 AND counted_quantity_micros IS NULL").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    if missing > 0 {
        return Err(DomainError::Conflict(
            "Conte todos os produtos antes de aprovar o inventário",
        ));
    }
    let lines = sqlx::query_as::<_,(Uuid,i64,i64)>("SELECT product_id,expected_quantity_micros,counted_quantity_micros FROM inventory_count_lines WHERE tenant_id=$1 AND count_id=$2").bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    for (product_id, _expected, counted) in lines {
        let current: i64 = sqlx::query_scalar("SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE").bind(tenant).bind(product_id).fetch_optional(&mut *tx).await.map_err(db)?.unwrap_or(0);
        let diff = counted - current;
        if diff == 0 {
            continue;
        }
        let direction = if diff > 0 { "receipt" } else { "issue" };
        let quantity = diff.unsigned_abs() as i64;
        let reserved = super::sales::reserved(&mut tx, tenant, product_id).await?;
        if direction == "issue" && current - quantity < reserved {
            return Err(DomainError::Conflict(
                "A contagem reduziria o saldo abaixo do estoque reservado",
            ));
        }
        let next = if direction == "receipt" {
            current + quantity
        } else {
            current - quantity
        };
        sqlx::query("INSERT INTO stock_balances(tenant_id,product_id,quantity_micros) VALUES($1,$2,0) ON CONFLICT DO NOTHING").bind(tenant).bind(product_id).execute(&mut *tx).await.map_err(db)?;
        sqlx::query(
            "UPDATE stock_balances SET quantity_micros=$3 WHERE tenant_id=$1 AND product_id=$2",
        )
        .bind(tenant)
        .bind(product_id)
        .bind(next)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        let movement = Uuid::now_v7();
        sqlx::query("INSERT INTO stock_movements(id,tenant_id,product_id,direction,quantity_micros,balance_after_micros,reason) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(movement).bind(tenant).bind(product_id).bind(direction).bind(quantity).bind(next).bind(format!("Ajuste do inventário {id}")).execute(&mut *tx).await.map_err(db)?;
        record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"stock_movement",id:movement,event:"stock.moved",details:serde_json::json!({"inventoryCountId":id,"productId":product_id,"direction":direction,"quantity":decimal(quantity,6),"balanceAfter":decimal(next,6)})}).await?;
    }
    sqlx::query("UPDATE inventory_counts SET status='approved',approved_by=$3,approved_at=clock_timestamp(),revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND status='open'").bind(tenant).bind(id).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "inventory_count",
            id,
            event: "inventory.count.approved",
            details: serde_json::json!({}),
        },
    )
    .await?;
    let result = serde_json::json!({"id":id,"status":"approved"});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "inventory.count.approve",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}
