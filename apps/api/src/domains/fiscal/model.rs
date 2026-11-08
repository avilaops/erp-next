use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domains::{DomainError, decimal};
use crate::platform::valid_document;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Homologation,
    Production,
}
impl Environment {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "homologation" => Some(Self::Homologation),
            "production" => Some(Self::Production),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Homologation => "homologation",
            Self::Production => "production",
        }
    }
    pub fn code(self) -> &'static str {
        match self {
            Self::Homologation => "2",
            Self::Production => "1",
        }
    }
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
    /// User-declared next number. Required when configuring production.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_number: Option<u32>,
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
        if self
            .next_number
            .is_some_and(|number| !(1..=999_999_999).contains(&number))
            || self.environment == Environment::Production && self.next_number.is_none()
        {
            return Err(DomainError::Invalid(
                "Informe a próxima numeração da série para produção",
            ));
        }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub foreign_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country_name: Option<String>,
    /// Unformatted CPF or CNPJ. Registration status is not checked here.
    pub tax_id: String,
    pub legal_name: String,
    pub state: String,
    pub municipality_code: String,
    pub postal_code: String,
    pub street: String,
    pub number: String,
    pub district: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub complement: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub city_name: Option<String>,
}

impl Recipient {
    fn validate(&self) -> Result<(), DomainError> {
        let person = if self.tax_id.len() == 11 {
            "fisica"
        } else {
            "juridica"
        };
        let foreign = self.state == "EX";
        if foreign {
            if !self.tax_id.is_empty()
                || self.municipality_code != "9999999"
                || !self.postal_code.is_empty()
                || !self
                    .country_code
                    .as_deref()
                    .is_some_and(|v| digits(v, 4) && v != "1058" && v != "0000")
                || !self.country_name.as_deref().is_some_and(|v| text(v, 60))
                || !self.city_name.as_deref().is_some_and(|v| text(v, 60))
                || !self
                    .foreign_id
                    .as_deref()
                    .is_some_and(|v| v.len() <= 20 && v.bytes().all(|b| b.is_ascii_alphanumeric()))
            {
                return Err(DomainError::Invalid(
                    "Destinatário exterior exige UF EX, município 9999999, país estrangeiro, cidade e identificação estrangeira (vazia quando inexistente), sem CPF/CNPJ ou CEP",
                ));
            }
        } else if self.foreign_id.is_some()
            || self.country_code.is_some()
            || self.country_name.is_some()
        {
            return Err(DomainError::Invalid(
                "Identificação e país estrangeiro exigem UF EX",
            ));
        }
        if !foreign && !valid_document(&self.tax_id, person) {
            return Err(DomainError::Invalid(
                "CPF/CNPJ do destinatário inválido; informe sem formatação",
            ));
        }
        if !foreign {
            let prefix = state_code(&self.state)
                .ok_or(DomainError::Invalid("UF do destinatário inválida"))?;
            if !digits(&self.municipality_code, 7)
                || !self.municipality_code.starts_with(prefix)
                || !digits(&self.postal_code, 8)
            {
                return Err(DomainError::Invalid(
                    "Código IBGE ou CEP do destinatário inválido",
                ));
            }
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
        if self
            .complement
            .as_ref()
            .is_some_and(|value| !text(value, 60))
            || self
                .city_name
                .as_ref()
                .is_some_and(|value| !text(value, 60))
            || self.phone.as_ref().is_some_and(|value| {
                !(6..=14).contains(&value.len()) || !value.bytes().all(|byte| byte.is_ascii_digit())
            })
            || self.email.as_ref().is_some_and(|value| {
                !text(value, 60) || !value.contains('@') || value.contains(' ')
            })
        {
            return Err(DomainError::Invalid(
                "Confira complemento, município, telefone e e-mail do destinatário",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Exportation {
    /// direct: own foreign sale; indirect: exporter referencing domestic purchases; trading: domestic sale for export.
    pub kind: String,
    pub exit_state: Option<String>,
    pub export_location: Option<String>,
    pub dispatch_location: Option<String>,
}
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExportDetail {
    pub drawback_number: Option<String>,
    pub export_registration: Option<String>,
    pub referenced_access_key: Option<String>,
    pub exported_quantity: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReferencedDfe {
    pub access_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_number: Option<u16>,
}
fn valid_financial_key(key: &str) -> bool {
    if !digits(key, 44) || !["55", "65"].contains(&&key[20..22]) {
        return false;
    }
    let sum: u32 = key[..43]
        .bytes()
        .rev()
        .enumerate()
        .map(|(i, b)| u32::from(b - b'0') * (2 + i as u32 % 8))
        .sum();
    let rest = sum % 11;
    u32::from(key.as_bytes()[43] - b'0') == if rest < 2 { 0 } else { 11 - rest }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DraftItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub referenced_dfe: Option<ReferencedDfe>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub taxable_unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub taxable_quantity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub taxable_unit_price: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub export_details: Vec<ExportDetail>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub insurance_amount: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub other_amount: Option<String>,

    /// Explicit item allocation, never silently distributed across products.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freight_amount: Option<String>,
    /// Unconditional commercial discount, preserving the original unit price.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discount_amount: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additional_info: Option<String>,
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

impl DraftItem {
    pub fn commercial_total(&self) -> Result<i128, DomainError> {
        let gross = exact_decimal(&self.gross_total, 13, 2)?;
        let freight = exact_decimal(self.freight_amount.as_deref().unwrap_or("0.00"), 13, 2)?;
        let discount = exact_decimal(self.discount_amount.as_deref().unwrap_or("0.00"), 13, 2)?;
        let insurance = exact_decimal(self.insurance_amount.as_deref().unwrap_or("0.00"), 13, 2)?;
        let other = exact_decimal(self.other_amount.as_deref().unwrap_or("0.00"), 13, 2)?;
        let net = gross + freight + insurance + other - discount;
        if discount > gross || net <= 0 || net > 999_999_999_999_999 {
            return Err(DomainError::Invalid(
                "Desconto não pode superar o produto; total com frete deve ser positivo e respeitar o limite fiscal",
            ));
        }
        Ok(net)
    }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination_icms_rate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination_fcp_rate: Option<String>,
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
        if profile.crt != 3 || profile.state != "SP" {
            return Err(DomainError::Invalid(
                "Declaração tributária disponível para emitente SP no CRT 3",
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
            || (!self.final_consumer
                && draft.recipient.state != "EX"
                && ![5, 6].contains(&draft.purpose))
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
        let interstate = draft.recipient.state != "EX" && profile.state != draft.recipient.state;
        if interstate && taxed_icms && ![40_000, 70_000, 120_000].contains(&icms_rate) {
            return Err(DomainError::Invalid(
                "ICMS interestadual tributado exige alíquota declarada de 4%, 7% ou 12%",
            ));
        }
        let difal = ![5, 6].contains(&draft.purpose)
            && interstate
            && !self.recipient_taxpayer
            && self.final_consumer;
        if difal && !taxed_icms {
            return Err(DomainError::Invalid(
                "Venda interestadual a não contribuinte disponível somente com ICMS CST 00 e DIFAL declarado",
            ));
        }
        let destination_rate = declared_rate(self.destination_icms_rate.as_deref(), difal)?;
        let fcp_rate = declared_rate(self.destination_fcp_rate.as_deref(), difal)?;
        if difal && destination_rate < icms_rate {
            return Err(DomainError::Invalid(
                "Alíquota interna do destino não pode ser menor que a interestadual neste recorte de DIFAL",
            ));
        }
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
        let immunity = draft.recipient.state == "EX"
            && self.ibs_cbs.cst == "410"
            && self.ibs_cbs.class_code == "410004";
        if !immunity && (self.ibs_cbs.cst != "000" || self.ibs_cbs.class_code != "000001") {
            return Err(DomainError::Invalid(
                "IBS/CBS limitado ao recorte tributado integral 000/000001",
            ));
        }
        let ibs_state_rate = declared_rate(Some(&self.ibs_cbs.ibs_state_rate), !immunity)?;
        let ibs_city_rate = declared_rate(Some(&self.ibs_cbs.ibs_city_rate), !immunity)?;
        let cbs_rate = declared_rate(Some(&self.ibs_cbs.cbs_rate), !immunity)?;
        let mut total_ipi = 0;
        let mut tax_totals = [0_i128; 10];
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
            let product = item.commercial_total()?;
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
            let difal_amount = if difal {
                rounded_tax(base, destination_rate - icms_rate)
            } else {
                0
            };
            let fcp_amount = if difal {
                rounded_tax(base, fcp_rate)
            } else {
                0
            };
            let reform_base = if immunity {
                0
            } else {
                product - icms - pis - cofins - difal_amount - fcp_amount
            };
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
                difal_amount,
                fcp_amount,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crt: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simplified_danfe: Option<super::simplified::SimplifiedDanfe>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exportation: Option<Exportation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<super::draft_extras::Transport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retentions: Option<super::draft_extras::Retentions>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authorized_xml: Vec<super::draft_extras::XmlAccess>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intermediary: Option<super::draft_extras::Intermediary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_authority_information: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment_terms: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub financial_category_id: Option<uuid::Uuid>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub installments: Vec<super::draft_extras::Installment>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issued_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub departure_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presence_indicator: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub print_type: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_consumer: Option<bool>,
    /// Nome declarado do vendedor; nao concede permissao nem cria vinculo comercial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub salesperson: Option<String>,

    /// Historical drafts without this declaration retain mode 9 and zero freight.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freight_mode: Option<String>,
    /// Full domestic sales order copied into this draft; no billing effect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_order_id: Option<uuid::Uuid>,
    /// Durable commercial return/reversal that owns this fiscal document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_return_id: Option<uuid::Uuid>,
    /// `sale_cancellation` for an incoming sales return or `purchase_reversal` for an outgoing purchase return.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_return_kind: Option<String>,
    pub environment: Environment,
    pub model: u8,
    /// 1 normal; 2 complementar; 3 ajuste; 4 devolução com referência fiscal explícita.
    #[serde(default = "default_fiscal_purpose")]
    pub purpose: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debit_type: Option<String>,
    /// Direção declarada pelo operador da devolução. Não é inferida do pedido.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub return_direction: Option<String>,
    /// Chaves das notas fiscais que originaram a devolução.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub referenced_access_keys: Vec<String>,
    pub operation_nature: String,
    /// Reference to the accountant-approved instruction, not an approval assertion by this API.
    pub tax_rule_reference: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additional_information: Option<String>,
    pub recipient: Recipient,
    pub items: Vec<DraftItem>,
    pub products_total: String,
    /// Required by the emission adapter, optional for existing saved drafts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payments: Option<Vec<DraftPayment>>,
    /// Troco explícito da NFC-e; nunca inferido a partir de recebimentos.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change_amount: Option<String>,
    /// 1 normal; 3, 4 e 9 são contingências próprias da NFC-e.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emission_type: Option<String>,
    /// Optional for historical drafts. CRT 3 emission requires this declaration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tax_declaration: Option<TaxDeclaration>,
    /// Explicit request for server-calculated approximate taxes; not operation taxes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ibpt: Option<super::ibpt_document::IbptSelection>,
}

fn default_fiscal_purpose() -> u8 {
    1
}

impl DraftInput {
    pub(super) fn validate_reference_issuer(&self, tax_id: &str) -> Result<(), DomainError> {
        if self.purpose == 5
            && self
                .credit_type
                .as_deref()
                .is_some_and(|kind| ["03", "04"].contains(&kind))
            && self
                .referenced_access_keys
                .iter()
                .any(|key| key.get(6..20) != Some(tax_id))
        {
            return Err(DomainError::Invalid(
                "Crédito 03 e 04 exige referência emitida pela mesma empresa",
            ));
        }
        Ok(())
    }

    fn validate_financial_note(&self, profile: &ProfileInput) -> Result<(), DomainError> {
        let credit = self.credit_type.as_deref();
        let debit = self.debit_type.as_deref();
        if (self.purpose == 5
            && (!credit.is_some_and(|v| ["01", "02", "03", "04", "05", "06"].contains(&v))
                || debit.is_some()))
            || (self.purpose != 5 && credit.is_some())
            || (self.purpose == 6
                && (!debit.is_some_and(|v| {
                    ["01", "02", "03", "04", "05", "06", "07", "08"].contains(&v)
                }) || credit.is_some()))
            || (self.purpose != 6 && debit.is_some())
        {
            return Err(DomainError::Invalid(
                "Declare o tipo de crédito para finalidade 5 ou de débito para finalidade 6, exclusivamente",
            ));
        }
        let item_refs: Vec<_> = self
            .items
            .iter()
            .filter_map(|item| item.referenced_dfe.as_ref())
            .collect();
        if ![5, 6].contains(&self.purpose) {
            return if item_refs.is_empty() {
                Ok(())
            } else {
                Err(DomainError::Invalid(
                    "Referência DF-e por item está habilitada somente nas notas de crédito e débito",
                ))
            };
        }
        if self.model != 55
            || profile.crt != 3
            || self.recipient.state == "EX"
            || self.exportation.is_some()
            || self.return_direction.is_some()
            || self.tax_declaration.is_none()
        {
            return Err(DomainError::Invalid(
                "Crédito e débito exigem NF-e doméstica CRT 3 com declaração tributária explícita",
            ));
        }
        if self.purpose == 5 && !credit.is_some_and(|v| ["01", "03", "04", "06"].contains(&v)) {
            return Err(DomainError::Invalid(
                "Crédito 02 exige grupo ZFM e emissão a partir de 2029; crédito 05 exige transferência de crédito; grupos ainda não suportados",
            ));
        }
        if self.purpose == 6 && !debit.is_some_and(|v| ["03", "04", "06"].contains(&v)) {
            return Err(DomainError::Invalid(
                "Subtipo de débito exige grupo de transferência, estorno ou ajuste de competência ainda não suportado",
            ));
        }
        if credit.is_some_and(|v| ["01", "03", "04"].contains(&v))
            && self.referenced_access_keys.len() != 1
        {
            return Err(DomainError::Invalid(
                "Crédito 01, 03 e 04 exige exatamente uma referência no cabeçalho",
            ));
        }
        if credit.is_some_and(|v| v != "06") && !item_refs.is_empty() {
            return Err(DomainError::Invalid(
                "Somente crédito 06 permite referência DF-e por item",
            ));
        }
        let required = credit == Some("06") || debit.is_some_and(|v| ["03", "04"].contains(&v));
        if required && item_refs.len() != self.items.len()
            || !item_refs.is_empty() && !self.referenced_access_keys.is_empty()
        {
            return Err(DomainError::Invalid(
                "Declare a origem de cada item sem combinar referências no cabeçalho",
            ));
        }
        if credit.is_some_and(|v| ["03", "04"].contains(&v))
            && self
                .referenced_access_keys
                .iter()
                .any(|key| key.get(..2) != state_code(&profile.state))
        {
            return Err(DomainError::Invalid(
                "Crédito 03 e 04 exige referência da mesma UF do emitente",
            ));
        }
        let mut header = std::collections::HashSet::new();
        if self.referenced_access_keys.len() > 99
            || self.referenced_access_keys.iter().any(|key| {
                !valid_financial_key(key)
                    || !header.insert(key)
                    || self.purpose == 5 && credit != Some("03") && &key[20..22] != "55"
            })
        {
            return Err(DomainError::Invalid(
                "Chaves de origem inválidas, repetidas ou com modelo incompatível",
            ));
        }
        let mut bindings = std::collections::HashSet::new();
        let mut keys = std::collections::HashSet::new();
        for reference in item_refs {
            if !valid_financial_key(&reference.access_key)
                || &reference.access_key[20..22] != "55"
                || (if debit == Some("03") {
                    reference.item_number.is_some()
                } else {
                    !reference
                        .item_number
                        .is_some_and(|v| (1..=990).contains(&v))
                })
                || !bindings.insert((&reference.access_key, reference.item_number))
            {
                return Err(DomainError::Invalid(
                    "Referência DF-e por item inválida; débito 03 proíbe nItem, os demais exigem item de 1 a 990 sem repetição",
                ));
            }
            keys.insert(&reference.access_key);
        }
        if debit != Some("03") && keys.len() > 1 {
            return Err(DomainError::Invalid(
                "Este subtipo permite somente um documento fiscal de origem",
            ));
        }
        let legacy = credit.is_some_and(|v| ["03", "04", "06"].contains(&v));
        let advance = debit == Some("06");
        let declaration = self.tax_declaration.as_ref().unwrap();
        if !legacy
            && self
                .items
                .iter()
                .any(|item| !matches!(item.icms_cst.as_deref(), Some("40" | "41")))
        {
            return Err(DomainError::Invalid(
                "Este subtipo não permite ICMS: declare CST 40/41 sem alíquota",
            ));
        }
        if !legacy && declaration.ipi_cst.is_some() {
            return Err(DomainError::Invalid(
                "Este subtipo não permite IPI no pacote PL_010g v1.03 fixado",
            ));
        }
        let no_contributions = !legacy
            && (!advance
                || self
                    .issued_at
                    .as_deref()
                    .is_some_and(|v| !v.starts_with("2026-")));
        if no_contributions
            && self.items.iter().any(|item| {
                !["04", "05", "06", "07", "08", "09"].contains(&item.pis_cst.as_str())
                    || !["04", "05", "06", "07", "08", "09"].contains(&item.cofins_cst.as_str())
            })
        {
            return Err(DomainError::Invalid(
                "Este subtipo/ano não permite PIS ou COFINS",
            ));
        }
        Ok(())
    }

    fn validate_exportation(&self) -> Result<(), DomainError> {
        let foreign = self.recipient.state == "EX";
        let invalid = || {
            DomainError::Invalid(
                "Confira modalidade de exportação, local de saída e referências por item",
            )
        };
        match &self.exportation {
            Some(export) => {
                if self.model != 55
                    || self.purpose != 1
                    || !["direct", "indirect", "trading"].contains(&export.kind.as_str())
                    || foreign != (export.kind != "trading")
                {
                    return Err(invalid());
                }
                if foreign {
                    if !export
                        .exit_state
                        .as_deref()
                        .is_some_and(|v| state_code(v).is_some())
                        || !export
                            .export_location
                            .as_deref()
                            .is_some_and(|v| text(v, 60))
                        || export
                            .dispatch_location
                            .as_deref()
                            .is_some_and(|v| !text(v, 60))
                    {
                        return Err(invalid());
                    }
                    if let Some(tax) = &self.tax_declaration
                        && (tax.recipient_taxpayer || tax.recipient_state_registration.is_some())
                    {
                        return Err(invalid());
                    }
                } else if export.exit_state.is_some()
                    || export.export_location.is_some()
                    || export.dispatch_location.is_some()
                {
                    return Err(invalid());
                }
            }
            None if foreign => return Err(invalid()),
            None => (),
        }
        for item in &self.items {
            if self
                .exportation
                .as_ref()
                .is_some_and(|v| v.kind == "trading")
                && !["5501", "5502", "6501", "6502"].contains(&item.cfop.as_str())
            {
                return Err(DomainError::Invalid(
                    "Venda para trading com fim específico de exportação exige CFOP 5501/5502 ou 6501/6502",
                ));
            }
            let taxable = (
                &item.taxable_unit,
                &item.taxable_quantity,
                &item.taxable_unit_price,
            );
            match taxable {
                (Some(unit), Some(quantity), Some(price)) => {
                    let quantity = exact_decimal(quantity, 11, 4)?;
                    let price = exact_decimal(price, 11, 10)?;
                    if !text(unit, 6)
                        || quantity == 0
                        || price == 0
                        || (quantity * price + 500_000_000_000_i128) / 1_000_000_000_000_i128
                            != exact_decimal(&item.gross_total, 13, 2)?
                    {
                        return Err(DomainError::Invalid(
                            "Unidade tributável exige quantidade e preço equivalentes ao total do produto",
                        ));
                    }
                }
                (None, None, None) if !foreign => (),
                _ => {
                    return Err(DomainError::Invalid(
                        "Exportação exige unidade tributável do NCM, quantidade e preço declarados",
                    ));
                }
            }
            let indirect = self
                .exportation
                .as_ref()
                .is_some_and(|v| v.kind == "indirect");
            if (indirect && item.export_details.is_empty())
                || item.export_details.len() > 500
                || (!foreign && !item.export_details.is_empty())
            {
                return Err(invalid());
            }
            let mut exported = 0_i128;
            for detail in &item.export_details {
                if detail
                    .drawback_number
                    .as_deref()
                    .is_some_and(|v| !text(v, 20))
                {
                    return Err(invalid());
                }
                let has_indirect = detail.export_registration.is_some()
                    || detail.referenced_access_key.is_some()
                    || detail.exported_quantity.is_some();
                if indirect || has_indirect {
                    if !detail
                        .export_registration
                        .as_deref()
                        .is_some_and(|v| v.len() <= 12 && v.bytes().all(|b| b.is_ascii_digit()))
                        || !detail.referenced_access_key.as_deref().is_some_and(|v| {
                            digits(v, 44) && &v[20..22] == "55" && {
                                let sum: u32 = v[..43]
                                    .bytes()
                                    .rev()
                                    .enumerate()
                                    .map(|(i, b)| u32::from(b - b'0') * (2 + (i as u32 % 8)))
                                    .sum();
                                let rest = sum % 11;
                                let dv = if rest < 2 { 0 } else { 11 - rest };
                                u32::from(v.as_bytes()[43] - b'0') == dv
                            }
                        })
                    {
                        return Err(invalid());
                    }
                    let quantity = exact_decimal(
                        detail.exported_quantity.as_deref().ok_or_else(invalid)?,
                        11,
                        4,
                    )?;
                    if quantity == 0 {
                        return Err(invalid());
                    }
                    exported += quantity;
                } else if detail.drawback_number.is_none() {
                    return Err(invalid());
                }
            }
            if exported > exact_decimal(&item.quantity, 11, 4)? {
                return Err(DomainError::Invalid(
                    "Quantidade exportada referenciada não pode superar a quantidade comercial do item",
                ));
            }
        }
        Ok(())
    }

    /// Structural and arithmetic validation only; not an XSD or tax determination.
    pub fn validate(&self, profile: &ProfileInput) -> Result<i64, DomainError> {
        if self.series.is_some_and(|v| !(1..=999).contains(&v))
            || self.number.is_some_and(|v| !(1..=999_999_999).contains(&v))
            || self.crt.is_some_and(|v| !(1..=4).contains(&v))
        {
            return Err(DomainError::Invalid(
                "Confira série (1 a 999), número (1 a 999999999) e CRT (1 a 4)",
            ));
        }
        super::simplified::validate(self, profile)?;
        super::draft_extras::validate(self)?;
        use time::{OffsetDateTime, format_description::well_known::Rfc3339};
        let parse_date = |value: &str| {
            OffsetDateTime::parse(value, &Rfc3339).map_err(|_| {
                DomainError::Invalid("Data fiscal deve incluir data, hora e fuso horario")
            })
        };
        let issued_at = self.issued_at.as_deref().map(parse_date).transpose()?;
        let departure_at = self.departure_at.as_deref().map(parse_date).transpose()?;
        if departure_at.is_some() && issued_at.is_none()
            || issued_at
                .zip(departure_at)
                .is_some_and(|(issued, departure)| departure < issued)
        {
            return Err(DomainError::Invalid(
                "Data de saida exige emissao informada e nao pode antecede-la",
            ));
        }
        if self
            .presence_indicator
            .is_some_and(|value| ![0, 1, 2, 3, 4, 5, 9].contains(&value))
        {
            return Err(DomainError::Invalid("Indicador de presenca invalido"));
        }
        if self.print_type.is_some_and(|value| {
            if self.model == 65 {
                value != 4
            } else {
                ![1, 2, 6].contains(&value)
            }
        }) {
            return Err(DomainError::Invalid(
                "Apresentacao do DANFE incompativel com o modelo",
            ));
        }
        if self.model == 65
            && (departure_at.is_some()
                || self.final_consumer == Some(false)
                || self
                    .presence_indicator
                    .is_some_and(|value| ![1, 4, 5].contains(&value)))
        {
            return Err(DomainError::Invalid(
                "NFC-e exige consumidor final e nao permite data de saida",
            ));
        }
        if self
            .salesperson
            .as_ref()
            .is_some_and(|value| !text(value, 200))
        {
            return Err(DomainError::Invalid(
                "Nome do vendedor exige ate 200 caracteres",
            ));
        }
        if self
            .tax_declaration
            .as_ref()
            .zip(self.final_consumer)
            .is_some_and(|(taxes, final_consumer)| taxes.final_consumer != final_consumer)
        {
            return Err(DomainError::Invalid(
                "Consumidor final diverge da declaracao tributaria",
            ));
        }

        if self.environment != profile.environment {
            return Err(DomainError::Conflict(
                "O ambiente do rascunho deve corresponder à configuração fiscal",
            ));
        }
        if self.additional_information.as_ref().is_some_and(|text| {
            text.chars().count() > 5000
                || text
                    .chars()
                    .any(|character| character.is_control() && character != '\n')
        }) {
            return Err(DomainError::Invalid(
                "Informações complementares exigem até 5000 caracteres, sem controles",
            ));
        }
        if ![55, 65].contains(&self.model)
            || !text(&self.operation_nature, 60)
            || !text(&self.tax_rule_reference, 200)
        {
            return Err(DomainError::Invalid(
                "Exige modelo 55 ou 65, natureza da operação e referência à instrução fiscal",
            ));
        }
        if ![1, 2, 3, 4, 5, 6].contains(&self.purpose) {
            return Err(DomainError::Invalid(
                "Finalidade fiscal deve ser normal, complementar, ajuste, devolução, crédito ou débito",
            ));
        }
        if self.purpose == 4 {
            if self.model != 55
                || !matches!(
                    self.return_direction.as_deref(),
                    Some("incoming" | "outgoing")
                )
                || self.referenced_access_keys.is_empty()
                || self.referenced_access_keys.len() > 99
                || self.source_order_id.is_some()
                || self.source_return_id.is_none()
                || !matches!(
                    self.source_return_kind.as_deref(),
                    Some("sale_cancellation" | "purchase_reversal")
                )
            {
                return Err(DomainError::Invalid(
                    "Devolução exige NF-e modelo 55, origem comercial, direção explícita e de 1 a 99 chaves referenciadas",
                ));
            }
            let source_kind = self.source_return_kind.as_deref().unwrap_or_default();
            let direction_matches = matches!(
                (source_kind, self.return_direction.as_deref()),
                ("sale_cancellation", Some("incoming")) | ("purchase_reversal", Some("outgoing"))
            );
            if !direction_matches {
                return Err(DomainError::Invalid(
                    "Origem comercial e direção da devolução são incompatíveis",
                ));
            }
            let mut keys = std::collections::HashSet::new();
            if self
                .referenced_access_keys
                .iter()
                .any(|key| !digits(key, 44) || !keys.insert(key))
            {
                return Err(DomainError::Invalid(
                    "Chaves referenciadas devem ter 44 dígitos e não podem se repetir",
                ));
            }
        } else if self.return_direction.is_some()
            || self.purpose == 1 && !self.referenced_access_keys.is_empty()
            || self.source_return_id.is_some()
            || self.source_return_kind.is_some()
        {
            return Err(DomainError::Invalid(
                "Direção e chaves referenciadas só podem ser informadas em devolução",
            ));
        }
        if self.purpose != 1 && (self.model != 55 || self.source_order_id.is_some()) {
            return Err(DomainError::Invalid(
                "Finalidade especial exige NF-e modelo 55 sem vinculo direto a pedido de venda",
            ));
        }
        if [2, 3].contains(&self.purpose) {
            let mut keys = std::collections::HashSet::new();
            if self.purpose == 2 && self.referenced_access_keys.is_empty()
                || self.referenced_access_keys.len() > 99
                || self
                    .referenced_access_keys
                    .iter()
                    .any(|key| !digits(key, 44) || !keys.insert(key))
            {
                return Err(DomainError::Invalid(
                    "Confira as chaves referenciadas; nota complementar exige ao menos uma NF-e de origem",
                ));
            }
            if self.purpose == 3
                && self
                    .payments
                    .as_ref()
                    .is_some_and(|payments| payments.len() != 1 || payments[0].code != "90")
            {
                return Err(DomainError::Invalid(
                    "Nota de ajuste exige meio de pagamento 90, sem pagamento",
                ));
            }
        }
        let emission_type = self.emission_type.as_deref().unwrap_or("1");
        if !(if self.model == 65 {
            ["1", "3", "4", "9"].contains(&emission_type)
        } else {
            emission_type == "1"
        }) {
            return Err(DomainError::Invalid(
                "Modalidade de emissão incompatível com o modelo fiscal",
            ));
        }
        self.recipient.validate()?;
        self.validate_exportation()?;
        let freight_mode = self.freight_mode.as_deref().unwrap_or("9");
        if !["0", "1", "2", "3", "4", "9"].contains(&freight_mode) {
            return Err(DomainError::Invalid("Modalidade de frete inválida"));
        }
        if self.items.is_empty() || self.items.len() > 990 {
            return Err(DomainError::Invalid("Informe de 1 a 990 itens"));
        }
        self.validate_financial_note(profile)?;
        if let Some(selection) = &self.ibpt {
            selection.validate(self.items.len())?;
        }
        let expected_cfop = if self.recipient.state == "EX" {
            b'7'
        } else {
            match (self.purpose, self.return_direction.as_deref()) {
                (4, Some("incoming")) | (5, None) => {
                    if profile.state == self.recipient.state {
                        b'1'
                    } else {
                        b'2'
                    }
                }
                (4, Some("outgoing")) | (1 | 2 | 3 | 6, None) => {
                    if profile.state == self.recipient.state {
                        b'5'
                    } else {
                        b'6'
                    }
                }
                _ => unreachable!("purpose and return direction were validated above"),
            }
        };
        let mut total = 0_i64;
        let mut commercial_total = 0_i128;
        for item in &self.items {
            let freight = exact_decimal(item.freight_amount.as_deref().unwrap_or("0.00"), 13, 2)?;
            if freight > 0 && freight_mode == "9" {
                return Err(DomainError::Invalid(
                    "Frete cobrado exige modalidade de transporte diferente de 9",
                ));
            }
            commercial_total += item.commercial_total()?;
            if item
                .additional_info
                .as_deref()
                .is_some_and(|value| !text(value, 500))
            {
                return Err(DomainError::Invalid(
                    "Informações do item exigem até 500 caracteres sem controles",
                ));
            }
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
                    "NCM exige 8 dígitos; CFOP deve corresponder à entrada/saída e ao destino da operação",
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
        let invoice_total = commercial_total + ipi_total;
        if !self.installments.is_empty() {
            let installments_total =
                self.installments
                    .iter()
                    .try_fold(0_i128, |sum, installment| {
                        exact_decimal(&installment.amount, 13, 2).map(|value| sum + value)
                    })?;
            if installments_total != invoice_total {
                return Err(DomainError::Invalid(
                    "Soma das parcelas deve corresponder ao total da NF-e",
                ));
            }
        }
        if invoice_total > 999_999_999_999_999 {
            return Err(DomainError::Invalid(
                "Total da NF-e incluindo IPI excede o limite fiscal",
            ));
        }
        let change = exact_decimal(self.change_amount.as_deref().unwrap_or("0.00"), 13, 2)?;
        if self.model != 65 && change != 0 {
            return Err(DomainError::Invalid(
                "Troco somente pode ser declarado na NFC-e modelo 65",
            ));
        }
        if self.model == 65
            && self
                .tax_declaration
                .as_ref()
                .is_some_and(|declaration| !declaration.final_consumer)
        {
            return Err(DomainError::Invalid(
                "NFC-e modelo 65 exige operação com consumidor final",
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
            } else if payment_total != invoice_total + change {
                return Err(DomainError::Invalid(
                    "Pagamentos declarados devem somar o total da nota mais o troco, incluindo IPI",
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

    #[test]
    fn editable_numbering_round_trips_and_rejects_invalid_values() {
        let mut value = draft();
        value.series = Some(7);
        value.number = Some(321);
        value.crt = Some(1);
        assert!(value.validate(&profile()).is_ok());
        let saved = serde_json::to_value(&value).unwrap();
        assert_eq!(saved["series"], 7);
        assert_eq!(saved["number"], 321);
        assert_eq!(saved["crt"], 1);
        value.series = Some(0);
        assert!(value.validate(&profile()).is_err());
        value.series = Some(1000);
        assert!(value.validate(&profile()).is_err());
        value.series = Some(7);
        value.number = Some(0);
        assert!(value.validate(&profile()).is_err());
        value.number = Some(1_000_000_000);
        assert!(value.validate(&profile()).is_err());
        value.number = Some(321);
        value.crt = Some(5);
        assert!(value.validate(&profile()).is_err());
    }

    fn profile() -> ProfileInput {
        serde_json::from_value(serde_json::json!({"environment":"homologation","state":"SP","municipalityCode":"3550308","stateRegistration":"110042490114","crt":1,"series":1,"certificateReference":"fixture-a1"})).unwrap()
    }
    fn draft() -> DraftInput {
        serde_json::from_value(serde_json::json!({"environment":"homologation","model":55,"operationNature":"Venda","taxRuleReference":"fixture-instruction","recipient":{"taxId":"52998224725","legalName":"Destinatário de teste","state":"SP","municipalityCode":"3550308","postalCode":"01001000","street":"Rua de teste","number":"1","district":"Centro"},"items":[{"code":"TEST","description":"Produto de teste","unit":"UN","ncm":"00000000","cfop":"5102","quantity":"3.0000","unitPrice":"0.3333333333","grossTotal":"1.00","origin":0,"icmsCst":null,"csosn":"102","pisCst":"07","cofinsCst":"07"}],"productsTotal":"1.00"})).unwrap()
    }
    #[test]
    fn export_contract_checks_foreign_address_units_and_domestic_trading_cfop() {
        let mut value = draft();
        value.exportation = Some(Exportation {
            kind: "direct".into(),
            exit_state: Some("SP".into()),
            export_location: Some("Porto de Santos".into()),
            dispatch_location: None,
        });
        value.recipient.tax_id.clear();
        value.recipient.state = "EX".into();
        value.recipient.municipality_code = "9999999".into();
        value.recipient.postal_code.clear();
        value.recipient.foreign_id = Some("US1234".into());
        value.recipient.country_code = Some("2496".into());
        value.recipient.country_name = Some("ESTADOS UNIDOS".into());
        value.recipient.city_name = Some("Miami".into());
        value.items[0].cfop = "7102".into();
        value.items[0].taxable_unit = Some("KG".into());
        value.items[0].taxable_quantity = Some("2.0000".into());
        value.items[0].taxable_unit_price = Some("0.5000000000".into());
        assert!(value.validate(&profile()).is_ok());
        let mut invalid = value.clone();
        invalid.recipient.country_code = Some("1058".into());
        assert!(invalid.validate(&profile()).is_err());
        let mut invalid = value.clone();
        invalid.items[0].taxable_quantity = None;
        assert!(invalid.validate(&profile()).is_err());
        let mut invalid = value.clone();
        invalid.exportation = None;
        assert!(invalid.validate(&profile()).is_err());
        let mut trading = draft();
        trading.exportation = Some(Exportation {
            kind: "trading".into(),
            exit_state: None,
            export_location: None,
            dispatch_location: None,
        });
        assert!(trading.validate(&profile()).is_err());
        trading.items[0].cfop = "5502".into();
        assert!(trading.validate(&profile()).is_ok());
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

    #[test]
    fn nfce_model_accepts_explicit_change_and_keeps_nfe_without_change() {
        let mut value = draft();
        value.model = 65;
        value.change_amount = Some("1.00".into());
        value.payments = Some(vec![DraftPayment {
            code: "01".into(),
            description: None,
            amount: "2.00".into(),
        }]);
        assert_eq!(value.validate(&profile()).unwrap(), 100);
        value.change_amount = Some("0.99".into());
        assert!(value.validate(&profile()).is_err());

        let mut nfe = draft();
        nfe.change_amount = Some("1.00".into());
        assert!(nfe.validate(&profile()).is_err());
    }

    #[test]
    fn return_purpose_requires_explicit_direction_reference_and_return_cfop() {
        let mut value = draft();
        value.purpose = 4;
        value.return_direction = Some("incoming".into());
        value.source_return_id = Some(uuid::Uuid::nil());
        value.source_return_kind = Some("sale_cancellation".into());
        value.referenced_access_keys = vec!["35261104252011000110550010000000011000000001".into()];
        value.items[0].cfop = "1102".into();
        assert_eq!(value.validate(&profile()).unwrap(), 100);

        let mut invalid = value.clone();
        invalid.items[0].cfop = "5102".into();
        assert!(invalid.validate(&profile()).is_err());

        let mut invalid = value.clone();
        invalid.referenced_access_keys[0] = "1".into();
        assert!(invalid.validate(&profile()).is_err());

        let mut invalid = value;
        invalid.return_direction = None;
        assert!(invalid.validate(&profile()).is_err());
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
    fn credit_and_debit_require_explicit_types_and_distinct_origin_references() {
        let key = "35261012345678000195550010000001231482917364";
        for (purpose, subtype) in [
            (5, "01"),
            (5, "03"),
            (5, "04"),
            (5, "06"),
            (6, "03"),
            (6, "04"),
            (6, "06"),
        ] {
            let (mut value, profile) = declared_normal_draft();
            value.purpose = purpose;
            if purpose == 5 {
                value.credit_type = Some(subtype.into());
                value.items[0].cfop = "1102".into();
            } else {
                value.debit_type = Some(subtype.into());
            }
            value.payments = Some(vec![DraftPayment {
                code: "90".into(),
                description: None,
                amount: "0.00".into(),
            }]);
            if purpose == 5 && ["01", "03", "04"].contains(&subtype) {
                value.referenced_access_keys = vec![key.into()];
            }
            if purpose == 5 && subtype == "06" || purpose == 6 && ["03", "04"].contains(&subtype) {
                value.items[0].referenced_dfe = Some(ReferencedDfe {
                    access_key: key.into(),
                    item_number: if purpose == 6 && subtype == "03" {
                        None
                    } else {
                        Some(1)
                    },
                });
            }
            if purpose == 6 || subtype == "01" {
                value.items[0].icms_cst = Some("41".into());
                value.items[0].pis_cst = "07".into();
                value.items[0].cofins_cst = "07".into();
                let declaration = value.tax_declaration.as_mut().unwrap();
                declaration.icms_rate = Some("0.0000".into());
                declaration.pis_rate = Some("0.0000".into());
                declaration.cofins_rate = Some("0.0000".into());
                declaration.ipi_rate = Some("0.0000".into());
                declaration.ipi_cst = None;
                declaration.ipi_frame_code = None;
            }
            assert!(value.validate(&profile).is_ok(), "{purpose}/{subtype}");
            let mut missing = value.clone();
            missing.credit_type = None;
            missing.debit_type = None;
            assert!(missing.validate(&profile).is_err());
            if let Some(reference) = value.items[0].referenced_dfe.as_mut() {
                reference.item_number = if subtype == "03" && purpose == 6 {
                    Some(1)
                } else {
                    None
                };
                assert!(value.validate(&profile).is_err());
            }
        }
        let (mut value, profile) = declared_normal_draft();
        value.purpose = 6;
        value.debit_type = Some("07".into());
        assert!(value.validate(&profile).is_err());
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
    fn commercial_values_preserve_gross_total_and_validate_transport_and_payments() {
        let (mut value, profile) = declared_normal_draft();
        value.freight_mode = Some("0".into());
        value.items[0].freight_amount = Some("0.20".into());
        value.items[0].discount_amount = Some("0.05".into());
        value.payments.as_mut().unwrap()[0].amount = "1.27".into();
        assert_eq!(value.validate(&profile).unwrap(), 100);
        let mut invalid = value.clone();
        invalid.freight_mode = None;
        assert!(invalid.validate(&profile).is_err());
        let mut invalid = value.clone();
        invalid.items[0].discount_amount = Some("1.01".into());
        assert!(invalid.validate(&profile).is_err());
        let mut invalid = value.clone();
        invalid.items[0].freight_amount = Some("0.201".into());
        assert!(invalid.validate(&profile).is_err());
        value.payments.as_mut().unwrap()[0].amount = "1.10".into();
        assert!(value.validate(&profile).is_err());
    }

    #[test]
    fn interstate_non_taxpayer_requires_destination_rates_and_correct_payment() {
        let (mut value, profile) = declared_normal_draft();
        value.recipient.state = "MG".into();
        value.recipient.municipality_code = "3106200".into();
        value.items[0].cfop = "6108".into();
        let declaration = value.tax_declaration.as_mut().unwrap();
        declaration.icms_rate = Some("12.0000".into());
        declaration.recipient_taxpayer = false;
        declaration.recipient_state_registration = None;
        declaration.final_consumer = true;
        declaration.ipi_in_icms_base = true;
        declaration.destination_icms_rate = Some("20.0000".into());
        declaration.destination_fcp_rate = Some("2.0000".into());
        assert_eq!(value.validate(&profile).unwrap(), 100);
        let mut invalid = value.clone();
        invalid
            .tax_declaration
            .as_mut()
            .unwrap()
            .destination_fcp_rate = None;
        assert!(invalid.validate(&profile).is_err());
        let mut invalid = value.clone();
        invalid
            .tax_declaration
            .as_mut()
            .unwrap()
            .destination_icms_rate = Some("7.0000".into());
        assert!(invalid.validate(&profile).is_err());
        let mut invalid = value.clone();
        invalid.tax_declaration.as_mut().unwrap().icms_rate = Some("18.0000".into());
        assert!(invalid.validate(&profile).is_err());
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
    fn credit_origin_issuer_is_checked_before_persisting() {
        let mut value = draft();
        value.purpose = 5;
        value.credit_type = Some("03".into());
        value.referenced_access_keys = vec!["35261004252011000110550010000000011000000017".into()];
        assert!(value.validate_reference_issuer("04252011000110").is_ok());
        assert!(value.validate_reference_issuer("19131243000197").is_err());
        value.credit_type = Some("04".into());
        assert!(value.validate_reference_issuer("19131243000197").is_err());
        value.credit_type = Some("01".into());
        assert!(value.validate_reference_issuer("19131243000197").is_ok());
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
    }
    #[test]
    fn environment_selection_requires_numbering_and_secret_payloads_remain_invalid() {
        assert_eq!(
            serde_json::from_str::<Environment>("\"production\"").unwrap(),
            Environment::Production
        );
        assert!(serde_json::from_str::<Environment>("\"sandbox\"").is_err());
        let mut production = profile();
        production.environment = Environment::Production;
        assert!(production.validate().is_err());
        production.next_number = Some(1);
        assert!(production.validate().is_ok());
        assert!(draft().validate(&production).is_err());
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
