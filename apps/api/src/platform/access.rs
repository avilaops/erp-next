use axum::{
    Extension, Json,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use super::{auth::AuthenticatedIdentity, state::AppState};

const TENANT_HEADER: &str = "x-tenant-id";

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurrentAccessResponse {
    identity: AuthenticatedIdentity,
    tenant: TenantSummary,
    roles: Vec<String>,
    permissions: Vec<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
struct TenantSummary {
    id: Uuid,
    legal_name: String,
    trade_name: Option<String>,
}

#[derive(FromRow)]
pub(crate) struct AccessRow {
    tenant_id: Uuid,
    legal_name: String,
    trade_name: Option<String>,
    roles: Vec<String>,
    pub(super) permissions: Vec<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsersResponse {
    data: Vec<UserSummary>,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsResponse {
    data: Vec<PermissionSummary>,
}

#[derive(FromRow, Serialize, utoipa::ToSchema)]
struct PermissionSummary {
    code: String,
    description: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RolesResponse {
    data: Vec<RoleSummary>,
}

#[derive(FromRow, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
struct RoleSummary {
    id: Uuid,
    code: String,
    name: String,
    permissions: Vec<String>,
}

#[derive(FromRow, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
struct UserSummary {
    id: Uuid,
    name: String,
    email: String,
    status: String,
    roles: Vec<String>,
}

#[utoipa::path(get, path = "/api/v1/me", tag = "Platform", security(("bearerAuth" = [])),
    params(("X-Tenant-Id" = Uuid, Header)), responses((status = 200, body = CurrentAccessResponse),
    (status = 400, description = "Empresa inválida"), (status = 401, description = "Credencial inválida"),
    (status = 403, description = "Sem acesso"), (status = 500, description = "Erro interno"),
    (status = 503, description = "Auth indisponível")))]
pub async fn current_access(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Json<CurrentAccessResponse>, AccessError> {
    let tenant_id = tenant_id(&headers)?;
    let mut transaction = tenant_transaction(&state, tenant_id).await?;
    let access = load_access(&mut transaction, tenant_id, &identity.subject).await?;
    transaction.commit().await.map_err(database_error)?;

    Ok(Json(CurrentAccessResponse {
        identity,
        tenant: TenantSummary {
            id: access.tenant_id,
            legal_name: access.legal_name,
            trade_name: access.trade_name,
        },
        roles: access.roles,
        permissions: access.permissions,
    }))
}

#[utoipa::path(get, path = "/api/v1/users", tag = "Platform", security(("bearerAuth" = [])),
    params(("X-Tenant-Id" = Uuid, Header)), responses((status = 200, body = UsersResponse),
    (status = 400, description = "Empresa inválida"), (status = 401, description = "Credencial inválida"),
    (status = 403, description = "Sem permissão"), (status = 500, description = "Erro interno"),
    (status = 503, description = "Auth indisponível")))]
pub async fn list_users(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Json<UsersResponse>, AccessError> {
    let tenant_id = tenant_id(&headers)?;
    let mut transaction = tenant_transaction(&state, tenant_id).await?;
    let access = load_access(&mut transaction, tenant_id, &identity.subject).await?;
    require_permission(&access, "platform.users.read")?;

    let users = sqlx::query_as::<_, UserSummary>(
        r#"
        SELECT
            membership.id,
            identity.display_name AS name,
            identity.email,
            CASE membership.status
                WHEN 'active' THEN 'active'
                WHEN 'invited' THEN 'pending'
                ELSE 'blocked'
            END AS status,
            COALESCE(array_agg(DISTINCT role.name) FILTER (WHERE role.name IS NOT NULL), '{}') AS roles
        FROM tenant_memberships membership
        JOIN identities identity ON identity.id = membership.identity_id
        LEFT JOIN membership_roles membership_role ON membership_role.membership_id = membership.id
        LEFT JOIN roles role ON role.id = membership_role.role_id
        WHERE membership.tenant_id = $1
        GROUP BY membership.id, identity.display_name, identity.email
        ORDER BY identity.display_name, membership.id
        "#,
    )
    .bind(tenant_id)
    .fetch_all(&mut *transaction)
    .await
    .map_err(database_error)?;
    transaction.commit().await.map_err(database_error)?;

    Ok(Json(UsersResponse { data: users }))
}

#[utoipa::path(get, path = "/api/v1/permissions", tag = "Platform", security(("bearerAuth" = [])),
    params(("X-Tenant-Id" = Uuid, Header)), responses((status = 200, body = PermissionsResponse),
    (status = 400, description = "Empresa inválida"), (status = 401, description = "Credencial inválida"),
    (status = 403, description = "Sem permissão"), (status = 500, description = "Erro interno"),
    (status = 503, description = "Auth indisponível")))]
pub async fn list_permissions(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Json<PermissionsResponse>, AccessError> {
    let tenant_id = tenant_id(&headers)?;
    let mut transaction = tenant_transaction(&state, tenant_id).await?;
    let access = load_access(&mut transaction, tenant_id, &identity.subject).await?;
    require_permission(&access, "platform.roles.read")?;

    let permissions = sqlx::query_as::<_, PermissionSummary>(
        "SELECT code, description FROM permissions ORDER BY code",
    )
    .fetch_all(&mut *transaction)
    .await
    .map_err(database_error)?;
    transaction.commit().await.map_err(database_error)?;

    Ok(Json(PermissionsResponse { data: permissions }))
}

#[utoipa::path(get, path = "/api/v1/roles", tag = "Platform", security(("bearerAuth" = [])),
    params(("X-Tenant-Id" = Uuid, Header)), responses((status = 200, body = RolesResponse),
    (status = 400, description = "Empresa inválida"), (status = 401, description = "Credencial inválida"),
    (status = 403, description = "Sem permissão"), (status = 500, description = "Erro interno"),
    (status = 503, description = "Auth indisponível")))]
