use super::{access, auth::AuthenticatedIdentity, state::AppState};
use crate::domains::{DomainError, db, response, revision};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DashboardLayout {
    pub favorite_paths: Vec<String>,
    pub charts: Vec<String>,
    pub period: String,
}

impl DashboardLayout {
    fn validate(&self) -> Result<(), DomainError> {
        let allowed = [
            "/vendas/pedidos",
            "/compras/pedidos",
            "/cadastros/clientes-fornecedores",
            "/cadastros/produtos",
            "/financeiro/contas-receber",
            "/financeiro/contas-pagar",
        ];
        let unique = |values: &[String]| {
            values
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                == values.len()
        };
        if self.favorite_paths.len() > allowed.len()
            || !unique(&self.favorite_paths)
            || self
                .favorite_paths
                .iter()
                .any(|p| !allowed.contains(&p.as_str()))
            || self.charts.len() > 3
            || !unique(&self.charts)
            || self.charts.iter().any(|c| {
                !["Ticket médio", "Valor faturado", "Pedidos de venda"].contains(&c.as_str())
            })
            || !["7D", "30D", "3M", "6M", "12M"].contains(&self.period.as_str())
        {
            return Err(DomainError::Invalid("Layout da página inicial inválido"));
        }
        Ok(())
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default)]
    owner_key: Option<String>,
    product_page_size: i32,
    #[serde(default)]
    dashboard_layout: Option<DashboardLayout>,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceData {
    product_page_size: i32,
    dashboard_layout: DashboardLayout,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesSnapshot {
    owner_key: String,
    tenant_id: Uuid,
    revision: i64,
    data: PreferenceData,
}

fn owner_key(tenant: Uuid, subject: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{tenant}:{subject}").as_bytes())
    )
}

async fn transaction<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
    identity: &AuthenticatedIdentity,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>), DomainError> {
    let tenant = access::tenant_id(headers)?;
    let mut tx = access::tenant_transaction(state, tenant).await?;
    if write {
        sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    access::load_access(&mut tx, tenant, &identity.subject).await?;
    sqlx::query("SELECT set_config('app.auth_subject',$1,true)")
        .bind(&identity.subject)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    Ok((tenant, tx))
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    subject: &str,
) -> Result<(i64, i32, DashboardLayout), DomainError> {
    let row: Option<(i64, i32, serde_json::Value)> = sqlx::query_as(
        "SELECT revision,product_page_size,dashboard_layout FROM personal_preferences WHERE tenant_id=$1 AND auth_subject=$2",
    ).bind(tenant).bind(subject).fetch_optional(&mut **tx).await.map_err(db)?;
    let (revision, size, layout) = row.unwrap_or_else(|| (1, 25, json!({
        "favoritePaths":["/vendas/pedidos","/compras/pedidos","/cadastros/clientes-fornecedores","/cadastros/produtos","/financeiro/contas-receber"],
        "charts":["Ticket médio","Valor faturado"],"period":"6M"
    })));
    let layout = serde_json::from_value(layout).map_err(|_| access::AccessError::Internal)?;
    Ok((revision, size, layout))
}

#[utoipa::path(get,path="/api/v1/preferences",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=PreferencesSnapshot),(status=403,description="Sem vínculo ativo")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx) = transaction(&state, &headers, &identity, false).await?;
    let (revision, size, layout) = load(&mut tx, tenant, &identity.subject).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        PreferencesSnapshot {
            tenant_id: tenant,
            owner_key: owner_key(tenant, &identity.subject),
            revision,
            data: PreferenceData {
                product_page_size: size,
                dashboard_layout: layout,
            },
        },
    ))
}

#[utoipa::path(put,path="/api/v1/preferences",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),request_body=Preferences,responses((status=200,body=PreferencesSnapshot),(status=412,description="Revisão alterada"),(status=422,description="Preferência inválida")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<Preferences>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let Json(input) = payload
        .map_err(|_| DomainError::Invalid("Preferências inválidas ou campos desconhecidos"))?;
    if ![10, 25, 50, 100].contains(&input.product_page_size) {
        return Err(DomainError::Invalid(
            "Escolha 10, 25, 50 ou 100 produtos por página",
        ));
    }
    if let Some(layout) = &input.dashboard_layout {
        layout.validate()?;
    }
    let (tenant, mut tx) = transaction(&state, &headers, &identity, true).await?;
    if (input.dashboard_layout.is_some() || input.owner_key.is_some())
        && input.owner_key.as_deref() != Some(owner_key(tenant, &identity.subject).as_str())
    {
        return Err(DomainError::Conflict(
            "A conta ou empresa mudou. Recarregue suas preferências",
        ));
    }
    let (current, _, previous_layout) = load(&mut tx, tenant, &identity.subject).await?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    let layout = input.dashboard_layout.unwrap_or(previous_layout);
    let raw = serde_json::to_value(&layout).map_err(|_| access::AccessError::Internal)?;
    sqlx::query("INSERT INTO personal_preferences(tenant_id,auth_subject,product_page_size,revision,dashboard_layout) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,auth_subject) DO UPDATE SET product_page_size=$3,revision=$4,dashboard_layout=$5,updated_at=now()")
        .bind(tenant).bind(&identity.subject).bind(input.product_page_size).bind(next).bind(raw).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,details) SELECT $1,id,'preferences.updated','personal_preferences',$3 FROM identities WHERE auth_subject=$2")
        .bind(tenant).bind(&identity.subject).bind(json!({"previousRevision":current,"revision":next,"productPageSize":input.product_page_size})).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        PreferencesSnapshot {
            tenant_id: tenant,
            owner_key: owner_key(tenant, &identity.subject),
            revision: next,
            data: PreferenceData {
                product_page_size: input.product_page_size,
                dashboard_layout: layout,
            },
        },
    ))
}
