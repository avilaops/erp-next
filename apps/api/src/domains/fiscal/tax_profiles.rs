//! Accountant-declared reusable defaults. No inference of CFOP, origin or tax incidence.
use crate::domains::DomainError;
use serde::{Deserialize, Serialize};
#[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaxProfile {
    pub name: String,
    pub operation_nature: String,
    pub pis_rate: String,
    pub cofins_rate: String,
    pub ibs_cbs_cst: String,
    pub class_code: String,
    pub active: bool,
}
impl TaxProfile {
    pub fn validate(&mut self) -> Result<(), DomainError> {
        self.name = self.name.trim().to_string();
        self.operation_nature = self.operation_nature.trim().to_string();
        if self.name.is_empty()
            || self.name.chars().count() > 80
            || self.operation_nature.is_empty()
            || self.operation_nature.chars().count() > 60
            || self
                .name
                .chars()
                .chain(self.operation_nature.chars())
                .any(char::is_control)
        {
            return Err(DomainError::Invalid("Nome ou natureza do perfil inválidos"));
        }
        self.pis_rate = crate::domains::decimal(crate::domains::fixed(&self.pis_rate, 4)?, 4);
        self.cofins_rate = crate::domains::decimal(crate::domains::fixed(&self.cofins_rate, 4)?, 4);
        for rate in [&self.pis_rate, &self.cofins_rate] {
            if super::model::exact_decimal(rate, 2, 4)? >= 1_000_000 {
                return Err(DomainError::Invalid("Alíquota deve ser menor que 100"));
            }
        }
        if self.ibs_cbs_cst.len() != 3
            || !self.ibs_cbs_cst.bytes().all(|c| c.is_ascii_digit())
            || self.class_code.len() != 6
            || !self.class_code.bytes().all(|c| c.is_ascii_digit())
            || !self.class_code.starts_with(&self.ibs_cbs_cst)
        {
            return Err(DomainError::Invalid(
                "CST IBS/CBS ou cClassTrib inválidos ou incompatíveis",
            ));
        }
        Ok(())
    }
}
