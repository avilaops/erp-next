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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_line: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_rules: Option<LineTaxRules>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defaults: Option<TaxProfileDefaults>,
}

#[derive(Clone, Default, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaxProfileDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icms_cst: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pis_cst: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cofins_cst: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ipi_cst: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ipi_frame_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ibs_state_rate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ibs_city_rate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cbs_rate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_consumer: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ipi_in_icms_base: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icms_out_of_contributions: Option<bool>,
}

#[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LineTaxRules {
    pub icms_rate: String,
    pub ipi_rate: String,
    pub cfop_same_state: String,
    pub cfop_interstate_taxpayer: String,
    pub cfop_interstate_non_taxpayer: String,
    pub icms_cst: String,
    pub ipi_cst: String,
    pub ipi_frame_code: String,
    pub pis_cst: String,
    pub cofins_cst: String,
    pub ibs_state_rate: String,
    pub ibs_city_rate: String,
    pub cbs_rate: String,
    pub final_consumer: bool,
    pub ipi_in_icms_base: bool,
    pub icms_out_of_contributions: bool,
    pub additional_information: String,
}

impl LineTaxRules {
    fn validate(&mut self) -> Result<(), DomainError> {
        for (cfop, prefix) in [
            (&self.cfop_same_state, b'5'),
            (&self.cfop_interstate_taxpayer, b'6'),
            (&self.cfop_interstate_non_taxpayer, b'6'),
        ] {
            if cfop.len() != 4
                || !cfop.bytes().all(|c| c.is_ascii_digit())
                || cfop.as_bytes()[0] != prefix
            {
                return Err(DomainError::Invalid(
                    "CFOP interno deve começar por 5; interestadual por 6, com quatro dígitos",
                ));
            }
        }
        for code in [
            &self.icms_cst,
            &self.ipi_cst,
            &self.pis_cst,
            &self.cofins_cst,
        ] {
            if code.len() != 2 || !code.bytes().all(|c| c.is_ascii_digit()) {
                return Err(DomainError::Invalid(
                    "CST deve conservar dois dígitos, inclusive zeros à esquerda",
                ));
            }
        }
        if self.ipi_frame_code.len() != 3
            || !self.ipi_frame_code.bytes().all(|c| c.is_ascii_digit())
            || self.additional_information.chars().count() > 5000
            || self
                .additional_information
                .chars()
                .any(|c| c.is_control() && c != '\n')
        {
            return Err(DomainError::Invalid(
                "Enquadramento IPI ou informações complementares inválidos",
            ));
        }
        for rate in [
            &mut self.icms_rate,
            &mut self.ipi_rate,
            &mut self.ibs_state_rate,
            &mut self.ibs_city_rate,
            &mut self.cbs_rate,
        ] {
            let value = crate::domains::fixed(rate, 4)?;
            if value >= 1_000_000 {
                return Err(DomainError::Invalid("Alíquota deve ser menor que 100"));
            }
            *rate = crate::domains::decimal(value, 4);
        }
        Ok(())
    }
}
fn normalize_profile_rate(rate: &str) -> Result<String, DomainError> {
    let (whole, fraction) = match rate.split_once('.') {
        Some((_, "")) => return Err(DomainError::Invalid("Alíquota decimal inválida")),
        Some(parts) => parts,
        None => (rate, ""),
    };
    let value = crate::domains::fixed(&format!("{whole}.{fraction:0<4}"), 4)?;
    if value >= 1_000_000 {
        return Err(DomainError::Invalid("Alíquota deve ser menor que 100"));
    }
    Ok(crate::domains::decimal(value, 4))
}

impl TaxProfile {
    pub fn validate(&mut self) -> Result<(), DomainError> {
        if self
            .product_line
            .as_deref()
            .is_some_and(|line| !matches!(line, "imported" | "national"))
            || self.product_line.is_some() != self.line_rules.is_some()
        {
            return Err(DomainError::Invalid(
                "Regras da nota exigem uma linha comercial válida",
            ));
        }
        if let Some(rules) = self.line_rules.as_mut() {
            rules.validate()?;
        }
        if let Some(defaults) = &mut self.defaults {
            for rate in [
                &mut defaults.ibs_state_rate,
                &mut defaults.ibs_city_rate,
                &mut defaults.cbs_rate,
            ]
            .into_iter()
            .flatten()
            {
                *rate = normalize_profile_rate(rate)?;
            }
            if defaults
                .ipi_frame_code
                .as_deref()
                .is_some_and(|v| v.len() != 3 || !v.bytes().all(|c| c.is_ascii_digit()))
            {
                return Err(DomainError::Invalid(
                    "Enquadramento do IPI exige três dígitos",
                ));
            }
        }
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
        self.pis_rate = normalize_profile_rate(&self.pis_rate)?;
        self.cofins_rate = normalize_profile_rate(&self.cofins_rate)?;
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
