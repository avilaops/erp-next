use super::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    revision,
};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

const READ: &str = "logistics.postings.read";
const MANAGE: &str = "logistics.postings.manage";

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub q: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PostingInput {
    pub recipient_name: String,
    pub service: String,
    pub destination_city: String,
    pub destination_state: String,
    pub package_count: i32,
    pub weight_grams: i64,
    pub declared_value_cents: i64,
    pub order_id: Option<Uuid>,
    pub carrier: Option<String>,
    pub tracking_code: Option<String>,
}

fn text(value: &str, min: usize, max: usize) -> Result<String, DomainError> {
    let value = value.trim();
    if value.chars().count() < min
        || value.chars().count() > max
        || value.chars().any(char::is_control)
    {
        return Err(DomainError::Invalid("Texto fora do limite permitido"));
    }
    Ok(value.to_owned())
}

fn status(value: &str) -> Result<&str, DomainError> {
    ["prepared", "posted", "in_transit", "delivered", "cancelled"]
        .contains(&value)
        .then_some(value)
        .ok_or(DomainError::Invalid("Situação de postagem inválida"))
}

fn transition(current: &str, next: &str) -> Result<(), DomainError> {
    if matches!(
        (current, next),
        ("prepared", "posted" | "cancelled")
            | ("posted", "in_transit" | "cancelled")
            | ("in_transit", "delivered" | "cancelled")
    ) {
        Ok(())
    } else {
        Err(DomainError::Conflict("Transição de situação não permitida"))
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/logistics/postings", get(list).post(create))
        .route("/api/v1/logistics/postings/{id}", get(get_one))
        .route(
            "/api/v1/logistics/postings/{id}/status",
            post(change_status),
        )
}

pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let offset = query.offset.unwrap_or(0).max(0);
    let q = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned);
    let wanted_status = query.status.as_deref().map(status).transpose()?;
    let rows = sqlx::query("SELECT id,code,order_id,recipient_name,carrier,service,tracking_code,destination_city,destination_state,package_count,weight_grams,declared_value_cents,status,revision,created_at,updated_at FROM logistics_postings WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR code ILIKE '%'||$3||'%' OR recipient_name ILIKE '%'||$3||'%' OR destination_city ILIKE '%'||$3||'%') ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5")
        .bind(tenant).bind(wanted_status).bind(q).bind(limit).bind(offset).fetch_all(&mut *tx).await.map_err(db)?;
    let data = rows.into_iter().map(|row| json!({
        "id": row.get::<Uuid,_>("id"), "code": row.get::<String,_>("code"), "orderId": row.get::<Option<Uuid>,_>("order_id"),
        "recipientName": row.get::<String,_>("recipient_name"), "carrier": row.get::<Option<String>,_>("carrier"), "service": row.get::<String,_>("service"),
        "trackingCode": row.get::<Option<String>,_>("tracking_code"), "destinationCity": row.get::<String,_>("destination_city"), "destinationState": row.get::<String,_>("destination_state"),
        "packageCount": row.get::<i32,_>("package_count"), "weightGrams": row.get::<i64,_>("weight_grams"), "declaredValueCents": row.get::<i64,_>("declared_value_cents"),
        "status": row.get::<String,_>("status"), "revision": row.get::<i64,_>("revision"), "createdAt": row.get::<time::OffsetDateTime,_>("created_at"), "updatedAt": row.get::<time::OffsetDateTime,_>("updated_at")
    })).collect::<Vec<_>>();
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId": tenant, "data": data, "limit": limit, "offset": offset}),
    ))
}

