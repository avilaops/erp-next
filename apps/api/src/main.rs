mod config;
mod domains;
mod http;
mod platform;

use anyhow::Context;
use config::Config;
use platform::auth::AuthClient;
use platform::state::AppState;
use sqlx::postgres::PgPoolOptions;
use tokio::net::TcpListener;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();
    platform::langfuse::init();
    let result = run().await;
    platform::langfuse::shutdown().await;
    result
}

async fn run() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .connect(&config.database_url)
        .await
        .context("failed to connect to PostgreSQL")?;

    match std::env::args().nth(1).as_deref() {
        Some("migrate") => {
            sqlx::migrate!("../../migrations")
                .run(&pool)
                .await
                .context("failed to apply database migrations")?;
            info!("database migrations applied");
            return Ok(());
        }
        Some(_) => anyhow::bail!("usage: erp-next-api [migrate]"),
        None => {}
    }

    let listener = TcpListener::bind(config.bind_address)
        .await
        .context("failed to bind HTTP listener")?;
    let local_address = listener.local_addr()?;
    let auth = AuthClient::new(config.auth_userinfo_url);
    let state = AppState::new(pool, auth)
        .with_fiscal_engine(domains::fiscal::engine_client::FiscalEngine::from_env()?)
        .with_certificates(domains::fiscal::certificate_crypto::CertificateVault::from_env()?)
        .with_assistant(domains::assistant::InferenceClient::from_env()?)
        .with_danfe(config.danfe)
        .with_contracts(config.contracts)
        .with_invitations(config.invitations);
    let fiscal_worker = domains::fiscal::incoming::worker::start(state.clone())?;
    let app = http::router(state);

    info!(%local_address, "ERP Next API listening");
    let result = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("HTTP server failed");
    if let Some(worker) = fiscal_worker {
        worker.abort();
    }
    result
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "erp_next_api=info,tower_http=info".into()),
        )
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install terminate handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
