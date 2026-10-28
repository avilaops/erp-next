use axum::Json;
use utoipa::{
    Modify, OpenApi,
    openapi::security::{Http, HttpAuthScheme, SecurityScheme},
};

use super::health;
use crate::domains::{catalog, finance, fiscal, inventory, parties, reference_data, sales};
use crate::platform::{access, access_management, company};

#[derive(OpenApi)]
#[openapi(
    info(title = "Ávila ERP API", version = "0.1.0", description = "Contrato gerado dos recursos implementados. Sem dados demonstrativos."),
    paths(health::live, health::ready, access::current_access, access::list_users,
        access::list_roles, access::list_permissions, company::get_company, company::put_company,
        access_management::get_role, access_management::create_role, access_management::update_role,
        access_management::delete_role, access_management::get_member, access_management::update_member,
        catalog::list, catalog::get, catalog::create, catalog::update,
        parties::list, parties::get, parties::create, parties::update,
        reference_data::list_product_categories, reference_data::get_product_category,
        reference_data::create_product_category, reference_data::update_product_category,
        reference_data::list_financial_categories, reference_data::get_financial_category,
        reference_data::create_financial_category, reference_data::update_financial_category,
        reference_data::list_financial_accounts, reference_data::get_financial_account,
        reference_data::create_financial_account, reference_data::update_financial_account,
        reference_data::list_payment_methods, reference_data::get_payment_method,
        reference_data::create_payment_method, reference_data::update_payment_method,
        sales::list, sales::get, sales::create, sales::update, sales::confirm, sales::cancel, sales::complete,
        finance::list, finance::get, finance::pay, finance::reverse,
        inventory::balances, inventory::history, inventory::post_movement,
        fiscal::get_profile, fiscal::put_profile, fiscal::readiness, fiscal::danfe::generate,
        fiscal::list, fiscal::get_draft, fiscal::create, fiscal::update, fiscal::issue),
    modifiers(&Security),
    tags((name = "Health"), (name = "Platform"), (name = "Catalog"), (name = "Inventory"), (name = "Fiscal"), (name = "Sales"), (name = "Finance"))
)]
struct ApiDoc;

struct Security;
impl Modify for Security {
    fn modify(&self, doc: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = doc.components.as_mut() {
            components.add_security_scheme(
                "bearerAuth",
                SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
            );
        }
    }
}

pub async fn document() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_contains_only_implemented_resources_and_company_preconditions() {
        let doc = serde_json::to_value(ApiDoc::openapi()).unwrap();
        assert_eq!(doc["paths"].as_object().unwrap().len(), 38);
        for resource in [
            "product-categories",
            "financial-categories",
            "financial-accounts",
            "payment-methods",
        ] {
            assert!(doc["paths"][format!("/api/v1/{resource}")]["post"]["requestBody"].is_object());
            for status in ["200", "403", "404", "409", "412", "422", "428"] {
                assert!(
                    doc["paths"][format!("/api/v1/{resource}/{{id}}")]["put"]["responses"]
                        .get(status)
                        .is_some()
                );
            }
        }
        let update = &doc["paths"]["/api/v1/company"]["put"];
        for status in ["200", "401", "403", "412", "422", "428"] {
            assert!(update["responses"].get(status).is_some());
        }
        assert!(doc["components"]["schemas"].get("CompanyData").is_some());
        let edit_order = &doc["paths"]["/api/v1/orders/{id}"]["put"];
        for status in ["200", "403", "404", "409", "412", "422", "428"] {
            assert!(edit_order["responses"].get(status).is_some());
        }
        let issue = &doc["paths"]["/api/v1/fiscal/nfe/{id}/issue"]["post"];
        assert!(issue["responses"].get("503").is_some());
        assert!(issue["responses"].get("200").is_none());
        assert!(
            doc["components"]["securitySchemes"]
                .get("bearerAuth")
                .is_some()
        );
        for path in [
            "/api/v1/integrations/service-keys",
            "/api/v1/integrations/service-keys/{id}",
            "/api/v1/fiscal/received-nfes/import",
            "/api/v1/notas-recebidas",
            "/api/v1/notas-recebidas/{id}/xml",
            "/api/v1/notas-recebidas/{id}/danfe",
        ] {
            assert!(doc["paths"].get(path).is_some(), "missing {path}");
        }
    }
}
