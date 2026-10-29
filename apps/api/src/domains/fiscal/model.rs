use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domains::{DomainError, decimal};
use crate::platform::valid_document;

/// No production variant: neither a request nor a database row can enable it.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Homologation,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProfileInput {
    pub environment: Environment,
    pub state: String,
    pub municipality_code: String,
    pub state_registration: String,
    pub crt: u8,
    pub series: u16,
    /// Opaque alias only. Not a path, password, certificate or proof of provisioning.
    #[serde(default)]
    pub certificate_reference: String,
}

impl ProfileInput {
    pub fn validate(&self) -> Result<(), DomainError> {
        let prefix = state_code(&self.state).ok_or(DomainError::Invalid("UF inválida"))?;
        if !digits(&self.municipality_code, 7) || !self.municipality_code.starts_with(prefix) {
            return Err(DomainError::Invalid(
                "Código IBGE deve ter 7 dígitos e corresponder à UF",
            ));
        }
        if self.state_registration.is_empty()
            || self.state_registration.len() > 14
            || !self.state_registration.bytes().all(|c| c.is_ascii_digit())
        {
            return Err(DomainError::Invalid(
                "Informe a IE do emitente somente com dígitos",
            ));
        }
        if !(1..=4).contains(&self.crt) || !(1..=999).contains(&self.series) {
            return Err(DomainError::Invalid(
                "CRT deve ser de 1 a 4; série deve ser de 1 a 999",
            ));
        }
        if !self.certificate_reference.is_empty() && self.certificate_reference.len() < 3
            || self.certificate_reference.len() > 100
            || !self
                .certificate_reference
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
        {
            return Err(DomainError::Invalid(
                "Referência A1 deve ser um alias de 3 a 100 letras ASCII, números, hífen ou sublinhado; não envie segredos",
            ));
        }
        Ok(())
    }

    pub fn matches_company(&self, state: &str, regime: &str, registration: &str) -> bool {
        let crt_matches = match regime {
            "simples" => [1, 2, 4].contains(&self.crt),
            "presumido" | "real" => self.crt == 3,
            _ => false,
        };
        self.state == state && crt_matches && self.state_registration == registration
    }
}

pub fn state_code(state: &str) -> Option<&'static str> {
    Some(match state {
        "RO" => "11",
        "AC" => "12",
        "AM" => "13",
        "RR" => "14",
        "PA" => "15",
        "AP" => "16",
        "TO" => "17",
        "MA" => "21",
        "PI" => "22",
        "CE" => "23",
        "RN" => "24",
        "PB" => "25",
        "PE" => "26",
        "AL" => "27",
        "SE" => "28",
        "BA" => "29",
        "MG" => "31",
        "ES" => "32",
        "RJ" => "33",
        "SP" => "35",
        "PR" => "41",
        "SC" => "42",
        "RS" => "43",
        "MS" => "50",
        "MT" => "51",
        "GO" => "52",
        "DF" => "53",
        _ => return None,
    })
}

fn digits(value: &str, size: usize) -> bool {
    value.len() == size && value.bytes().all(|c| c.is_ascii_digit())
}

fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}

fn exact_decimal(value: &str, whole_digits: usize, scale: usize) -> Result<i128, DomainError> {
    let invalid = || {
        DomainError::Invalid(
            "Decimal exige ponto, escala fixa e valor não negativo dentro dos limites",
        )
    };
    let (whole, fraction) = value.split_once('.').ok_or_else(invalid)?;
    if whole.is_empty()
        || whole.len() > whole_digits
        || (whole.len() > 1 && whole.starts_with('0'))
        || fraction.len() != scale
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|c| c.is_ascii_digit())
    {
        return Err(invalid());
    }
    format!("{whole}{fraction}").parse().map_err(|_| invalid())
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Recipient {
    /// Unformatted CPF or CNPJ. Registration status is not checked here.
    pub tax_id: String,
    pub legal_name: String,
    pub state: String,
    pub municipality_code: String,
    pub postal_code: String,
    pub street: String,
    pub number: String,
    pub district: String,
}

