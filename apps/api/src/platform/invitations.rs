use std::{env, time::Duration};

use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use super::{
    access,
    access_management::{self as management, ManagementError},
    auth::AuthenticatedIdentity,
    state::AppState,
};

const MANAGER_PERMISSIONS: &[&str] = &[
    "platform.company.read",
    "platform.roles.read",
    "platform.users.manage",
    "platform.users.read",
];

#[derive(Clone)]
pub struct ProvisioningClient {
    http: reqwest::Client,
    endpoint: reqwest::Url,
    client_id: String,
    secret: String,
    destination: String,
}

impl std::fmt::Debug for ProvisioningClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ProvisioningClient { credentials: [REDACTED] }")
    }
}

impl ProvisioningClient {
    #[cfg(test)]
    pub(crate) fn for_test(endpoint: reqwest::Url) -> Self {
        Self {
            http: reqwest::Client::new(),
            endpoint,
            client_id: "erp-invitation-test".into(),
            secret: "isolated-test-only".into(),
            destination: "https://erp.example.test/preferencias/usuarios".into(),
        }
    }

    pub fn from_env(issuer: &str) -> anyhow::Result<Option<Self>> {
        let client_id = env::var("ERP_AUTH_CLIENT_ID").unwrap_or_default();
        let secret = env::var("ERP_AUTH_CLIENT_SECRET").unwrap_or_default();
        if client_id.is_empty() && secret.is_empty() {
            return Ok(None);
        }
        anyhow::ensure!(
            !client_id.is_empty() && !secret.is_empty(),
            "Both ERP Auth client credentials are required for invitations"
        );
        let origin = reqwest::Url::parse(issuer)?;
        let destination =
            env::var("ERP_WEB_ORIGIN").unwrap_or_else(|_| "https://erp.avilaops.com".into());
        let target = reqwest::Url::parse(&destination)?;
        for url in [&origin, &target] {
            anyhow::ensure!(
                url.username().is_empty()
                    && url.password().is_none()
                    && (url.scheme() == "https"
                        || (url.scheme() == "http"
                            && matches!(url.host_str(), Some("localhost" | "127.0.0.1")))),
                "Invitations require trusted HTTPS service origins"
            );
            anyhow::ensure!(
                url.path() == "/" && url.query().is_none() && url.fragment().is_none(),
                "Invitation service addresses must be origins"
            );
        }
        Ok(Some(Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            endpoint: origin.join("/api/provisionamento/acessos")?,
            client_id,
            secret,
            destination: target.join("/preferencias/usuarios")?.to_string(),
        }))
    }

    async fn send(&self, invitation: &Invitation, company: &str, inviter: &str) -> &'static str {
        #[derive(Deserialize)]
        struct Delivery {
            envio: String,
        }
        let result = self.http.post(self.endpoint.clone()).basic_auth(&self.client_id, Some(&self.secret))
            .json(&serde_json::json!({"email":invitation.email,"nome":invitation.name,"destino":self.destination,"enviarConvite":true,"empresa":company,"convidadoPor":inviter}))
            .send().await;
        let response = match result {
            Ok(value) => value,
            Err(_) => return "unknown",
        };
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            return "limited";
        }
        if !response.status().is_success() {
            return "failed";
        }
        // Auth can return a password setup URL when mail fails. Never expose or persist it.
        match response.json::<Delivery>().await {
            Ok(value) if value.envio == "enviado" => "sent",
            Ok(value) if value.envio == "limite" => "limited",
            Ok(_) => "failed",
            Err(_) => "unknown",
        }
    }
}

#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvitationInput {
    name: String,
    email: String,
    role_ids: Vec<Uuid>,
    #[serde(default)]
    manage_users: bool,
}

#[derive(FromRow, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    id: Uuid,
    name: String,
    email: String,
    status: String,
    delivery: String,
    expires_at: String,
    roles: Vec<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct InvitationsResponse {
    data: Vec<Invitation>,
    enabled: bool,
}

