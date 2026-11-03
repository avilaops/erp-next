use crate::domains::DomainError;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CteLinkKind {
    Purchase,
    Sale,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CteLinkInput {
    pub kind: CteLinkKind,
    pub order_id: Uuid,
    pub carrier_party_id: Option<Uuid>,
    pub freight_cents: String,
    pub reason: String,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CteUnlinkInput {
    pub reason: String,
}
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct CteLinkOptionsQuery {
    pub kind: CteLinkKind,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

pub(super) fn freight(value: &str) -> Result<i64, DomainError> {
    if value.is_empty()
        || value.len() > 15
        || !value.bytes().all(|b| b.is_ascii_digit())
        || value.len() > 1 && value.starts_with('0')
    {
        return Err(DomainError::Invalid(
            "Frete deve ser informado em centavos exatos, sem sinal ou zeros à esquerda",
        ));
    }
    value
        .parse()
        .map_err(|_| DomainError::Invalid("Frete fora do limite"))
}
pub(super) fn reason(value: &str) -> Result<String, DomainError> {
    let value = value.trim();
    if !(3..=500).contains(&value.chars().count()) || value.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Descreva a conferência em 3 a 500 caracteres, sem caracteres de controle",
        ));
    }
    Ok(value.to_owned())
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CteCarrierChoice {
    pub party_id: Option<Uuid>,
    pub tax_id: String,
    pub name: String,
    pub own_company: bool,
    pub available: bool,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CteCommercialLink {
    pub id: Uuid,
    pub kind: CteLinkKind,
    pub order_id: Option<Uuid>,
    pub carrier_party_id: Option<Uuid>,
    pub carrier_tax_id: String,
    pub carrier_name: String,
    pub counterparty_name: Option<String>,
    pub order_amount_cents: Option<String>,
    pub order_revision: Option<i64>,
    pub freight_cents: String,
    pub reason: Option<String>,
    pub created_at: String,
    pub can_unlink: bool,
    pub restricted: bool,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CteCommercialLinks {
    pub tenant_id: Uuid,
    pub document_id: Uuid,
    pub inspection_id: Uuid,
    pub source_xml_sha256: String,
    pub revision: i64,
    pub service_cents: String,
    pub allocated_cents: String,
    pub can_link_purchase: bool,
    pub can_link_sale: bool,
    pub carrier: CteCarrierChoice,
    pub data: Vec<CteCommercialLink>,
}
#[derive(Serialize, ToSchema, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CteCommercialOrder {
    pub id: Uuid,
    pub counterparty_name: String,
    pub counterparty_tax_id: String,
    pub due_date: String,
    pub amount_cents: String,
    pub status: String,
    pub revision: i64,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CteCommercialOptions {
    pub tenant_id: Uuid,
    pub document_id: Uuid,
    pub source_xml_sha256: String,
    pub kind: CteLinkKind,
    pub data: Vec<CteCommercialOrder>,
    pub total: i64,
    pub offset: u32,
    pub limit: u32,
}
