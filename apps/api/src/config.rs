use std::{env, net::SocketAddr};

use anyhow::{Context, ensure};

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_address: SocketAddr,
    pub auth_userinfo_url: String,
    pub database_url: String,
    pub database_max_connections: u32,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        reject_production_fiscal_mode(
            &env::var("NFE_PRODUCTION_ENABLED").unwrap_or_else(|_| "false".to_owned()),
        )?;
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
        })
    }
}

fn reject_production_fiscal_mode(value: &str) -> anyhow::Result<()> {
    ensure!(
        value == "false",
        "NFE_PRODUCTION_ENABLED must remain false: production NF-e is not implemented or approved"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::reject_production_fiscal_mode;
    #[test]
    fn production_fiscal_flag_cannot_enable_transmission() {
        assert!(reject_production_fiscal_mode("false").is_ok());
        for value in ["true", "1", "", "False", "production"] {
            assert!(reject_production_fiscal_mode(value).is_err());
        }
    }
}
