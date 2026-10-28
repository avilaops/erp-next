use axum::{Json, extract::State, http::StatusCode};
use serde::Serialize;

use crate::platform::state::AppState;

#[derive(Serialize, utoipa::ToSchema)]
pub struct HealthResponse {
    status: &'static str,
}

#[utoipa::path(get, path = "/health/live", tag = "Health", responses((status = 200, body = HealthResponse)))]
pub async fn live() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[utoipa::path(get, path = "/health/ready", tag = "Health", responses((status = 200, body = HealthResponse), (status = 503, body = HealthResponse)))]
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

#[utoipa::path(get, path = "/api/health", tag = "Health", responses((status = 200, body = HealthResponse), (status = 503, body = HealthResponse)))]
pub async fn api_health(
    state: State<AppState>,
) -> Result<Json<HealthResponse>, (StatusCode, Json<HealthResponse>)> {
    ready(state).await
}