fn db(error: sqlx::Error) -> ManagementError {
    access::database_error(error).into()
}
fn key(headers: &HeaderMap) -> Result<Uuid, ManagementError> {
    headers
        .get("idempotency-key")
        .ok_or(ManagementError::CommandKeyRequired)?
        .to_str()
        .ok()
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or(ManagementError::Invalid(
            "Informe uma chave válida para o convite",
        ))
}
fn json<T: Serialize>(value: T) -> Response {
    ([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response()
}

async fn invitation(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<Invitation, ManagementError> {
    sqlx::query_as("SELECT i.id, i.name, i.email, CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired' ELSE i.status END AS status, i.delivery, to_char(i.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS expires_at, ARRAY(SELECT name FROM roles WHERE id = ANY(i.role_ids) ORDER BY name) AS roles FROM user_invitations i WHERE id = $1")
        .bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(ManagementError::NotFound)
}

async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    subject: &str,
    id: Uuid,
    action: &str,
) -> Result<(), ManagementError> {
    sqlx::query("INSERT INTO audit_log (tenant_id, identity_id, action, entity_type, entity_id) SELECT $1, id, $3, 'user_invitation', $4 FROM identities WHERE auth_subject = $2")
        .bind(tenant).bind(subject).bind(action).bind(id.to_string()).execute(&mut **tx).await.map_err(db)?;
    sqlx::query("INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, 'user_invitation', $2, $3, '{}'::jsonb)")
        .bind(tenant).bind(id.to_string()).bind(action).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

async fn manager_role(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    rights: &access::AccessRow,
) -> Result<Uuid, ManagementError> {
    let permissions = MANAGER_PERMISSIONS
        .iter()
        .map(|p| (*p).to_owned())
        .collect::<Vec<_>>();
    management::within_authority(rights, &permissions)?;
    let id: Uuid = sqlx::query_scalar("INSERT INTO roles (tenant_id, code, name, description) VALUES ($1, 'user-manager', 'Gestor de usuários', 'Convidar e gerenciar usuários, consultar papéis e dados da empresa') ON CONFLICT (tenant_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id")
        .bind(tenant).fetch_one(&mut **tx).await.map_err(db)?;
    let role = management::role(tx, id).await?;
    if role.permissions.is_empty() {
        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_code) SELECT $1, unnest($2::text[])",
        )
        .bind(id)
        .bind(&permissions)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    } else if role.permissions != permissions {
        return Err(ManagementError::Conflict(
            "O papel Gestor de usuários foi personalizado. Selecione os papéis manualmente",
        ));
    }
    Ok(id)
}

async fn selected_permissions(
    tx: &mut Transaction<'_, Postgres>,
    ids: &[Uuid],
    rights: &access::AccessRow,
) -> Result<Vec<String>, ManagementError> {
    let mut permissions = Vec::new();
    for id in ids {
        let role = management::role(tx, *id).await?;
        management::within_authority(rights, &role.permissions)?;
        permissions.extend(role.permissions);
    }
    permissions.sort();
    permissions.dedup();
    Ok(permissions)
}

#[utoipa::path(get, path = "/api/v1/invitations", tag = "Platform", security(("bearerAuth" = [])), responses((status = 200, body = InvitationsResponse)))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, ManagementError> {
    let (_, mut tx, _) =
        management::authorized(&state, &headers, &identity, "platform.users.read", false).await?;
    let ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM user_invitations ORDER BY created_at DESC LIMIT 200")
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
    let mut data = Vec::new();
    for id in ids {
        data.push(invitation(&mut tx, id).await?);
    }
    tx.commit().await.map_err(db)?;
    Ok(json(InvitationsResponse {
        data,
        enabled: state.invitations.is_some(),
    }))
}

