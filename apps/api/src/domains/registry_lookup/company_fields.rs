use super::parse::text;
use serde_json::Value;
use std::collections::BTreeMap;

/// Project only values that have an exact counterpart in company forms.
pub fn company_fields(
    ws: bool,
    value: &Value,
    record: &Value,
    fields: &mut BTreeMap<String, String>,
) {
    let simples = if ws {
        value.get("simples").is_some_and(|option| {
            text(option, "simples").is_some_and(|flag| flag.eq_ignore_ascii_case("sim"))
                && option
                    .get("data_exclusao_simples")
                    .is_none_or(Value::is_null)
        })
    } else {
        value.get("opcao_pelo_simples").and_then(Value::as_bool) == Some(true)
            && value
                .get("data_exclusao_do_simples")
                .is_none_or(Value::is_null)
    };
    if simples {
        fields.insert("taxRegime".into(), "simples".into());
    }
    if ws {
        if let Some(description) = record
            .get("atividade_principal")
            .and_then(|v| text(v, "descricao"))
        {
            fields.insert("activityDescription".into(), description);
        }
        if let Some(street) = fields.get_mut("street")
            && let Some(kind) = text(record, "tipo_logradouro")
        {
            *street = format!("{kind} {street}");
        }
    }
    let size = if ws {
        value.get("porte").and_then(|v| text(v, "id"))
    } else {
        value
            .get("codigo_porte")
            .and_then(Value::as_u64)
            .map(|v| format!("{v:02}"))
    };
    if let Some(size) = match size.as_deref() {
        Some("01") => Some("micro"),
        Some("03") => Some("pequena"),
        _ => None, // "Demais" does not distinguish medium and large companies.
    } {
        fields.insert("companySize".into(), size.into());
    }
    let phone = if ws {
        text(record, "telefone1")
            .and_then(|number| text(record, "ddd1").map(|ddd| format!("{ddd}{number}")))
    } else {
        text(record, "ddd_telefone_1")
    };
    if let Some(phone) = phone {
        let digits: String = phone.chars().filter(char::is_ascii_digit).collect();
        if (10..=11).contains(&digits.len()) {
            fields.insert("phone".into(), digits);
        }
    }
}
