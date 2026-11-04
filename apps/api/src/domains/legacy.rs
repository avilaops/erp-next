use super::{DomainError, authorized, db, response};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCollection {
    pub name: String,
    pub count: i64,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LegacyFile {
    pub id: Uuid,
    pub filename: String,
    pub media_type: String,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LegacyRecord {
    pub id: Uuid,
    pub collection: String,
    pub title: String,
    pub details: Value,
    pub files: Vec<LegacyFile>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LegacyPage {
    pub collections: Vec<LegacyCollection>,
    pub data: Vec<LegacyRecord>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
    pub next_cursor: Option<LegacyCursor>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCursor {
    pub collection: String,
    pub id: Uuid,
}
#[derive(Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct HistoryQuery {
    collection: Option<String>,
    offset: Option<i64>,
    after_collection: Option<String>,
    after_id: Option<Uuid>,
}

#[utoipa::path(get,path="/api/v1/legacy-history",tag="Platform",security(("bearerAuth"=[])),params(HistoryQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=LegacyPage),(status=403,description="Sem permissão")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(query): Query<HistoryQuery>,
) -> Result<Response, DomainError> {
    let offset = query.offset.unwrap_or(0);
    if !(0..=100000).contains(&offset) || query.collection.as_ref().is_some_and(|s| s.len() > 100) {
        return Err(DomainError::Invalid("Filtro inválido"));
    }
    if query.after_collection.is_some() != query.after_id.is_some()
        || query.after_collection.as_ref().is_some_and(|collection| {
            collection.is_empty()
                || collection.len() > 100
                || offset != 0
                || query
                    .collection
                    .as_ref()
                    .is_some_and(|filter| filter != collection)
        })
    {
        return Err(DomainError::Invalid("Cursor inválido"));
    }
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "platform.legacy.read",
        "platform.legacy.read",
        false,
    )
    .await?;
    let collections: Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('name',collection,'count',count(*)) FROM legacy_history WHERE tenant_id=$1 GROUP BY collection ORDER BY collection").bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM legacy_history WHERE tenant_id=$1 AND ($2::text IS NULL OR collection=$2)").bind(tenant).bind(&query.collection).fetch_one(&mut *tx).await.map_err(db)?;
    let mut records = sqlx::QueryBuilder::<sqlx::Postgres>::new(
        "SELECT jsonb_build_object('id',h.id,'collection',h.collection,'title',h.title,'details',h.details,\
        'files',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename,'mediaType',f.media_type) ORDER BY f.id) \
        FROM legacy_files f WHERE f.tenant_id=h.tenant_id AND f.history_id=h.id),'[]'::jsonb)) \
        FROM legacy_history h WHERE h.tenant_id=",
    );
    records.push_bind(tenant);
    if let Some(collection) = &query.collection {
        records.push(" AND h.collection=").push_bind(collection);
    }
    if let (Some(collection), Some(id)) = (&query.after_collection, query.after_id) {
        records
            .push(" AND (h.collection,h.id)>(")
            .push_bind(collection)
            .push(",")
            .push_bind(id)
            .push(")");
    }
    records.push(" ORDER BY h.collection,h.id LIMIT 26");
    if query.after_id.is_none() {
        records.push(" OFFSET ").push_bind(offset);
    }
    let mut rows: Vec<Value> = records
        .build_query_scalar()
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;
    let has_more = rows.len() > 25;
    rows.truncate(25);
    let data: Vec<LegacyRecord> = serde_json::from_value(Value::Array(rows))
        .map_err(|_| crate::platform::access::AccessError::Internal)?;
    let next_cursor = if has_more {
        data.last().map(|record| LegacyCursor {
            collection: record.collection.clone(),
            id: record.id,
        })
    } else {
        None
    };
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        LegacyPage {
            collections: serde_json::from_value(Value::Array(collections))
                .map_err(|_| crate::platform::access::AccessError::Internal)?,
            data,
            total,
            offset,
            limit: 25,
            next_cursor,
        },
    ))
}

#[utoipa::path(get,path="/api/v1/legacy-history/files/{id}",tag="Platform",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,description="Arquivo original"),(status=403,description="Sem permissão"),(status=404,description="Arquivo não encontrado")))]
pub async fn file(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "platform.legacy.read",
        "platform.legacy.read",
        false,
    )
    .await?;
    let (bytes, mime): (Vec<u8>, String) =
        sqlx::query_as("SELECT content,media_type FROM legacy_files WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?
            .ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    let media = match mime.as_str() {
        "image/png" => "image/png",
        "image/jpeg" => "image/jpeg",
        "image/webp" => "image/webp",
        "application/xml" => "application/xml",
        _ => "application/octet-stream",
    };
    Ok((
        [
            (header::CONTENT_TYPE, media),
            (header::CACHE_CONTROL, "no-store"),
            (header::CONTENT_DISPOSITION, "attachment"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response())
}
