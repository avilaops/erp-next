use super::*;

fn template() -> Value {
    let definition: Value =
        serde_json::from_str(include_str!("ludus-template.fixture.json")).unwrap();
    let roles: Vec<_> = definition["roles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|role| json!({"name":role,"uuid":role}))
        .collect();
    let fields: Vec<_> = definition["fields"].as_array().unwrap().iter().map(|field| json!({"name":field["name"],"type":field["kind"],"required":field["required"],"submitter_uuid":field["role"]})).collect();
    json!({"id":42,"updated_at":"reviewed","submitters":roles,"fields":fields})
}

fn snapshot(count: usize) -> Value {
    let items: Vec<_> = (0..count).map(|_| json!({"sku":"AC-1","name":"Equipamento","quantity":"2.500000","unit":"UN","unitPrice":"40.00","amount":"100.00","structureColor":"Branco"})).collect();
    json!({"order":{"id":Uuid::nil(),"number":"42","revision":1,"status":"confirmed","amount":format!("{count}00.00"),"dueDate":"2027-01-01"},"company":{"legalName":"Fornecedor","taxId":"documento"},"customer":{"name":"Cliente","taxId":"documento","email":"cliente@example.test","phone":"11999999999","addresses":[{"street":"Errada","primary":false},{"street":"Rua correta","number":"12","complement":"Sala 3","district":"Centro","city":"São Paulo","state":"SP","postalCode":"01000000","primary":true}]},"items":items})
}

fn input(template: &Value) -> Generate {
    let fields = editable_fields(template)
        .into_iter()
        .filter(|f| f["required"] == true)
        .map(|f| {
            let name = f["name"].as_str().unwrap().to_owned();
            let value = match name.as_str() {
                "Data do contrato — dia" => "13",
                "Data do contrato — mês" => "novembro",
                "Data do contrato — ano (dois últimos dígitos)" => "26",
                "Valor acordado de entrada (R$)" => "0,00",
                "Valor remanescente (R$)" => "100,00",
                _ => "Conferido",
            };
            (name, value.to_owned())
        })
        .collect();
    let recipients = template["submitters"]
        .as_array()
        .unwrap()
        .iter()
        .map(|role| Recipient {
            name: "Pessoa de teste".into(),
            email: format!("p{}@example.test", role["name"].as_str().unwrap().len()),
            role: role["name"].as_str().unwrap().into(),
        })
        .collect();
    Generate {
        order_id: Uuid::nil(),
        order_revision: 1,
        template_id: 42,
        template_updated_at: "reviewed".into(),
        recipients,
        fields,
    }
}

#[test]
fn ludus_uses_primary_address_phone_indexed_items_and_server_owned_exact_currency() {
    let template = template();
    let mut input = input(&template);
    input
        .fields
        .insert("Produto 1 — preço unitário".into(), "0,01".into());
    input.fields.insert(
        "Compradora — endereço — bairro".into(),
        "Outra cidade".into(),
    );
    validate(&mut input, &template, &snapshot(1)).unwrap();
    for (name, want) in [
        (
            "Compradora — endereço — logradouro e número",
            "Rua correta, 12, Sala 3",
        ),
        ("Compradora — endereço — bairro", "Centro"),
        ("Compradora — endereço — CEP", "01000000"),
        ("Compradora — endereço — cidade / UF", "São Paulo / SP"),
        ("Telefone / WhatsApp da compradora", "11999999999"),
        ("Produto 1 — código / modelo", "AC-1"),
        ("Produto 1 — descrição", "Equipamento · Estrutura: Branco"),
        ("Produto 1 — quantidade", "2,5 UN"),
        ("Produto 1 — preço unitário", "40,00"),
        ("Produto 1 — preço total", "100,00"),
        ("pedido_total", "100,00"),
        ("Pedido — subtotal dos produtos", "100,00"),
        ("Pedido — descontos / acréscimos", "0,00"),
    ] {
        assert_eq!(
            input.fields.get(name).map(String::as_str),
            Some(want),
            "{name}"
        );
    }
    assert!(
        !input
            .fields
            .contains_key("Compradora — natureza — Pessoa jurídica")
    );
    assert!(
        !input
            .fields
            .contains_key("Garantia — ESTRUTURA — prazo / condição adicional")
    );
}

#[test]
fn ludus_accepts_one_and_five_products_and_rejects_six_instead_of_truncating() {
    let template = template();
    for count in [1, 5] {
        let mut request = input(&template);
        validate(&mut request, &template, &snapshot(count)).unwrap();
        assert_eq!(
            request.fields[&format!("Produto {count} — preço total")],
            "100,00"
        );
    }
    let mut request = input(&template);
    assert!(matches!(
        validate(&mut request, &template, &snapshot(6)),
        Err(DomainError::Conflict(_))
    ));
}

#[test]
fn structured_quantities_preserve_whole_integer_zeros_and_only_trim_fractional_zeros() {
    let template = template();
    for (raw, expected) in [
        ("10", "10 UN"),
        ("100", "100 UN"),
        ("10.000000", "10 UN"),
        ("0.500000", "0,5 UN"),
    ] {
        let mut state = snapshot(1);
        state["items"][0]["quantity"] = json!(raw);
        let mut request = input(&template);
        validate(&mut request, &template, &state).unwrap();
        assert_eq!(request.fields["Produto 1 — quantidade"], expected);
    }
}

#[test]
fn structured_description_ignores_historical_holder_color_and_preserves_holder_type() {
    let template = template();
    for kind in ["Standard", "Olímpico", "Não se aplica"] {
        let mut state = snapshot(1);
        state["items"][0]["plateHolderColor"] = json!("Cor histórica desconsiderada");
        state["items"][0]["plateHolderType"] = json!(kind);
        let mut request = input(&template);
        validate(&mut request, &template, &state).unwrap();
        assert_eq!(
            request.fields["Produto 1 — descrição"],
            format!("Equipamento · Estrutura: Branco · Tipo de anilheiro: {kind}")
        );
        assert_eq!(
            state["items"][0]["plateHolderColor"],
            "Cor histórica desconsiderada"
        );
    }
}

#[test]
fn ludus_cannot_inject_products_into_empty_rows() {
    let template = template();
    let mut request = input(&template);
    request
        .fields
        .insert("Produto 5 — descrição".into(), "Item inventado".into());
    validate(&mut request, &template, &snapshot(1)).unwrap();
    assert_eq!(
        request
            .fields
            .get("Produto 5 — descrição")
            .map(String::as_str),
        Some("")
    );
}

#[test]
fn ludus_negotiated_entry_and_balance_never_follow_actual_receipts() {
    let template = template();
    let mut state = snapshot(1);
    apply_checkout(
        &mut state,
        &crate::domains::sales::checkout_document::fixture(),
    );
    state["finance"] = json!({"receivedAmount":"95.00","outstandingAmount":"5.00"});
    let mut request = input(&template);
    validate(&mut request, &template, &state).unwrap();
    assert_eq!(
        request
            .fields
            .get("Valor acordado de entrada (R$)")
            .map(String::as_str),
        Some("70,01")
    );
    assert_eq!(
        request
            .fields
            .get("Valor remanescente (R$)")
            .map(String::as_str),
        Some("29,99")
    );
    assert_eq!(
        request
            .fields
            .get("Telefone / WhatsApp da compradora")
            .map(String::as_str),
        Some("11999999999")
    );
    assert!(!request.fields.contains_key("Saldo — data de vencimento"));
}

#[test]
fn ludus_currency_preserves_large_exact_cents_and_rejects_malformed_manual_money() {
    let template = template();
    let mut state = snapshot(1);
    state["order"]["amount"] = json!("999999999999.99");
    state["items"][0]["unitPrice"] = json!("999999999999.99");
    state["items"][0]["amount"] = json!("999999999999.99");
    let mut request = input(&template);
    validate(&mut request, &template, &state).unwrap();
    assert_eq!(
        request.fields.get("pedido_total").map(String::as_str),
        Some("999.999.999.999,99")
    );
    for bad in ["1.00", "R$ 1,00", "1,1", "-1,00", "1e3", "NaN", "1.00,00"] {
        let mut request = input(&template);
        request
            .fields
            .insert("Logística — VALOR DO FRETE".into(), bad.into());
        assert!(
            validate(&mut request, &template, &snapshot(1)).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn ludus_rejects_multiple_marks_arbitrary_mark_values_and_impossible_dates() {
    let template = template();
    for (a, b) in [
        (
            "Compradora — natureza — Pessoa física",
            "Compradora — natureza — Pessoa jurídica",
        ),
        (
            "Pagamento — condição — À vista",
            "Pagamento — condição — 02 parcelas",
        ),
        (
            "Disponibilidade 1 — origem — Nacional",
            "Disponibilidade 1 — origem — Importado",
        ),
        (
            "Frete — modalidade — Retirada",
            "Frete — modalidade — Outra",
        ),
    ] {
        let mut request = input(&template);
        request.fields.insert(a.into(), "X".into());
        request.fields.insert(b.into(), "X".into());
        assert!(
            validate(&mut request, &template, &snapshot(1)).is_err(),
            "{a}"
        );
    }
    let mut request = input(&template);
    request
        .fields
        .insert("Reserva de domínio — Sim".into(), "sim".into());
    assert!(validate(&mut request, &template, &snapshot(1)).is_err());
    let mut request = input(&template);
    request
        .fields
        .insert("Data do contrato — dia".into(), "31".into());
    request
        .fields
        .insert("Data do contrato — mês".into(), "fevereiro".into());
    assert!(validate(&mut request, &template, &snapshot(1)).is_err());
    let mut request = input(&template);
    request
        .fields
        .insert("Pedido — data de emissão — dia".into(), "13".into());
    assert!(validate(&mut request, &template, &snapshot(1)).is_err());

    for bad in ["31/02/2027", "01/01/abcd", "01/01/0000", "2027-01-01"] {
        let mut request = input(&template);
        request
            .fields
            .insert("Saldo — data de vencimento".into(), bad.into());
        assert!(
            validate(&mut request, &template, &snapshot(1)).is_err(),
            "{bad}"
        );
    }
    let mut leap = input(&template);
    leap.fields
        .insert("Data do contrato — dia".into(), "29".into());
    leap.fields
        .insert("Data do contrato — mês".into(), "fevereiro".into());
    leap.fields.insert(
        "Data do contrato — ano (dois últimos dígitos)".into(),
        "28".into(),
    );
    leap.fields
        .insert("Saldo — data de vencimento".into(), "29/02/2028".into());
    validate(&mut leap, &template, &snapshot(1)).unwrap();
}

#[test]
fn full_ludus_editable_payload_exceeds_old_limit_and_remains_server_locked() {
    let template = template();
    let mut request = input(&template);
    for field in editable_fields(&template) {
        request
            .fields
            .entry(field["name"].as_str().unwrap().into())
            .or_default();
    }
    assert_eq!(request.fields.len(), 142);
    validate(&mut request, &template, &snapshot(1)).unwrap();
    assert_eq!(request.fields["pedido_total"], "100,00");
    assert_eq!(request.fields["Produto 5 — descrição"], "");
}

#[test]
fn inconsistent_negotiated_schedule_and_invalid_source_money_are_explicit_conflicts() {
    let template = template();
    let mut state = snapshot(1);
    apply_checkout(
        &mut state,
        &crate::domains::sales::checkout_document::fixture(),
    );
    state["negotiatedPayments"]["entryAmountCents"] = json!(1);
    assert!(matches!(
        validate(&mut input(&template), &template, &state),
        Err(DomainError::Conflict(_))
    ));
    let mut state = snapshot(1);
    state["items"][0]["unitPrice"] = json!(0.1);
    assert!(matches!(
        validate(&mut input(&template), &template, &state),
        Err(DomainError::Conflict(_))
    ));
}

#[test]
fn legacy_template_and_decimal_defaults_stay_unchanged_with_many_order_items() {
    let template = json!({"updated_at":"reviewed","submitters":[{"name":"Compradora","uuid":"Compradora"}],"fields":[{"name":"pedido_total","type":"text","required":true,"submitter_uuid":"Compradora"},{"name":"itens","type":"text","required":true,"submitter_uuid":"Compradora"},{"name":"condicoes","type":"text","required":false,"submitter_uuid":"Compradora"}]});
    let mut request = input(&template);
    request
        .fields
        .insert("condicoes".into(), "Livre no modelo antigo".into());
    validate(&mut request, &template, &snapshot(6)).unwrap();
    assert_eq!(request.fields["pedido_total"], "600.00");
    assert_eq!(request.fields["itens"].lines().count(), 6);
    assert_eq!(request.fields["condicoes"], "Livre no modelo antigo");
}
