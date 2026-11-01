use axum::Json;
use utoipa::{
    Modify, OpenApi,
    openapi::security::{Http, HttpAuthScheme, SecurityScheme},
};

use super::health;
use crate::domains::{
    assistant, catalog, commissions, contracts, finance, fiscal, inventory, legacy, parties,
    payables, production, purchasing, reference_data, returns, sales, staff,
};
use crate::platform::{access, access_management, company, invitations, onboarding, service_auth};

#[derive(OpenApi)]
#[openapi(
    info(title = "Ávila ERP API", version = "0.1.0", description = "Contrato gerado dos recursos implementados. Sem dados demonstrativos."),
    paths(purchasing::list,purchasing::get,purchasing::create,purchasing::update,purchasing::confirm,purchasing::cancel,purchasing::close,purchasing::receipts,purchasing::receive,purchasing::get_receipt,payables::list,payables::get,payables::pay,payables::reverse,staff::list, staff::get, staff::create, staff::update, onboarding::list, onboarding::create, health::live, health::ready, health::api_health, access::current_access, access::list_users,
        crate::platform::preferences::get, crate::platform::preferences::put, crate::platform::audit::list,
        crate::platform::financial_settings::get, crate::platform::financial_settings::put,
        crate::platform::subscriptions::account, crate::platform::subscriptions::checkout,
        crate::platform::subscriptions::refresh, crate::platform::subscriptions::change_plan,
        crate::platform::subscriptions::cancel, crate::platform::subscriptions::invoices,
        assistant::chat, invitations::list, invitations::create, invitations::resend, invitations::revoke,
        contracts::list, contracts::options, contracts::detail, contracts::generate,
        contracts::templates::list, contracts::templates::detail, contracts::templates::save, contracts::templates::pdf,
        contracts::templates::import::catalog, contracts::templates::import::import_template,
        contracts::templates::publish::publish,
        contracts::review, contracts::send, contracts::refresh, contracts::file, contracts::webhook,
        legacy::list, legacy::file, access::list_roles, access::list_permissions, company::get_company, company::put_company,
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
        commissions::get_order, commissions::configure_order, commissions::list,
        commissions::get_seller, commissions::adjust, commissions::pay,
        production::list_orders, production::get_order, production::create_orders,
        production::move_order, production::consume, production::reverse_consumption,
        production::list_stages, production::create_stage, production::update_stage,
        returns::cancel_completed, returns::reverse_receipt, returns::sale_history, returns::purchase_history,
        inventory::balances, inventory::history, inventory::post_movement,
        fiscal::get_profile, fiscal::put_profile, fiscal::readiness, fiscal::danfe::generate,
        fiscal::certificates::get, fiscal::certificates::put, fiscal::certificates::remove,
        fiscal::list, fiscal::get_draft, fiscal::create, fiscal::update, fiscal::emission::issue, fiscal::order_source::get,
        fiscal::received::import, fiscal::received::list, fiscal::received::get_document, fiscal::received::download_xml,
        fiscal::received::download_danfe, fiscal::lojas::list, fiscal::lojas::download_xml,
        fiscal::emission::list, fiscal::emission::get_document, fiscal::emission::download_xml, fiscal::emission::consult,
        fiscal::emission::events::cancel, fiscal::emission::events::correction, fiscal::emission::events::void_numbers,
        fiscal::emission::events::list, fiscal::emission::events::process_order_cancellation,
        fiscal::incoming::status, fiscal::incoming::documents, fiscal::incoming::document, fiscal::incoming::query,
        fiscal::incoming::manifestations, fiscal::incoming::manifest, fiscal::incoming::conversion, fiscal::incoming::convert,
        fiscal::incoming::reconciliation::get, fiscal::incoming::reconciliation::reconcile,
        fiscal::monitor::status, fiscal::monitor::sync, fiscal::monitor::download_xml,
        fiscal::manifestation::manifest,
        fiscal::lojas::download_danfe, service_auth::create, service_auth::list,
        service_auth::revoke),
    components(schemas(fiscal::model::TaxDeclaration, fiscal::model::IbsCbsDeclaration)),
    modifiers(&Security),
    tags((name = "Assistant"), (name = "Health"), (name = "Platform"), (name = "Catalog"), (name = "Inventory"), (name = "Fiscal"), (name = "Sales"), (name = "Finance"))
)]
struct ApiDoc;

