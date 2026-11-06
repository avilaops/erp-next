use super::{
    DomainChange, DomainError, authorized, command_key, db, fixed, record, remember, replay,
    response, revision,
};
use crate::platform::access::{load_access, require_permission};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

const READ: &str = "service.warranties.read";
const MANAGE: &str = "service.warranties.manage";
const APPROVE: &str = "service.warranties.approve";

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PolicyInput {
    pub name: String,
    pub coverage_type: String,
    pub duration_days: i32,
    #[serde(default)]
    pub scope: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CaseInput {
    pub title: String,
    pub description: String,
    pub criticality: String,
    pub policy_id: Option<Uuid>,
    pub customer_id: Option<Uuid>,
    pub order_id: Option<Uuid>,
    pub product_id: Option<Uuid>,
    pub serial_number: Option<String>,
    pub lot: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TransitionInput {
    pub status: String,
    pub details: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ServiceOrderInput {
    pub diagnosis: Option<String>,
    pub report: Value,
    pub scheduled_at: Option<String>,
    pub labor_cents: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PartInput {
    pub product_id: Uuid,
    pub quantity: String,
    pub amount_cents: i64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApprovalInput {
    pub action: String,
    pub decision: String,
    pub amount_cents: Option<i64>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RmaInput {
    pub supplier_id: Option<Uuid>,
    pub carrier: Option<String>,
    pub tracking_code: Option<String>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RmaTransitionInput {
    pub status: String,
    #[serde(default)]
    pub details: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QuarantineInput {
    pub product_id: Uuid,
    pub quantity: String,
    pub reason: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QuarantineTransitionInput {
    pub status: String,
    #[serde(default)]
    pub details: Value,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/warranty-policies",
            get(list_policies).post(create_policy),
        )
        .route("/api/v1/warranty-cases", get(list_cases).post(create_case))
        .route("/api/v1/warranty-cases/{id}", get(get_case))
        .route("/api/v1/warranty-cases/{id}/transition", post(transition))
        .route(
            "/api/v1/warranty-cases/{id}/service-order",
            post(service_order),
        )
        .route("/api/v1/warranty-service-orders/{id}/parts", post(add_part))
        .route("/api/v1/warranty-cases/{id}/approval", post(approve_case))
        .route("/api/v1/warranty-cases/{id}/rma", post(create_rma))
        .route(
            "/api/v1/warranty-rmas/{id}/transition",
            post(transition_rma),
        )
        .route(
            "/api/v1/warranty-cases/{id}/quarantine",
            post(create_quarantine),
        )
        .route(
            "/api/v1/warranty-quarantines/{id}/transition",
            post(transition_quarantine),
        )
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

fn choice<'a>(value: &'a str, allowed: &[&str]) -> Result<&'a str, DomainError> {
    allowed
        .contains(&value)
        .then_some(value)
        .ok_or(DomainError::Invalid("Opção não suportada"))
}

pub async fn list_policies(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let rows = sqlx::query("SELECT id,name,coverage_type,duration_days,scope,status,revision,updated_at FROM warranty_policies WHERE tenant_id=$1 ORDER BY name,id")
        .bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    let data: Vec<Value> = rows.into_iter().map(|row| json!({
        "id": row.get::<Uuid,_>("id"), "name": row.get::<String,_>("name"),
        "coverageType": row.get::<String,_>("coverage_type"), "durationDays": row.get::<i32,_>("duration_days"),
        "scope": row.get::<Value,_>("scope"), "status": row.get::<String,_>("status"),
        "revision": row.get::<i64,_>("revision"), "updatedAt": row.get::<time::OffsetDateTime,_>("updated_at")
    })).collect();
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId": tenant, "data": data}),
    ))
}

pub async fn create_policy(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Json(input): Json<PolicyInput>,
) -> Result<Response, DomainError> {
    let name = text(&input.name, 3, 120)?;
    let coverage = choice(&input.coverage_type, &["legal", "contractual", "extended"])?;
    if !(1..=3650).contains(&input.duration_days) {
        return Err(DomainError::Invalid("Duração da garantia inválida"));
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
        "warranty.policy.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let id = Uuid::now_v7();
    let result = json!({"tenantId": tenant, "data": {"id": id, "name": name, "coverageType": coverage, "durationDays": input.duration_days, "scope": input.scope, "status": "active", "revision": 1}});
    sqlx::query("INSERT INTO warranty_policies(id,tenant_id,name,coverage_type,duration_days,scope) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(id).bind(tenant).bind(&name).bind(coverage).bind(input.duration_days).bind(&input.scope).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "warranty_policy",
            id,
            event: "warranty.policy.created",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.policy.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}

pub async fn list_cases(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let rows = sqlx::query("SELECT id,protocol,title,criticality,coverage_status,status,serial_number,lot,revision,created_at,updated_at FROM warranty_cases WHERE tenant_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 200")
        .bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    let data: Vec<Value> = rows.into_iter().map(|row| json!({
        "id": row.get::<Uuid,_>("id"), "protocol": row.get::<String,_>("protocol"), "title": row.get::<String,_>("title"),
        "criticality": row.get::<String,_>("criticality"), "coverageStatus": row.get::<String,_>("coverage_status"),
        "status": row.get::<String,_>("status"), "serialNumber": row.get::<Option<String>,_>("serial_number"),
        "lot": row.get::<Option<String>,_>("lot"), "revision": row.get::<i64,_>("revision"),
        "createdAt": row.get::<time::OffsetDateTime,_>("created_at"), "updatedAt": row.get::<time::OffsetDateTime,_>("updated_at")
    })).collect();
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId": tenant, "data": data}),
    ))
}

pub async fn create_case(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Json(input): Json<CaseInput>,
) -> Result<Response, DomainError> {
    let title = text(&input.title, 3, 160)?;
    let description = text(&input.description, 15, 10000)?;
    let criticality = choice(&input.criticality, &["low", "normal", "high", "critical"])?;
    for value in [&input.serial_number, &input.lot].into_iter().flatten() {
        text(value, 1, 120)?;
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
        "warranty.case.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let id = Uuid::now_v7();
    let protocol = format!("GAR-{}", id.simple());
    let result = json!({"tenantId": tenant, "data": {"id": id, "protocol": protocol, "title": title, "description": description, "criticality": criticality, "coverageStatus": "pending", "status": "opened", "revision": 1}});
    sqlx::query("INSERT INTO warranty_cases(id,tenant_id,protocol,policy_id,customer_id,order_id,product_id,serial_number,lot,title,description,criticality) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
        .bind(id).bind(tenant).bind(&protocol).bind(input.policy_id).bind(input.customer_id).bind(input.order_id).bind(input.product_id).bind(input.serial_number.as_deref()).bind(input.lot.as_deref()).bind(&title).bind(&description).bind(criticality).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO warranty_case_events(id,tenant_id,case_id,event_type,status,details) VALUES($1,$2,$3,'opened','opened',$4)")
        .bind(Uuid::now_v7()).bind(tenant).bind(id).bind(&result).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "warranty_case",
            id,
            event: "warranty.case.opened",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.case.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}

pub async fn get_case(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let case = sqlx::query("SELECT id,protocol,title,description,criticality,coverage_status,status,serial_number,lot,revision,created_at,updated_at FROM warranty_cases WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let events = sqlx::query("SELECT id,event_type,status,details,created_at FROM warranty_case_events WHERE tenant_id=$1 AND case_id=$2 ORDER BY created_at,id")
        .bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    let timeline: Vec<Value> = events.into_iter().map(|row| json!({"id": row.get::<Uuid,_>("id"), "eventType": row.get::<String,_>("event_type"), "status": row.get::<Option<String>,_>("status"), "details": row.get::<Value,_>("details"), "createdAt": row.get::<time::OffsetDateTime,_>("created_at")})).collect();
    Ok(response(
        StatusCode::OK,
        Some(case.get::<i64, _>("revision")),
        json!({"tenantId": tenant, "data": {"id": case.get::<Uuid,_>("id"), "protocol": case.get::<String,_>("protocol"), "title": case.get::<String,_>("title"), "description": case.get::<String,_>("description"), "criticality": case.get::<String,_>("criticality"), "coverageStatus": case.get::<String,_>("coverage_status"), "status": case.get::<String,_>("status"), "serialNumber": case.get::<Option<String>,_>("serial_number"), "lot": case.get::<Option<String>,_>("lot"), "timeline": timeline}}),
    ))
}

pub async fn transition(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<TransitionInput>,
) -> Result<Response, DomainError> {
    let status = choice(
        &input.status,
        &[
            "triage",
            "diagnosis",
            "treatment",
            "resolved",
            "closed",
            "cancelled",
        ],
    )?;
    let key = command_key(&headers)?;
    let request =
        serde_json::to_value(&input).map_err(|_| DomainError::Invalid("Entrada inválida"))?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.case.transition",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let next = sqlx::query_scalar::<_, i64>("UPDATE warranty_cases SET status=$3,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$4 RETURNING revision")
        .bind(tenant).bind(id).bind(status).bind(expected).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::StaleRevision)?;
    let event = match status {
        "triage" => "triaged",
        "diagnosis" => "diagnosed",
        "treatment" => "treated",
        "resolved" => "resolved",
        "closed" => "closed",
        _ => "cancelled",
    };
    sqlx::query("INSERT INTO warranty_case_events(id,tenant_id,case_id,event_type,status,details) VALUES($1,$2,$3,$4,$5,$6)").bind(Uuid::now_v7()).bind(tenant).bind(id).bind(event).bind(status).bind(&input.details).execute(&mut *tx).await.map_err(db)?;
    let result =
        json!({"tenantId": tenant, "data": {"id": id, "status": status, "revision": next}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "warranty_case",
            id,
            event: "warranty.case.transitioned",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.case.transition",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}

pub async fn service_order(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<ServiceOrderInput>,
) -> Result<Response, DomainError> {
    if input.labor_cents < 0 || input.labor_cents > 99_999_999_999_999 {
        return Err(DomainError::Invalid("Mão de obra inválida"));
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
        "warranty.service-order.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    sqlx::query(
        "SELECT id FROM warranty_cases WHERE tenant_id=$1 AND id=$2 AND revision=$3 FOR UPDATE",
    )
    .bind(tenant)
    .bind(id)
    .bind(expected)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::StaleRevision)?;
    let service_id = Uuid::now_v7();
    sqlx::query("INSERT INTO warranty_service_orders(id,tenant_id,case_id,diagnosis,report,scheduled_at,labor_cents) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(service_id).bind(tenant).bind(id).bind(input.diagnosis.as_deref()).bind(&input.report).bind(input.scheduled_at.as_deref()).bind(input.labor_cents).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE warranty_cases SET status='treatment',revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$3").bind(tenant).bind(id).bind(expected).execute(&mut *tx).await.map_err(db)?;
    let result = json!({"tenantId": tenant, "data": {"id": service_id, "caseId": id, "status": "open", "laborCents": input.labor_cents}});
    sqlx::query("INSERT INTO warranty_case_events(id,tenant_id,case_id,event_type,status,details) VALUES($1,$2,$3,'treated','treatment',$4)").bind(Uuid::now_v7()).bind(tenant).bind(id).bind(&result).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "warranty_service_order",
            id: service_id,
            event: "warranty.service_order.created",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.service-order.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(expected + 1), result))
}

pub async fn add_part(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<PartInput>,
) -> Result<Response, DomainError> {
    let quantity = fixed(&input.quantity, 6)?;
    if quantity <= 0 {
        return Err(DomainError::Invalid("Quantidade de peça inválida"));
    }
    if input.amount_cents < 0 || input.amount_cents > 99_999_999_999_999 {
        return Err(DomainError::Invalid("Valor da peça inválido"));
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
        "warranty.service-order.part.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let service = sqlx::query(
        "SELECT so.case_id, so.revision, p.name, p.sku FROM warranty_service_orders so JOIN products p ON p.tenant_id=$1 AND p.id=$2 AND p.status='active' WHERE so.tenant_id=$1 AND so.id=$3 AND so.revision=$4 FOR UPDATE OF so",
    )
    .bind(tenant)
    .bind(input.product_id)
    .bind(id)
    .bind(expected)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::StaleRevision)?;
    let part_id = Uuid::now_v7();
    sqlx::query("INSERT INTO warranty_service_order_parts(id,tenant_id,service_order_id,product_id,product_name,sku,quantity_micros,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(part_id)
        .bind(tenant)
        .bind(id)
        .bind(input.product_id)
        .bind(service.get::<String, _>("name"))
        .bind(service.get::<String, _>("sku"))
        .bind(quantity)
        .bind(input.amount_cents)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let next = sqlx::query_scalar::<_, i64>(
        "UPDATE warranty_service_orders SET status='in_repair', revision=revision+1, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING revision",
    )
    .bind(tenant)
    .bind(id)
    .bind(expected)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    let case_id = service.get::<Uuid, _>("case_id");
    let result = json!({"tenantId": tenant, "data": {"id": part_id, "serviceOrderId": id, "caseId": case_id, "productId": input.product_id, "productName": service.get::<String, _>("name"), "sku": service.get::<String, _>("sku"), "quantity": input.quantity, "amountCents": input.amount_cents, "revision": next}});
    sqlx::query("INSERT INTO warranty_case_events(id,tenant_id,case_id,event_type,status,details) VALUES($1,$2,$3,'treated','in_repair',$4)")
        .bind(Uuid::now_v7())
        .bind(tenant)
        .bind(case_id)
        .bind(&result)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "warranty_service_order_part",
            id: part_id,
            event: "warranty.service_order.part_added",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.service-order.part.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(next), result))
}

pub async fn approve_case(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<ApprovalInput>,
) -> Result<Response, DomainError> {
    let action = choice(&input.action, &["exchange", "credit", "refund"])?;
    let decision = choice(&input.decision, &["approved", "rejected"])?;
    if input
        .amount_cents
        .is_some_and(|value| !(0..=99_999_999_999_999).contains(&value))
    {
        return Err(DomainError::Invalid("Valor da aprovação inválido"));
    }
    let notes = text(&input.notes, 0, 2000)?;
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let request =
        serde_json::to_value(&input).map_err(|_| DomainError::Invalid("Entrada inválida"))?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, APPROVE, true).await?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.case.approval.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    sqlx::query(
        "SELECT id FROM warranty_cases WHERE tenant_id=$1 AND id=$2 AND revision=$3 FOR UPDATE",
    )
    .bind(tenant)
    .bind(id)
    .bind(expected)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::StaleRevision)?;
    let approval_id = Uuid::now_v7();
    sqlx::query("INSERT INTO warranty_approvals(id,tenant_id,case_id,action,decision,amount_cents,notes) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(approval_id)
        .bind(tenant)
        .bind(id)
        .bind(action)
        .bind(decision)
        .bind(input.amount_cents)
        .bind(&notes)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let next = sqlx::query_scalar::<_, i64>(
        "UPDATE warranty_cases SET resolution=jsonb_build_object('approvalId',$3::text,'action',$4::text,'decision',$5::text), revision=revision+1, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$6 RETURNING revision",
    )
    .bind(tenant)
    .bind(id)
    .bind(approval_id)
    .bind(action)
    .bind(decision)
    .bind(expected)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    let result = json!({"tenantId": tenant, "data": {"id": approval_id, "caseId": id, "action": action, "decision": decision, "amountCents": input.amount_cents, "revision": next}});
    sqlx::query("INSERT INTO warranty_case_events(id,tenant_id,case_id,event_type,status,details) VALUES($1,$2,$3,'approval',$4,$5)")
        .bind(Uuid::now_v7())
        .bind(tenant)
        .bind(id)
        .bind(decision)
        .bind(&result)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "warranty_approval",
            id: approval_id,
            event: "warranty.case.approval.created",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.case.approval.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(next), result))
}

pub async fn create_rma(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Json(input): Json<RmaInput>,
) -> Result<Response, DomainError> {
    let carrier = input
        .carrier
        .as_deref()
        .map(|value| text(value, 2, 160))
        .transpose()?;
    let tracking_code = input
        .tracking_code
        .as_deref()
        .map(|value| text(value, 2, 160))
        .transpose()?;
    let notes = text(&input.notes, 0, 4000)?;
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
        "warranty.rma.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    sqlx::query(
        "SELECT id FROM warranty_cases WHERE tenant_id=$1 AND id=$2 AND revision=$3 FOR UPDATE",
    )
    .bind(tenant)
    .bind(case_id)
    .bind(expected)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::StaleRevision)?;
    if let Some(supplier_id) = input.supplier_id {
        let supplier_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM parties WHERE tenant_id=$1 AND id=$2 AND status='active' AND is_supplier)",
        )
        .bind(tenant)
        .bind(supplier_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        if !supplier_exists {
            return Err(DomainError::Conflict("Fornecedor ativo não encontrado"));
        }
    }
    let id = Uuid::now_v7();
    let reference = format!("RMA-{}", id.simple());
    sqlx::query("INSERT INTO warranty_rmas(id,tenant_id,case_id,supplier_id,reference,carrier,tracking_code,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(id)
        .bind(tenant)
        .bind(case_id)
        .bind(input.supplier_id)
        .bind(&reference)
        .bind(carrier.as_deref())
        .bind(tracking_code.as_deref())
        .bind(&notes)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let next = sqlx::query_scalar::<_, i64>(
        "UPDATE warranty_cases SET revision=revision+1, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING revision",
    )
    .bind(tenant)
    .bind(case_id)
    .bind(expected)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    let result = json!({"tenantId": tenant, "data": {"id": id, "caseId": case_id, "reference": reference, "status": "requested", "revision": next}});
    sqlx::query("INSERT INTO warranty_case_events(id,tenant_id,case_id,event_type,status,details) VALUES($1,$2,$3,'note','requested',$4)")
        .bind(Uuid::now_v7())
        .bind(tenant)
        .bind(case_id)
        .bind(&result)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "warranty_rma",
            id,
            event: "warranty.rma.created",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.rma.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(next), result))
}

