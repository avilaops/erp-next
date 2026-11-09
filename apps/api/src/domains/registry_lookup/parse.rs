use std::collections::BTreeMap;

use serde_json::Value;

use super::company_fields::company_fields;
use super::model::{LookupKind, RegistryData, RegistryStateRegistration, STATES};

pub fn text(value: &Value, key: &str) -> Option<String> {
    let raw = value.get(key)?.as_str()?.trim();
    (!raw.is_empty() && raw.chars().count() <= 200 && !raw.chars().any(char::is_control))
        .then(|| raw.to_owned())
}

fn normalize_id(raw: &str) -> String {
    raw.chars()
        .filter(|c| !"./- ".contains(*c))
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn municipality_code(value: Option<&Value>, state: Option<&String>) -> Option<String> {
    let value = value?;
    let code = match value {
        Value::String(value) => value.trim().to_owned(),
        Value::Number(value) => value.as_u64()?.to_string(),
        _ => return None,
    };
    let prefix = crate::domains::fiscal::model::state_code(state?)?;
    (code.len() == 7 && code.bytes().all(|byte| byte.is_ascii_digit()) && code.starts_with(prefix))
        .then_some(code)
}

pub fn parse(
    source: &str,
    kind: LookupKind,
    requested: &str,
    state: Option<&str>,
    value: &Value,
) -> Option<(RegistryData, Option<String>)> {
    if !value.is_object() {
        return None;
    }
    let via = source == "ViaCEP";
    let ws = source == "CNPJ.ws";
    let cep = kind == LookupKind::Cep;
    let record = if ws {
        value.get("estabelecimento")?
    } else {
        value
    };
    let identity = text(record, if cep { "cep" } else { "cnpj" })?;
    if normalize_id(&identity) != requested {
        return None;
    }
    let mut fields = BTreeMap::new();
    let mapping: &[(&str, &str)] = if cep {
        if via {
            &[
                ("postalCode", "cep"),
                ("state", "uf"),
                ("city", "localidade"),
                ("street", "logradouro"),
                ("district", "bairro"),
            ]
        } else {
            &[
                ("postalCode", "cep"),
                ("state", "state"),
                ("city", "city"),
                ("street", "street"),
                ("district", "neighborhood"),
            ]
        }
    } else if ws {
        &[
            ("postalCode", "cep"),
            ("street", "logradouro"),
            ("district", "bairro"),
            ("number", "numero"),
            ("complement", "complemento"),
            ("tradeName", "nome_fantasia"),
            ("email", "email"),
        ]
    } else {
        &[
            ("postalCode", "cep"),
            ("state", "uf"),
            ("city", "municipio"),
            ("street", "logradouro"),
            ("district", "bairro"),
            ("number", "numero"),
            ("complement", "complemento"),
            ("tradeName", "nome_fantasia"),
            ("activityDescription", "cnae_fiscal_descricao"),
            ("email", "email"),
        ]
    };
    for &(target, key) in mapping {
        if record
            .get(key)
            .is_some_and(|v| !v.is_null() && !v.is_string())
        {
            return None;
        }
        if let Some(mut val) = text(record, key) {
            if target == "postalCode" {
                val = normalize_id(&val);
                if val.len() != 8 || !val.bytes().all(|c| c.is_ascii_digit()) {
                    return None;
                }
            }
            fields.insert(target.into(), val);
        }
    }
    if !cep {
        fields.insert("legalName".into(), text(value, "razao_social")?);
        fields.insert("personType".into(), "juridica".into());
        company_fields(ws, value, record, &mut fields);
        if ws {
            if let Some(val) = record.get("estado").and_then(|s| text(s, "sigla")) {
                fields.insert("state".into(), val);
            }
            if let Some(val) = record.get("cidade").and_then(|s| text(s, "nome")) {
                fields.insert("city".into(), val);
            }
            if let Some(val) = record
                .get("atividade_principal")
                .and_then(|s| text(s, "id"))
            {
                fields.insert("cnae".into(), val);
            }
        } else if let Some(val) = value
            .get("cnae_fiscal")
            .and_then(Value::as_u64)
            .filter(|n| *n <= 9_999_999)
        {
            fields.insert("cnae".into(), format!("{val:07}"));
        }
    }
    if fields
        .get("state")
        .is_some_and(|s| !STATES.contains(&s.as_str()))
    {
        return None;
    }
    if cep && (!fields.contains_key("state") || !fields.contains_key("city")) {
        return None;
    }
    // Only project documented IBGE identifiers, never provider-local city IDs
    // or a code guessed from the municipality's name. Older providers may omit it.
    let raw_municipality = if via && cep {
        record.get("ibge")
    } else if ws && !cep {
        record.get("cidade").and_then(|city| city.get("ibge_id"))
    } else if source == "BrasilAPI" && !cep {
        record.get("codigo_municipio_ibge")
    } else {
        None
    };
    if let Some(code) = municipality_code(raw_municipality, fields.get("state")) {
        fields.insert("municipalityCode".into(), code);
    }
    let generic = cep && (!fields.contains_key("street") || !fields.contains_key("district"));
    let mut registrations = vec![];
    if ws {
        // Missing registrations are unknown; never synthesize ISENTO or a taxpayer flag.
        if let Some(items) = record.get("inscricoes_estaduais").and_then(Value::as_array) {
            if items.len() > 100 {
                return None;
            }
            for item in items {
                let uf = item.get("estado").and_then(|s| text(s, "sigla"))?;
                if !STATES.contains(&uf.as_str()) {
                    return None;
                }
                if state.is_some_and(|selected| selected != uf) {
                    continue;
                }
                let number = text(item, "inscricao_estadual")?;
                if number.len() > 20
                    || !number
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "./-".contains(c))
                {
                    return None;
                }
                registrations.push(RegistryStateRegistration {
                    state: uf,
                    number,
                    active: item.get("ativo").and_then(Value::as_bool),
                    source_updated_at: text(item, "atualizado_em"),
                });
            }
        }
    }
    if kind == LookupKind::Ie {
        fields.clear();
    }
    Some((
        RegistryData {
            fields,
            state_registrations: registrations,
            generic_postal_code: generic,
            taxpayer_status: "unknown".into(),
        },
        text(value, "atualizado_em"),
    ))
}
