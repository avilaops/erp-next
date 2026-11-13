use std::collections::BTreeMap;

use serde_json::Value;

use super::parse::text;

const STATUSES: [(u64, &str); 5] = [
    (1, "NULA"),
    (2, "ATIVA"),
    (3, "SUSPENSA"),
    (4, "INAPTA"),
    (8, "BAIXADA"),
];

/// The source's registration status is independent of the ERP record's status.
pub fn fields(ws: bool, record: &Value, fields: &mut BTreeMap<String, String>) {
    let raw = record.get("situacao_cadastral").filter(|v| !v.is_null());
    let description_key = if ws {
        "situacao_cadastral"
    } else {
        "descricao_situacao_cadastral"
    };
    let description = text(record, description_key).map(|s| s.to_uppercase());
    let malformed_description =
        record.get(description_key).is_some_and(|v| !v.is_null()) && description.is_none();
    let code = if malformed_description {
        None
    } else if ws {
        description.as_deref().and_then(|s| {
            STATUSES
                .iter()
                .find(|(_, label)| *label == s)
                .map(|(code, _)| *code)
        })
    } else {
        let numeric = raw.and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str()?.trim().parse().ok())
        });
        match numeric {
            Some(code) => STATUSES
                .iter()
                .find(|(known, label)| {
                    *known == code && description.as_deref().is_none_or(|s| s == *label)
                })
                .map(|(code, _)| *code),
            None if raw.is_none() => description.as_deref().and_then(|s| {
                STATUSES
                    .iter()
                    .find(|(_, label)| *label == s)
                    .map(|(code, _)| *code)
            }),
            _ => None,
        }
    };
    let label = code.and_then(|code| {
        STATUSES
            .iter()
            .find(|(known, _)| *known == code)
            .map(|(_, label)| *label)
    });
    fields.insert(
        "registrationStatusCode".into(),
        code.map_or_else(|| "unknown".into(), |code| code.to_string()),
    );
    fields.insert(
        "registrationStatus".into(),
        label.unwrap_or("Não confirmada").into(),
    );
    if let Some(date) = text(record, "data_situacao_cadastral") {
        let format = time::format_description::parse_borrowed::<2>("[year]-[month]-[day]")
            .expect("ISO date format");
        if date.len() == 10 && time::Date::parse(&date, &format).is_ok() {
            fields.insert("registrationStatusDate".into(), date);
        }
    }
    let reason = if ws {
        record
            .get("motivo_situacao_cadastral")
            .and_then(|reason| text(reason, "descricao"))
    } else {
        text(record, "descricao_motivo_situacao_cadastral")
    };
    if let Some(reason) = reason {
        fields.insert("registrationStatusReason".into(), reason);
    }
}

pub fn warning(fields: &BTreeMap<String, String>) -> Option<String> {
    match fields.get("registrationStatusCode").map(String::as_str) {
        Some("2") => None,
        Some("1" | "3" | "4" | "8") => Some(format!(
            "Situação cadastral do CNPJ: {}. Confira a situação da empresa antes de continuar o cadastro ou a negociação.",
            fields.get("registrationStatus").map(String::as_str).unwrap_or("Não confirmada")
        )),
        _ => Some("Situação cadastral do CNPJ: não confirmada pela fonte consultada. Confira antes de continuar.".into()),
    }
}
