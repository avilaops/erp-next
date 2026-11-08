use super::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    revision,
};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

const READ: &str = "logistics.checkout.read";
const MANAGE: &str = "logistics.checkout.manage";

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StartInput {
    pub order_id: Uuid,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CheckInput {
    pub checked_quantity_micros: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PackageInput {
    pub weight_grams: i64,
    pub length_mm: i32,
    pub width_mm: i32,
    pub height_mm: i32,
    pub label_code: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PackageStatusInput {
    pub status: String,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/logistics/checkouts", get(list).post(start))
        .route("/api/v1/logistics/checkouts/{id}", get(get_one))
        .route(
            "/api/v1/logistics/checkouts/{id}/lines/{line}/check",
            post(check_line),
        )
        .route(
            "/api/v1/logistics/checkouts/{id}/packages",
            post(add_package),
        )
        .route(
            "/api/v1/logistics/checkouts/{id}/packages/{package_id}/status",
            post(change_package_status),
        )
        .route("/api/v1/logistics/checkouts/{id}/complete", post(complete))
}

pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let rows = sqlx::query("SELECT id,order_id,status,revision,started_at,completed_at FROM logistics_checkouts WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100").bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    let data = rows.into_iter().map(|row| json!({"id":row.get::<Uuid,_>("id"),"orderId":row.get::<Uuid,_>("order_id"),"status":row.get::<String,_>("status"),"revision":row.get::<i64,_>("revision"),"startedAt":row.get::<time::OffsetDateTime,_>("started_at"),"completedAt":row.get::<Option<time::OffsetDateTime>,_>("completed_at")})).collect::<Vec<_>>();
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data}),
    ))
}

