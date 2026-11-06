use super::{auth::AuthenticatedIdentity, state::AppState};
use crate::domains::{DomainChange, DomainError, authorized, db, record, response, revision};
use axum::{
    Extension,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileQuery {
    q: Option<String>,
    origin: Option<String>,
    status: Option<String>,
    #[serde(default)]
    offset: i64,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    25
}

#[derive(FromRow, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManagedFile {
    id: Uuid,
    origin: String,
    filename: String,
    media_type: String,
    byte_size: i64,
    sha256: String,
    status: String,
    revision: i64,
    version_count: i64,
    created_at: String,
}

fn validate(query: &mut FileQuery) -> Result<(), DomainError> {
    query.q = query
        .q
        .take()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if query
        .q
        .as_ref()
        .is_some_and(|value| value.len() > 120 || value.chars().any(char::is_control))
    {
        return Err(DomainError::Invalid("Busca de arquivos inválida"));
    }
    if query
        .origin
        .as_ref()
        .is_some_and(|value| !matches!(value.as_str(), "system" | "legacy"))
    {
        return Err(DomainError::Invalid("Origem de arquivo inválida"));
    }
    if query.status.as_ref().is_some_and(|value| {
        !matches!(
            value.as_str(),
            "pending" | "available" | "quarantined" | "archived"
        )
    }) {
        return Err(DomainError::Invalid("Situação de arquivo inválida"));
    }
    if query.offset < 0 || !(1..=100).contains(&query.limit) {
        return Err(DomainError::Invalid("Paginação inválida"));
    }
    Ok(())
}

#[utoipa::path(get,path="/api/v1/system/files",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),FileQuery),responses((status=200,body=serde_json::Value),(status=403,description="Sem permissão"),(status=422,description="Filtros inválidos")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(mut query): Query<FileQuery>,
) -> Result<Response, DomainError> {
    validate(&mut query)?;
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "system.files.read",
        "system.files.manage",
        false,
    )
    .await?;
    let data: Vec<ManagedFile> = sqlx::query_as(
        r#"WITH catalog AS (
            SELECT f.id, 'system'::text origin, f.original_name filename, f.media_type,
                f.byte_size, f.sha256, f.status, f.revision,
                (SELECT count(*) FROM system_config.file_versions v
                    WHERE v.tenant_id=f.tenant_id AND v.file_id=f.id) version_count,
                f.created_at
            FROM system_config.files f
            WHERE f.tenant_id=$1
            UNION ALL
            SELECT f.id, 'legacy', f.filename, f.media_type,
                octet_length(f.content)::bigint, f.sha256, 'available', 1, 1, h.imported_at
            FROM legacy_files f
            JOIN legacy_history h ON h.tenant_id=f.tenant_id AND h.id=f.history_id
            WHERE f.tenant_id=$1
        )
        SELECT id, origin, filename, media_type, byte_size, sha256, status, revision,
            version_count,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') created_at
        FROM catalog
        WHERE ($2::text IS NULL OR filename ILIKE '%' || $2 || '%'
            OR media_type ILIKE '%' || $2 || '%' OR sha256 ILIKE $2 || '%')
            AND ($3::text IS NULL OR origin=$3)
            AND ($4::text IS NULL OR status=$4)
        ORDER BY created_at DESC, id DESC
        LIMIT $5 OFFSET $6"#,
    )
    .bind(tenant)
    .bind(&query.q)
    .bind(&query.origin)
    .bind(&query.status)
    .bind(query.limit)
    .bind(query.offset)
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    let total: i64 = sqlx::query_scalar(
        "WITH catalog AS (SELECT id,'system'::text origin,original_name filename,media_type,sha256,status FROM system_config.files WHERE tenant_id=$1 UNION ALL SELECT id,'legacy',filename,media_type,sha256,'available' FROM legacy_files WHERE tenant_id=$1) SELECT count(*) FROM catalog WHERE ($2::text IS NULL OR filename ILIKE '%' || $2 || '%' OR media_type ILIKE '%' || $2 || '%' OR sha256 ILIKE $2 || '%') AND ($3::text IS NULL OR origin=$3) AND ($4::text IS NULL OR status=$4)"
    ).bind(tenant).bind(&query.q).bind(&query.origin).bind(&query.status).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data,"total":total,"offset":query.offset,"limit":query.limit,"canEdit":can_edit}),
    ))
}

#[utoipa::path(post,path="/api/v1/system/files/{id}/archive",operation_id="archive_system_file",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=i64,Header),("id"=Uuid,Path)),responses((status=200,body=ManagedFile),(status=404,description="Arquivo não encontrado"),(status=412,description="Revisão desatualizada"),(status=428,description="If-Match obrigatório")))]
pub async fn archive(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.files.read",
        "system.files.manage",
        true,
    )
    .await?;
    let updated = sqlx::query("UPDATE system_config.files SET status='archived',revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$3 AND status<>'archived'")
        .bind(tenant).bind(id).bind(expected).execute(&mut *tx).await.map_err(db)?;
    if updated.rows_affected() == 0 {
        let current: Option<(i64, String)> = sqlx::query_as(
            "SELECT revision,status FROM system_config.files WHERE tenant_id=$1 AND id=$2",
        )
        .bind(tenant)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        return match current {
            None => Err(DomainError::NotFound),
            Some((_, status)) if status == "archived" => {
                Err(DomainError::Conflict("Arquivo já está arquivado"))
            }
            Some((revision, _)) if revision != expected => Err(DomainError::StaleRevision),
            _ => Err(DomainError::Conflict("Arquivo não pode ser arquivado")),
        };
    }
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "system_file",
            id,
            event: "system.file.archived",
            details: json!({"revision":expected+1}),
        },
    )
    .await?;
    let data: ManagedFile = sqlx::query_as("SELECT id,'system'::text origin,original_name filename,media_type,byte_size,sha256,status,revision,(SELECT count(*) FROM system_config.file_versions v WHERE v.tenant_id=f.tenant_id AND v.file_id=f.id) version_count,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') created_at FROM system_config.files f WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data.revision),
        json!({"data":data}),
    ))
}

#[utoipa::path(get,path="/api/v1/system/files/{id}/content",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=Uuid,Path)),responses((status=200,description="Conteúdo legado preservado"),(status=403,description="Sem permissão"),(status=404,description="Conteúdo não armazenado no banco")))]
pub async fn content(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.files.read",
        "system.files.manage",
        false,
    )
    .await?;
    let row: Option<(Vec<u8>, String, String)> = sqlx::query_as(
        "SELECT content,media_type,filename FROM legacy_files WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    let (bytes, media_type, _) = row.ok_or(DomainError::NotFound)?;
    let safe_type = match media_type.as_str() {
        "image/png" => "image/png",
        "image/jpeg" => "image/jpeg",
        "image/webp" => "image/webp",
        "application/xml" => "application/xml",
        "application/pdf" => "application/pdf",
        _ => "application/octet-stream",
    };
    Ok((
        [
            (header::CONTENT_TYPE, safe_type),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::CONTENT_DISPOSITION, "attachment"),
        ],
        bytes,
    )
        .into_response())
}