impl Recipient {
    fn validate(&self) -> Result<(), DomainError> {
        let person = if self.tax_id.len() == 11 {
            "fisica"
        } else {
            "juridica"
        };
        if !valid_document(&self.tax_id, person) {
            return Err(DomainError::Invalid(
                "CPF/CNPJ do destinatário inválido; informe sem formatação",
            ));
        }
        let prefix =
            state_code(&self.state).ok_or(DomainError::Invalid("UF do destinatário inválida"))?;
        if !digits(&self.municipality_code, 7)
            || !self.municipality_code.starts_with(prefix)
            || !digits(&self.postal_code, 8)
        {
            return Err(DomainError::Invalid(
                "Código IBGE ou CEP do destinatário inválido",
            ));
        }
        if !text(&self.legal_name, 60)
            || !text(&self.street, 60)
            || !text(&self.number, 60)
            || !text(&self.district, 60)
        {
            return Err(DomainError::Invalid(
                "Nome e endereço do destinatário exigem de 1 a 60 caracteres sem controles",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DraftItem {
    pub code: String,
    pub description: String,
    pub unit: String,
    pub ncm: String,
    pub cfop: String,
    /// 4 decimal places; unit price has 10. Transport uses strings, never floats.
    pub quantity: String,
    pub unit_price: String,
    pub gross_total: String,
    pub origin: u8,
    pub icms_cst: Option<String>,
    pub csosn: Option<String>,
    pub pis_cst: String,
    pub cofins_cst: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DraftInput {
    pub environment: Environment,
    pub model: u8,
    pub operation_nature: String,
    /// Reference to the accountant-approved instruction, not an approval assertion by this API.
    pub tax_rule_reference: String,
    pub recipient: Recipient,
    pub items: Vec<DraftItem>,
    pub products_total: String,
}

impl DraftInput {
    /// Structural and arithmetic validation only; not an XSD or tax determination.
    pub fn validate(&self, profile: &ProfileInput) -> Result<i64, DomainError> {
        if self.model != 55
            || !text(&self.operation_nature, 60)
            || !text(&self.tax_rule_reference, 200)
        {
            return Err(DomainError::Invalid(
                "Exige modelo 55, natureza da operação e referência à instrução fiscal",
            ));
        }
        self.recipient.validate()?;
        if self.items.is_empty() || self.items.len() > 990 {
            return Err(DomainError::Invalid("Informe de 1 a 990 itens"));
        }
        let expected_cfop = if profile.state == self.recipient.state {
            b'5'
        } else {
            b'6'
        };
        let mut total = 0_i64;
        for item in &self.items {
            if !text(&item.code, 60) || !text(&item.description, 120) || !text(&item.unit, 6) {
                return Err(DomainError::Invalid(
                    "Código, descrição ou unidade do item inválidos",
                ));
            }
            if !digits(&item.ncm, 8)
                || !digits(&item.cfop, 4)
                || item.cfop.as_bytes()[0] != expected_cfop
            {
                return Err(DomainError::Invalid(
                    "NCM exige 8 dígitos; CFOP de saída deve começar com 5 na mesma UF ou 6 entre UFs",
                ));
            }
            validate_tax_codes(item, profile.crt)?;
            let quantity = exact_decimal(&item.quantity, 11, 4)?;
            let price = exact_decimal(&item.unit_price, 11, 10)?;
            let cents = exact_decimal(&item.gross_total, 13, 2)?;
            // NF-e qCom: 11 whole digits; vUnCom: 11 whole digits; vProd: 13.
            if quantity == 0
                || quantity > 999_999_999_999_999
                || price == 0
                || cents == 0
                || cents > 999_999_999_999_999
            {
                return Err(DomainError::Invalid(
                    "Quantidade, preço ou total do item fora dos limites da preparação",
                ));
            }
            let computed = (quantity * price + 500_000_000_000_i128) / 1_000_000_000_000_i128;
            if computed != cents {
                return Err(DomainError::Invalid(
                    "Total do item diverge de quantidade vezes preço, arredondado em centavos",
                ));
            }
            total = total
                .checked_add(
                    i64::try_from(cents)
                        .map_err(|_| DomainError::Invalid("Total excede o limite"))?,
                )
                .ok_or(DomainError::Invalid("Total excede o limite"))?;
        }
        if total > 999_999_999_999_999
            || exact_decimal(&self.products_total, 13, 2)? != i128::from(total)
        {
            return Err(DomainError::Invalid(
                "Total de produtos diverge da soma dos itens ou excede o limite",
            ));
        }
        Ok(total)
    }
}

fn validate_tax_codes(item: &DraftItem, crt: u8) -> Result<(), DomainError> {
    let csosn_valid = item.csosn.as_deref().is_some_and(|code| {
        [
            "101", "102", "103", "201", "202", "203", "300", "400", "500", "900",
        ]
        .contains(&code)
    });
    let cst_valid = item.icms_cst.as_deref().is_some_and(|code| {
        [
            "00", "02", "10", "15", "20", "30", "40", "41", "50", "51", "53", "60", "61", "70",
            "90",
        ]
        .contains(&code)
    });
    let valid_icms = if [1, 4].contains(&crt) {
        csosn_valid && item.icms_cst.is_none()
    } else {
        cst_valid && item.csosn.is_none()
    };
    let contribution_valid = |code: &str| {
        digits(code, 2)
            && matches!(
                code.parse::<u8>(),
                Ok(1..=9 | 49..=56 | 60..=67 | 70..=75 | 98..=99)
            )
    };
    if item.origin > 8
        || !valid_icms
        || !contribution_valid(&item.pis_cst)
        || !contribution_valid(&item.cofins_cst)
    {
        return Err(DomainError::Invalid(
            "Origem, CST/CSOSN, PIS ou COFINS inválidos para o CRT informado",
        ));
    }
    Ok(())
}

pub fn products_total(cents: i64) -> String {
    decimal(cents, 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> ProfileInput {
        serde_json::from_value(serde_json::json!({"environment":"homologation","state":"SP","municipalityCode":"3550308","stateRegistration":"110042490114","crt":1,"series":1,"certificateReference":"fixture-a1"})).unwrap()
    }
    fn draft() -> DraftInput {
        serde_json::from_value(serde_json::json!({"environment":"homologation","model":55,"operationNature":"Venda","taxRuleReference":"fixture-instruction","recipient":{"taxId":"52998224725","legalName":"Destinatário de teste","state":"SP","municipalityCode":"3550308","postalCode":"01001000","street":"Rua de teste","number":"1","district":"Centro"},"items":[{"code":"TEST","description":"Produto de teste","unit":"UN","ncm":"00000000","cfop":"5102","quantity":"3.0000","unitPrice":"0.3333333333","grossTotal":"1.00","origin":0,"icmsCst":null,"csosn":"102","pisCst":"07","cofinsCst":"07"}],"productsTotal":"1.00"})).unwrap()
    }
    #[test]
    fn draft_arithmetic_is_exact_and_rejects_tampered_totals() {
        assert_eq!(draft().validate(&profile()).unwrap(), 100);
        let mut value = draft();
        value.items[0].gross_total = "0.99".into();
        assert!(value.validate(&profile()).is_err());
        let mut value = draft();
        value.products_total = "1.01".into();
        assert!(value.validate(&profile()).is_err());
        let mut value = draft();
        value.items[0].quantity = "0.0000".into();
        assert!(value.validate(&profile()).is_err());
    }
    #[test]
    fn crt_cfop_and_recipient_are_checked_without_tax_inference() {
        let mut value = draft();
        value.items[0].icms_cst = Some("00".into());
        assert!(value.validate(&profile()).is_err());
        let mut value = draft();
        value.items[0].cfop = "6102".into();
        assert!(value.validate(&profile()).is_err());
        let mut value = draft();
        value.recipient.tax_id = "00000000000".into();
        assert!(value.validate(&profile()).is_err());
        let mut value = draft();
        value.model = 65;
        assert!(value.validate(&profile()).is_err());
    }
    #[test]
    fn production_and_secret_payloads_are_not_configuration_options() {
        assert!(serde_json::from_str::<Environment>("\"production\"").is_err());
        for alias in [
            "/tmp/a1.pfx",
            "https://secret.test/a1",
            "-----BEGIN PRIVATE KEY-----",
            "a1:password",
        ] {
            let mut value = profile();
            value.certificate_reference = alias.into();
            assert!(value.validate().is_err());
        }
        let mut value = profile();
        value.municipality_code = "3304557".into();
        assert!(value.validate().is_err());
    }
}