pub async fn transition_rma(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<RmaTransitionInput>,
) -> Result<Response, DomainError> {
    let status = choice(
        &input.status,
        &[
            "authorized",
            "in_transit",
            "received",
            "closed",
            "cancelled",
        ],
    )?;
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
        "warranty.rma.transition",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let current = sqlx::query(
        "SELECT case_id FROM warranty_rmas WHERE tenant_id=$1 AND id=$2 AND revision=$3 FOR UPDATE",
    )
    .bind(tenant)
    .bind(id)
    .bind(expected)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::StaleRevision)?;
    let case_id = current.get::<Uuid, _>("case_id");
    let next = sqlx::query_scalar::<_, i64>(
        "UPDATE warranty_rmas SET status=$3, revision=revision+1, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$4 RETURNING revision",
    )
    .bind(tenant)
    .bind(id)
    .bind(status)
    .bind(expected)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    let result = json!({"tenantId": tenant, "data": {"id": id, "caseId": case_id, "status": status, "revision": next}});
    sqlx::query("INSERT INTO warranty_case_events(id,tenant_id,case_id,event_type,status,details) VALUES($1,$2,$3,'note',$4,$5)")
        .bind(Uuid::now_v7())
        .bind(tenant)
        .bind(case_id)
        .bind(status)
        .bind(&input.details)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "warranty_rma",
            id,
            event: "warranty.rma.transitioned",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.rma.transition",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}

