//! One invitation carries the commercial order and the contract signing link.
//! Every value comes from the immutable contract snapshot, never the send request.
use serde_json::{Value, json};

use super::{api::ContractEmail, model};

/// Escape both Markdown and the provider's email-variable syntax. In particular,
/// product/customer text must never introduce another signing or document link.
fn literal(value: &str) -> String {
    let mut text = String::new();
    for character in value.chars() {
        match character {
            '&' => text.push_str("&amp;"),
            '<' => text.push_str("&lt;"),
            '>' => text.push_str("&gt;"),
            '{' => text.push_str("&#123;"),
            '}' => text.push_str("&#125;"),
            '\\' | '`' | '*' | '_' | '[' | ']' | '(' | ')' | '#' | '+' | '-' | '!' | '|' => {
                text.push('\\');
                text.push(character);
            }
            '\r' => {}
            character if character.is_control() && character != '\n' => text.push(' '),
            character => text.push(character),
        }
    }
    text
}

fn decimal(value: &Value, money: bool) -> String {
    let raw = value.as_str().unwrap_or("");
    let (integer, fraction) = raw.split_once('.').unwrap_or((raw, ""));
    let mut grouped = String::new();
    for (index, digit) in integer.chars().enumerate() {
        if index > 0 && (integer.len() - index).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    let fraction = if money {
        fraction
    } else {
        fraction.trim_end_matches('0')
    };
    if !fraction.is_empty() {
        grouped.push(',');
        grouped.push_str(fraction);
    }
    if money {
        format!("R$ {grouped}")
    } else {
        grouped
    }
}

fn due_date(snapshot: &Value) -> String {
    let raw = snapshot["order"]["dueDate"].as_str().unwrap_or("");
    match raw.split('-').collect::<Vec<_>>().as_slice() {
        [year, month, day] => format!("{day}/{month}/{year}"),
        _ => raw.to_owned(),
    }
}

fn contents(snapshot: &Value, fields: &Value, escape: bool) -> String {
    let text = |value: &str| {
        if escape {
            literal(value)
        } else {
            value.to_owned()
        }
    };
    let string = |value: &Value| text(value.as_str().unwrap_or(""));
    let mut sections = vec![
        format!("Pedido {}", model::order_number(snapshot)),
        format!("Empresa: {}", string(&snapshot["company"]["legalName"])),
        format!("Cliente: {}", string(&snapshot["customer"]["name"])),
        format!(
            "Documento do cliente: {}",
            string(&snapshot["customer"]["taxId"])
        ),
        "Itens do pedido:".into(),
    ];
    for item in snapshot["items"].as_array().into_iter().flatten() {
        sections.push(format!(
            "{} · {}\nQuantidade: {} {}\nUnitário: {} · Total: {}",
            string(&item["sku"]),
            string(&item["name"]),
            text(&decimal(&item["quantity"], false)),
            string(&item["unit"]),
            text(&decimal(&item["unitPrice"], true)),
            text(&decimal(&item["amount"], true)),
        ));
        for (key, label) in [
            ("structureColor", "Estrutura"),
            ("swingArmColor", "Braços"),
            ("plateHolderType", "Tipo de anilheiro"),
            ("upholsteryColor", "Estofado"),
        ] {
            if let Some(color) = item[key].as_str().filter(|value| !value.is_empty()) {
                sections.push(format!("{label}: {}", text(color)));
            }
        }
    }
    sections.push(format!(
        "Total do pedido: {}",
        text(&decimal(&snapshot["order"]["amount"], true))
    ));
    sections.push(format!("Vencimento: {}", text(&due_date(snapshot))));
    for (key, source, label) in [
        ("condicoes", "paymentTerms", "Condições comerciais"),
        ("entrega", "deliveryTerms", "Condições de entrega"),
        ("observacoes", "notes", "Observações comerciais"),
    ] {
        // Negotiated installments and accepted proposals remain authoritative
        // even when the PDF model does not declare the corresponding field.
        if let Some(value) = snapshot["commercialTerms"][source]
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                snapshot["proposal"][source]
                    .as_str()
                    .filter(|value| !value.trim().is_empty())
            })
            .or_else(|| {
                fields[key]
                    .as_str()
                    .filter(|value| !value.trim().is_empty())
            })
        {
            sections.push(format!("{label}: {}", text(value)));
        }
    }
    sections.join("\n\n")
}

pub fn preview(snapshot: &Value, fields: &Value) -> ContractEmail {
    ContractEmail {
        subject: format!(
            "Pedido {} e contrato para assinatura",
            model::order_number(snapshot)
        ),
        text: format!(
            "{}\n\nO e-mail inclui o link individual para revisar e assinar o contrato.",
            contents(snapshot, fields, false)
        ),
    }
}