#[utoipa::path(post, path = "/api/v1/invitations", tag = "Platform", request_body = InvitationInput, security(("bearerAuth" = [])), responses((status = 200, body = Invitation)))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<InvitationInput>, JsonRejection>,
) -> Result<Response, ManagementError> {
    let client = state.invitations.as_ref().ok_or(ManagementError::Conflict(
        "O envio de convites ainda não foi configurado",
    ))?;
    let command_key = key(&headers)?;
    let Json(mut input) = payload
        .map_err(|_| ManagementError::Invalid("Convite inválido ou campos desconhecidos"))?;
    input.name = input.name.trim().into();
    input.email = input.email.trim().to_lowercase();
    input.role_ids.sort();
    input.role_ids.dedup();
    if input.name.is_empty()
        || input.name.chars().count() > 120
        || input.email.len() > 254
        || input.email.chars().any(char::is_whitespace)
        || !input.email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && domain.contains('.') && !domain.contains('@')
        })
        || input.role_ids.len() > 32
        || (input.role_ids.is_empty() && !input.manage_users)
    {
        return Err(ManagementError::Invalid(
            "Informe nome, e-mail válido e ao menos um acesso",
        ));
    }
    let request =
        serde_json::to_value(&input).map_err(|_| ManagementError::Invalid("Convite inválido"))?;
    let (tenant, mut tx, rights) =
        management::authorized(&state, &headers, &identity, "platform.users.manage", true).await?;
    access::require_permission(&rights, "platform.users.read")?;
    access::require_permission(&rights, "platform.roles.read")?;
    let previous: Option<(Uuid, serde_json::Value)> =
        sqlx::query_as("SELECT id, request FROM user_invitations WHERE command_key = $1")
            .bind(command_key)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?;
    if let Some((id, previous)) = previous {
        if previous != request {
            return Err(ManagementError::Conflict(
                "Chave já utilizada com outro convite",
            ));
        }
        let value = invitation(&mut tx, id).await?;
        tx.commit().await.map_err(db)?;
        return Ok(json(value));
    }
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tenant_memberships m JOIN identities i ON i.id = m.identity_id WHERE lower(i.email) = $1) OR EXISTS(SELECT 1 FROM user_invitations WHERE email = $1 AND status = 'pending')")
        .bind(&input.email).fetch_one(&mut *tx).await.map_err(db)?;
    if exists {
        return Err(ManagementError::Conflict(
            "Este e-mail já possui um acesso ou convite nesta empresa. Consulte a lista de usuários",
        ));
    }
    if input.manage_users {
        let manager = manager_role(&mut tx, tenant, &rights).await?;
        if !input.role_ids.contains(&manager) {
            input.role_ids.push(manager);
        }
    }
    let ceiling = selected_permissions(&mut tx, &input.role_ids, &rights).await?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO user_invitations (id, tenant_id, name, email, invited_by, role_ids, permission_ceiling, command_key, delivery_key, request) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)")
        .bind(id).bind(tenant).bind(&input.name).bind(&input.email).bind(&identity.subject).bind(&input.role_ids).bind(&ceiling).bind(command_key).bind(request).execute(&mut *tx).await.map_err(db)?;
    audit(
        &mut tx,
        tenant,
        &identity.subject,
        id,
        "user_invitation.created",
    )
    .await?;
    let value = invitation(&mut tx, id).await?;
    let company: String = sqlx::query_scalar("SELECT legal_name FROM tenants WHERE id = $1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    // Commit the invitation before contacting Auth: a delivered email always has a persisted invitation.
    tx.commit().await.map_err(db)?;
    let delivery = client.send(&value, &company, &identity.name).await;
    finish_delivery(&state, tenant, id, command_key, delivery).await
}

