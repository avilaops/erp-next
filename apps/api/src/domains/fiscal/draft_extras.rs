use super::model::{DraftInput, exact_decimal, state_code};
use crate::{domains::DomainError, platform::valid_document};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Default, Deserialize, Serialize, ToSchema)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Transport {
    pub carrier_tax_id: Option<String>,
    pub carrier_name: Option<String>,
    pub state_registration: Option<String>,
    pub address: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub plate: Option<String>,
    pub vehicle_state: Option<String>,
    pub rntc: Option<String>,
    pub volumes: Option<u32>,
    pub volume_kind: Option<String>,
    pub volume_number: Option<String>,
    pub brand: Option<String>,
    pub net_weight: Option<String>,
    pub gross_weight: Option<String>,
}

#[derive(Clone, Default, Deserialize, Serialize, ToSchema)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Retentions {
    pub pis: Option<String>,
    pub cofins: Option<String>,
    pub csll: Option<String>,
    pub income_tax_base: Option<String>,
    pub income_tax: Option<String>,
    pub social_security_base: Option<String>,
    pub social_security: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct XmlAccess {
    pub tax_id: String,
    pub name: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Intermediary {
    pub tax_id: String,
    pub registration: String,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Installment {
    pub number: String,
    pub due_date: String,
    pub amount: String,
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}
fn document(value: &str) -> bool {
    valid_document(
        value,
        if value.len() == 11 {
            "fisica"
        } else {
            "juridica"
        },
    )
}

pub fn validate(draft: &DraftInput) -> Result<(), DomainError> {
    if let Some(transport) = &draft.transport {
        if draft.freight_mode.as_deref().unwrap_or("9") == "9" {
            return Err(DomainError::Invalid(
                "Dados de transporte exigem modalidade de frete diferente de 9",
            ));
        }
        if transport
            .carrier_tax_id
            .as_ref()
            .is_some_and(|value| !document(value))
            || transport.carrier_tax_id.is_some() != transport.carrier_name.is_some()
            || [
                &transport.carrier_name,
                &transport.address,
                &transport.city,
                &transport.volume_kind,
                &transport.volume_number,
                &transport.brand,
            ]
            .into_iter()
            .any(|value| value.as_ref().is_some_and(|value| !valid_text(value, 60)))
            || [&transport.state, &transport.vehicle_state]
                .into_iter()
                .any(|value| {
                    value
                        .as_ref()
                        .is_some_and(|value| state_code(value).is_none())
                })
            || transport
                .state_registration
                .as_ref()
                .is_some_and(|value| !valid_text(value, 14) || transport.state.is_none())
            || transport.plate.as_ref().is_some_and(|value| {
                value.len() != 7
                    || !value
                        .bytes()
                        .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
            })
            || transport.vehicle_state.is_some() && transport.plate.is_none()
            || transport
                .rntc
                .as_ref()
                .is_some_and(|value| !valid_text(value, 20) || transport.plate.is_none())
        {
            return Err(DomainError::Invalid(
                "Confira documento, nome, UF, veiculo e volumes da transportadora",
            ));
        }
        let net = transport
            .net_weight
            .as_deref()
            .map(|value| exact_decimal(value, 12, 3))
            .transpose()?;
        let gross = transport
            .gross_weight
            .as_deref()
            .map(|value| exact_decimal(value, 12, 3))
            .transpose()?;
        if net.zip(gross).is_some_and(|(net, gross)| net > gross) {
            return Err(DomainError::Invalid(
                "Peso liquido nao pode superar o peso bruto",
            ));
        }
    }
    if let Some(retentions) = &draft.retentions {
        for value in [
            &retentions.pis,
            &retentions.cofins,
            &retentions.csll,
            &retentions.income_tax_base,
            &retentions.income_tax,
            &retentions.social_security_base,
            &retentions.social_security,
        ]
        .into_iter()
        .flatten()
        {
            exact_decimal(value, 13, 2)?;
        }
    }
    let mut documents = std::collections::HashSet::new();
    if draft.authorized_xml.len() > 10
        || draft.authorized_xml.iter().any(|entry| {
            !document(&entry.tax_id)
                || !documents.insert(&entry.tax_id)
                || entry
                    .name
                    .as_ref()
                    .is_some_and(|name| !valid_text(name, 200))
        })
    {
        return Err(DomainError::Invalid(
            "Informe ate 10 CPF/CNPJ distintos para acesso ao XML",
        ));
    }
    if let Some(intermediary) = &draft.intermediary
        && (!valid_document(&intermediary.tax_id, "juridica")
            || !valid_text(&intermediary.registration, 60)
            || ![2, 3, 4, 9].contains(&draft.presence_indicator.unwrap_or(9)))
    {
        return Err(DomainError::Invalid(
            "Intermediador exige CNPJ, cadastro e operacao nao presencial",
        ));
    }
    if draft
        .tax_authority_information
        .as_ref()
        .is_some_and(|value| !valid_text(value, 2000))
        || draft
            .payment_terms
            .as_ref()
            .is_some_and(|value| !valid_text(value, 200))
    {
        return Err(DomainError::Invalid(
            "Confira informacoes fiscais e condicao de pagamento",
        ));
    }
    if draft.installments.len() > 120 || draft.model == 65 && !draft.installments.is_empty() {
        return Err(DomainError::Invalid(
            "Parcelas exigem NF-e modelo 55 e limite de 120 parcelas",
        ));
    }
    let mut numbers = std::collections::HashSet::new();
    for installment in &draft.installments {
        if installment.number.len() != 3
            || !installment.number.bytes().all(|byte| byte.is_ascii_digit())
            || !numbers.insert(&installment.number)
            || time::Date::parse(
                &installment.due_date,
                &time::format_description::parse_borrowed::<2>("[year]-[month]-[day]")
                    .expect("static date format"),
            )
            .is_err()
            || exact_decimal(&installment.amount, 13, 2)? <= 0
        {
            return Err(DomainError::Invalid(
                "Confira numero, vencimento e valor positivo de cada parcela",
            ));
        }
    }
    Ok(())
}
