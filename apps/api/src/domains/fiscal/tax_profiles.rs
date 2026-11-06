//! Accountant-declared reusable defaults. No inference of CFOP, origin or tax incidence.
use crate::domains::DomainError;
use serde::{Deserialize, Serialize};

fn normalize_rate(value: &mut String) -> Result<(), DomainError> {
    let (whole, fraction) = value.split_once('.').unwrap_or((value.as_str(), ""));
    if fraction.len() > 4 {
        return Err(DomainError::Invalid(
            "Alíquota aceita até quatro casas decimais",
        ));
    }
    let normalized = format!("{whole}.{fraction:0<4}");
    if super::model::exact_decimal(&normalized, 2, 4)? >= 1_000_000 {
        return Err(DomainError::Invalid("Alíquota deve ser menor que 100"));
    }
    *value = normalized;
    Ok(())
}
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
    pub defaults: Option<TaxProfileDefaults>,
}

/// Optional operator-declared defaults. Absence never selects a fiscal treatment.
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

impl TaxProfileDefaults {
    fn validate(&mut self) -> Result<(), DomainError> {
        let code = |value: &Option<String>, allowed: &[&str]| {
            if value
                .as_deref()
                .is_some_and(|value| !allowed.contains(&value))
            {
                Err(DomainError::Invalid(
                    "CST do padrão tributário fora do recorte suportado",
                ))
            } else {
                Ok(())
            }
        };
        code(&self.icms_cst, &["00", "40", "41", "50"])?;
        code(
            &self.pis_cst,
            &["01", "02", "04", "05", "06", "07", "08", "09"],
        )?;
        code(
            &self.cofins_cst,
            &["01", "02", "04", "05", "06", "07", "08", "09"],
        )?;
        code(
            &self.ipi_cst,
            &[
                "00", "49", "50", "99", "01", "02", "03", "04", "05", "51", "52", "53", "54", "55",
            ],
        )?;
        if self.ipi_frame_code.as_deref().is_some_and(|value| {
            value.len() != 3 || !value.bytes().all(|byte| byte.is_ascii_digit())
        }) {
            return Err(DomainError::Invalid(
                "Enquadramento do IPI exige três dígitos",
            ));
        }
        for rate in [
            &mut self.ibs_state_rate,
            &mut self.ibs_city_rate,
            &mut self.cbs_rate,
        ]
        .into_iter()
        .flatten()
        {
            normalize_rate(rate)?;
        }
        Ok(())
    }
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
        for rate in [&mut self.pis_rate, &mut self.cofins_rate] {
            normalize_rate(rate)?;
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
        if let Some(defaults) = &mut self.defaults {
            defaults.validate()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn profile() -> serde_json::Value {
        json!({"name":"Nacional","operationNature":"Venda de mercadoria adquirida no mercado interno","pisRate":"1.65","cofinsRate":"7.6","ibsCbsCst":"000","classCode":"000001","active":true})
    }

    #[test]
    fn optional_defaults_preserve_codes_zero_false_and_legacy_absence() {
        let mut legacy: TaxProfile = serde_json::from_value(profile()).unwrap();
        legacy.validate().unwrap();
        assert!(legacy.defaults.is_none());
        assert!(
            serde_json::to_value(&legacy)
                .unwrap()
                .get("defaults")
                .is_none()
        );
        assert_eq!(legacy.pis_rate, "1.6500");
        let mut input = profile();
        input["defaults"] = json!({"icmsCst":"00","pisCst":"01","cofinsCst":"01","ipiCst":"53","ipiFrameCode":"999","ibsStateRate":"0.1","ibsCityRate":"0","cbsRate":"0.9","finalConsumer":false,"ipiInIcmsBase":false,"icmsOutOfContributions":true});
        let mut value: TaxProfile = serde_json::from_value(input).unwrap();
        value.validate().unwrap();
        let defaults = serde_json::to_value(value).unwrap()["defaults"].clone();
        assert_eq!(defaults["icmsCst"], "00");
        assert_eq!(defaults["ibsStateRate"], "0.1000");
        assert_eq!(defaults["ibsCityRate"], "0.0000");
        assert_eq!(defaults["finalConsumer"], false);
        assert_eq!(defaults["ipiInIcmsBase"], false);
    }

    #[test]
    fn defaults_refuse_unknown_fields_unsupported_codes_and_inexact_rates() {
        for defaults in [
            json!({"icmsCst":"99"}),
            json!({"pisCst":"03"}),
            json!({"ipiFrameCode":"99"}),
            json!({"ibsStateRate":"0.12345"}),
            json!({"cbsRate":"100"}),
            json!({"ibsCityRate":"-1"}),
            json!({"cbsRate":"1e-2"}),
        ] {
            let mut input = profile();
            input["defaults"] = defaults;
            let mut value: TaxProfile = serde_json::from_value(input).unwrap();
            assert!(value.validate().is_err());
        }
        for defaults in [
            json!({"icmsRate":"18.0000"}),
            json!({"finalConsumer":"false"}),
        ] {
            let mut input = profile();
            input["defaults"] = defaults;
            assert!(serde_json::from_value::<TaxProfile>(input).is_err());
        }
    }
}
