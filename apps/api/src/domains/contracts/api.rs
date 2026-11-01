//! Explicit JSON envelopes for the public contracts API.
use super::{model::Contract, templates::Definition};
use std::collections::BTreeMap;
use uuid::Uuid;
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractSummary {
    pub id: Uuid,
    pub order_id: Uuid,
    pub customer_id: Uuid,
    pub customer_name: Option<String>,
    pub template_name: String,
    pub status: String,
    pub problem: Option<String>,
    pub created_at: String,
    pub revision: i64,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractList {
    pub tenant_id: Uuid,
    pub can_edit: bool,
    pub data: Vec<ContractSummary>,
    pub total: i64,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractFile {
    pub id: Uuid,
    pub kind: String,
    pub position: i32,
    pub sha256: String,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractDetail {
    pub tenant_id: Uuid,
    pub can_edit: bool,
    pub can_send: bool,
    pub email_ready: bool,
    pub data: Contract,
    pub files: Vec<ContractFile>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractOrderContext {
    pub id: Uuid,
    pub revision: i64,
    pub status: String,
    pub due_date: String,
    pub amount: String,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractCompanyContext {
    pub legal_name: String,
    pub tax_id: String,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractCustomerContext {
    pub id: Uuid,
    pub name: String,
    pub tax_id: String,
    pub email: Option<String>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractContextItem {
    pub name: String,
    pub sku: String,
    pub unit: String,
    pub quantity: String,
    pub unit_price: String,
    pub amount: String,
    pub structure_color: Option<String>,
    pub upholstery_color: Option<String>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractContext {
    pub order: ContractOrderContext,
    pub company: ContractCompanyContext,
    pub customer: ContractCustomerContext,
    pub items: Vec<ContractContextItem>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractTemplateRole {
    pub name: String,
    pub uuid: String,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractTemplateField {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub required: bool,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractTemplateChoice {
    pub id: i64,
    pub name: String,
    pub updated_at: String,
    pub roles: Vec<ContractTemplateRole>,
    pub fields: Vec<ContractTemplateField>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractOptions {
    pub tenant_id: Uuid,
    pub can_edit: bool,
    pub configured: bool,
    pub email_ready: bool,
    pub defaults: BTreeMap<String, String>,
    pub snapshot: ContractContext,
    pub templates: Vec<ContractTemplateChoice>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDraftSummary {
    pub id: Uuid,
    pub name: String,
    pub revision: i64,
    pub updated_at: String,
    pub published_revision: Option<i64>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDraftList {
    pub tenant_id: Uuid,
    pub can_edit: bool,
    pub data: Vec<TemplateDraftSummary>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVersionSummary {
    pub revision: i64,
    pub external_id: Option<i64>,
    pub status: String,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDraftDetail {
    pub tenant_id: Uuid,
    pub can_edit: bool,
    pub id: Uuid,
    pub definition: Definition,
    pub revision: i64,
    pub versions: Option<Vec<TemplateVersionSummary>>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateCatalogItem {
    pub id: i64,
    pub name: String,
    pub updated_at: Option<String>,
    pub can_import: bool,
    pub draft_id: Option<Uuid>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateCatalog {
    pub tenant_id: Uuid,
    pub can_edit: bool,
    pub configured: bool,
    pub data: Vec<TemplateCatalogItem>,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateImportResult {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub revision: i64,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePublishResult {
    pub id: Uuid,
    pub external_id: i64,
    pub revision: i64,
    pub status: String,
}
#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SigningProgress {
    pub id: i64,
    pub role: String,
    pub email: String,
    pub send_confirmed: bool,
    pub opened_at: Option<String>,
    pub completed_at: Option<String>,
    pub declined_at: Option<String>,
}

pub fn checked<T: serde::de::DeserializeOwned>(
    value: serde_json::Value,
) -> Result<serde_json::Value, crate::domains::DomainError> {
    serde_json::from_value::<T>(value.clone())
        .map_err(|_| crate::platform::access::AccessError::Internal)?;
    Ok(value)
}
