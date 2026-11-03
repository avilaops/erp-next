//! Optional CT-e scheduler, scoped to one tenant and a current member's rights.
use crate::{
    domains::{DomainError, authorized, db},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};
use axum::http::HeaderMap;
use uuid::Uuid;

pub fn start(state: AppState) -> anyhow::Result<Option<tokio::task::JoinHandle<()>>> {
    let tenant = std::env::var("ERP_CTE_AUTOMATION_TENANT_ID")
        .ok()
        .filter(|v| !v.trim().is_empty());
    let subject = std::env::var("ERP_CTE_AUTOMATION_SUBJECT")
        .ok()
        .filter(|v| !v.trim().is_empty());
    let (tenant, subject) = match (tenant, subject) {
        (None, None) => return Ok(None),
        (Some(tenant), Some(subject)) => (tenant.parse::<Uuid>()?, subject),
        _ => anyhow::bail!(
            "ERP_CTE_AUTOMATION_TENANT_ID and ERP_CTE_AUTOMATION_SUBJECT must be configured together"
        ),
    };
    anyhow::ensure!(
        subject.len() <= 255 && !subject.chars().any(char::is_control),
        "Invalid CT-e automation subject"
    );
    anyhow::ensure!(
        state.fiscal_engine.is_some() && state.certificates.is_some(),
        "CT-e automation requires the fiscal engine and certificate vault"
    );
    let mut headers = HeaderMap::new();
    headers.insert("x-tenant-id", tenant.to_string().parse()?);
    let identity = AuthenticatedIdentity {
        subject,
        email: String::new(),
        name: "CT-e scheduler".to_owned(),
    };
    Ok(Some(tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if tick(&state, &identity, &headers).await.is_err() {
                tracing::warn!(
                    "Scheduled CT-e capture did not complete; check durable CT-e distribution status"
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
    let (tenant, mut tx, _) =
        authorized(state, headers, identity, super::READ, super::QUERY, false).await?;
    let row: Option<(i64,bool)> = sqlx::query_as("SELECT revision,COALESCE(next_query_at<=clock_timestamp(),true) AND COALESCE(lease_until<=clock_timestamp(),true) FROM fiscal_cte_distribution_state WHERE tenant_id=$1 AND environment=2")
        .bind(tenant).fetch_optional(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    let (revision, due) = row.unwrap_or((1, true));
    if due {
        super::run_distribution(state, identity, headers, revision, Uuid::now_v7()).await?;
    }
    Ok(())
}
