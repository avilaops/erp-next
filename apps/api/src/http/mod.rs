#[cfg(test)]
mod access_tests;
#[cfg(test)]
mod assistant_tests;
#[cfg(test)]
mod audit_tests;
#[cfg(test)]
mod certificate_tests;
#[cfg(test)]
mod commission_tests;
#[cfg(test)]
mod company_tests;
#[cfg(test)]
mod contracts_tests;
#[cfg(test)]
mod cte_distribution_tests;
#[cfg(test)]
mod cte_inspection_tests;
#[cfg(test)]
mod cte_links_tests;
#[cfg(test)]
mod custom_fields_tests;
#[cfg(test)]
mod custom_reports_tests;
#[cfg(test)]
mod danfe_tests;
#[cfg(test)]
mod dashboard_tests;
#[cfg(test)]
mod domain_tests;
#[cfg(test)]
mod emission_tests;
#[cfg(test)]
mod files_tests;
#[cfg(test)]
mod financial_settings_tests;
#[cfg(test)]
mod fiscal_preferences_tests;
#[cfg(test)]
mod fiscal_tests;
mod health;
#[cfg(test)]
mod health_tests;
#[cfg(test)]
mod incoming_tests;
#[cfg(test)]
mod invitation_tests;
#[cfg(test)]
mod label_templates_tests;
#[cfg(test)]
mod legacy_tests;
#[cfg(test)]
mod mcp_tests;
#[cfg(test)]
mod monitor_tests;
#[cfg(test)]
mod negotiation_tests;
#[cfg(test)]
mod onboarding_tests;
pub(crate) mod openapi;
#[cfg(test)]
mod operations_tests;
#[cfg(test)]
mod parties_tests;
#[cfg(test)]
mod preferences_tests;
#[cfg(test)]
mod production_tests;
#[cfg(test)]
mod proposal_tests;
#[cfg(test)]
mod purchase_chain_tests;
#[cfg(test)]
mod received_nfe_tests;
#[cfg(test)]
mod received_nfse_tests;
#[cfg(test)]
mod reconciliation_tests;
#[cfg(test)]
mod reference_tests;
#[cfg(test)]
mod registration_settings_tests;
#[cfg(test)]
mod registry_tests;
#[cfg(test)]
mod returns_tests;
#[cfg(test)]
mod sales_settings_tests;
#[cfg(test)]
mod simulator_tests;
#[cfg(test)]
mod staff_tests;
#[cfg(test)]
mod subscription_tests;
#[cfg(test)]
mod supply_catalogs_tests;
#[cfg(test)]
mod supply_settings_tests;
#[cfg(test)]
mod template_draft_tests;
#[cfg(test)]
mod workflows_tests;

use axum::{
    Router, middleware,
    routing::{get, post, put},
};
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};

use crate::domains::{
    catalog, data_transfer, finance, fiscal, inventory, parties, payables, purchasing,
    reference_data, sales, staff, staff_payroll,
};
use crate::platform::{
    access, access_management, auth, company, invitations, onboarding, service_auth,
    state::AppState,
};

