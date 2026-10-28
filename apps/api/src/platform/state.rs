use sqlx::PgPool;

use super::auth::AuthClient;

#[derive(Clone)]
pub struct AppState {
    pub auth: AuthClient,
    pub database: PgPool,
}

impl AppState {
    pub fn new(database: PgPool, auth: AuthClient) -> Self {
        Self { auth, database }
    }
}
