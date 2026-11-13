use super::{model::*, parse};
use serde_json::{Value, json};

#[test]
fn cnpj_registration_status_is_preserved_from_both_providers() {
    for (code, label) in [
        (1, "NULA"),
        (2, "ATIVA"),
        (3, "SUSPENSA"),
        (4, "INAPTA"),
        (8, "BAIXADA"),
    ] {
        let brasil = json!({"cnpj":"04252011000110","razao_social":"Empresa sintética","situacao_cadastral":code,"descricao_situacao_cadastral":label,"data_situacao_cadastral":"2026-04-15","descricao_motivo_situacao_cadastral":"Motivo informado pela fonte"});
        let ws = json!({"razao_social":"Empresa sintética","estabelecimento":{"cnpj":"04252011000110","situacao_cadastral":label,"data_situacao_cadastral":"2026-04-15","motivo_situacao_cadastral":{"descricao":"Motivo informado pela fonte"}}});
        for (provider, value) in [("BrasilAPI", brasil), ("CNPJ.ws", ws)] {
            let (data, _) =
                parse::parse(provider, LookupKind::Cnpj, "04252011000110", None, &value).unwrap();
            assert_eq!(
                data.fields.get("registrationStatusCode"),
                Some(&code.to_string()),
                "{provider}"
            );
            assert_eq!(
                data.fields.get("registrationStatus").map(String::as_str),
                Some(label)
            );
            assert_eq!(
                data.fields
                    .get("registrationStatusDate")
                    .map(String::as_str),
                Some("2026-04-15")
            );
            assert_eq!(
                data.fields
                    .get("registrationStatusReason")
                    .map(String::as_str),
                Some("Motivo informado pela fonte")
            );
        }
    }
}

#[test]
fn missing_or_conflicting_registration_status_never_implies_an_active_company() {
    for extra in [
        json!({}),
        json!({"situacao_cadastral":99}),
        json!({"situacao_cadastral":2,"descricao_situacao_cadastral":"BAIXADA"}),
        json!({"situacao_cadastral":2,"descricao_situacao_cadastral":{"invalid":true}}),
    ] {
        let mut value = json!({"cnpj":"04252011000110","razao_social":"Empresa sintética"});
        value
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let (data, _) = parse::parse(
            "BrasilAPI",
            LookupKind::Cnpj,
            "04252011000110",
            None,
            &value,
        )
        .unwrap();
        assert_eq!(
            data.fields
                .get("registrationStatusCode")
                .map(String::as_str),
            Some("unknown")
        );
        assert_eq!(
            data.fields.get("registrationStatus").map(String::as_str),
            Some("Não confirmada")
        );
        assert!(!data.fields.contains_key("status"));
        assert_eq!(data.fields["legalName"], "Empresa sintética");
    }
    let cep = json!({"cep":"01001-000","uf":"SP","localidade":"São Paulo","situacao_cadastral":8});
    let (data, _) = parse::parse("ViaCEP", LookupKind::Cep, "01001000", None, &cep).unwrap();
    assert!(!data.fields.contains_key("registrationStatus"));
}

fn input(kind: LookupKind, value: &str) -> LookupInput {
    LookupInput {
        kind,
        value: value.into(),
        context: LookupContext::Party,
        state: None,
    }
}

#[test]
fn registration_warning_and_date_do_not_invent_source_facts() {
    for date in ["2026-02-30", "15/04/2026", "2026-04-15T00:00:00Z"] {
        let value = json!({"cnpj":"04252011000110","razao_social":"Empresa sintética","situacao_cadastral":"08","data_situacao_cadastral":date});
        let (data, _) = parse::parse(
            "BrasilAPI",
            LookupKind::Cnpj,
            "04252011000110",
            None,
            &value,
        )
        .unwrap();
        assert_eq!(data.fields["registrationStatus"], "BAIXADA");
        assert!(!data.fields.contains_key("registrationStatusDate"));
        assert!(!data.fields.contains_key("registrationStatusReason"));
        assert!(
            super::registration_status::warning(&data.fields)
                .unwrap()
                .contains("BAIXADA")
        );
    }
    let value =
        json!({"cnpj":"04252011000110","razao_social":"Empresa sintética","situacao_cadastral":2});
    let (data, _) = parse::parse(
        "BrasilAPI",
        LookupKind::Cnpj,
        "04252011000110",
        None,
        &value,
    )
    .unwrap();
    assert!(super::registration_status::warning(&data.fields).is_none());
    assert!(
        super::registration_status::warning(&Default::default())
            .unwrap()
            .contains("não confirmada")
    );
}

#[test]
fn municipality_codes_come_from_provider_ibge_fields_as_strings_or_integers() {
    for code in [json!("3550308"), json!(3550308)] {
        let via = json!({"cep":"01001-000","uf":"SP","localidade":"São Paulo","ibge":code});
        let (data, _) = parse::parse("ViaCEP", LookupKind::Cep, "01001000", None, &via).unwrap();
        assert_eq!(
            data.fields.get("municipalityCode").map(String::as_str),
            Some("3550308")
        );
        let brasil = json!({"cnpj":"04252011000110","razao_social":"Empresa","uf":"SP","municipio":"São Paulo","codigo_municipio":7107,"codigo_municipio_ibge":code});
        let (data, _) = parse::parse(
            "BrasilAPI",
            LookupKind::Cnpj,
            "04252011000110",
            None,
            &brasil,
        )
        .unwrap();
        assert_eq!(
            data.fields.get("municipalityCode").map(String::as_str),
            Some("3550308")
        );
        let ws = json!({"razao_social":"Empresa","estabelecimento":{"cnpj":"04252011000110","estado":{"sigla":"SP"},"cidade":{"nome":"São Paulo","id":123,"ibge_id":code}}});
        let (data, _) =
            parse::parse("CNPJ.ws", LookupKind::Cnpj, "04252011000110", None, &ws).unwrap();
        assert_eq!(
            data.fields.get("municipalityCode").map(String::as_str),
            Some("3550308")
        );
    }
}