pub fn router(state: AppState) -> Router {
    let request_id_header = axum::http::HeaderName::from_static("x-request-id");

    let business = Router::new()
        .route(
            "/api/v1/registry-lookups",
            axum::routing::post(crate::domains::registry_lookup::lookup),
        )
        .route(
            "/api/v1/registration-settings/{section}",
            get(crate::domains::registration_settings::get)
                .put(crate::domains::registration_settings::put),
        )
        .route(
            "/api/v1/inventory-settings",
            get(crate::domains::supply_settings::get_inventory)
                .put(crate::domains::supply_settings::put_inventory),
        )
        .route(
            "/api/v1/purchase-settings",
            get(crate::domains::supply_settings::get_purchase)
                .put(crate::domains::supply_settings::put_purchase),
        )
        .route(
            "/api/v1/sales-settings",
            get(sales::settings::get).put(sales::settings::put),
        )
        .route(
            "/api/v1/commercial-settings/{line}",
            get(crate::platform::commercial_settings::get)
                .put(crate::platform::commercial_settings::put),
        )
        .route(
            "/api/v1/commercial-settings/{line}/preview",
            post(crate::platform::commercial_settings::preview),
        )
        .route(
            "/api/v1/fixed-expenses",
            get(crate::domains::fixed_expenses::list).post(crate::domains::fixed_expenses::create),
        )
        .route(
            "/api/v1/fixed-expenses/{id}",
            put(crate::domains::fixed_expenses::update),
        )
        .route(
            "/api/v1/product-costs/{id}",
            get(crate::platform::product_costs::get).put(crate::platform::product_costs::put),
        )
        .route(
            "/api/v1/sales-simulator/{line}",
            get(crate::domains::sales::pricing::options),
        )
        .route(
            "/api/v1/sales-simulator/{line}/quote",
            post(crate::domains::sales::pricing::quote),
        )
        .route(
            "/api/v1/sales-simulator/{line}/orders",
            post(crate::domains::sales::pricing_orders::create),
        )
        .route(
            "/api/v1/orders/{id}/pricing",
            get(crate::domains::sales::pricing_orders::get),
        )
        .route(
            "/api/v1/orders/{id}/pricing/approve",
            post(crate::domains::sales::pricing_orders::approve),
        )
        .route(
            "/api/v1/price-tables/{line}",
            get(crate::platform::price_tables::current),
        )
        .route(
            "/api/v1/price-tables/{line}/preview",
            get(crate::platform::price_tables::preview),
        )
        .route(
            "/api/v1/price-tables/{line}/publish",
            post(crate::platform::price_tables::publish),
        )
        .merge(crate::platform::subscriptions::routes())
        .merge(crate::domains::commissions::routes())
        .merge(crate::domains::production::routes())
        .route(
            "/api/v1/financial-settings",
            get(crate::domains::finance::settings::get).put(crate::domains::finance::settings::put),
        )
        .route("/api/v1/audit", get(crate::platform::audit::list))
        .route("/api/v1/dashboard", get(crate::domains::dashboard::get))
        .route(
            "/api/v1/system/custom-fields",
            get(crate::platform::custom_fields::list).post(crate::platform::custom_fields::create),
        )
        .route(
            "/api/v1/system/custom-fields/{id}",
            axum::routing::put(crate::platform::custom_fields::update),
        )
        .route("/api/v1/system/files", get(crate::platform::files::list))
        .route(
            "/api/v1/system/files/{id}/archive",
            post(crate::platform::files::archive),
        )
        .route(
            "/api/v1/system/files/{id}/content",
            get(crate::platform::files::content),
        )
        .route(
            "/api/v1/system/custom-reports",
            get(crate::platform::custom_reports::list)
                .post(crate::platform::custom_reports::create),
        )
        .route(
            "/api/v1/system/custom-reports/{id}",
            axum::routing::put(crate::platform::custom_reports::update),
        )
        .route(
            "/api/v1/system/label-templates",
            get(crate::platform::label_templates::list)
                .post(crate::platform::label_templates::create),
        )
        .route(
            "/api/v1/system/label-templates/{id}",
            axum::routing::put(crate::platform::label_templates::update),
        )
        .route(
            "/api/v1/system/workflows",
            get(crate::platform::workflows::list).post(crate::platform::workflows::create),
        )
        .route(
            "/api/v1/system/workflows/{id}",
            axum::routing::put(crate::platform::workflows::update),
        )
        .route(
            "/api/v1/system/workflows/{id}/publish",
            post(crate::platform::workflows::publish),
        )
        .route(
            "/api/v1/system/workflows/{id}/archive",
            post(crate::platform::workflows::archive),
        )
        .merge(crate::domains::returns::routes())
        .route(
            "/api/v1/preferences",
            get(crate::platform::preferences::get).put(crate::platform::preferences::put),
        )
        .merge(crate::domains::contracts::routes())
        .route(
            "/api/v1/assistant",
            axum::routing::post(crate::domains::assistant::chat),
        )
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
            "/api/v1/company-registration/lookup",
            post(crate::domains::registry_lookup::lookup_registration),
        )
        .route(
            "/api/v1/companies",
            get(onboarding::list).post(onboarding::create),
        )
        .route(
            "/api/v1/company-selection",
            post(onboarding::select_company),
        )
        .route("/api/v1/financial-payables", get(payables::list_all))
        .route("/api/v1/financial-payables/{id}", get(payables::get_all))
        .route(
            "/api/v1/financial-payables/{id}/payments",
            post(payables::pay_all),
        )
        .route(
            "/api/v1/financial-payables/{id}/reverse-payment",
            post(payables::reverse_all),
        )
        .route("/api/v1/staff-payroll", get(staff_payroll::list))
        .route(
            "/api/v1/staff-payroll/salaries",
            post(staff_payroll::salaries),
        )
        .route(
            "/api/v1/staff-payroll/generate",
            post(staff_payroll::generate),
        )
        .route(
            "/api/v1/staff-payroll/requests/{id}/review",
            post(staff_payroll::review),
        )
        .route("/api/v1/staff/{id}/payroll", get(staff_payroll::get))
        .route(
            "/api/v1/staff/{id}/payroll/requests",
            post(staff_payroll::propose),
        )
        .route("/api/v1/staff", get(staff::list).post(staff::create))
        .route("/api/v1/staff/{id}", get(staff::get).put(staff::update))
        .merge(fiscal::routes())
        .merge(service_auth::management_routes())
        .merge(reference_data::routes())
        .route("/api/v1/orders", get(sales::list).post(sales::create))
        .route(
            "/api/v1/opportunities",
            get(sales::opportunities::list).post(sales::opportunities::create),
        )
        .route(
            "/api/v1/opportunities/{id}",
            get(sales::opportunities::get).put(sales::opportunities::update),
        )
        .route(
            "/api/v1/commercial/metrics/orders",
            get(sales::metrics::orders),
        )
        .route(
            "/api/v1/commercial/metrics/commissions",
            get(sales::metrics::commissions),
        )
        .route(
            "/api/v1/commercial/tables/{line}",
            get(sales::negotiation::table),
        )
        .route(
            "/api/v1/commercial/simulate",
            post(sales::negotiation::simulate),
        )
        .route(
            "/api/v1/commercial/orders",
            post(sales::negotiation::convert),
        )
        .route(
            "/api/v1/commercial/orders/{id}",
            get(sales::negotiation::quote),
        )
        .route(
            "/api/v1/commercial/orders/{id}/decision",
            post(sales::negotiation::decision),
        )
        .route(
            "/api/v1/commercial/approval-settings",
            get(sales::negotiation::get_rules).put(sales::negotiation::put_rules),
        )
        .route(
            "/api/v1/proposals",
            get(sales::proposals::list).post(sales::proposals::create),
        )
        .route(
            "/api/v1/proposals/{id}",
            get(sales::proposals::get).put(sales::proposals::update),
        )
        .route(
            "/api/v1/proposals/{id}/revise",
            axum::routing::post(sales::proposals::revise),
        )
        .route(
            "/api/v1/proposals/{id}/convert",
            axum::routing::post(sales::proposals::convert),
        )
        .route(
            "/api/v1/proposals/{id}/{action}",
            axum::routing::post(sales::proposals::decide),
        )
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
            "/api/v1/products/import",
            axum::routing::post(data_transfer::preview),
        )
        .route(
            "/api/v1/products/import/{id}",
            get(data_transfer::get_import),
        )
        .route(
            "/api/v1/products/import/{id}/confirm",
            axum::routing::post(data_transfer::confirm),
        )
        .route("/api/v1/products/export", get(data_transfer::export))
        .route(
            "/api/v1/products/{id}/catalog",
            get(crate::domains::catalog_publication::get)
                .put(crate::domains::catalog_publication::put)
                .layer(axum::extract::DefaultBodyLimit::max(14_100_000)),
        )
        .route(
            "/api/v1/products/{id}/media/{media_id}",
            get(crate::domains::catalog_publication::media),
        )
        .route(
            "/api/v1/catalog-publication",
            get(crate::domains::catalog_publication::preview)
                .post(crate::domains::catalog_publication::publish),
        )
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
        );
    let protected = business.clone().route_layer(middleware::from_fn_with_state(
        state.clone(),
        auth::require_auth,
    ));

    let service = fiscal::service_routes().layer(middleware::from_fn_with_state(
        state.clone(),
        service_auth::require_service_auth,
    ));

    Router::new()
        .route(
            "/api/v1/webhooks/contracts/{tenant}",
            axum::routing::post(crate::domains::contracts::webhook),
        )
        .route("/openapi.json", get(openapi::document))
        .route("/health/live", get(health::live))
        .route("/health/ready", get(health::ready))
        .merge(service)
        .route("/api/health", get(health::api_health))
        .merge(protected)
        .with_state(state.clone())
        .merge(crate::mcp::router(
            state.clone(),
            business.with_state(state),
        ))
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