pub async fn create_quarantine(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Json(input): Json<QuarantineInput>,
) -> Result<Response, DomainError> {
    let quantity = fixed(&input.quantity, 6)?;
    if quantity <= 0 {
        return Err(DomainError::Invalid("Quantidade de quarentena inválida"));
    }
    let reason = text(&input.reason, 3, 500)?;
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let request =
        serde_json::to_value(&input).map_err(|_| DomainError::Invalid("Entrada inválida"))?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    require_permission(
        &load_access(&mut tx, tenant, &identity.subject).await?,
        "inventory.stock.manage",
    )?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.quarantine.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    sqlx::query(
        "SELECT id FROM warranty_cases WHERE tenant_id=$1 AND id=$2 AND revision=$3 FOR UPDATE",
    )
    .bind(tenant)
    .bind(case_id)
    .bind(expected)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::StaleRevision)?;
    let active = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM products WHERE tenant_id=$1 AND id=$2 AND status='active')",
    )
    .bind(tenant)
    .bind(input.product_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    if !active {
        return Err(DomainError::Conflict("Produto ativo não encontrado"));
    }
    sqlx::query(
        "INSERT INTO stock_balances(tenant_id,product_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    )
    .bind(tenant)
    .bind(input.product_id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    let previous = sqlx::query_scalar::<_, i64>(
        "SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(input.product_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    let next = previous
        .checked_sub(quantity)
        .filter(|value| *value >= 0)
        .ok_or(DomainError::Conflict(
            "Saldo insuficiente para colocar o produto em quarentena",
        ))?;
    let reserved = super::sales::reserved(&mut tx, tenant, input.product_id).await?;
    if next < reserved {
        return Err(DomainError::Conflict(
            "Saldo disponível insuficiente: parte do estoque está reservada",
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
    let movement_id = Uuid::now_v7();
    let movement_reason = format!("Garantia {case_id}: {reason}");
    sqlx::query("INSERT INTO stock_movements(id,tenant_id,product_id,direction,quantity_micros,balance_after_micros,reason) VALUES($1,$2,$3,'issue',$4,$5,$6)")
        .bind(movement_id)
        .bind(tenant)
        .bind(input.product_id)
        .bind(quantity)
        .bind(next)
        .bind(&movement_reason)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let quarantine_id = Uuid::now_v7();
    sqlx::query("INSERT INTO warranty_quarantines(id,tenant_id,case_id,product_id,quantity_micros,stock_movement_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(quarantine_id)
        .bind(tenant)
        .bind(case_id)
        .bind(input.product_id)
        .bind(quantity)
        .bind(movement_id)
        .bind(&reason)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let next_case_revision = sqlx::query_scalar::<_, i64>(
        "UPDATE warranty_cases SET revision=revision+1, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING revision",
    )
    .bind(tenant)
    .bind(case_id)
    .bind(expected)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    let result = json!({"tenantId": tenant, "data": {"id": quarantine_id, "caseId": case_id, "productId": input.product_id, "quantity": input.quantity, "status": "quarantined", "stockMovementId": movement_id, "revision": 1, "caseRevision": next_case_revision}});
    sqlx::query("INSERT INTO warranty_case_events(id,tenant_id,case_id,event_type,status,details) VALUES($1,$2,$3,'note','quarantined',$4)")
        .bind(Uuid::now_v7())
        .bind(tenant)
        .bind(case_id)
        .bind(&result)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "warranty_quarantine",
            id: quarantine_id,
            event: "warranty.quarantine.created",
            details: result.clone(),
        },
    )
    .await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "stock_movement",
            id: movement_id,
            event: "stock.moved_to_warranty_quarantine",
            details: json!({"caseId": case_id, "quarantineId": quarantine_id, "productId": input.product_id, "quantity": input.quantity}),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.quarantine.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::CREATED,
        Some(next_case_revision),
        result,
    ))
}

pub async fn transition_quarantine(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<QuarantineTransitionInput>,
) -> Result<Response, DomainError> {
    let status = choice(&input.status, &["released", "disposed"])?;
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let request =
        serde_json::to_value(&input).map_err(|_| DomainError::Invalid("Entrada inválida"))?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    require_permission(
        &load_access(&mut tx, tenant, &identity.subject).await?,
        "inventory.stock.manage",
    )?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.quarantine.transition",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let current = sqlx::query("SELECT case_id,product_id,quantity_micros,stock_movement_id,status FROM warranty_quarantines WHERE tenant_id=$1 AND id=$2 AND revision=$3 FOR UPDATE")
        .bind(tenant)
        .bind(id)
        .bind(expected)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::StaleRevision)?;
    if current.get::<String, _>("status") != "quarantined" {
        return Err(DomainError::Conflict("Quarentena já foi encerrada"));
    }
    let case_id = current.get::<Uuid, _>("case_id");
    let product_id = current.get::<Uuid, _>("product_id");
    let quantity = current.get::<i64, _>("quantity_micros");
    let original_movement = current.get::<Uuid, _>("stock_movement_id");
    let release_movement = if status == "released" {
        sqlx::query(
            "INSERT INTO stock_balances(tenant_id,product_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(tenant)
        .bind(product_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        let previous = sqlx::query_scalar::<_, i64>("SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE")
            .bind(tenant)
            .bind(product_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        let next = previous
            .checked_add(quantity)
            .filter(|value| *value <= 999999999999999999)
            .ok_or(DomainError::Conflict("Limite de estoque excedido"))?;
        sqlx::query(
            "UPDATE stock_balances SET quantity_micros=$3 WHERE tenant_id=$1 AND product_id=$2",
        )
        .bind(tenant)
        .bind(product_id)
        .bind(next)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        let movement_id = Uuid::now_v7();
        sqlx::query("INSERT INTO stock_movements(id,tenant_id,product_id,direction,quantity_micros,balance_after_micros,reason,reverses_id) VALUES($1,$2,$3,'receipt',$4,$5,$6,$7)")
            .bind(movement_id)
            .bind(tenant)
            .bind(product_id)
            .bind(quantity)
            .bind(next)
            .bind("Liberação de quarentena de garantia")
            .bind(original_movement)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        Some(movement_id)
    } else {
        None
    };
    let next = sqlx::query_scalar::<_, i64>("UPDATE warranty_quarantines SET status=$3,release_movement_id=$4,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$5 RETURNING revision")
        .bind(tenant)
        .bind(id)
        .bind(status)
        .bind(release_movement)
        .bind(expected)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    let result = json!({"tenantId": tenant, "data": {"id": id, "caseId": case_id, "status": status, "releaseMovementId": release_movement, "revision": next}});
    sqlx::query("INSERT INTO warranty_case_events(id,tenant_id,case_id,event_type,status,details) VALUES($1,$2,$3,'note',$4,$5)")
        .bind(Uuid::now_v7())
        .bind(tenant)
        .bind(case_id)
        .bind(status)
        .bind(&input.details)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "warranty_quarantine",
            id,
            event: "warranty.quarantine.transitioned",
            details: result.clone(),
        },
    )
    .await?;
    if let Some(movement_id) = release_movement {
        record(
            &mut tx,
            tenant,
            &identity,
            &headers,
            DomainChange {
                kind: "stock_movement",
                id: movement_id,
                event: "stock.restored_from_warranty_quarantine",
                details: json!({"caseId": case_id, "quarantineId": id, "productId": product_id, "quantityMicros": quantity, "reversesId": original_movement}),
            },
        )
        .await?;
    }
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "warranty.quarantine.transition",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}
