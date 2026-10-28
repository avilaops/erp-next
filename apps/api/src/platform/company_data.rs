use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

const STATES: &[&str] = &[
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
    "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

#[derive(Clone, Default, Deserialize, Serialize, ToSchema)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct CompanyData {
    pub legal_name: String,
    pub trade_name: String,
    pub person_type: String,
    pub tax_id: String,
    pub state_registration: String,
    pub municipal_registration: String,
    pub suframa: String,
    pub cnae: String,
    pub main_activity: String,
    pub tax_regime: String,
    pub company_size: String,
    pub activity_description: String,
    pub segments: Vec<String>,
    pub postal_code: String,
    pub state: String,
    pub city: String,
    pub street: String,
    pub number: String,
    pub district: String,
    pub complement: String,
    pub contact_name: String,
    pub phone: String,
    pub mobile: String,
    pub email: String,
    pub billing_email: String,
    pub website: String,
    pub substitute_registrations: Vec<StateRegistration>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StateRegistration {
    pub state: String,
    pub value: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

impl CompanyData {
    pub fn validate(&mut self) -> Result<(), Vec<FieldError>> {
        let mut errors = vec![];
        let mut check = |valid: bool, field: &str, message: &str| {
            if !valid {
                errors.push(FieldError {
                    field: field.into(),
                    message: message.into(),
                });
            }
        };
        self.legal_name = self.legal_name.trim().to_owned();
        let raw_tax_id = self.tax_id.clone();
        let raw_postal_code = self.postal_code.clone();
        self.tax_id = self
            .tax_id
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .map(|c| c.to_ascii_uppercase())
            .collect();
        self.postal_code = self
            .postal_code
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect();
        check(
            !self.legal_name.is_empty(),
            "legalName",
            "Informe o nome empresarial",
        );
        check(
            matches!(self.person_type.as_str(), "juridica" | "fisica"),
            "personType",
            "Selecione o tipo de pessoa",
        );
        check(
            raw_tax_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "./- ".contains(c))
                && valid_document(&self.tax_id, &self.person_type),
            "taxId",
            "Informe um CPF ou CNPJ válido para o tipo de pessoa",
        );
        check(
            matches!(self.tax_regime.as_str(), "simples" | "presumido" | "real"),
            "taxRegime",
            "Selecione o regime tributário",
        );
        check(
            matches!(
                self.main_activity.as_str(),
                "" | "outros" | "comercio" | "servicos"
            ),
            "mainActivity",
            "Selecione uma atividade válida",
        );
        check(
            matches!(
                self.company_size.as_str(),
                "" | "micro" | "pequena" | "media" | "grande"
            ),
            "companySize",
            "Selecione um porte válido",
        );
        let mut segments = std::collections::HashSet::new();
        check(
            !self.segments.is_empty()
                && self.segments.len() <= 4
                && self.segments.iter().all(|segment| {
                    ["Comércio", "E-commerce", "Serviços", "Indústria"].contains(&segment.as_str())
                        && segments.insert(segment)
                }),
            "segments",
            "Selecione segmentos válidos sem repetição",
        );
        check(
            raw_postal_code
                .chars()
                .all(|c| c.is_ascii_digit() || ".- ".contains(c))
                && self.postal_code.len() == 8,
            "postalCode",
            "Informe um CEP com oito dígitos",
        );
        check(
            STATES.contains(&self.state.as_str()),
            "state",
            "Selecione uma UF válida",
        );
        for (field, value) in [
            ("city", &self.city),
            ("street", &self.street),
            ("number", &self.number),
            ("district", &self.district),
        ] {
            check(!value.trim().is_empty(), field, "Campo obrigatório");
        }
        for (field, value) in [
            ("email", &self.email),
            ("billingEmail", &self.billing_email),
        ] {
            check(
                value.is_empty()
                    || (!value.contains(char::is_whitespace)
                        && value.split_once('@').is_some_and(|(local, domain)| {
                            !local.is_empty() && domain.contains('.') && !domain.contains('@')
                        })),
                field,
                "Informe um e-mail válido",
            );
        }
        check(
            self.website.is_empty()
                || reqwest::Url::parse(&self.website).is_ok_and(|url| {
                    ["http", "https"].contains(&url.scheme())
                        && url.host_str().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                }),
            "website",
            "Informe um endereço HTTP ou HTTPS",
        );
        check(
            self.substitute_registrations.len() <= 27,
            "substituteRegistrations",
            "Máximo de 27 inscrições",
        );
        let mut states = std::collections::HashSet::new();
        for registration in &self.substitute_registrations {
            check(
                STATES.contains(&registration.state.as_str())
                    && !registration.value.trim().is_empty()
                    && registration.value.len() <= 80
                    && states.insert(&registration.state),
                "substituteRegistrations",
                "Informe inscrições válidas sem repetir UF",
            );
        }
        let value = serde_json::to_value(&self).expect("company data serializes");
        for (field, value) in value.as_object().expect("company data is an object") {
            if let Some(text) = value.as_str() {
                check(text.len() <= 300, field, "Máximo de 300 bytes por campo");
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

pub(crate) fn valid_document(value: &str, person: &str) -> bool {
    let valid_characters = if person == "fisica" {
        value.len() == 11 && value.bytes().all(|c| c.is_ascii_digit())
    } else {
        value.len() == 14
            && value
                .bytes()
                .take(12)
                .all(|c| c.is_ascii_digit() || c.is_ascii_uppercase())
            && value.bytes().skip(12).all(|c| c.is_ascii_digit())
    };
    if !valid_characters {
        return false;
    }
    let digits: Vec<u32> = value.bytes().map(|c| u32::from(c - b'0')).collect();
    let length = if person == "fisica" { 11 } else { 14 };
    if digits.len() != length || digits.iter().all(|digit| *digit == digits[0]) {
        return false;
    }
    for end in [length - 2, length - 1] {
        let sum: u32 = digits[..end]
            .iter()
            .enumerate()
            .map(|(index, digit)| {
                let weight = if length == 11 {
                    (end + 1 - index) as u32
                } else {
                    ((end - 1 - index) % 8 + 2) as u32
                };
                digit * weight
            })
            .sum();
        let remainder = sum % 11;
        let expected = if remainder < 2 { 0 } else { 11 - remainder };
        if digits[end] != expected {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_validation_checks_type_and_check_digits() {
        assert!(valid_document("04252011000110", "juridica"));
        // Receita Federal's published example: ASCII value minus 48.
        assert!(valid_document("12ABC34501DE35", "juridica"));
        assert!(!valid_document("12ABC34501DE34", "juridica"));
        assert!(!valid_document("12ABC34501DE3A", "juridica"));
        assert!(valid_document("52998224725", "fisica"));
        for invalid in ["", "11111111111", "52998224724", "5299822472A"] {
            assert!(!valid_document(invalid, "fisica"));
        }
        assert!(!valid_document("52998224725", "juridica"));
    }

    #[test]
    fn validation_reports_fields_and_refuses_unknown_input() {
        let mut data = CompanyData::default();
        let errors = data.validate().unwrap_err();
        assert!(errors.iter().any(|e| e.field == "taxId"));
        assert!(errors.iter().any(|e| e.field == "postalCode"));
        assert!(
            serde_json::from_value::<CompanyData>(serde_json::json!({"tenantId":"foreign"}))
                .is_err()
        );
    }
}