pub async fn list_roles(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Json<RolesResponse>, AccessError> {
    let tenant_id = tenant_id(&headers)?;
    let mut transaction = tenant_transaction(&state, tenant_id).await?;
    let access = load_access(&mut transaction, tenant_id, &identity.subject).await?;
    require_permission(&access, "platform.roles.read")?;

    let roles = sqlx::query_as::<_, RoleSummary>(
        r#"
        SELECT
            role.id,
            role.code,
            role.name,
            COALESCE(array_agg(DISTINCT role_permission.permission_code)
                FILTER (WHERE role_permission.permission_code IS NOT NULL), '{}') AS permissions
        FROM roles role
        LEFT JOIN role_permissions role_permission ON role_permission.role_id = role.id
        WHERE role.tenant_id = $1
        GROUP BY role.id, role.code, role.name
        ORDER BY role.name, role.id
        "#,
    )
    .bind(tenant_id)
    .fetch_all(&mut *transaction)
    .await
    .map_err(database_error)?;
    transaction.commit().await.map_err(database_error)?;

    Ok(Json(RolesResponse { data: roles }))
}

pub(crate) async fn tenant_transaction(
    state: &AppState,
    tenant_id: Uuid,
) -> Result<Transaction<'_, Postgres>, AccessError> {
    let mut transaction = state.database.begin().await.map_err(database_error)?;
    sqlx::query("SELECT set_config('app.tenant_id', $1, true)")
        .bind(tenant_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    Ok(transaction)
}

pub(crate) async fn load_access(
    transaction: &mut Transaction<'_, Postgres>,
    tenant_id: Uuid,
    auth_subject: &str,
) -> Result<AccessRow, AccessError> {
    sqlx::query_as::<_, AccessRow>(
        r#"
        SELECT
            tenant.id AS tenant_id,
            tenant.legal_name,
            tenant.trade_name,
            COALESCE(array_agg(DISTINCT role.code) FILTER (WHERE role.code IS NOT NULL), '{}') AS roles,
            COALESCE(array_agg(DISTINCT role_permission.permission_code)
                FILTER (WHERE role_permission.permission_code IS NOT NULL), '{}') AS permissions
        FROM tenants tenant
        JOIN tenant_memberships membership ON membership.tenant_id = tenant.id
        JOIN identities identity ON identity.id = membership.identity_id
        LEFT JOIN membership_roles membership_role ON membership_role.membership_id = membership.id
        LEFT JOIN roles role ON role.id = membership_role.role_id
        LEFT JOIN role_permissions role_permission ON role_permission.role_id = role.id
        WHERE tenant.id = $1
          AND identity.auth_subject = $2
          AND tenant.status = 'active'
          AND membership.status = 'active'
        GROUP BY tenant.id, tenant.legal_name, tenant.trade_name
        "#,
    )
    .bind(tenant_id)
    .bind(auth_subject)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(database_error)?
    .ok_or(AccessError::Forbidden)
}

pub(crate) fn require_permission(access: &AccessRow, permission: &str) -> Result<(), AccessError> {
    access
        .permissions
        .iter()
        .any(|candidate| candidate == permission)
        .then_some(())
        .ok_or(AccessError::Forbidden)
}

pub(crate) fn tenant_id(headers: &HeaderMap) -> Result<Uuid, AccessError> {
    let value = headers
        .get(TENANT_HEADER)
        .ok_or(AccessError::MissingTenant)?
        .to_str()
        .map_err(|_| AccessError::InvalidTenant)?;
    Uuid::parse_str(value).map_err(|_| AccessError::InvalidTenant)
}

pub(crate) fn database_error(error: sqlx::Error) -> AccessError {
    tracing::error!(%error, "platform access database operation failed");
    AccessError::Internal
}

#[derive(Debug)]
pub enum AccessError {
    MissingTenant,
    InvalidTenant,
    Forbidden,
    Internal,
}

impl IntoResponse for AccessError {
    fn into_response(self) -> Response {
        let (status, code, title) = match self {
            Self::MissingTenant => (
                StatusCode::BAD_REQUEST,
                "missing_tenant",
                "Empresa ativa não informada",
            ),
            Self::InvalidTenant => (
                StatusCode::BAD_REQUEST,
                "invalid_tenant",
                "Identificador da empresa inválido",
            ),
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                "forbidden",
                "Acesso não autorizado para esta empresa",
            ),
            Self::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Erro interno",
            ),
        };
        (
            status,
            [(header::CONTENT_TYPE, "application/problem+json")],
            Json(serde_json::json!({
                "type": format!("https://erp.avilaops.com/problems/{code}"),
                "title": title,
                "status": status.as_u16(),
            })),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_tenant_header() {
        let expected = Uuid::now_v7();
        let mut headers = HeaderMap::new();
        headers.insert(TENANT_HEADER, expected.to_string().parse().unwrap());

        assert_eq!(tenant_id(&headers).unwrap(), expected);
    }

    #[test]
    fn rejects_missing_and_invalid_tenant_headers() {
        assert!(matches!(
            tenant_id(&HeaderMap::new()),
            Err(AccessError::MissingTenant)
        ));
        let mut headers = HeaderMap::new();
        headers.insert(TENANT_HEADER, "not-a-uuid".parse().unwrap());
        assert!(matches!(
            tenant_id(&headers),
            Err(AccessError::InvalidTenant)
        ));
    }
}
