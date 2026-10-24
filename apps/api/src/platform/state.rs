use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub database: PgPool,
}

impl AppState {
    pub fn new(database: PgPool) -> Self {
        Self { database }
    }
}

