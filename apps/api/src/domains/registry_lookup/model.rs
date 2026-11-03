use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{domains::DomainError, platform::valid_document};

pub const STATES: &[&str] = &[
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
    "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];
pub const IE_STATES: &[&str] = &["BA", "GO", "MG", "PB", "PR", "PE", "RS", "SC", "SP", "SE"];

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum LookupKind {
    Cep,
    Cnpj,
    Ie,
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LookupContext {
    Company,
    Party,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LookupInput {
    pub kind: LookupKind,
    pub context: LookupContext,
    pub value: String,
    pub state: Option<String>,
}

impl LookupInput {
    pub fn normalize(&mut self) -> Result<(), DomainError> {
        let raw = self.value.trim();
        if raw.len() > 32 || raw.is_empty() {
            return Err(DomainError::Invalid("Informe o documento ou CEP"));
        }
        self.value = match self.kind {
            LookupKind::Cep => {
                let plain = raw.replace('-', "");
                if !plain.bytes().all(|c| c.is_ascii_digit())
                    || plain.len() != 8
                    || !(raw.len() == 8 || (raw.len() == 9 && raw.as_bytes()[5] == b'-'))
                {
                    return Err(DomainError::Invalid("Informe um CEP com oito dígitos"));
                }
                plain
            }
            _ => {
                if !raw
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "./- ".contains(c))
                {
                    return Err(DomainError::Invalid("CNPJ contém caracteres inválidos"));
                }
                let plain: String = raw
                    .chars()
                    .filter(char::is_ascii_alphanumeric)
                    .map(|c| c.to_ascii_uppercase())
                    .collect();
                if !valid_document(&plain, "juridica") {
                    return Err(DomainError::Invalid(
                        "Informe CNPJ com dígitos verificadores válidos. CPF não possui consulta neste serviço",
                    ));
                }
                plain
            }
        };
        self.state = self.state.as_ref().map(|s| s.trim().to_ascii_uppercase());
        if self
            .state
            .as_ref()
            .is_some_and(|s| !STATES.contains(&s.as_str()))
            || (self.kind == LookupKind::Ie && self.state.is_none())
        {
            return Err(DomainError::Invalid(
                "Selecione a UF para consultar a inscrição estadual",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LookupStatus {
    Found,
    NotFound,
    Unavailable,
    Unsupported,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegistryData {
    /// Only fields needed by the existing company/party forms; never raw QSA.
    pub fields: BTreeMap<String, String>,
    pub state_registrations: Vec<RegistryStateRegistration>,
    pub generic_postal_code: bool,
    /// A registry lookup never determines the operation's ICMS taxpayer indicator.
    pub taxpayer_status: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegistryStateRegistration {
    pub state: String,
    pub number: String,
    pub active: Option<bool>,
    pub source_updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LookupAttempt {
    pub source: String,
    pub outcome: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LookupReply {
    pub tenant_id: Uuid,
    pub kind: LookupKind,
    pub value: String,
    pub status: LookupStatus,
    pub data: Option<RegistryData>,
    pub source: Option<String>,
    pub source_updated_at: Option<String>,
    pub fetched_at: String,
    pub expires_at: Option<String>,
    pub cached: bool,
    pub attempts: Vec<LookupAttempt>,
    pub warnings: Vec<String>,
}
