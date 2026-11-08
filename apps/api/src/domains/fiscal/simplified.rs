//! Domestic retail eligibility for DANFE Simplificado Tipo 2 (NT 2026.002 v1.11).
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::model::{DraftInput, ProfileInput, exact_decimal};
use crate::domains::DomainError;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SimplifiedDanfe {
    pub qr_code_url: String,
    pub access_key_url: String,
}

fn official_url(value: &str) -> bool {
    if value.is_empty()
        || value.chars().count() > 300
        || value.chars().any(char::is_control)
        || value.trim() != value
    {
        return false;
    }
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url
            .host_str()
            .is_some_and(|host| host == "gov.br" || host.ends_with(".gov.br"))
}

/// Additional checks only; the draft's ordinary arithmetic/tax checks remain required.
pub fn validate(draft: &DraftInput, profile: &ProfileInput) -> Result<(), DomainError> {
    if draft.print_type != Some(6) {
        return if draft.simplified_danfe.is_some() {
            Err(DomainError::Invalid(
                "Endereços do DANFE Simplificado Tipo 2 exigem tipo de impressão 6",
            ))
        } else {
            Ok(())
        };
    }
    let endpoints = draft.simplified_danfe.as_ref().ok_or(DomainError::Invalid(
        "Informe as URLs oficiais da UF para consulta por QR Code e chave do DANFE Simplificado Tipo 2",
    ))?;
    if !official_url(&endpoints.qr_code_url) || !official_url(&endpoints.access_key_url) {
        return Err(DomainError::Invalid(
            "URLs do DANFE Simplificado Tipo 2 exigem HTTPS, domínio gov.br e até 300 caracteres, sem credenciais, consulta ou fragmento",
        ));
    }
    let final_consumer = draft.final_consumer.or_else(|| {
        draft
            .tax_declaration
            .as_ref()
            .map(|taxes| taxes.final_consumer)
    });
    if draft.model != 55
        || draft.purpose != 1
        || final_consumer != Some(true)
        || !draft
            .presence_indicator
            .is_some_and(|presence| [1, 4, 5].contains(&presence))
        || draft.recipient.state != profile.state
        || draft.exportation.is_some()
        || draft.departure_at.is_some()
        || !draft.referenced_access_keys.is_empty()
        || draft.return_direction.is_some()
        || draft.source_return_id.is_some()
        || draft.source_return_kind.is_some()
    {
        return Err(DomainError::Invalid(
            "DANFE Simplificado Tipo 2 exige NF-e 55 de venda interna normal a consumidor final, presença 1, 4 ou 5, sem exportação, devolução, data de saída ou referência fiscal",
        ));
    }
    if !draft.installments.is_empty() {
        return Err(DomainError::Invalid(
            "DANFE Simplificado Tipo 2 não permite fatura ou duplicatas",
        ));
    }
    if draft.freight_mode.as_deref().unwrap_or("9") != "9" && draft.presence_indicator != Some(4)
        || draft.transport.as_ref().is_some_and(|transport| {
            transport.plate.is_some()
                || transport.vehicle_state.is_some()
                || transport.rntc.is_some()
        })
    {
        return Err(DomainError::Invalid(
            "DANFE Simplificado Tipo 2 admite frete somente na entrega a domicílio e não permite dados de veículo de transporte",
        ));
    }
    if let Some(taxes) = &draft.tax_declaration
        && (!taxes.final_consumer
            || taxes.ipi_cst.is_some()
            || taxes
                .ipi_rate
                .as_deref()
                .map(|rate| exact_decimal(rate, 2, 4))
                .transpose()?
                .is_some_and(|rate| rate != 0)
            || taxes.destination_icms_rate.is_some()
            || taxes.destination_fcp_rate.is_some())
    {
        return Err(DomainError::Invalid(
            "DANFE Simplificado Tipo 2 não permite grupo de IPI ou ICMS da UF de destino e exige consumidor final",
        ));
    }
    let allowed = [
        "5101", "5102", "5103", "5104", "5115", "5405", "5656", "5667", "5910", "5933",
    ];
    let mut invoice_total = 0_i128;
    for item in &draft.items {
        let sp_exception =
            profile.state == "SP" && item.cfop == "5949" && item.icms_cst.as_deref() == Some("40");
        if !allowed.contains(&item.cfop.as_str()) && !sp_exception {
            return Err(DomainError::Invalid(
                "CFOP não permitido no DANFE Simplificado Tipo 2; em SP, 5949 exige CST ICMS 40",
            ));
        }
        invoice_total =
            invoice_total
                .checked_add(item.commercial_total()?)
                .ok_or(DomainError::Invalid(
                    "Total do DANFE Simplificado Tipo 2 excede o limite",
                ))?;
    }
    // Conservative application limit until a UF-specific configured limit is supported.
    if invoice_total > 20_000_000 {
        return Err(DomainError::Invalid(
            "Valor total do DANFE Simplificado Tipo 2 excede o limite de R$ 200.000,00",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile() -> ProfileInput {
        serde_json::from_value(serde_json::json!({"environment":"homologation","state":"SP","municipalityCode":"3550308","stateRegistration":"110042490114","crt":1,"series":1})).unwrap()
    }
    fn draft() -> DraftInput {
        serde_json::from_value(serde_json::json!({"environment":"homologation","model":55,"purpose":1,"printType":6,"finalConsumer":true,"presenceIndicator":1,"simplifiedDanfe":{"qrCodeUrl":"https://teste.sefaz.gov.br/nfe/qrcode","accessKeyUrl":"https://teste.sefaz.gov.br/nfe/consulta"},"operationNature":"Venda","taxRuleReference":"teste","recipient":{"taxId":"52998224725","legalName":"Destinatário fictício","state":"SP","municipalityCode":"3550308","postalCode":"01001000","street":"Rua de teste","number":"1","district":"Centro"},"items":[{"code":"TESTE","description":"Produto fictício","unit":"UN","ncm":"95069100","cfop":"5102","quantity":"1.0000","unitPrice":"100.0000000000","grossTotal":"100.00","origin":0,"icmsCst":null,"csosn":"102","pisCst":"07","cofinsCst":"07"}],"productsTotal":"100.00"})).unwrap()
    }
    #[test]
    fn official_endpoints_reject_credentials_host_confusion_and_query() {
        assert!(official_url("https://teste.sefaz.gov.br/nfe/qrcode"));
        for value in [
            "http://teste.sefaz.gov.br",
            "https://gov.br.example.com",
            "https://user@teste.sefaz.gov.br",
            "https://teste.sefaz.gov.br?p=1",
            "https://teste.sefaz.gov.br#fragment",
            "file:///tmp/teste",
        ] {
            assert!(!official_url(value));
        }
    }
    #[test]
    fn internal_retail_and_domestic_delivery_are_eligible() {
        let mut value = draft();
        assert!(validate(&value, &profile()).is_ok());
        value.presence_indicator = Some(4);
        value.freight_mode = Some("0".into());
        assert!(validate(&value, &profile()).is_ok());
        value.presence_indicator = Some(1);
        assert!(validate(&value, &profile()).is_err());
    }
    #[test]
    fn rejects_other_modes_references_interstate_and_nonfinal_sale() {
        let value = draft();
        let mut invalid = value.clone();
        invalid.model = 65;
        assert!(validate(&invalid, &profile()).is_err());
        let mut invalid = value.clone();
        invalid.print_type = Some(1);
        assert!(validate(&invalid, &profile()).is_err());
        let mut invalid = value.clone();
        invalid.final_consumer = Some(false);
        assert!(validate(&invalid, &profile()).is_err());
        let mut invalid = value.clone();
        invalid.presence_indicator = Some(9);
        assert!(validate(&invalid, &profile()).is_err());
        let mut invalid = value.clone();
        invalid.recipient.state = "RJ".into();
        assert!(validate(&invalid, &profile()).is_err());
        let mut invalid = value;
        invalid.referenced_access_keys.push("teste".into());
        assert!(validate(&invalid, &profile()).is_err());
    }
    #[test]
    fn whitelist_sp_exception_and_exact_invoice_limit() {
        let mut value = draft();
        value.items[0].cfop = "5949".into();
        assert!(validate(&value, &profile()).is_err());
        value.items[0].icms_cst = Some("40".into());
        assert!(validate(&value, &profile()).is_ok());
        value.items[0].gross_total = "200000.00".into();
        assert!(validate(&value, &profile()).is_ok());
        value.items[0].other_amount = Some("0.01".into());
        assert!(validate(&value, &profile()).is_err());
    }
}
