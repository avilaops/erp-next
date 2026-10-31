use super::{access, auth::AuthenticatedIdentity, state::AppState};
use crate::domains::{DomainError, db, response};
use axum::{
    Extension,
    extract::{Query, State, rejection::QueryRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

#[derive(Default, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuditQuery {
    q: Option<String>,
    action: Option<String>,
    entity: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    before: Option<Uuid>,
}

#[derive(FromRow, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    id: Uuid,
    occurred_at: String,
    actor: Option<String>,
    action: String,
    entity_type: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditResponse {
    tenant_id: Uuid,
    data: Vec<AuditEvent>,
    next_cursor: Option<Uuid>,
}

fn date(value: Option<&str>) -> Result<Option<Date>, DomainError> {
    let format = time::format_description::parse_borrowed::<2>("[year]-[month]-[day]")
        .map_err(|_| access::AccessError::Internal)?;
    value
        .map(|raw| {
            Date::parse(raw, &format)
                .map_err(|_| DomainError::Invalid("Data inválida; use AAAA-MM-DD"))
        })
        .transpose()
}

#[utoipa::path(get, path="/api/v1/audit", tag="Platform", security(("bearerAuth"=[])),
    params(AuditQuery, ("X-Tenant-Id"=Uuid, Header)),
    responses((status=200,body=AuditResponse),(status=403,description="Consultar auditoria não permitido"),(status=422,description="Filtros inválidos")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<AuditQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let tenant = access::tenant_id(&headers)?;
    let mut tx = access::tenant_transaction(&state, tenant).await?;
    let member = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&member, "platform.audit.read")?;
    let Query(query) = query.map_err(|_| DomainError::Invalid("Filtros de auditoria inválidos"))?;
    for value in [&query.q, &query.action, &query.entity]
        .into_iter()
        .flatten()
    {
        if value.len() > 120 || value.chars().any(char::is_control) {
            return Err(DomainError::Invalid(
                "Filtro deve ter até 120 bytes e não conter caracteres de controle",
            ));
        }
    }
    let start = date(query.start_date.as_deref())?;
    let end = date(query.end_date.as_deref())?;
    if start.zip(end).is_some_and(|(start, end)| start > end) {
        return Err(DomainError::Invalid(
            "Data final deve ser igual ou posterior à inicial",
        ));
    }
    let cursor: Option<(OffsetDateTime, Uuid)> = if let Some(id) = query.before {
        Some(
            sqlx::query_as("SELECT occurred_at,id FROM audit_log WHERE tenant_id=$1 AND id=$2")
                .bind(tenant)
                .bind(id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db)?
                .ok_or(DomainError::Invalid(
                    "Página de auditoria inválida; atualize a consulta",
                ))?,
        )
    } else {
        None
    };
    // Deliberate projection: details, entity identifiers and request metadata never leave this endpoint.
    let mut rows = sqlx::query_as::<_, AuditEvent>(r#"
        SELECT a.id, to_char(a.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
            i.display_name AS actor, a.action, a.entity_type
        FROM audit_log a LEFT JOIN identities i ON i.id=a.identity_id
        WHERE a.tenant_id=$1
          AND ($2::text IS NULL OR strpos(lower(a.action || ' ' || a.entity_type || ' ' || coalesce(i.display_name,'')),lower($2))>0)
          AND ($3::text IS NULL OR a.action=$3)
          AND ($4::text IS NULL OR a.entity_type=$4)
          AND ($5::date IS NULL OR a.occurred_at >= ($5::date::timestamp AT TIME ZONE 'UTC'))
          AND ($6::date IS NULL OR a.occurred_at < (($6::date + 1)::timestamp AT TIME ZONE 'UTC'))
          AND ($7::timestamptz IS NULL OR (a.occurred_at,a.id)<($7,$8))
        ORDER BY a.occurred_at DESC,a.id DESC LIMIT 26
    "#).bind(tenant).bind(query.q.as_deref().filter(|v| !v.is_empty()))
        .bind(query.action.as_deref().filter(|v| !v.is_empty()))
        .bind(query.entity.as_deref().filter(|v| !v.is_empty()))
        .bind(start).bind(end).bind(cursor.map(|v| v.0)).bind(cursor.map(|v| v.1))
        .fetch_all(&mut *tx).await.map_err(db)?;
    let next_cursor = if rows.len() > 25 {
        rows.truncate(25);
        rows.last().map(|r| r.id)
    } else {
        None
    };
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        serde_json::to_value(AuditResponse {
            tenant_id: tenant,
            data: rows,
            next_cursor,
        })
        .map_err(|_| access::AccessError::Internal)?,
    ))
}
