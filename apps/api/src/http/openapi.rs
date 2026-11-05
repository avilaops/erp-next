use axum::Json;
use utoipa::{
    Modify, OpenApi,
    openapi::security::{Http, HttpAuthScheme, SecurityScheme},
};

use super::health;
use crate::domains::{
    assistant, catalog, commissions, contracts, finance, fiscal, inventory, legacy, parties,
    payables, production, purchasing, reference_data, returns, sales, staff, staff_payroll,
};
use crate::platform::{access, access_management, company, invitations, onboarding, service_auth};

#[derive(OpenApi)]
#[openapi(
    info(title = "Ávila ERP API", version = "0.1.0", description = "Contrato gerado dos recursos implementados. Sem dados demonstrativos."),
    paths(crate::platform::commercial_settings::get, crate::platform::commercial_settings::put, crate::platform::commercial_settings::preview, payables::list_all,payables::get_all,payables::pay_all,payables::reverse_all,staff_payroll::salaries,staff_payroll::get,staff_payroll::list,staff_payroll::propose,staff_payroll::review,staff_payroll::generate,crate::domains::registration_settings::get,crate::domains::registration_settings::put,purchasing::list,purchasing::get,purchasing::create,purchasing::update,purchasing::confirm,purchasing::cancel,purchasing::close,purchasing::receipts,purchasing::receive,purchasing::get_receipt,payables::list,payables::get,payables::pay,payables::reverse,staff::list, staff::get, staff::create, staff::update, onboarding::list, onboarding::create, health::live, health::ready, health::api_health, access::current_access, access::list_users,
        onboarding::select_company,
        crate::platform::preferences::get, crate::platform::preferences::put, crate::platform::audit::list,
        crate::platform::custom_fields::list, crate::platform::custom_fields::create, crate::platform::custom_fields::update,
        crate::domains::registry_lookup::lookup,
        fiscal::ibpt::quote,
        crate::domains::finance::settings::get, crate::domains::finance::settings::put,
        sales::settings::get, sales::settings::put,
        crate::domains::supply_settings::inventory::get_inventory, crate::domains::supply_settings::inventory::put_inventory,
        crate::domains::supply_settings::purchase::get_purchase, crate::domains::supply_settings::purchase::put_purchase,
        reference_data::list_warehouses, reference_data::get_warehouse, reference_data::create_warehouse, reference_data::update_warehouse,
        reference_data::list_product_groups, reference_data::get_product_group, reference_data::create_product_group, reference_data::update_product_group,
        reference_data::list_tag_groups, reference_data::get_tag_group, reference_data::create_tag_group, reference_data::update_tag_group,
        reference_data::list_tags, reference_data::get_tag, reference_data::create_tag, reference_data::update_tag,
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
        sales::proposals::list, sales::proposals::get, sales::proposals::create,
        sales::proposals::decide,
        sales::proposals::revise, sales::proposals::convert,
        sales::proposals::update,
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
        fiscal::received_nfse::import, fiscal::received_nfse::list,
        fiscal::received_nfse::get_document, fiscal::received_nfse::download_xml,
        fiscal::emission::list, fiscal::emission::get_document, fiscal::emission::download_xml, fiscal::emission::consult,
        fiscal::emission::events::cancel, fiscal::emission::events::correction, fiscal::emission::events::void_numbers,
        fiscal::emission::events::list, fiscal::emission::events::process_order_cancellation,
        fiscal::incoming::status, fiscal::incoming::documents, fiscal::incoming::document, fiscal::incoming::query,
        fiscal::purchase_match::preview, fiscal::purchase_match::link,
        fiscal::cte_distribution::status, fiscal::cte_distribution::documents, fiscal::cte_distribution::document,
        fiscal::cte_distribution::query, fiscal::cte_distribution::run,
        fiscal::cte_inspection::get_inspection, fiscal::cte_inspection::inspect,
        fiscal::cte_links::get_links, fiscal::cte_links::options, fiscal::cte_links::link, fiscal::cte_links::unlink,
        fiscal::incoming::manifestations, fiscal::incoming::manifest, fiscal::incoming::conversion, fiscal::incoming::convert,
        fiscal::incoming::reconciliation::get, fiscal::incoming::reconciliation::reconcile,
        fiscal::monitor::status, fiscal::monitor::sync, fiscal::monitor::download_xml,
        fiscal::manifestation::manifest,
        fiscal::lojas::download_danfe, service_auth::create, service_auth::list,
        service_auth::revoke,
        crate::domains::fixed_expenses::list, crate::domains::fixed_expenses::create, crate::domains::fixed_expenses::update,
        crate::platform::product_costs::get, crate::platform::product_costs::put,
        crate::platform::price_tables::current, crate::platform::price_tables::preview, crate::platform::price_tables::publish),
    components(schemas(assistant::AssistantEvent, fiscal::model::TaxDeclaration, fiscal::model::IbsCbsDeclaration)),
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
                        || path.starts_with("/api/v1/financial-payables")
                        || path.starts_with("/api/v1/staff-payroll")
                        || (path.starts_with("/api/v1/staff/") && path.contains("/payroll"))
                        || path.starts_with("/api/v1/production")
                        || path.starts_with("/api/v1/proposals")
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
    fn reference_catalog_contracts_preserve_existing_response_schemas() {
        let doc = serde_json::to_value(ApiDoc::openapi()).unwrap();
        // Frozen before adding supply catalogs: extending a shared response union
        // would otherwise widen all sixteen existing operations at once.
        let expected: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/reference_catalog_schemas.json")).unwrap();
        for (name, schema) in expected.as_object().unwrap() {
            assert_eq!(&doc["components"]["schemas"][name], schema, "{name}");
        }
        for resource in [
            "product-categories",
            "financial-categories",
            "financial-accounts",
            "payment-methods",
        ] {
            let path = format!("/api/v1/{resource}");
            for (method, suffix, status, schema) in [
                ("get", "", "200", "ReferenceList"),
                ("post", "", "201", "ReferenceSnapshot"),
                ("get", "/{id}", "200", "ReferenceSnapshot"),
                ("put", "/{id}", "200", "ReferenceSnapshot"),
            ] {
                assert_eq!(
                    doc["paths"][format!("{path}{suffix}")][method]["responses"][status]["content"]
                        ["application/json"]["schema"]["$ref"],
                    format!("#/components/schemas/{schema}")
                );
            }
        }
    }

    #[test]
    fn supply_catalog_contracts_use_typed_response_schemas() {
        let doc = serde_json::to_value(ApiDoc::openapi()).unwrap();
        for (resource, input, record) in [
            ("warehouses", "WarehouseInput", "WarehouseReference"),
            ("product-groups", "GroupInput", "GroupReference"),
            ("tag-groups", "GroupInput", "GroupReference"),
            ("tags", "TagInput", "TagReference"),
        ] {
            for (method, suffix, status, list) in [
                ("get", "", "200", true),
                ("post", "", "201", false),
                ("get", "/{id}", "200", false),
                ("put", "/{id}", "200", false),
            ] {
                let path = format!("/api/v1/{resource}{suffix}");
                let schema_ref =
                    doc["paths"][&path][method]["responses"][status]["content"]["application/json"]
                        ["schema"]["$ref"]
                        .as_str()
                        .unwrap();
                let schema = schema_ref.strip_prefix("#/components/schemas/").unwrap();
                let envelope = if list {
                    "SupplyList_"
                } else {
                    "SupplySnapshot_"
                };
                assert_eq!(schema, format!("{envelope}{record}"));
                let data = &doc["components"]["schemas"][schema]["properties"]["data"];
                let record_data = if list { &data["items"] } else { data };
                let input_data = &doc["components"]["schemas"][input];
                assert_eq!(record_data["type"], "object");
                assert!(record_data.get("allOf").is_none(), "{method} {path}");
                // Every input field plus the record identity must belong to one
                // object, so additionalProperties cannot reject id/revision.
                let properties = record_data["properties"].as_object().unwrap();
                let input_properties = input_data["properties"].as_object().unwrap();
                assert_eq!(properties.len(), input_properties.len() + 2);
                for (name, property) in input_properties {
                    assert_eq!(&properties[name], property, "{method} {path}: {name}");
                }
                assert_eq!(
                    properties["id"],
                    serde_json::json!({"type":"string","format":"uuid"})
                );
                assert_eq!(
                    properties["revision"],
                    serde_json::json!({"type":"integer","format":"int64"})
                );
                let required = record_data["required"].as_array().unwrap();
                for field in input_data["required"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .chain([&serde_json::json!("id"), &serde_json::json!("revision")])
                {
                    assert!(required.contains(field), "{method} {path}: {field}");
                }
            }
        }
    }

    #[test]
    fn web_consumers_have_explicit_response_schemas() {
        let doc = serde_json::to_value(ApiDoc::openapi()).unwrap();
        for path in [
            "/api/v1/preferences",
            "/api/v1/financial-settings",
            "/api/v1/legacy-history",
            "/api/v1/commercial-contracts",
            "/api/v1/contract-template-drafts",
            "/api/v1/contract-template-drafts/{id}",
            "/api/v1/contract-template-drafts/catalog",
        ] {
            let schema = &doc["paths"][path]["get"]["responses"]["200"]["content"]["application/json"]
                ["schema"];
            assert!(schema.get("$ref").is_some(), "{path}: {schema}");
        }
        assert!(doc["components"]["schemas"]["AssistantEvent"].is_object());
    }

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
        assert_eq!(doc["paths"].as_object().unwrap().len(), 188);
        assert!(doc["paths"]["/api/v1/system/custom-fields"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/system/custom-fields"]["post"].is_object());
        assert!(doc["paths"]["/api/v1/system/custom-fields/{id}"]["put"].is_object());
        let selection = &doc["paths"]["/api/v1/company-selection"]["post"];
        for status in ["204", "400", "401", "403", "500", "503"] {
            assert!(selection["responses"].get(status).is_some());
        }
        for (path, method) in [
            ("/api/v1/proposals", "get"),
            ("/api/v1/proposals", "post"),
            ("/api/v1/proposals/{id}", "get"),
            ("/api/v1/proposals/{id}", "put"),
            ("/api/v1/proposals/{id}/{action}", "post"),
            ("/api/v1/proposals/{id}/revise", "post"),
            ("/api/v1/proposals/{id}/convert", "post"),
        ] {
            assert!(doc["paths"][path][method].is_object());
        }
        assert!(doc["paths"]["/api/v1/registry-lookups"]["post"]["requestBody"].is_object());
        for status in ["200", "401", "403", "409", "422"] {
            assert!(
                doc["paths"]["/api/v1/registry-lookups"]["post"]["responses"]
                    .get(status)
                    .is_some()
            );
        }
        let nfse_import = &doc["paths"]["/api/v1/fiscal/received-nfses/import"]["post"];
        for status in ["200", "201", "403", "409", "422", "428", "502", "503"] {
            assert!(nfse_import["responses"].get(status).is_some());
        }
        for suffix in ["", "/{id}", "/{id}/xml"] {
            let path = format!("/api/v1/fiscal/received-nfses{suffix}");
            assert!(doc["paths"][&path]["get"].is_object());
        }
        for suffix in [
            "status",
            "documents",
            "documents/{id}",
            "documents/{id}/inspection",
            "documents/{id}/commercial-links",
            "documents/{id}/commercial-options",
            "runs/{id}",
        ] {
            let path = format!("/api/v1/fiscal/cte-distribution/{suffix}");
            assert!(doc["paths"][&path]["get"].is_object());
        }
        let cte_query = &doc["paths"]["/api/v1/fiscal/cte-distribution/query"]["post"];
        assert!(cte_query["requestBody"].is_object());
        for status in ["200", "403", "409", "412", "428"] {
            assert!(cte_query["responses"].get(status).is_some());
        }
        let inspection =
            &doc["paths"]["/api/v1/fiscal/cte-distribution/documents/{id}/inspect"]["post"];
        assert!(inspection["requestBody"].is_object());
        for status in [
            "200", "201", "403", "404", "409", "422", "428", "502", "503",
        ] {
            assert!(inspection["responses"].get(status).is_some());
        }
        for suffix in ["commercial-links", "commercial-links/{linkId}/unlink"] {
            let path = format!("/api/v1/fiscal/cte-distribution/documents/{{id}}/{suffix}");
            for status in ["200", "403", "404", "409", "412", "422", "428"] {
                assert!(
                    doc["paths"][&path]["post"]["responses"]
                        .get(status)
                        .is_some()
                );
            }
        }
        let registration = &doc["paths"]["/api/v1/registration-settings/{section}"];
        assert!(registration["get"].is_object());
        assert!(registration["put"]["requestBody"].is_object());
        for status in ["200", "403", "404", "412", "422", "428"] {
            assert!(registration["put"]["responses"].get(status).is_some());
        }
        for resource in ["inventory-settings", "purchase-settings"] {
            let path = format!("/api/v1/{resource}");
            assert!(doc["paths"][&path]["get"].is_object());
            assert!(doc["paths"][&path]["put"]["requestBody"].is_object());
            for status in ["200", "403", "412", "422", "428"] {
                assert!(
                    doc["paths"][&path]["put"]["responses"]
                        .get(status)
                        .is_some()
                );
            }
        }
        assert!(doc["paths"]["/api/v1/sales-settings"]["get"].is_object());
        assert!(doc["paths"]["/api/v1/sales-settings"]["put"].is_object());
        let required = doc["components"]["schemas"]["SalesSettingsInput"]["required"]
            .as_array()
            .unwrap();
        for field in [
            "minimumOrderAmount",
            "maximumPaymentTermDays",
            "requireCustomerContact",
        ] {
            assert!(required.iter().any(|value| value == field));
        }
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
            "warehouses",
            "product-groups",
            "tag-groups",
            "tags",
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