pub async fn start(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Json(input): Json<StartInput>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let request =
        serde_json::to_value(&input).map_err(|_| DomainError::Invalid("Entrada inválida"))?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.checkout.start",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let order = sqlx::query("SELECT id FROM sales_orders WHERE tenant_id=$1 AND id=$2 AND status IN ('confirmed','completed') FOR UPDATE").bind(tenant).bind(input.order_id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let order_id = order.get::<Uuid, _>("id");
    let existing = sqlx::query(
        "SELECT id,status,revision FROM logistics_checkouts WHERE tenant_id=$1 AND order_id=$2",
    )
    .bind(tenant)
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?;
    if let Some(row) = existing {
        let id = row.get::<Uuid, _>("id");
        let result = json!({"tenantId":tenant,"data":{"id":id,"orderId":order_id,"status":row.get::<String,_>("status"),"revision":row.get::<i64,_>("revision")}});
        remember(
            &mut tx,
            tenant,
            &identity.subject,
            key,
            "logistics.checkout.start",
            &request,
            &result,
        )
        .await?;
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let lines = sqlx::query("SELECT line_number,product_id,sku,name,quantity_micros FROM sales_order_lines WHERE tenant_id=$1 AND order_id=$2 ORDER BY line_number").bind(tenant).bind(order_id).fetch_all(&mut *tx).await.map_err(db)?;
    if lines.is_empty() {
        return Err(DomainError::Conflict("Pedido sem itens para conferência"));
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO logistics_checkouts(id,tenant_id,order_id) VALUES($1,$2,$3)")
        .bind(id)
        .bind(tenant)
        .bind(order_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    for line in &lines {
        sqlx::query("INSERT INTO logistics_checkout_lines(tenant_id,checkout_id,line_number,product_id,sku,name,expected_quantity_micros) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(tenant).bind(id).bind(line.get::<i32,_>("line_number")).bind(line.get::<Uuid,_>("product_id")).bind(line.get::<String,_>("sku")).bind(line.get::<String,_>("name")).bind(line.get::<i64,_>("quantity_micros")).execute(&mut *tx).await.map_err(db)?;
    }
    let result = json!({"tenantId":tenant,"data":{"id":id,"orderId":order_id,"status":"counting","revision":1}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "logistics_checkout",
            id,
            event: "logistics.checkout.started",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.checkout.start",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}

pub async fn get_one(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let checkout=sqlx::query("SELECT id,order_id,status,revision,started_at,completed_at FROM logistics_checkouts WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let lines=sqlx::query("SELECT line_number,product_id,sku,name,expected_quantity_micros,checked_quantity_micros FROM logistics_checkout_lines WHERE tenant_id=$1 AND checkout_id=$2 ORDER BY line_number").bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    let packages=sqlx::query("SELECT id,package_number,weight_grams,length_mm,width_mm,height_mm,label_code,status FROM logistics_checkout_packages WHERE tenant_id=$1 AND checkout_id=$2 ORDER BY package_number").bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    let data = json!({"id":checkout.get::<Uuid,_>("id"),"orderId":checkout.get::<Uuid,_>("order_id"),"status":checkout.get::<String,_>("status"),"revision":checkout.get::<i64,_>("revision"),"startedAt":checkout.get::<time::OffsetDateTime,_>("started_at"),"completedAt":checkout.get::<Option<time::OffsetDateTime>,_>("completed_at"),"lines":lines.into_iter().map(|row|json!({"lineNumber":row.get::<i32,_>("line_number"),"productId":row.get::<Uuid,_>("product_id"),"sku":row.get::<String,_>("sku"),"name":row.get::<String,_>("name"),"expectedQuantityMicros":row.get::<i64,_>("expected_quantity_micros"),"checkedQuantityMicros":row.get::<i64,_>("checked_quantity_micros")})).collect::<Vec<_>>(),"packages":packages.into_iter().map(|row|json!({"id":row.get::<Uuid,_>("id"),"packageNumber":row.get::<i32,_>("package_number"),"weightGrams":row.get::<i64,_>("weight_grams"),"lengthMm":row.get::<i32,_>("length_mm"),"widthMm":row.get::<i32,_>("width_mm"),"heightMm":row.get::<i32,_>("height_mm"),"labelCode":row.get::<Option<String>,_>("label_code"),"status":row.get::<String,_>("status")})).collect::<Vec<_>>()});
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data["revision"].as_i64().unwrap_or(1)),
        json!({"tenantId":tenant,"data":data}),
    ))
}

pub async fn add_package(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<PackageInput>,
) -> Result<Response, DomainError> {
    if input.weight_grams < 1 || input.length_mm < 1 || input.width_mm < 1 || input.height_mm < 1 {
        return Err(DomainError::Invalid(
            "Dimensões e peso do volume são obrigatórios",
        ));
    }
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let request =
        serde_json::to_value(&input).map_err(|_| DomainError::Invalid("Entrada inválida"))?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.checkout.package",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let checkout = sqlx::query(
        "SELECT status,revision FROM logistics_checkouts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    if checkout.get::<String, _>("status") != "counting" {
        return Err(DomainError::Conflict("Checkout não está aberto"));
    }
    if checkout.get::<i64, _>("revision") != expected {
        return Err(DomainError::StaleRevision);
    }
    let number: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(package_number),0)+1 FROM logistics_checkout_packages WHERE tenant_id=$1 AND checkout_id=$2").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    let package_id = Uuid::now_v7();
    sqlx::query("INSERT INTO logistics_checkout_packages(id,tenant_id,checkout_id,package_number,weight_grams,length_mm,width_mm,height_mm,label_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(package_id).bind(tenant).bind(id).bind(number).bind(input.weight_grams).bind(input.length_mm).bind(input.width_mm).bind(input.height_mm).bind(&input.label_code).execute(&mut *tx).await.map_err(db)?;
    let new_revision = expected + 1;
    sqlx::query(
        "UPDATE logistics_checkouts SET revision=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .bind(new_revision)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    let result = json!({"tenantId":tenant,"data":{"id":package_id,"checkoutId":id,"packageNumber":number,"weightGrams":input.weight_grams,"lengthMm":input.length_mm,"widthMm":input.width_mm,"heightMm":input.height_mm,"labelCode":input.label_code,"status":"prepared","revision":new_revision}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "logistics_checkout",
            id,
            event: "logistics.checkout.package_added",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.checkout.package",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(new_revision), result))
}

pub async fn change_package_status(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path((id, package_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<PackageStatusInput>,
) -> Result<Response, DomainError> {
    if !matches!(input.status.as_str(), "labelled" | "packed") {
        return Err(DomainError::Invalid("Status de volume inválido"));
    }
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let request =
        serde_json::to_value(&input).map_err(|_| DomainError::Invalid("Entrada inválida"))?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.checkout.package.status",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let checkout = sqlx::query(
        "SELECT status,revision FROM logistics_checkouts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    if checkout.get::<String, _>("status") != "counting" {
        return Err(DomainError::Conflict("Checkout não está aberto"));
    }
    if checkout.get::<i64, _>("revision") != expected {
        return Err(DomainError::StaleRevision);
    }
    let current = sqlx::query("SELECT package_number,status FROM logistics_checkout_packages WHERE tenant_id=$1 AND checkout_id=$2 AND id=$3 FOR UPDATE").bind(tenant).bind(id).bind(package_id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let current_status = current.get::<String, _>("status");
    let allowed = matches!(
        (current_status.as_str(), input.status.as_str()),
        ("prepared", "labelled") | ("labelled", "packed")
    );
    if !allowed {
        return Err(DomainError::Conflict("Transição de volume inválida"));
    }
    sqlx::query("UPDATE logistics_checkout_packages SET status=$4 WHERE tenant_id=$1 AND checkout_id=$2 AND id=$3").bind(tenant).bind(id).bind(package_id).bind(&input.status).execute(&mut *tx).await.map_err(db)?;
    let new_revision = expected + 1;
    sqlx::query(
        "UPDATE logistics_checkouts SET revision=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .bind(new_revision)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    let result = json!({"tenantId":tenant,"data":{"id":package_id,"checkoutId":id,"packageNumber":current.get::<i32,_>("package_number"),"status":input.status,"revision":new_revision}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "logistics_checkout",
            id: package_id,
            event: "logistics.checkout.package_status_changed",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.checkout.package.status",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(new_revision), result))
}

pub async fn check_line(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path((id, line)): Path<(Uuid, i32)>,
    Json(input): Json<CheckInput>,
) -> Result<Response, DomainError> {
    if input.checked_quantity_micros < 0 {
        return Err(DomainError::Invalid("Quantidade conferida inválida"));
    }
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let request =
        serde_json::to_value(&input).map_err(|_| DomainError::Invalid("Entrada inválida"))?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.checkout.check",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let checkout = sqlx::query(
        "SELECT status,revision FROM logistics_checkouts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    if checkout.get::<String, _>("status") != "counting" {
        return Err(DomainError::Conflict("Checkout não está aberto"));
    }
    if checkout.get::<i64, _>("revision") != expected {
        return Err(DomainError::StaleRevision);
    }
    let line_row=sqlx::query("SELECT expected_quantity_micros FROM logistics_checkout_lines WHERE tenant_id=$1 AND checkout_id=$2 AND line_number=$3").bind(tenant).bind(id).bind(line).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if input.checked_quantity_micros > line_row.get::<i64, _>("expected_quantity_micros") {
        return Err(DomainError::Invalid(
            "Quantidade conferida maior que a esperada",
        ));
    }
    let new_revision = expected + 1;
    sqlx::query("UPDATE logistics_checkout_lines SET checked_quantity_micros=$4 WHERE tenant_id=$1 AND checkout_id=$2 AND line_number=$3").bind(tenant).bind(id).bind(line).bind(input.checked_quantity_micros).execute(&mut *tx).await.map_err(db)?;
    sqlx::query(
        "UPDATE logistics_checkouts SET revision=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .bind(new_revision)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    let result = json!({"tenantId":tenant,"data":{"id":id,"lineNumber":line,"checkedQuantityMicros":input.checked_quantity_micros,"revision":new_revision}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "logistics_checkout",
            id,
            event: "logistics.checkout.line_checked",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.checkout.check",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(new_revision), result))
}

pub async fn complete(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(_input): Json<serde_json::Value>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let request = json!({"revision":expected});
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.checkout.complete",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let checkout=sqlx::query("SELECT order_id,status,revision FROM logistics_checkouts WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if checkout.get::<String, _>("status") != "counting" {
        return Err(DomainError::Conflict("Checkout não está aberto"));
    }
    if checkout.get::<i64, _>("revision") != expected {
        return Err(DomainError::StaleRevision);
    }
    let incomplete=sqlx::query_scalar::<_,i64>("SELECT count(*) FROM logistics_checkout_lines WHERE tenant_id=$1 AND checkout_id=$2 AND checked_quantity_micros<>expected_quantity_micros").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    if incomplete > 0 {
        return Err(DomainError::Conflict("Ainda existem itens não conferidos"));
    }
    let new_revision = expected + 1;
    sqlx::query("UPDATE logistics_checkouts SET status='completed',revision=$3,completed_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(new_revision).execute(&mut *tx).await.map_err(db)?;
    let result = json!({"tenantId":tenant,"data":{"id":id,"orderId":checkout.get::<Uuid,_>("order_id"),"status":"completed","revision":new_revision}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "logistics_checkout",
            id,
            event: "logistics.checkout.completed",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.checkout.complete",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(new_revision), result))
}
