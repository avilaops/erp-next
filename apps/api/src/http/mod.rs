#[cfg(test)]
mod access_tests;
#[cfg(test)]
mod company_tests;
#[cfg(test)]
mod danfe_tests;
#[cfg(test)]
mod domain_tests;
#[cfg(test)]
mod fiscal_tests;
mod health;
#[cfg(test)]
mod health_tests;
#[cfg(test)]
mod invitation_tests;
#[cfg(test)]
mod legacy_tests;
#[cfg(test)]
mod onboarding_tests;
mod openapi;
#[cfg(test)]
mod operations_tests;
#[cfg(test)]
mod parties_tests;
#[cfg(test)]
mod purchase_chain_tests;
#[cfg(test)]
mod received_nfe_tests;
#[cfg(test)]
mod reference_tests;
#[cfg(test)]
mod staff_tests;

use axum::{Router, middleware, routing::get};
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};

use crate::domains::{
    catalog, finance, fiscal, inventory, parties, payables, purchasing, reference_data, sales,
    staff,
};
use crate::platform::{
    access, access_management, auth, company, invitations, onboarding, service_auth,
    state::AppState,
};

pub fn router(state: AppState) -> Router {
    let request_id_header = axum::http::HeaderName::from_static("x-request-id");

    let protected = Router::new()
        .route("/api/v1/legacy-history", get(crate::domains::legacy::list))
        .route(
            "/api/v1/legacy-history/files/{id}",
            get(crate::domains::legacy::file),
        )
        .route(
            "/api/v1/purchase-orders",
            get(purchasing::list).post(purchasing::create),
        )
        .route(
            "/api/v1/purchase-orders/{id}",
            get(purchasing::get).put(purchasing::update),
        )
        .route(
            "/api/v1/purchase-orders/{id}/confirm",
            axum::routing::post(purchasing::confirm),
        )
        .route(
            "/api/v1/purchase-orders/{id}/cancel",
            axum::routing::post(purchasing::cancel),
        )
        .route(
            "/api/v1/purchase-orders/{id}/close",
            axum::routing::post(purchasing::close),
        )
        .route(
            "/api/v1/purchase-orders/{id}/receipts",
            get(purchasing::receipts).post(purchasing::receive),
        )
        .route(
            "/api/v1/purchase-receipts/{id}",
            get(purchasing::get_receipt),
        )
        .route("/api/v1/payables", get(payables::list))
        .route("/api/v1/payables/{id}", get(payables::get))
        .route(
            "/api/v1/payables/{id}/payments",
            axum::routing::post(payables::pay),
        )
        .route(
            "/api/v1/payables/{id}/reverse-payment",
            axum::routing::post(payables::reverse),
        )
        .route(
            "/api/v1/companies",
            get(onboarding::list).post(onboarding::create),
        )
        .route("/api/v1/staff", get(staff::list).post(staff::create))
        .route("/api/v1/staff/{id}", get(staff::get).put(staff::update))
        .merge(fiscal::routes())
        .merge(service_auth::management_routes())
        .merge(reference_data::routes())
        .route("/api/v1/orders", get(sales::list).post(sales::create))
        .route("/api/v1/orders/{id}", get(sales::get).put(sales::update))
        .route(
            "/api/v1/orders/{id}/confirm",
            axum::routing::post(sales::confirm),
        )
        .route(
            "/api/v1/orders/{id}/cancel",
            axum::routing::post(sales::cancel),
        )
        .route(
            "/api/v1/orders/{id}/complete",
            axum::routing::post(sales::complete),
        )
        .route("/api/v1/receivables", get(finance::list))
        .route("/api/v1/receivables/{id}", get(finance::get))
        .route(
            "/api/v1/receivables/{id}/payments",
            axum::routing::post(finance::pay),
        )
        .route(
            "/api/v1/receivables/{id}/reverse-payment",
            axum::routing::post(finance::reverse),
        )
        .route("/api/v1/parties", get(parties::list).post(parties::create))
        .route(
            "/api/v1/parties/{id}",
            get(parties::get).put(parties::update),
        )
        .route("/api/v1/products", get(catalog::list).post(catalog::create))
        .route(
            "/api/v1/products/{id}",
            get(catalog::get).put(catalog::update),
        )
        .route("/api/v1/stock", get(inventory::balances))
        .route(
            "/api/v1/stock/movements",
            get(inventory::history).post(inventory::post_movement),
        )
        .route(
            "/api/v1/company",
            get(company::get_company).put(company::put_company),
        )
        .route("/api/v1/me", get(access::current_access))
        .route("/api/v1/users", get(access::list_users))
        .route(
            "/api/v1/invitations",
            get(invitations::list).post(invitations::create),
        )
        .route(
            "/api/v1/invitations/{id}/resend",
            axum::routing::post(invitations::resend),
        )
        .route(
            "/api/v1/invitations/{id}/revoke",
            axum::routing::post(invitations::revoke),
        )
        .route("/api/v1/permissions", get(access::list_permissions))
        .route(
            "/api/v1/roles",
            get(access::list_roles).post(access_management::create_role),
        )
        .route(
            "/api/v1/roles/{id}",
            get(access_management::get_role)
                .put(access_management::update_role)
                .delete(access_management::delete_role),
        )
        .route(
            "/api/v1/users/{id}",
            get(access_management::get_member).put(access_management::update_member),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ));

    let service = fiscal::service_routes().layer(middleware::from_fn_with_state(
        state.clone(),
        service_auth::require_service_auth,
    ));

    Router::new()
        .route("/openapi.json", get(openapi::document))
        .route("/health/live", get(health::live))
        .route("/health/ready", get(health::ready))
        .merge(service)
        .route("/api/health", get(health::api_health))
        .merge(protected)
        .with_state(state)
        .layer(PropagateRequestIdLayer::new(request_id_header.clone()))
        .layer(TraceLayer::new_for_http())
        .layer(SetRequestIdLayer::new(request_id_header, MakeRequestUuid))
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use sqlx::postgres::PgPoolOptions;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn liveness_does_not_depend_on_database_availability() {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://postgres:postgres@127.0.0.1:1/erp_next")
            .expect("valid test database URL");
        let auth =
            crate::platform::auth::AuthClient::new("http://127.0.0.1:1/oauth/userinfo".to_owned());
        let response = router(AppState::new(pool, auth))
            .oneshot(
                Request::builder()
                    .uri("/health/live")
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("router response");

        assert_eq!(response.status(), axum::http::StatusCode::OK);
    }

    #[tokio::test]
    async fn protected_routes_require_a_bearer_token_before_database_access() {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://postgres:postgres@127.0.0.1:1/erp_next")
            .expect("valid test database URL");
        let auth =
            crate::platform::auth::AuthClient::new("http://127.0.0.1:1/oauth/userinfo".to_owned());
        let response = router(AppState::new(pool, auth))
            .oneshot(
                Request::builder()
                    .uri("/api/v1/me")
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("router response");

        assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn protected_routes_reject_tokens_refused_by_auth() {
        let auth_listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test auth listener");
        let auth_address = auth_listener.local_addr().expect("test auth address");
        let auth_server = tokio::spawn(async move {
            axum::serve(
                auth_listener,
                Router::new().route(
                    "/oauth/userinfo",
                    get(|| async { axum::http::StatusCode::UNAUTHORIZED }),
                ),
            )
            .await
        });

        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://postgres:postgres@127.0.0.1:1/erp_next")
            .expect("valid test database URL");
        let auth =
            crate::platform::auth::AuthClient::new(format!("http://{auth_address}/oauth/userinfo"));
        let response = router(AppState::new(pool, auth))
            .oneshot(
                Request::builder()
                    .uri("/api/v1/me")
                    .header(axum::http::header::AUTHORIZATION, "Bearer refused")
                    .body(Body::empty())
                    .expect("valid request"),
            )
            .await
            .expect("router response");
        auth_server.abort();

        assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
    }
}
