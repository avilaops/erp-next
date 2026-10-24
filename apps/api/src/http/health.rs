use axum::{Json, extract::State, http::StatusCode};
use serde::Serialize;

use crate::platform::state::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    status: &'static str,
}

pub async fn live() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

pub async fn ready(
    State(state): State<AppState>,
) -> Result<Json<HealthResponse>, (StatusCode, Json<HealthResponse>)> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.database)
        .await
        .map(|_| Json(HealthResponse { status: "ready" }))
        .map_err(|error| {
            tracing::error!(%error, "database readiness check failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse {
                    status: "unavailable",
                }),
            )
        })
}

