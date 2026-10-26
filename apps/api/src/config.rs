use std::{env, net::SocketAddr};

use anyhow::{Context, ensure};

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_address: SocketAddr,
    pub database_url: String,
    pub database_max_connections: u32,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let bind_address = env::var("API_BIND_ADDRESS")
            .unwrap_or_else(|_| "0.0.0.0:8080".to_owned())
            .parse()
            .context("API_BIND_ADDRESS must be a valid socket address")?;
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
            database_url,
            database_max_connections,
        })
    }
}