pub fn invitation(snapshot: &Value, fields: &Value) -> Value {
    let preview = preview(snapshot, fields);
    json!({
        "send_email": true,
        "message": {
            "subject": preview.subject,
            "body": format!("Olá.\n\n{}\n\nRevise o pedido e o contrato antes de assinar.\n\n[Abrir contrato e assinar]({{submitter.link}})", contents(snapshot, fields, true)),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkout_invitation_preserves_installments_and_escapes_customer_terms() {
        let checkout = crate::domains::sales::checkout_document::fixture();
        let snapshot = json!({"order":{"number":"42","amount":"100.00","dueDate":"2027-01-01"},"company":{"legalName":"Empresa"},"customer":{"name":"Cliente"},"items":[],"proposal":null,"commercialTerms":crate::domains::sales::checkout_document::terms(&checkout)});
        let preview = preview(&snapshot, &json!({}));
        assert!(preview.text.contains("Parcela 2: R$ 14,99"));
        assert!(
            preview
                .text
                .contains("45 dias após o recebimento da entrada")
        );
        let invitation = invitation(&snapshot, &json!({}));
        let body = invitation["message"]["body"].as_str().unwrap();
        assert!(!body.contains("<script>"));
        assert!(!body.contains("<combinada>"));
        assert!(body.contains("Parcela 2: R$ 14,99"));
    }

    #[test]
    fn order_invitation_uses_commercial_snapshot_and_one_signing_link_without_internal_costs() {
        let snapshot = json!({
            "order":{"id":"internal-id","number":"42","amount":"123.45","dueDate":"2026-12-01"},
            "company":{"legalName":"Empresa"},"customer":{"name":"Cliente","taxId":"123"},
            "items":[{"sku":"SKU-1","name":"Produto {documents.link} [site](https://invalid.test) <b>","quantity":"2.000000","unit":"UN","unitPrice":"61.72","amount":"123.45","structureColor":"Azul","upholsteryColor":"Preto","cost":"SECRET_COST"}],
            "profit":"SECRET_PROFIT"
        });
        let fields = json!({"condicoes":"Entrada combinada","entrega":"Após confirmação"});
        let email = invitation(&snapshot, &fields);
        assert_eq!(
            email["message"]["subject"],
            "Pedido PV-000042 e contrato para assinatura"
        );
        let body = email["message"]["body"].as_str().unwrap();
        assert_eq!(body.matches("{submitter.link}").count(), 1);
        assert!(!body.contains("{documents.link}"));
        assert!(body.contains("&#123;documents.link&#125;"));
        assert!(!body.contains("[site](https://invalid.test)"));
        assert!(!body.contains("<b>"));
        assert!(body.contains("R$ 123,45"));
        assert!(body.contains("Quantidade: 2 UN"));
        assert!(body.contains("01/12/2026"));
        assert!(body.contains("Entrada combinada"));
        assert!(body.contains("Estrutura: Azul"));
        assert!(!body.contains("SECRET_"));
        assert!(!body.contains("internal-id"));
        assert!(
            preview(&snapshot, &fields)
                .text
                .contains("Produto {documents.link}")
        );
    }

    #[test]
    fn historical_snapshot_keeps_its_identifier_without_inventing_an_order_number() {
        let snapshot = json!({"order":{"id":"historical-id"}});
        assert_eq!(model::order_number(&snapshot), "historical-id");
        assert_eq!(decimal(&json!("1234567.89"), true), "R$ 1.234.567,89");
        assert_eq!(decimal(&json!("1000.250000"), false), "1.000,25");
    }

    #[test]
    fn accepted_proposal_terms_are_used_even_without_pdf_fields_and_escaped() {
        let snapshot = json!({"proposal":{"paymentTerms":"Entrada {submitter.link}","deliveryTerms":"Entrega <b>combinada</b>","notes":"Conferir [acesso](https://invalid.test)"}});
        let email = invitation(
            &snapshot,
            &json!({"condicoes":"Do not replace accepted terms"}),
        );
        let body = email["message"]["body"].as_str().unwrap();
        assert_eq!(body.matches("{submitter.link}").count(), 1);
        assert!(body.contains("Entrada &#123;submitter.link&#125;"));
        assert!(body.contains("Entrega &lt;b&gt;combinada&lt;/b&gt;"));
        assert!(!body.contains("[acesso](https://invalid.test)"));
        assert!(!body.contains("Do not replace"));
        let historical = invitation(
            &json!({}),
            &json!({"condicoes":"Manual historical terms","observacoes":"Historical notes"}),
        );
        assert!(
            historical["message"]["body"]
                .as_str()
                .unwrap()
                .contains("Manual historical terms")
        );
        assert!(
            historical["message"]["body"]
                .as_str()
                .unwrap()
                .contains("Historical notes")
        );
    }
}
