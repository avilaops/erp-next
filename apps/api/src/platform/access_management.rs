use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{
    access::{self, AccessRow},
    auth::AuthenticatedIdentity,
    state::AppState,
};

const ADMIN_PERMISSIONS: &[&str] = &[
    "platform.users.read",
    "platform.users.manage",
    "platform.roles.read",
    "platform.roles.manage",
];

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RoleInput {
    code: String,
    name: String,
    #[serde(default)]
    description: String,
    permissions: Vec<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MemberInput {
    status: String,
    role_ids: Vec<Uuid>,
}

#[derive(FromRow, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoleDetail {
    id: Uuid,
    code: String,
    name: String,
    description: String,
    revision: i64,
    permissions: Vec<String>,
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemberDetail {
    id: Uuid,
    name: String,
    email: String,
    status: String,
    revision: i64,
    role_ids: Vec<Uuid>,
}

#[derive(Debug)]
pub enum ManagementError {
    Access(access::AccessError),
    NotFound,
    Invalid(&'static str),
    RevisionRequired,
    CommandKeyRequired,
    InvalidRevision,
    StaleRevision,
    Conflict(&'static str),
}

impl From<access::AccessError> for ManagementError {
    fn from(value: access::AccessError) -> Self {
        Self::Access(value)
    }
}

impl IntoResponse for ManagementError {
    fn into_response(self) -> Response {
        let (status, code, title) = match self {
            Self::Access(error) => return error.into_response(),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "not_found",
                "Recurso não encontrado nesta empresa",
            ),
            Self::Invalid(title) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_access", title),
            Self::RevisionRequired => (
                StatusCode::PRECONDITION_REQUIRED,
                "revision_required",
                "Recarregue os dados antes de salvar",
            ),
            Self::CommandKeyRequired => (
                StatusCode::PRECONDITION_REQUIRED,
                "idempotency_required",
                "Informe uma chave de idempotência para criar o papel",
            ),
            Self::InvalidRevision => (
                StatusCode::BAD_REQUEST,
                "invalid_revision",
                "Revisão inválida",
            ),
            Self::StaleRevision => (
                StatusCode::PRECONDITION_FAILED,
                "revision_conflict",
                "Outra pessoa alterou estes dados. Sua edição foi preservada",
            ),
            Self::Conflict(title) => (StatusCode::CONFLICT, "access_conflict", title),
        };
        (status, [(header::CONTENT_TYPE, "application/problem+json"), (header::CACHE_CONTROL, "no-store")], Json(serde_json::json!({"type":format!("https://erp.avilaops.com/problems/{code}"),"title":title,"status":status.as_u16()}))).into_response()
    }
}

fn db(error: sqlx::Error) -> ManagementError {
    access::database_error(error).into()
}

fn expected_revision(headers: &HeaderMap) -> Result<i64, ManagementError> {
    headers
        .get(header::IF_MATCH)
        .ok_or(ManagementError::RevisionRequired)?
        .to_str()
        .ok()
        .and_then(|raw| raw.strip_prefix('"'))
        .and_then(|raw| raw.strip_suffix('"'))
        .and_then(|raw| raw.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .ok_or(ManagementError::InvalidRevision)
}

fn response<T: Serialize>(status: StatusCode, revision: i64, value: T) -> Response {
    let mut response = (status, Json(value)).into_response();
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(&format!("\"{revision}\"")).expect("integer revision"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn authorized<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
    identity: &AuthenticatedIdentity,
    permission: &str,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>, AccessRow), ManagementError> {
    let tenant = access::tenant_id(headers)?;
    let mut tx = access::tenant_transaction(state, tenant).await?;
    // All access writes serialize on the tenant, then recheck the caller's rights.
    if write {
        sqlx::query("SELECT id FROM tenants WHERE id = $1 FOR UPDATE")
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, permission)?;
    Ok((tenant, tx, rights))
}

async fn role(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Result<RoleDetail, ManagementError> {
    sqlx::query_as("SELECT r.id, r.code, r.name, r.description, r.revision, COALESCE(array_agg(p.permission_code ORDER BY p.permission_code) FILTER (WHERE p.permission_code IS NOT NULL), '{}') AS permissions FROM roles r LEFT JOIN role_permissions p ON p.role_id = r.id WHERE r.id = $1 GROUP BY r.id")
        .bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(ManagementError::NotFound)
}

async fn member(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<MemberDetail, ManagementError> {
    sqlx::query_as("SELECT m.id, i.display_name AS name, i.email, CASE m.status WHEN 'active' THEN 'active' WHEN 'invited' THEN 'pending' ELSE 'blocked' END AS status, m.revision, COALESCE(array_agg(mr.role_id ORDER BY mr.role_id) FILTER (WHERE mr.role_id IS NOT NULL), '{}') AS role_ids FROM tenant_memberships m JOIN identities i ON i.id = m.identity_id LEFT JOIN membership_roles mr ON mr.membership_id = m.id WHERE m.id = $1 GROUP BY m.id, i.display_name, i.email")
        .bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(ManagementError::NotFound)
}

fn within_authority(rights: &AccessRow, permissions: &[String]) -> Result<(), ManagementError> {
    if permissions
        .iter()
        .any(|code| !rights.permissions.contains(code))
    {
        return Err(access::AccessError::Forbidden.into());
    }
    Ok(())
}

async fn ensure_administrator(tx: &mut Transaction<'_, Postgres>) -> Result<(), ManagementError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT m.id FROM tenant_memberships m JOIN membership_roles mr ON mr.membership_id = m.id JOIN role_permissions rp ON rp.role_id = mr.role_id WHERE m.status = 'active' GROUP BY m.id HAVING array_agg(DISTINCT rp.permission_code) @> $1::text[])")
        .bind(ADMIN_PERMISSIONS).fetch_one(&mut **tx).await.map_err(db)?;
    if !exists {
        return Err(ManagementError::Conflict(
            "A empresa precisa manter ao menos um administrador ativo de usuários e papéis",
        ));
    }
    Ok(())
}

struct AccessChange {
    action: &'static str,
    entity: &'static str,
    id: Uuid,
    revision: i64,
}

async fn record(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    change: AccessChange,
) -> Result<(), ManagementError> {
    let AccessChange {
        action,
        entity,
        id,
        revision,
    } = change;
    let metadata = serde_json::json!({"revision":revision});
    let request_id = headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok());
    sqlx::query("INSERT INTO audit_log (tenant_id, identity_id, action, entity_type, entity_id, request_id, details) SELECT $1, id, $3, $4, $5, $6, $7 FROM identities WHERE auth_subject = $2")
        .bind(tenant).bind(&identity.subject).bind(action).bind(entity).bind(id.to_string()).bind(request_id).bind(&metadata).execute(&mut **tx).await.map_err(db)?;
    sqlx::query("INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, $2, $3, $4, $5)")
        .bind(tenant).bind(entity).bind(id.to_string()).bind(action).bind(metadata).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

fn validate_role(input: &mut RoleInput) -> Result<(), ManagementError> {
    input.name = input.name.trim().into();
    input.description = input.description.trim().into();
    if input.code.is_empty()
        || input.code.len() > 80
        || !input
            .code
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
        || input.name.is_empty()
        || input.name.len() > 120
        || input.description.chars().count() > 1000
    {
        return Err(ManagementError::Invalid(
            "Informe código, nome e descrição válidos",
        ));
    }
    let mut unique = std::collections::HashSet::new();
    if input.permissions.len() > 256 || input.permissions.iter().any(|code| !unique.insert(code)) {
        return Err(ManagementError::Invalid(
            "Permissões repetidas ou quantidade inválida",
        ));
    }
    for code in &input.permissions {
        if let Some(prefix) = code.strip_suffix(".manage")
            && !input.permissions.contains(&format!("{prefix}.read"))
        {
            return Err(ManagementError::Invalid(
                "A permissão de gerenciar exige a permissão de consultar correspondente",
            ));
        }
    }
    input.permissions.sort();
    Ok(())
}

async fn replace_permissions(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    codes: &[String],
) -> Result<(), ManagementError> {
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM permissions WHERE code = ANY($1)")
        .bind(codes)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    if count != codes.len() as i64 {
        return Err(ManagementError::Invalid(
            "Permissão não reconhecida pelo ERP",
        ));
    }
    sqlx::query("DELETE FROM role_permissions WHERE role_id = $1")
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_code) SELECT $1, unnest($2::text[])",
    )
    .bind(id)
    .bind(codes)
    .execute(&mut **tx)
    .await
    .map_err(db)?;
    Ok(())
}

#[utoipa::path(get, path = "/api/v1/roles/{id}", tag = "Platform", security(("bearerAuth" = [])), params(("id" = Uuid, Path), ("X-Tenant-Id" = Uuid, Header)), responses((status = 200, body = RoleDetail), (status = 401, description = "Credencial inválida"), (status = 403, description = "Sem permissão"), (status = 404, description = "Papel não encontrado"), (status = 400, description = "Empresa, identificador ou revisão inválidos"), (status = 500, description = "Erro interno"), (status = 503, description = "Auth indisponível")))]
pub async fn get_role(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, ManagementError> {
    let (_, mut tx, _) =
        authorized(&state, &headers, &identity, "platform.roles.read", false).await?;
    let value = role(&mut tx, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, value.revision, value))
}

#[utoipa::path(post, path = "/api/v1/roles", tag = "Platform", request_body = RoleInput, security(("bearerAuth" = [])), params(("X-Tenant-Id" = Uuid, Header), ("Idempotency-Key" = Uuid, Header)), responses((status = 201, body = RoleDetail), (status = 401, description = "Credencial inválida"), (status = 403, description = "Fora da autoridade do ator"), (status = 409, description = "Código em uso"), (status = 422, description = "Dados inválidos"), (status = 400, description = "Empresa, identificador ou revisão inválidos"), (status = 500, description = "Erro interno"), (status = 503, description = "Auth indisponível"), (status = 428, description = "Idempotency-Key obrigatório")))]
pub async fn create_role(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<RoleInput>, JsonRejection>,
) -> Result<Response, ManagementError> {
    let (tenant, mut tx, rights) =
        authorized(&state, &headers, &identity, "platform.roles.manage", true).await?;
    access::require_permission(&rights, "platform.roles.read")?;
    let Json(mut input) =
        payload.map_err(|_| ManagementError::Invalid("JSON inválido ou campos desconhecidos"))?;
    validate_role(&mut input)?;
    within_authority(&rights, &input.permissions)?;
    let command_key = headers
        .get("idempotency-key")
        .ok_or(ManagementError::CommandKeyRequired)?
        .to_str()
        .ok()
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or(ManagementError::Invalid("Chave de idempotência inválida"))?;
    let request = serde_json::to_value(&input).map_err(|_| access::AccessError::Internal)?;
    let replay = sqlx::query_as::<_, (serde_json::Value, serde_json::Value)>("SELECT request, result FROM role_creation_commands WHERE tenant_id = $1 AND auth_subject = $2 AND command_key = $3")
        .bind(tenant).bind(&identity.subject).bind(command_key).fetch_optional(&mut *tx).await.map_err(db)?;
    if let Some((previous_request, result)) = replay {
        if previous_request != request {
            return Err(ManagementError::Conflict(
                "Esta chave de idempotência já foi usada com outros dados",
            ));
        }
        let value: RoleDetail =
            serde_json::from_value(result).map_err(|_| access::AccessError::Internal)?;
        within_authority(&rights, &value.permissions)?;
        tx.commit().await.map_err(db)?;
        let mut reply = response(StatusCode::CREATED, value.revision, &value);
        reply
            .headers_mut()
            .insert("idempotency-replayed", HeaderValue::from_static("true"));
        reply.headers_mut().insert(
            header::LOCATION,
            HeaderValue::from_str(&format!("/api/v1/roles/{}", value.id)).expect("UUID location"),
        );
        return Ok(reply);
    }
    let id = Uuid::now_v7();
    let result = sqlx::query(
        "INSERT INTO roles (id, tenant_id, code, name, description) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(id)
    .bind(tenant)
    .bind(&input.code)
    .bind(&input.name)
    .bind(&input.description)
    .execute(&mut *tx)
    .await;
    if let Err(error) = result {
        if error
            .as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            return Err(ManagementError::Conflict(
                "Já existe um papel com este código nesta empresa",
            ));
        }
        return Err(db(error));
    }
    replace_permissions(&mut tx, id, &input.permissions).await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        AccessChange {
            action: "role.created",
            entity: "role",
            id,
            revision: 1,
        },
    )
    .await?;
    let value = role(&mut tx, id).await?;
    let result = serde_json::to_value(&value).map_err(|_| access::AccessError::Internal)?;
    sqlx::query("INSERT INTO role_creation_commands (tenant_id, auth_subject, command_key, request, result) VALUES ($1,$2,$3,$4,$5)")
        .bind(tenant).bind(&identity.subject).bind(command_key).bind(request).bind(result).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    let mut response = response(StatusCode::CREATED, 1, value);
    response.headers_mut().insert(
        header::LOCATION,
        HeaderValue::from_str(&format!("/api/v1/roles/{id}")).expect("UUID location"),
    );
    Ok(response)
}

#[utoipa::path(put, path = "/api/v1/roles/{id}", tag = "Platform", request_body = RoleInput, security(("bearerAuth" = [])), params(("id" = Uuid, Path), ("X-Tenant-Id" = Uuid, Header), ("If-Match" = String, Header)), responses((status = 200, body = RoleDetail), (status = 403, description = "Sem autoridade"), (status = 404, description = "Não encontrado"), (status = 409, description = "Último administrador ou código em uso"), (status = 412, description = "Revisão desatualizada"), (status = 422, description = "Dados inválidos"), (status = 428, description = "Revisão obrigatória"), (status = 400, description = "Empresa, identificador ou revisão inválidos"), (status = 401, description = "Credencial inválida"), (status = 500, description = "Erro interno"), (status = 503, description = "Auth indisponível")))]
pub async fn update_role(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<RoleInput>, JsonRejection>,
) -> Result<Response, ManagementError> {
    let expected = expected_revision(&headers)?;
    let (tenant, mut tx, rights) =
        authorized(&state, &headers, &identity, "platform.roles.manage", true).await?;
    access::require_permission(&rights, "platform.roles.read")?;
    let previous = role(&mut tx, id).await?;
    if previous.revision != expected {
        return Err(ManagementError::StaleRevision);
    }
    within_authority(&rights, &previous.permissions)?;
    let Json(mut input) =
        payload.map_err(|_| ManagementError::Invalid("JSON inválido ou campos desconhecidos"))?;
    validate_role(&mut input)?;
    within_authority(&rights, &input.permissions)?;
    let result = sqlx::query("UPDATE roles SET code = $2, name = $3, description = $4, revision = revision + 1 WHERE id = $1")
        .bind(id).bind(&input.code).bind(&input.name).bind(&input.description).execute(&mut *tx).await;
    if let Err(error) = result {
        if error
            .as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            return Err(ManagementError::Conflict(
                "Já existe um papel com este código nesta empresa",
            ));
        }
        return Err(db(error));
    }
    replace_permissions(&mut tx, id, &input.permissions).await?;
    ensure_administrator(&mut tx).await?;
    let value = role(&mut tx, id).await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        AccessChange {
            action: "role.updated",
            entity: "role",
            id,
            revision: value.revision,
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, value.revision, value))
}

#[utoipa::path(delete, path = "/api/v1/roles/{id}", tag = "Platform", security(("bearerAuth" = [])), params(("id" = Uuid, Path), ("X-Tenant-Id" = Uuid, Header), ("If-Match" = String, Header)), responses((status = 204, description = "Papel excluído"), (status = 403, description = "Sem autoridade"), (status = 404, description = "Não encontrado"), (status = 409, description = "Papel em uso"), (status = 412, description = "Revisão desatualizada"), (status = 428, description = "Revisão obrigatória"), (status = 400, description = "Empresa, identificador ou revisão inválidos"), (status = 401, description = "Credencial inválida"), (status = 500, description = "Erro interno"), (status = 503, description = "Auth indisponível")))]
pub async fn delete_role(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ManagementError> {
    let expected = expected_revision(&headers)?;
    let (tenant, mut tx, rights) =
        authorized(&state, &headers, &identity, "platform.roles.manage", true).await?;
    access::require_permission(&rights, "platform.roles.read")?;
    let previous = role(&mut tx, id).await?;
    if previous.revision != expected {
        return Err(ManagementError::StaleRevision);
    }
    within_authority(&rights, &previous.permissions)?;
    let used: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM membership_roles WHERE role_id = $1)")
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
    if used {
        return Err(ManagementError::Conflict(
            "Este papel está atribuído a usuários. Remova as atribuições antes de excluir",
        ));
    }
    sqlx::query("DELETE FROM roles WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        AccessChange {
            action: "role.deleted",
            entity: "role",
            id,
            revision: previous.revision,
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/v1/users/{id}", tag = "Platform", security(("bearerAuth" = [])), params(("id" = Uuid, Path), ("X-Tenant-Id" = Uuid, Header)), responses((status = 200, body = MemberDetail), (status = 401, description = "Credencial inválida"), (status = 403, description = "Sem permissão"), (status = 404, description = "Usuário não encontrado"), (status = 400, description = "Empresa, identificador ou revisão inválidos"), (status = 500, description = "Erro interno"), (status = 503, description = "Auth indisponível")))]
pub async fn get_member(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, ManagementError> {
    let (_, mut tx, _) =
        authorized(&state, &headers, &identity, "platform.users.read", false).await?;
    let value = member(&mut tx, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, value.revision, value))
}

#[utoipa::path(put, path = "/api/v1/users/{id}", tag = "Platform", request_body = MemberInput, security(("bearerAuth" = [])), params(("id" = Uuid, Path), ("X-Tenant-Id" = Uuid, Header), ("If-Match" = String, Header)), responses((status = 200, body = MemberDetail), (status = 403, description = "Sem autoridade"), (status = 404, description = "Usuário ou papel não encontrado"), (status = 409, description = "Último administrador, bloqueio próprio ou convite não aceito"), (status = 412, description = "Revisão desatualizada"), (status = 422, description = "Dados inválidos"), (status = 428, description = "Revisão obrigatória"), (status = 400, description = "Empresa, identificador ou revisão inválidos"), (status = 401, description = "Credencial inválida"), (status = 500, description = "Erro interno"), (status = 503, description = "Auth indisponível")))]
pub async fn update_member(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<MemberInput>, JsonRejection>,
) -> Result<Response, ManagementError> {
    let expected = expected_revision(&headers)?;
    let (tenant, mut tx, rights) =
        authorized(&state, &headers, &identity, "platform.users.manage", true).await?;
    access::require_permission(&rights, "platform.users.read")?;
    access::require_permission(&rights, "platform.roles.read")?;
    let previous = member(&mut tx, id).await?;
    if previous.revision != expected {
        return Err(ManagementError::StaleRevision);
    }
    let Json(input) =
        payload.map_err(|_| ManagementError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let mut unique = std::collections::HashSet::new();
    if !["active", "blocked", "pending"].contains(&input.status.as_str())
        || input.role_ids.len() > 128
        || input.role_ids.iter().any(|id| !unique.insert(id))
    {
        return Err(ManagementError::Invalid("Estado ou papéis inválidos"));
    }
    if (previous.status == "pending" && input.status != "pending")
        || (previous.status != "pending" && input.status == "pending")
    {
        return Err(ManagementError::Conflict(
            "A ativação de convites depende da confirmação no Auth",
        ));
    }
    let is_self: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM tenant_memberships m JOIN identities i ON i.id = m.identity_id WHERE m.id = $1 AND i.auth_subject = $2)").bind(id).bind(&identity.subject).fetch_one(&mut *tx).await.map_err(db)?;
    if is_self && input.status != "active" {
        return Err(ManagementError::Conflict(
            "Você não pode bloquear o próprio acesso",
        ));
    }
    for role_id in previous.role_ids.iter().chain(input.role_ids.iter()) {
        within_authority(&rights, &role(&mut tx, *role_id).await?.permissions)?;
    }
    let status = match input.status.as_str() {
        "active" => "active",
        "pending" => "invited",
        _ => "disabled",
    };
    sqlx::query("UPDATE tenant_memberships SET status = $2, revision = revision + 1, updated_at = now() WHERE id = $1").bind(id).bind(status).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("DELETE FROM membership_roles WHERE membership_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query(
        "INSERT INTO membership_roles (membership_id, role_id) SELECT $1, unnest($2::uuid[])",
    )
    .bind(id)
    .bind(&input.role_ids)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    ensure_administrator(&mut tx).await?;
    let value = member(&mut tx, id).await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        AccessChange {
            action: "membership.updated",
            entity: "membership",
            id,
            revision: value.revision,
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, value.revision, value))
}