pub async fn get_one(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let row = sqlx::query("SELECT id,code,order_id,recipient_name,carrier,service,tracking_code,destination_city,destination_state,package_count,weight_grams,declared_value_cents,status,revision,created_at,updated_at FROM logistics_postings WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let data = json!({"id": row.get::<Uuid,_>("id"), "code": row.get::<String,_>("code"), "orderId": row.get::<Option<Uuid>,_>("order_id"), "recipientName": row.get::<String,_>("recipient_name"), "carrier": row.get::<Option<String>,_>("carrier"), "service": row.get::<String,_>("service"), "trackingCode": row.get::<Option<String>,_>("tracking_code"), "destinationCity": row.get::<String,_>("destination_city"), "destinationState": row.get::<String,_>("destination_state"), "packageCount": row.get::<i32,_>("package_count"), "weightGrams": row.get::<i64,_>("weight_grams"), "declaredValueCents": row.get::<i64,_>("declared_value_cents"), "status": row.get::<String,_>("status"), "revision": row.get::<i64,_>("revision"), "createdAt": row.get::<time::OffsetDateTime,_>("created_at"), "updatedAt": row.get::<time::OffsetDateTime,_>("updated_at")});
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data["revision"].as_i64().unwrap_or(1)),
        json!({"tenantId": tenant, "data": data}),
    ))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Json(input): Json<PostingInput>,
) -> Result<Response, DomainError> {
    let recipient = text(&input.recipient_name, 2, 200)?;
    let service = text(&input.service, 2, 80)?;
    let city = text(&input.destination_city, 2, 120)?;
    let state_code = text(&input.destination_state, 2, 2)?.to_uppercase();
    if !state_code.chars().all(|c| c.is_ascii_uppercase())
        || !(1..=999).contains(&input.package_count)
        || !(1..=999999999).contains(&input.weight_grams)
        || !(0..=99999999999999).contains(&input.declared_value_cents)
    {
        return Err(DomainError::Invalid("Dados da postagem inválidos"));
    }
    let key = command_key(&headers)?;
    let request =
        serde_json::to_value(&input).map_err(|_| DomainError::Invalid("Entrada inválida"))?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.posting.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let id = Uuid::now_v7();
    let code = format!("OBJ-{}", &id.simple().to_string()[..8].to_uppercase());
    sqlx::query("INSERT INTO logistics_postings(id,tenant_id,code,order_id,recipient_name,carrier,service,tracking_code,destination_city,destination_state,package_count,weight_grams,declared_value_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)").bind(id).bind(tenant).bind(&code).bind(input.order_id).bind(&recipient).bind(&input.carrier).bind(&service).bind(&input.tracking_code).bind(&city).bind(&state_code).bind(input.package_count).bind(input.weight_grams).bind(input.declared_value_cents).execute(&mut *tx).await.map_err(db)?;
    let result = json!({"tenantId": tenant, "data": {"id": id, "code": code, "recipientName": recipient, "service": service, "destinationCity": city, "destinationState": state_code, "packageCount": input.package_count, "weightGrams": input.weight_grams, "declaredValueCents": input.declared_value_cents, "status": "prepared", "revision": 1}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "logistics_posting",
            id,
            event: "logistics.posting.created",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.posting.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}

pub async fn change_status(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<serde_json::Value>,
) -> Result<Response, DomainError> {
    let next = input
        .get("status")
        .and_then(|v| v.as_str())
        .ok_or(DomainError::Invalid("Informe status"))?;
    status(next)?;
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let request = json!({"status": next, "revision": expected});
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.posting.status",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let current = sqlx::query(
        "SELECT status, revision FROM logistics_postings WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    let current_status = current.get::<String, _>("status");
    let current_revision = current.get::<i64, _>("revision");
    if current_revision != expected {
        return Err(DomainError::StaleRevision);
    }
    transition(&current_status, next)?;
    let next_revision = current_revision + 1;
    sqlx::query("UPDATE logistics_postings SET status=$3, revision=$4, updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(id)
        .bind(next)
        .bind(next_revision)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let result = json!({"tenantId":tenant,"data":{"id":id,"status":next,"revision":next_revision}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "logistics_posting",
            id,
            event: "logistics.posting.status_changed",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.posting.status",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next_revision), result))
}

#[cfg(test)]
mod tests {
    use super::transition;

    #[test]
    fn posting_status_transition_matrix_matches_operational_flow() {
        for (current, next) in [
            ("prepared", "posted"),
            ("posted", "in_transit"),
            ("in_transit", "delivered"),
            ("prepared", "cancelled"),
            ("posted", "cancelled"),
            ("in_transit", "cancelled"),
        ] {
            assert!(transition(current, next).is_ok(), "{current} -> {next}");
        }
    }

    #[test]
    fn posting_status_transition_matrix_rejects_terminal_and_backward_changes() {
        for (current, next) in [
            ("delivered", "cancelled"),
            ("cancelled", "prepared"),
            ("prepared", "in_transit"),
            ("posted", "delivered"),
            ("in_transit", "posted"),
            ("prepared", "prepared"),
        ] {
            assert!(transition(current, next).is_err(), "{current} -> {next}");
        }
    }
}