#[cfg(test)]
include!("openapi_export.rs");

struct Security;
impl Modify for Security {
    fn modify(&self, doc: &mut utoipa::openapi::OpenApi) {
        for (path, item) in &mut doc.paths.paths {
            for (method, operation) in [
                ("get", &mut item.get),
                ("put", &mut item.put),
                ("post", &mut item.post),
                ("delete", &mut item.delete),
                ("options", &mut item.options),
                ("head", &mut item.head),
                ("patch", &mut item.patch),
                ("trace", &mut item.trace),
            ] {
                if let Some(operation) = operation {
                    if matches!(
                        operation.operation_id.as_deref(),
                        Some("list" | "create" | "get" | "update")
                    ) || (path.starts_with("/api/v1/purchase-orders")
                        || path.starts_with("/api/v1/payables")
                        || path.starts_with("/api/v1/commissions")
                        || path.starts_with("/api/v1/production")
                        || path.ends_with("/commission")
                        || path.starts_with("/api/v1/invitations"))
                    {
                        operation.operation_id = Some(format!("{method}:{path}"));
                    }
                    for (status, response) in &mut operation.responses.responses {
                        if let utoipa::openapi::RefOr::T(response) = response
                            && response.description.is_empty()
                        {
                            response.description = format!("Resposta HTTP {status}");
                        }
                    }
                }
            }
        }
        if let Some(components) = doc.components.as_mut() {
            components.add_security_scheme(
                "bearerAuth",
                SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
            );
            components.add_security_scheme(
                "serviceKey",
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
    fn fiscal_profile_accepts_missing_alias_but_always_returns_it() {
        use crate::domains::fiscal::model::ProfileInput;

        let profile: ProfileInput = serde_json::from_value(serde_json::json!({
            "environment": "homologation", "state": "SP",
            "municipalityCode": "3550308", "stateRegistration": "718319130117",
            "crt": 1, "series": 1
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&profile).unwrap()["certificateReference"],
            ""
        );

        let doc = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let schemas = &doc["components"]["schemas"];
        let alias = serde_json::json!("certificateReference");
        assert!(
            !schemas["ProfileRequest"]["required"]
                .as_array()
                .unwrap()
                .contains(&alias)
        );
        assert!(
            schemas["ProfileInput"]["required"]
                .as_array()
                .unwrap()
                .contains(&alias)
        );
        assert_eq!(
            schemas["ProfileInput"]["properties"],
            schemas["ProfileRequest"]["properties"]
        );
        assert_eq!(
            schemas["IssuerSnapshot"]["properties"]["profile"]["$ref"],
            "#/components/schemas/ProfileInput"
        );
        let data = schemas["ProfileSnapshot"]["properties"]["data"].to_string();
        assert!(data.contains("#/components/schemas/ProfileInput"));
        assert!(!data.contains("#/components/schemas/ProfileRequest"));
        assert_eq!(
            doc["paths"]["/api/v1/fiscal/config"]["put"]["requestBody"]["content"]["application/json"]
                ["schema"]["$ref"],
            "#/components/schemas/ProfileRequest"
        );
    }

    #[test]
    fn operation_ids_are_unique_and_path_parameters_match_templates() {
        let doc = serde_json::to_value(ApiDoc::openapi()).unwrap();
        let mut ids = std::collections::BTreeSet::new();
        for (path, item) in doc["paths"].as_object().unwrap() {
            for (method, operation) in item.as_object().unwrap() {
                if ![
                    "get", "put", "post", "delete", "options", "head", "patch", "trace",
                ]
                .contains(&method.as_str())
                {
                    continue;
                }
                let id = operation["operationId"].as_str().unwrap();
                assert!(ids.insert(id), "duplicate operation ID: {id}");
                for response in operation["responses"].as_object().unwrap().values() {
                    if response.get("$ref").is_none() {
                        assert!(!response["description"].as_str().unwrap().is_empty());
                    }
                }
                if let Some(parameters) = operation["parameters"].as_array() {
                    for parameter in parameters {
                        if parameter["in"] == "path" {
                            let name = parameter["name"].as_str().unwrap();
                            assert!(
                                path.contains(&format!("{{{name}}}")),
                                "{method} {path}: {name}"
                            );
                            assert_eq!(parameter["required"], true);
                        }
                    }
                }
            }
        }
        let filters = doc["paths"]["/api/v1/products"]["get"]["parameters"]
            .as_array()
            .unwrap();
        for name in ["q", "status", "offset", "limit"] {
            let parameter = filters.iter().find(|value| value["name"] == name).unwrap();
            assert_eq!(parameter["in"], "query");
            assert_eq!(parameter["required"], false);
        }
    }

    #[test]
    fn contract_contains_only_implemented_resources_and_company_preconditions() {
        let doc = serde_json::to_value(ApiDoc::openapi()).unwrap();
        assert_eq!(doc["paths"].as_object().unwrap().len(), 131);
        assert!(doc["paths"]["/api/v1/company-account"]["get"].is_object());
        for action in ["checkout", "refresh", "change-plan", "cancel"] {
            assert!(
                doc["paths"][format!("/api/v1/company-account/{action}")]["post"]["requestBody"]
                    .is_object()
            );
        }
        assert!(doc["paths"]["/api/v1/company-account/invoices"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/commissions"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/production/orders"]["post"].is_object());
        assert!(doc["paths"]["/api/v1/fiscal/monitor"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/fiscal/monitor/sync"]["post"].is_object());
        assert!(
            doc["paths"]["/api/v1/fiscal/monitor/documents/{id}/manifest"]["post"]["requestBody"]
                .is_object()
        );
        assert!(doc["paths"]["/api/v1/contract-template-drafts"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/contract-template-drafts/{id}"]["post"].is_object());
        assert!(doc["paths"]["/api/v1/contract-template-drafts/{id}/pdf"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/audit"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/preferences"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/preferences"]["put"]["requestBody"].is_object());
        assert!(doc["paths"]["/api/v1/preferences"]["put"]["responses"]["412"].is_object());
        assert!(doc["paths"]["/api/v1/invitations"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/invitations"]["post"]["requestBody"].is_object());
        for action in ["resend", "revoke"] {
            assert!(
                doc["paths"][format!("/api/v1/invitations/{{id}}/{action}")]["post"].is_object()
            );
        }
        assert!(doc["paths"]["/api/v1/legacy-history"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/legacy-history/files/{id}"]["get"].is_object());
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
        assert!(issue["responses"].get("200").is_some());
        assert!(issue["responses"].get("202").is_some());
        for path in [
            "/api/v1/orders/{id}/cancel-completed",
            "/api/v1/purchase-receipts/{id}/reverse",
            "/api/v1/fiscal/nfe/{id}/consult",
            "/api/v1/fiscal/nfe/{id}/cancel",
            "/api/v1/fiscal/nfe/{id}/correction",
            "/api/v1/fiscal/number-voids",
            "/api/v1/fiscal/distribution/query",
            "/api/v1/fiscal/manifestations",
            "/api/v1/fiscal/manifestations/{id}/reconcile",
            "/api/v1/fiscal/received-nfes/{id}/purchase",
        ] {
            assert!(doc["paths"][path]["post"].is_object(), "missing {path}");
        }
        assert!(
            doc["components"]["securitySchemes"]
                .get("bearerAuth")
                .is_some()
        );
        for path in [
            "/api/v1/assistant",
            "/api/v1/integrations/service-keys",
            "/api/v1/integrations/service-keys/{id}",
            "/api/v1/fiscal/received-nfes/import",
            "/api/v1/fiscal/received-nfes",
            "/api/v1/fiscal/received-nfes/{id}",
            "/api/v1/fiscal/received-nfes/{id}/xml",
            "/api/v1/fiscal/received-nfes/{id}/danfe",
            "/api/v1/notas-recebidas",
            "/api/v1/notas-recebidas/{id}/xml",
            "/api/v1/notas-recebidas/{id}/danfe",
        ] {
            assert!(doc["paths"].get(path).is_some(), "missing {path}");
        }
    }
}