#[test]
fn missing_invalid_or_wrong_state_ibge_never_breaks_address_or_invents_a_code() {
    for code in [
        Value::Null,
        json!(""),
        json!("3304557"),
        json!("355030"),
        json!("35503088"),
        json!("35A0308"),
        json!(3550308.5),
        json!({"id":3550308}),
    ] {
        let via = json!({"cep":"01001-000","uf":"SP","localidade":"São Paulo","ibge":code});
        let (data, _) = parse::parse("ViaCEP", LookupKind::Cep, "01001000", None, &via).unwrap();
        assert!(!data.fields.contains_key("municipalityCode"), "{code}");
        assert_eq!(data.fields["city"], "São Paulo");
        let brasil = json!({"cnpj":"04252011000110","razao_social":"Empresa","uf":"SP","municipio":"São Paulo","codigo_municipio":7107,"codigo_municipio_ibge":code});
        let (data, _) = parse::parse(
            "BrasilAPI",
            LookupKind::Cnpj,
            "04252011000110",
            None,
            &brasil,
        )
        .unwrap();
        assert!(!data.fields.contains_key("municipalityCode"), "{code}");
        let ws = json!({"razao_social":"Empresa","estabelecimento":{"cnpj":"04252011000110","estado":{"sigla":"SP"},"cidade":{"nome":"São Paulo","id":3550308,"ibge_id":code}}});
        let (data, _) =
            parse::parse("CNPJ.ws", LookupKind::Cnpj, "04252011000110", None, &ws).unwrap();
        assert!(!data.fields.contains_key("municipalityCode"), "{code}");
    }
    let brasil_cep = json!({"cep":"01001000","state":"SP","city":"São Paulo","ibge":"3550308"});
    let (data, _) =
        parse::parse("BrasilAPI", LookupKind::Cep, "01001000", None, &brasil_cep).unwrap();
    assert!(!data.fields.contains_key("municipalityCode"));
    let no_state =
        json!({"cnpj":"04252011000110","razao_social":"Empresa","codigo_municipio_ibge":3550308});
    let (data, _) = parse::parse(
        "BrasilAPI",
        LookupKind::Cnpj,
        "04252011000110",
        None,
        &no_state,
    )
    .unwrap();
    assert!(!data.fields.contains_key("municipalityCode"));
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
fn cnpj_projects_contacts_activity_and_exact_size_without_guessing_tax_choices() {
    let value = json!({"cnpj":"04252011000110","razao_social":"Empresa","codigo_porte":1,"ddd_telefone_1":"1133334444","email":"empresa@example.test","cnae_fiscal_descricao":"Atividade declarada","opcao_pelo_simples":false});
    let (data, _) = parse::parse(
        "BrasilAPI",
        LookupKind::Cnpj,
        "04252011000110",
        None,
        &value,
    )
    .unwrap();
    assert_eq!(data.fields["companySize"], "micro");
    assert_eq!(data.fields["email"], "empresa@example.test");
    assert_eq!(data.fields["phone"], "1133334444");
    assert_eq!(data.fields["activityDescription"], "Atividade declarada");
    assert!(!data.fields.contains_key("taxRegime"));
    assert!(!data.fields.contains_key("segments"));
    let value = json!({"razao_social":"Empresa","porte":{"id":"05"},"estabelecimento":{"cnpj":"04252011000110","tipo_logradouro":"RUA","logradouro":"EXEMPLO","ddd1":"11","telefone1":"33334444","email":"contato@example.test","atividade_principal":{"id":"6201501","descricao":"Atividade da fonte"}}});
    let (data, _) =
        parse::parse("CNPJ.ws", LookupKind::Cnpj, "04252011000110", None, &value).unwrap();
    assert_eq!(data.fields["street"], "RUA EXEMPLO");
    assert_eq!(data.fields["phone"], "1133334444");
    assert_eq!(data.fields["activityDescription"], "Atividade da fonte");
    assert!(!data.fields.contains_key("companySize"));
}

#[test]
fn simples_requires_an_explicit_positive_option_without_an_exclusion() {
    for (option, exclusion, expected) in [
        (Some(true), None, true),
        (Some(false), None, false),
        (None, None, false),
        (Some(true), Some("2026-01-01"), false),
    ] {
        let value = json!({"cnpj":"04252011000110","razao_social":"Empresa","opcao_pelo_simples":option,"data_exclusao_do_simples":exclusion});
        let (data, _) = parse::parse(
            "BrasilAPI",
            LookupKind::Cnpj,
            "04252011000110",
            None,
            &value,
        )
        .unwrap();
        assert_eq!(
            data.fields.get("taxRegime").map(String::as_str),
            expected.then_some("simples")
        );
    }
    let value = json!({"razao_social":"Empresa","simples":{"simples":"Sim","data_exclusao_simples":null},"estabelecimento":{"cnpj":"04252011000110"}});
    let (data, _) =
        parse::parse("CNPJ.ws", LookupKind::Cnpj, "04252011000110", None, &value).unwrap();
    assert_eq!(data.fields["taxRegime"], "simples");
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