async fn finish_delivery(
    state: &AppState,
    tenant: Uuid,
    id: Uuid,
    command: Uuid,
    delivery: &str,
) -> Result<Response, ManagementError> {
    let mut tx = access::tenant_transaction(state, tenant).await?;
    sqlx::query("UPDATE user_invitations SET delivery = $3 WHERE id = $1 AND delivery_key = $2")
        .bind(id)
        .bind(command)
        .bind(delivery)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let value = invitation(&mut tx, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(json(value))
}

#[utoipa::path(post, path = "/api/v1/invitations/{id}/resend", tag = "Platform", security(("bearerAuth" = [])), params(("id" = Uuid, Path)), responses((status = 200, body = Invitation)))]
pub async fn resend(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, ManagementError> {
    let client = state.invitations.as_ref().ok_or(ManagementError::Conflict(
        "O envio de convites ainda não foi configurado",
    ))?;
    let command = key(&headers)?;
    let (tenant, mut tx, rights) =
        management::authorized(&state, &headers, &identity, "platform.users.manage", true).await?;
    access::require_permission(&rights, "platform.users.read")?;
    access::require_permission(&rights, "platform.roles.read")?;
    let value = invitation(&mut tx, id).await?;
    let (previous, ready, roles): (Uuid, bool, Vec<Uuid>) = sqlx::query_as("SELECT delivery_key, last_delivery_at < now() - interval '60 seconds', role_ids FROM user_invitations WHERE id = $1 FOR UPDATE").bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    if previous == command {
        tx.commit().await.map_err(db)?;
        return Ok(json(value));
    }
    if value.status != "pending" || !ready {
        return Err(ManagementError::Conflict(
            "O convite precisa estar válido. Aguarde um minuto entre os envios",
        ));
    }
    selected_permissions(&mut tx, &roles, &rights).await?;
    sqlx::query("UPDATE user_invitations SET delivery = 'sending', delivery_key = $2, last_delivery_at = now() WHERE id = $1").bind(id).bind(command).execute(&mut *tx).await.map_err(db)?;
    audit(
        &mut tx,
        tenant,
        &identity.subject,
        id,
        "user_invitation.resent",
    )
    .await?;
    let company: String = sqlx::query_scalar("SELECT legal_name FROM tenants WHERE id = $1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    let delivery = client.send(&value, &company, &identity.name).await;
    finish_delivery(&state, tenant, id, command, delivery).await
}

#[utoipa::path(post, path = "/api/v1/invitations/{id}/revoke", tag = "Platform", security(("bearerAuth" = [])), params(("id" = Uuid, Path)), responses((status = 200, body = Invitation)))]
pub async fn revoke(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, ManagementError> {
    let (tenant, mut tx, _) =
        management::authorized(&state, &headers, &identity, "platform.users.manage", true).await?;
    let value = invitation(&mut tx, id).await?;
    if value.status == "accepted" {
        return Err(ManagementError::Conflict(
            "O convite já foi aceito. Gerencie o acesso pela lista de usuários",
        ));
    }
    sqlx::query("UPDATE user_invitations SET status = 'revoked' WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    audit(
        &mut tx,
        tenant,
        &identity.subject,
        id,
        "user_invitation.revoked",
    )
    .await?;
    let value = invitation(&mut tx, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(json(value))
}

pub async fn accept_for_identity(
    state: &AppState,
    identity: &AuthenticatedIdentity,
) -> Result<(), access::AccessError> {
    let mut discovery = state
        .database
        .begin()
        .await
        .map_err(access::database_error)?;
    sqlx::query("SELECT set_config('app.tenant_id', '', true), set_config('app.invitation_email', $1, true)").bind(&identity.email).execute(&mut *discovery).await.map_err(access::database_error)?;
    let candidates: Vec<(Uuid, Uuid)> = sqlx::query_as("SELECT id, tenant_id FROM user_invitations WHERE email = $1 AND status = 'pending' AND expires_at > now() ORDER BY created_at LIMIT 100")
        .bind(&identity.email).fetch_all(&mut *discovery).await.map_err(access::database_error)?;
    discovery.commit().await.map_err(access::database_error)?;
    for (id, tenant) in candidates {
        accept_one(state, identity, id, tenant).await?;
    }
    Ok(())
}

async fn accept_one(
    state: &AppState,
    identity: &AuthenticatedIdentity,
    id: Uuid,
    tenant: Uuid,
) -> Result<(), access::AccessError> {
    let mut tx = access::tenant_transaction(state, tenant).await?;
    sqlx::query("SELECT id FROM tenants WHERE id = $1 FOR UPDATE")
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .map_err(access::database_error)?;
    let pending: Option<(String, Vec<Uuid>, Vec<String>)> = sqlx::query_as("SELECT invited_by, role_ids, permission_ceiling FROM user_invitations WHERE id = $1 AND email = $2 AND status = 'pending' AND expires_at > now() FOR UPDATE")
        .bind(id).bind(&identity.email).fetch_optional(&mut *tx).await.map_err(access::database_error)?;
    let Some((inviter, roles, ceiling)) = pending else {
        return Ok(());
    };
    let rights = match access::load_access(&mut tx, tenant, &inviter).await {
        Ok(value) => value,
        Err(access::AccessError::Forbidden) => return Ok(()),
        Err(error) => return Err(error),
    };
    if access::require_permission(&rights, "platform.users.manage").is_err() {
        return Ok(());
    }
    let permissions = match selected_permissions(&mut tx, &roles, &rights).await {
        Ok(value) => value,
        Err(ManagementError::Access(access::AccessError::Internal)) => {
            return Err(access::AccessError::Internal);
        }
        Err(_) => return Ok(()),
    };
    if permissions.iter().any(|p| !ceiling.contains(p)) {
        return Ok(());
    }
    let identity_id: Uuid = sqlx::query_scalar("INSERT INTO identities (auth_subject, email, display_name) VALUES ($1,$2,$3) ON CONFLICT (auth_subject) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, updated_at = now() RETURNING id")
        .bind(&identity.subject).bind(&identity.email).bind(&identity.name).fetch_one(&mut *tx).await.map_err(access::database_error)?;
    // An invitation never reactivates a blocked membership or changes existing roles.
    let membership: Option<Uuid> = sqlx::query_scalar("INSERT INTO tenant_memberships (tenant_id, identity_id) VALUES ($1,$2) ON CONFLICT (tenant_id, identity_id) DO NOTHING RETURNING id")
        .bind(tenant).bind(identity_id).fetch_optional(&mut *tx).await.map_err(access::database_error)?;
    if let Some(membership) = membership {
        sqlx::query(
            "INSERT INTO membership_roles (membership_id, role_id) SELECT $1, unnest($2::uuid[])",
        )
        .bind(membership)
        .bind(&roles)
        .execute(&mut *tx)
        .await
        .map_err(access::database_error)?;
    }
    sqlx::query("UPDATE user_invitations SET status = 'accepted', accepted_at = now(), accepted_subject = $2 WHERE id = $1").bind(id).bind(&identity.subject).execute(&mut *tx).await.map_err(access::database_error)?;
    audit(
        &mut tx,
        tenant,
        &identity.subject,
        id,
        "user_invitation.accepted",
    )
    .await
    .map_err(|_| access::AccessError::Internal)?;
    tx.commit().await.map_err(access::database_error)?;
    Ok(())
}
