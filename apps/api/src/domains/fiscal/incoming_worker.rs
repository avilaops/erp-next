//! Optional one-tenant scheduler. A real member's current permissions authorize
//! each cycle; there is no cross-tenant scan or service role bypass.
use axum::http::HeaderMap;
use uuid::Uuid;

use crate::{
    domains::{DomainError, authorized, db},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};

pub fn start(state: AppState) -> anyhow::Result<Option<tokio::task::JoinHandle<()>>> {
    let tenant = std::env::var("ERP_FISCAL_AUTOMATION_TENANT_ID")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let subject = std::env::var("ERP_FISCAL_AUTOMATION_SUBJECT")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let (tenant, subject) = match (tenant, subject) {
        (None, None) => return Ok(None),
        (Some(tenant), Some(subject)) => (tenant.parse::<Uuid>()?, subject),
        _ => anyhow::bail!(
            "ERP_FISCAL_AUTOMATION_TENANT_ID and ERP_FISCAL_AUTOMATION_SUBJECT must be configured together"
        ),
    };
    anyhow::ensure!(
        subject.len() <= 255,
        "Fiscal automation subject exceeds limit"
    );
    anyhow::ensure!(
        state.fiscal_engine.is_some() && state.certificates.is_some(),
        "Fiscal automation requires the fiscal engine and certificate vault"
    );
    let mut headers = HeaderMap::new();
    headers.insert("x-tenant-id", tenant.to_string().parse()?);
    let identity = AuthenticatedIdentity {
        subject,
        email: String::new(),
        name: "Fiscal scheduler".to_owned(),
    };
    Ok(Some(tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if tick(&state, &identity, &headers).await.is_err() {
                // Do not log provider bodies, certificate material or identity.
                tracing::warn!(
                    "Scheduled fiscal distribution did not complete; durable status is available through the fiscal API"
                );
            }
        }
    })))
}

pub async fn tick(
    state: &AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
) -> Result<(), DomainError> {
    let (tenant, mut tx, _) = authorized(
        state,
        headers,
        identity,
        super::PERMISSION,
        super::PERMISSION,
        false,
    )
    .await?;
    let row: Option<(i64, bool)> = sqlx::query_as("SELECT revision,COALESCE(next_query_at<=clock_timestamp(),true) AND COALESCE(lease_until<=clock_timestamp(),true) FROM fiscal_distribution_cursors WHERE tenant_id=$1 AND environment=2")
        .bind(tenant).fetch_optional(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    let (revision, due) = row.unwrap_or((1, true));
    if due {
        super::run_distribution(state, identity, headers, revision, Uuid::now_v7()).await?;
    }
    Ok(())
}
