use super::{model::*, parse};
use serde_json::json;

fn input(kind: LookupKind, value: &str) -> LookupInput {
    LookupInput {
        kind,
        value: value.into(),
        context: LookupContext::Party,
        state: None,
    }
}

#[test]
fn input_preserves_letters_and_rejects_cpf_or_hidden_cep_characters() {
    let mut cnpj = input(LookupKind::Cnpj, "12.abc.345/01de-35");
    cnpj.normalize().unwrap();
    assert_eq!(cnpj.value, "12ABC34501DE35");
    for raw in [
        "abc01001000",
        "01001--000",
        "01001/000",
        "01001 000",
        "01001💥000",
    ] {
        assert!(input(LookupKind::Cep, raw).normalize().is_err(), "{raw}");
    }
    assert!(input(LookupKind::Cnpj, "52998224725").normalize().is_err());
}

#[test]
fn cep_handles_generic_address_but_refuses_wrong_identity_or_malformed_success() {
    let value =
        json!({"cep":"01001-000","uf":"SP","localidade":"São Paulo","logradouro":"","bairro":""});
    let (data, _) = parse::parse("ViaCEP", LookupKind::Cep, "01001000", None, &value).unwrap();
    assert!(data.generic_postal_code);
    assert_eq!(data.fields["city"], "São Paulo");
    assert!(!data.fields.contains_key("street"));
    assert!(parse::parse("ViaCEP", LookupKind::Cep, "99999999", None, &value).is_none());
    for bad in [
        json!({"erro":true}),
        json!({"cep":"01001000","uf":"XX","localidade":"Cidade"}),
        json!({"cep":"01001000","uf":"SP","localidade":[]}),
        json!([]),
    ] {
        assert!(parse::parse("ViaCEP", LookupKind::Cep, "01001000", None, &bad).is_none());
    }
}

#[test]
fn cnpj_exposes_only_form_fields_and_never_infers_taxpayer_status() {
    let value = json!({"cnpj":"12ABC34501DE35","razao_social":"Empresa","uf":"SP","municipio":"São Paulo","cnae_fiscal":6201501,"qsa":[{"nome_socio":"Segredo","cnpj_cpf_do_socio":"123"}],"capital_social":100000});
    let (data, _) = parse::parse(
        "BrasilAPI",
        LookupKind::Cnpj,
        "12ABC34501DE35",
        None,
        &value,
    )
    .unwrap();
    let output = serde_json::to_string(&data).unwrap();
    assert!(!output.contains("Segredo"));
    assert!(!output.contains("capital_social"));
    assert_eq!(data.taxpayer_status, "unknown");
    assert_eq!(data.fields["cnae"], "6201501");
    assert!(data.state_registrations.is_empty());
}

#[test]
fn ie_is_filtered_by_state_and_keeps_source_status_separate_from_tax_treatment() {
    let value = json!({"razao_social":"Empresa","atualizado_em":"2026-10-01T00:00:00Z","estabelecimento":{"cnpj":"04252011000110","estado":{"sigla":"SP"},"inscricoes_estaduais":[{"inscricao_estadual":"110042490114","ativo":false,"estado":{"sigla":"SP"}},{"inscricao_estadual":"123456789","ativo":true,"estado":{"sigla":"MG"}}]}});
    let (data, date) = parse::parse(
        "CNPJ.ws",
        LookupKind::Ie,
        "04252011000110",
        Some("SP"),
        &value,
    )
    .unwrap();
    assert!(data.fields.is_empty());
    assert_eq!(date.as_deref(), Some("2026-10-01T00:00:00Z"));
    assert_eq!(data.state_registrations.len(), 1);
    assert_eq!(data.state_registrations[0].active, Some(false));
    assert_eq!(data.taxpayer_status, "unknown");
}
