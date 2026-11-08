use super::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
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
pub struct PostingPackageInput {
    pub checkout_id: Uuid,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/logistics/labels", get(list_labels))
        .route(
            "/api/v1/logistics/checkouts/{id}/labels",
            get(list_labels).post(queue_labels),
        )
        .route(
            "/api/v1/logistics/postings/{id}/packages",
            post(link_posting_packages),
        )
}

pub async fn list_labels(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let rows = sqlx::query("SELECT j.id,j.checkout_id,j.package_id,j.status,j.created_at,p.package_number,p.label_code FROM logistics_label_jobs j JOIN logistics_checkout_packages p ON p.tenant_id=j.tenant_id AND p.id=j.package_id WHERE j.tenant_id=$1 ORDER BY j.created_at DESC,j.id DESC LIMIT 100").bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    let data = rows.into_iter().map(|row| json!({"id":row.get::<Uuid,_>("id"),"checkoutId":row.get::<Uuid,_>("checkout_id"),"packageId":row.get::<Uuid,_>("package_id"),"packageNumber":row.get::<i32,_>("package_number"),"labelCode":row.get::<Option<String>,_>("label_code"),"status":row.get::<String,_>("status"),"createdAt":row.get::<time::OffsetDateTime,_>("created_at")})).collect::<Vec<_>>();
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data}),
    ))
}

pub async fn queue_labels(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(checkout_id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let request = json!({"checkoutId": checkout_id});
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.labels.queue",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    let checkout = sqlx::query(
        "SELECT status FROM logistics_checkouts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(checkout_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    if checkout.get::<String, _>("status") == "cancelled" {
        return Err(DomainError::Conflict("Checkout cancelado"));
    }
    let packages = sqlx::query("SELECT id FROM logistics_checkout_packages WHERE tenant_id=$1 AND checkout_id=$2 AND status='labelled' ORDER BY package_number").bind(tenant).bind(checkout_id).fetch_all(&mut *tx).await.map_err(db)?;
    if packages.is_empty() {
        return Err(DomainError::Conflict(
            "Nenhum volume etiquetável encontrado",
        ));
    }
    let mut ids = Vec::with_capacity(packages.len());
    for package in packages {
        let package_id = package.get::<Uuid, _>("id");
        let job_id = Uuid::now_v7();
        let row = sqlx::query("INSERT INTO logistics_label_jobs(id,tenant_id,checkout_id,package_id) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id,package_id) DO UPDATE SET updated_at=now() RETURNING id").bind(job_id).bind(tenant).bind(checkout_id).bind(package_id).fetch_one(&mut *tx).await.map_err(db)?;
        ids.push(row.get::<Uuid, _>("id"));
    }
    let result = json!({"tenantId": tenant, "data": {"checkoutId": checkout_id, "jobIds": ids, "status": "queued"}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "logistics_labels",
            id: checkout_id,
            event: "logistics.labels.queued",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.labels.queue",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, None, result))
}

pub async fn link_posting_packages(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(posting_id): Path<Uuid>,
    Json(input): Json<PostingPackageInput>,
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
        "logistics.posting.packages",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, None, result));
    }
    sqlx::query("SELECT id FROM logistics_postings WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
        .bind(tenant)
        .bind(posting_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::NotFound)?;
    let packages = sqlx::query("SELECT id FROM logistics_checkout_packages WHERE tenant_id=$1 AND checkout_id=$2 AND status='packed' ORDER BY package_number").bind(tenant).bind(input.checkout_id).fetch_all(&mut *tx).await.map_err(db)?;
    if packages.is_empty() {
        return Err(DomainError::Conflict("Nenhum volume embalado encontrado"));
    }
    let mut linked = Vec::with_capacity(packages.len());
    for package in packages {
        let package_id = package.get::<Uuid, _>("id");
        sqlx::query("INSERT INTO logistics_posting_packages(tenant_id,posting_id,package_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING").bind(tenant).bind(posting_id).bind(package_id).execute(&mut *tx).await.map_err(db)?;
        linked.push(package_id);
    }
    let result = json!({"tenantId": tenant, "data": {"postingId": posting_id, "checkoutId": input.checkout_id, "packageIds": linked}});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "logistics_posting",
            id: posting_id,
            event: "logistics.posting.packages_linked",
            details: result.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "logistics.posting.packages",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}
