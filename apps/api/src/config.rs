use std::{env, net::SocketAddr};

use anyhow::{Context, ensure};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_address: SocketAddr,
    pub auth_userinfo_url: String,
    pub database_url: String,
    pub database_max_connections: u32,
    pub nfe_production_enabled: bool,
    pub nfe_production_tenant_id: Option<Uuid>,
    pub invitations: Option<crate::platform::invitations::ProvisioningClient>,
    pub mail: Option<crate::platform::mail::SmtpMailer>,
    pub danfe: Option<crate::domains::fiscal::danfe_client::DanfeClient>,
    pub contracts: Option<crate::domains::contracts::provider::Docuseal>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let nfe_production_enabled = parse_legacy_fiscal_flag(
            &env::var("NFE_PRODUCTION_ENABLED").unwrap_or_else(|_| "false".to_owned()),
        )?;
        let nfe_production_tenant_id = env::var("NFE_PRODUCTION_TENANT_ID")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| {
                Uuid::parse_str(value.trim()).context("NFE_PRODUCTION_TENANT_ID must be a UUID")
            })
            .transpose()?;
        ensure!(
            !nfe_production_enabled || nfe_production_tenant_id.is_some(),
            "NFE_PRODUCTION_TENANT_ID is required when NFE_PRODUCTION_ENABLED=true"
        );
        let bind_address = env::var("API_BIND_ADDRESS")
            .unwrap_or_else(|_| "0.0.0.0:8080".to_owned())
            .parse()
            .context("API_BIND_ADDRESS must be a valid socket address")?;
        let auth_issuer = env::var("AUTH_ISSUER")
            .unwrap_or_else(|_| "https://auth.avilaops.com".to_owned())
            .trim_end_matches('/')
            .to_owned();
        let auth_userinfo_url = env::var("AUTH_USERINFO_URL")
            .unwrap_or_else(|_| format!("{auth_issuer}/oauth/userinfo"));
        reqwest::Url::parse(&auth_userinfo_url)
            .context("AUTH_USERINFO_URL must be a valid absolute URL")?;
        let database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
        let database_max_connections = env::var("DATABASE_MAX_CONNECTIONS")
            .unwrap_or_else(|_| "10".to_owned())
            .parse()
            .context("DATABASE_MAX_CONNECTIONS must be an integer")?;

        ensure!(
            database_max_connections > 0,
            "DATABASE_MAX_CONNECTIONS must be greater than zero"
        );

        Ok(Self {
            bind_address,
            auth_userinfo_url,
            database_url,
            database_max_connections,
            nfe_production_enabled,
            nfe_production_tenant_id,
            invitations: crate::platform::invitations::ProvisioningClient::from_env(&auth_issuer)?,
            mail: crate::platform::mail::SmtpMailer::from_env()?,
            danfe: danfe_configuration()?,
            contracts: crate::domains::contracts::provider::Docuseal::from_env()?,
        })
    }
}

fn danfe_configuration() -> anyhow::Result<Option<crate::domains::fiscal::danfe_client::DanfeClient>>
{
    let endpoint = env::var("DANFE_MCP_URL")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let token = env::var("DANFE_MCP_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let ca_path = env::var("DANFE_CA_BUNDLE_FILE")
        .ok()
        .filter(|value| !value.trim().is_empty());
    if endpoint.is_none() && token.is_none() && ca_path.is_none() {
        return Ok(None);
    }
    let endpoint = endpoint.context("DANFE_MCP_URL is required when enabling DANFE")?;
    let token = token.context("DANFE_MCP_TOKEN is required when enabling DANFE")?;
    let bundle = ca_path
        .map(|path| std::fs::read_to_string(path).context("Failed to read DANFE_CA_BUNDLE_FILE"))
        .transpose()?;
    crate::domains::fiscal::danfe_client::DanfeClient::new(&endpoint, &token, bundle).map(Some)
}

// This is an explicit deployment gate. It never selects a tenant environment,
// provisions credentials or proves fiscal homologation by itself.
fn parse_legacy_fiscal_flag(value: &str) -> anyhow::Result<bool> {
    ensure!(
        ["false", "true"].contains(&value),
        "NFE_PRODUCTION_ENABLED must be a boolean; select the fiscal environment in the company profile"
    );
    Ok(value == "true")
}

#[cfg(test)]
mod tests {
    use super::parse_legacy_fiscal_flag;
    #[test]
    fn legacy_flag_accepts_booleans_without_selecting_a_company_environment() {
        assert_eq!(parse_legacy_fiscal_flag("false").unwrap(), false);
        assert_eq!(parse_legacy_fiscal_flag("true").unwrap(), true);
        for value in ["1", "", "False", "production"] {
            assert!(parse_legacy_fiscal_flag(value).is_err());
        }
    }
}
