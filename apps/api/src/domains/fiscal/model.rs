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
    #[schema(required = true)]
    pub certificate_reference: String,
}

/// Request-only schema derived from the serialized profile. The legacy alias
/// may be omitted on input; Serialize always emits it in existing responses.
pub struct ProfileRequest;

impl utoipa::PartialSchema for ProfileRequest {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::{RefOr, schema::Schema};

        let RefOr::T(Schema::Object(mut profile)) = ProfileInput::schema() else {
            unreachable!("ProfileInput must remain an object schema");
        };
        profile
            .required
            .retain(|name| name != "certificateReference");
        RefOr::T(Schema::Object(profile))
    }
}

impl ToSchema for ProfileRequest {}

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

pub(super) fn exact_decimal(
    value: &str,
    whole_digits: usize,
    scale: usize,
) -> Result<i128, DomainError> {
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
pub struct DraftPayment {
    pub code: String,
    pub description: Option<String>,
    pub amount: String,
}

/// Percentages, never fractions: fixed four decimal places, e.g. 18.0000.
/// These are declarations by the fiscal operator, not rates inferred by ERP.
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct IbsCbsDeclaration {
    pub cst: String,
    pub class_code: String,
    pub ibs_state_rate: String,
    pub ibs_city_rate: String,
    pub cbs_rate: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaxDeclaration {
    pub recipient_taxpayer: bool,
    pub recipient_state_registration: Option<String>,
    pub final_consumer: bool,
    pub icms_rate: Option<String>,
    pub pis_rate: Option<String>,
    pub cofins_rate: Option<String>,
    pub ipi_cst: Option<String>,
    pub ipi_frame_code: Option<String>,
    pub ipi_rate: Option<String>,
    pub ipi_in_icms_base: bool,
    pub icms_out_of_contributions: bool,
    pub ibs_cbs: IbsCbsDeclaration,
}

fn declared_rate(value: Option<&str>, required: bool) -> Result<i128, DomainError> {
    let rate = match value {
        Some(value) => exact_decimal(value, 2, 4)?,
        None if !required => 0,
        None => {
            return Err(DomainError::Invalid(
                "Declare a alíquota exigida pelo CST, inclusive zero",
            ));
        }
    };
    if rate >= 1_000_000 || !required && rate != 0 {
        return Err(DomainError::Invalid(
            "Alíquota percentual exige 4 casas, de zero a menos de 100; CST sem tributação aceita somente zero",
        ));
    }
    Ok(rate)
}

fn rounded_tax(base: i128, rate: i128) -> i128 {
    (base * rate + 500_000) / 1_000_000
}

impl TaxDeclaration {
    fn validate(&self, draft: &DraftInput, profile: &ProfileInput) -> Result<i128, DomainError> {
        if profile.crt != 3 || profile.state != "SP" || draft.recipient.state != "SP" {
            return Err(DomainError::Invalid(
                "Declaração tributária disponível para CRT 3 em operação interna SP",
            ));
        }
        let first = &draft.items[0];
        if self.recipient_taxpayer {
            if !self
                .recipient_state_registration
                .as_ref()
                .is_some_and(|value| {
                    (2..=14).contains(&value.len())
                        && value.bytes().all(|byte| byte.is_ascii_digit())
                })
            {
                return Err(DomainError::Invalid(
                    "Contribuinte exige inscrição estadual de 2 a 14 dígitos",
                ));
            }
        } else if self.recipient_state_registration.is_some()
            || !self.final_consumer
            || first.icms_cst.as_deref() == Some("50")
        {
            return Err(DomainError::Invalid(
                "Não contribuinte exige consumidor final, sem IE; CST 50 fora do recorte",
            ));
        }
        let taxed_icms = first.icms_cst.as_deref() == Some("00");
        if !matches!(first.icms_cst.as_deref(), Some("00" | "40" | "41" | "50"))
            || first.csosn.is_some()
            || !["01", "02", "04", "05", "06", "07", "08", "09"].contains(&first.pis_cst.as_str())
            || !["01", "02", "04", "05", "06", "07", "08", "09"]
                .contains(&first.cofins_cst.as_str())
        {
            return Err(DomainError::Invalid(
                "CST fora do recorte da declaração tributária",
            ));
        }
        let icms_rate = declared_rate(self.icms_rate.as_deref(), taxed_icms)?;
        let pis_rate = declared_rate(
            self.pis_rate.as_deref(),
            ["01", "02"].contains(&first.pis_cst.as_str()),
        )?;
        let cofins_rate = declared_rate(
            self.cofins_rate.as_deref(),
            ["01", "02"].contains(&first.cofins_cst.as_str()),
        )?;
        let taxed_ipi = matches!(self.ipi_cst.as_deref(), Some("00" | "49" | "50" | "99"));
        if let Some(cst) = &self.ipi_cst {
            if ![
                "00", "49", "50", "99", "01", "02", "03", "04", "05", "51", "52", "53", "54", "55",
            ]
            .contains(&cst.as_str())
                || !self
                    .ipi_frame_code
                    .as_ref()
                    .is_some_and(|value| digits(value, 3))
            {
                return Err(DomainError::Invalid(
                    "IPI exige CST suportado e enquadramento de 3 dígitos",
                ));
            }
        } else if self.ipi_frame_code.is_some() {
            return Err(DomainError::Invalid(
                "Enquadramento do IPI exige CST declarado",
            ));
        }
        let ipi_rate = declared_rate(self.ipi_rate.as_deref(), taxed_ipi)?;
        if self.ibs_cbs.cst != "000" || self.ibs_cbs.class_code != "000001" {
            return Err(DomainError::Invalid(
                "IBS/CBS limitado ao recorte tributado integral 000/000001",
            ));
        }
        let ibs_state_rate = declared_rate(Some(&self.ibs_cbs.ibs_state_rate), true)?;
        let ibs_city_rate = declared_rate(Some(&self.ibs_cbs.ibs_city_rate), true)?;
        let cbs_rate = declared_rate(Some(&self.ibs_cbs.cbs_rate), true)?;
        let mut total_ipi = 0;
        let mut tax_totals = [0_i128; 8];
        for item in &draft.items {
            if item.icms_cst != first.icms_cst
                || item.csosn != first.csosn
                || item.pis_cst != first.pis_cst
                || item.cofins_cst != first.cofins_cst
                || item.cfop != first.cfop
            {
                return Err(DomainError::Invalid(
                    "Declaração exige a mesma classificação fiscal por item",
                ));
            }
            let product = exact_decimal(&item.gross_total, 13, 2)?;
            let ipi = rounded_tax(product, ipi_rate);
            let base = if taxed_icms {
                product
                    + if self.final_consumer && self.ipi_in_icms_base {
                        ipi
                    } else {
                        0
                    }
            } else {
                0
            };
            let icms = rounded_tax(base, icms_rate);
            let contribution_base = product
                - if self.icms_out_of_contributions {
                    icms
                } else {
                    0
                };
            let pis = rounded_tax(contribution_base, pis_rate);
            let cofins = rounded_tax(contribution_base, cofins_rate);
            let reform_base = product - icms - pis - cofins;
            if contribution_base < 0 || reform_base < 0 {
                return Err(DomainError::Invalid(
                    "Base tributária negativa fora do recorte",
                ));
            }
            for (total, amount) in tax_totals.iter_mut().zip([
                base,
                icms,
                pis,
                cofins,
                reform_base,
                rounded_tax(reform_base, ibs_state_rate),
                rounded_tax(reform_base, ibs_city_rate),
                rounded_tax(reform_base, cbs_rate),
            ]) {
                *total += amount;
            }
            total_ipi += ipi;
        }
        if tax_totals
            .iter()
            .any(|amount| *amount > 999_999_999_999_999)
            || tax_totals[5] + tax_totals[6] > 999_999_999_999_999
            || total_ipi > 999_999_999_999_999
        {
            return Err(DomainError::Invalid(
                "Totais tributários excedem o limite fiscal",
            ));
        }
        Ok(total_ipi)
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DraftInput {
    /// Full domestic sales order copied into this draft; no billing effect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_order_id: Option<uuid::Uuid>,
    pub environment: Environment,
    pub model: u8,
    pub operation_nature: String,
    /// Reference to the accountant-approved instruction, not an approval assertion by this API.
    pub tax_rule_reference: String,
    pub recipient: Recipient,
    pub items: Vec<DraftItem>,
    pub products_total: String,
    /// Required by the emission adapter, optional for existing saved drafts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payments: Option<Vec<DraftPayment>>,
    /// Optional for historical drafts. CRT 3 emission requires this declaration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_declaration: Option<TaxDeclaration>,
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
        let ipi_total = self
            .tax_declaration
            .as_ref()
            .map(|declaration| declaration.validate(self, profile))
            .transpose()?
            .unwrap_or(0);
        let invoice_total = i128::from(total) + ipi_total;
        if invoice_total > 999_999_999_999_999 {
            return Err(DomainError::Invalid(
                "Total da NF-e incluindo IPI excede o limite fiscal",
            ));
        }
        if let Some(payments) = &self.payments {
            if payments.is_empty() || payments.len() > 100 {
                return Err(DomainError::Invalid(
                    "Informe de 1 a 100 formas de pagamento",
                ));
            }
            let mut payment_total = 0_i128;
            for payment in payments {
                if !["01", "03", "04", "15", "16", "17", "18", "90", "99"]
                    .contains(&payment.code.as_str())
                    || payment
                        .description
                        .as_ref()
                        .is_some_and(|value| !text(value, 60))
                    || payment.code == "99" && payment.description.is_none()
                {
                    return Err(DomainError::Invalid(
                        "Forma de pagamento ou descrição fiscal inválida",
                    ));
                }
                payment_total += exact_decimal(&payment.amount, 13, 2)?;
            }
            let no_payment = payments.iter().any(|payment| payment.code == "90");
            if no_payment {
                if payments.len() != 1 || payment_total != 0 {
                    return Err(DomainError::Invalid(
                        "Sem pagamento deve ser a única forma e ter valor zero",
                    ));
                }
            } else if payment_total != invoice_total {
                return Err(DomainError::Invalid(
                    "Pagamentos declarados devem somar o total da NF-e, incluindo IPI",
                ));
            }
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
    fn payment_declarations_require_exact_totals_and_explicit_no_payment() {
        let mut value = draft();
        value.payments = Some(vec![DraftPayment {
            code: "17".into(),
            description: None,
            amount: "1.00".into(),
        }]);
        assert_eq!(value.validate(&profile()).unwrap(), 100);
        value.payments.as_mut().unwrap()[0].amount = "0.99".into();
        assert!(value.validate(&profile()).is_err());
        value.payments = Some(vec![DraftPayment {
            code: "90".into(),
            description: None,
            amount: "0.00".into(),
        }]);
        assert_eq!(value.validate(&profile()).unwrap(), 100);
        value.payments.as_mut().unwrap().push(DraftPayment {
            code: "17".into(),
            description: None,
            amount: "1.00".into(),
        });
        assert!(value.validate(&profile()).is_err());
        value.payments = Some(vec![DraftPayment {
            code: "99".into(),
            description: None,
            amount: "1.00".into(),
        }]);
        assert!(value.validate(&profile()).is_err());
        value.payments.as_mut().unwrap()[0].description =
            Some("Pagamento declarado pelo operador".into());
        assert!(value.validate(&profile()).is_ok());
    }

    fn declared_normal_draft() -> (DraftInput, ProfileInput) {
        let mut profile = profile();
        profile.crt = 3;
        let mut value = draft();
        value.items[0].icms_cst = Some("00".into());
        value.items[0].csosn = None;
        value.items[0].pis_cst = "01".into();
        value.items[0].cofins_cst = "01".into();
        value.tax_declaration = Some(serde_json::from_value(serde_json::json!({
            "recipientTaxpayer":true,"recipientStateRegistration":"110042490114","finalConsumer":false,
            "icmsRate":"18.0000","pisRate":"1.6500","cofinsRate":"7.6000",
            "ipiCst":"50","ipiFrameCode":"999","ipiRate":"10.0000",
            "ipiInIcmsBase":false,"icmsOutOfContributions":true,
            "ibsCbs":{"cst":"000","classCode":"000001","ibsStateRate":"0.1000","ibsCityRate":"0.0000","cbsRate":"0.9000"}
        })).unwrap());
        value.payments = Some(vec![DraftPayment {
            code: "17".into(),
            description: None,
            amount: "1.10".into(),
        }]);
        (value, profile)
    }

    #[test]
    fn declared_taxes_require_exact_rates_and_payments_include_ipi() {
        let (value, profile) = declared_normal_draft();
        assert_eq!(value.validate(&profile).unwrap(), 100);
        let mut wrong_payment = value.clone();
        wrong_payment.payments.as_mut().unwrap()[0].amount = "1.00".into();
        assert!(wrong_payment.validate(&profile).is_err());
        for rate in [
            None,
            Some("18.00001"),
            Some("100.0000"),
            Some("-1.0000"),
            Some("1e1"),
        ] {
            let mut invalid = value.clone();
            invalid.tax_declaration.as_mut().unwrap().icms_rate = rate.map(str::to_owned);
            assert!(invalid.validate(&profile).is_err());
        }
        let mut zero = value;
        let declaration = zero.tax_declaration.as_mut().unwrap();
        declaration.icms_rate = Some("0.0000".into());
        declaration.pis_rate = Some("0.0000".into());
        declaration.cofins_rate = Some("0.0000".into());
        declaration.ipi_rate = Some("0.0000".into());
        zero.payments.as_mut().unwrap()[0].amount = "1.00".into();
        assert!(zero.validate(&profile).is_ok());
    }

    #[test]
    fn tax_declaration_preserves_cent_rounding_and_refuses_unsupported_combinations() {
        let (mut value, profile) = declared_normal_draft();
        value.items[0].quantity = "1.0000".into();
        value.items[0].unit_price = "0.0500000000".into();
        value.items[0].gross_total = "0.05".into();
        value.items.push(value.items[0].clone());
        value.products_total = "0.10".into();
        value.payments.as_mut().unwrap()[0].amount = "0.12".into();
        assert_eq!(value.validate(&profile).unwrap(), 10);
        value.payments.as_mut().unwrap()[0].amount = "0.11".into();
        assert!(value.validate(&profile).is_err());
        let (value, profile) = declared_normal_draft();
        let mut mixed = value.clone();
        mixed.items.push(mixed.items[0].clone());
        mixed.items[1].pis_cst = "02".into();
        mixed.products_total = "2.00".into();
        assert!(mixed.validate(&profile).is_err());
        let mut unsupported = value.clone();
        unsupported.tax_declaration.as_mut().unwrap().ibs_cbs.cst = "200".into();
        assert!(unsupported.validate(&profile).is_err());
        let mut unsupported = value.clone();
        unsupported
            .tax_declaration
            .as_mut()
            .unwrap()
            .recipient_taxpayer = false;
        assert!(unsupported.validate(&profile).is_err());
        let mut declaration = serde_json::to_value(value.tax_declaration.unwrap()).unwrap();
        declaration["unknownRate"] = serde_json::json!("18.0000");
        assert!(serde_json::from_value::<TaxDeclaration>(declaration).is_err());
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
