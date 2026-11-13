//! Bindings for the reviewed Ludus structured document. No signer facts, payment
//! receipts, legal classifications or logistics choices are inferred here.
use std::collections::{BTreeMap, HashSet};

use serde_json::Value;

use crate::domains::{DomainError, fixed};

const MARKER: &str = "Pedido — subtotal dos produtos";
const ITEM_COLUMNS: [&str; 5] = [
    "código / modelo",
    "descrição",
    "quantidade",
    "preço unitário",
    "preço total",
];

fn active(names: &HashSet<String>) -> bool {
    names.contains(MARKER) && names.contains("Produto 1 — descrição")
}

fn currency(cents: i64) -> String {
    let magnitude = cents.unsigned_abs();
    let whole = (magnitude / 100).to_string();
    let mut grouped = String::new();
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    format!(
        "{}{grouped},{:02}",
        if cents < 0 { "-" } else { "" },
        magnitude % 100
    )
}

fn source_money(value: &Value) -> Result<i64, DomainError> {
    value
        .as_str()
        .and_then(|raw| fixed(raw, 2).ok())
        .ok_or(DomainError::Conflict(
            "Os valores do pedido não estão em centavos exatos; confira a origem antes de gerar",
        ))
}

fn quantity(value: &Value, unit: &Value) -> Result<String, DomainError> {
    let raw = value
        .as_str()
        .ok_or(DomainError::Conflict("Quantidade do pedido inválida"))?;
    let (whole, fraction) = raw.split_once('.').unwrap_or((raw, ""));
    let canonical = if raw.contains('.') {
        raw.to_owned()
    } else {
        format!("{raw}.000000")
    };
    fixed(&canonical, 6).map_err(|_| DomainError::Conflict("Quantidade do pedido inválida"))?;
    let fraction = fraction.trim_end_matches('0');
    let raw = if fraction.is_empty() {
        whole.to_owned()
    } else {
        format!("{whole},{fraction}")
    };
    let unit = unit.as_str().unwrap_or("");
    Ok(if unit.is_empty() {
        raw
    } else {
        format!("{raw} {unit}")
    })
}

fn description(item: &Value) -> String {
    let mut text = item["name"].as_str().unwrap_or("").to_owned();
    for (key, label) in [
        ("structureColor", "Estrutura"),
        ("swingArmColor", "Braços"),
        ("plateHolderType", "Tipo de anilheiro"),
        ("upholsteryColor", "Estofado"),
    ] {
        if let Some(value) = item[key].as_str().filter(|value| !value.is_empty()) {
            text.push_str(&format!(" · {label}: {value}"));
        }
    }
    text
}

fn joined(value: &Value, keys: &[&str], separator: &str) -> String {
    keys.iter()
        .filter_map(|key| value[*key].as_str())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(separator)
}

pub(super) fn apply_defaults(
    snapshot: &Value,
    names: &HashSet<String>,
    values: &mut BTreeMap<String, String>,
) -> Result<(), DomainError> {
    if !active(names) {
        return Ok(());
    }
    let items = snapshot["items"]
        .as_array()
        .ok_or(DomainError::Conflict("Confira os produtos do pedido"))?;
    let capacity = (1..=200)
        .take_while(|row| {
            ITEM_COLUMNS
                .iter()
                .all(|column| names.contains(&format!("Produto {row} — {column}")))
        })
        .count();
    if items.len() > capacity {
        return Err(DomainError::Conflict(
            "O pedido tem mais produtos que as linhas do modelo; use um anexo que comporte todos os itens",
        ));
    }
    let total = source_money(&snapshot["order"]["amount"])?;
    let mut subtotal = 0_i64;
    let mut known = BTreeMap::new();
    for row in 1..=capacity {
        let cells = if let Some(item) = items.get(row - 1) {
            let amount = source_money(&item["amount"])?;
            subtotal = subtotal
                .checked_add(amount)
                .ok_or(DomainError::Conflict("Total dos produtos fora do limite"))?;
            [
                item["sku"].as_str().unwrap_or("").into(),
                description(item),
                quantity(&item["quantity"], &item["unit"])?,
                currency(source_money(&item["unitPrice"])?),
                currency(amount),
            ]
        } else {
            std::array::from_fn(|_| String::new())
        };
        // Empty rows are authoritative too: caller input cannot invent order items.
        for (column, value) in ITEM_COLUMNS.iter().zip(cells) {
            known.insert(format!("Produto {row} — {column}"), value);
        }
    }
    known.insert("pedido_total".into(), currency(total));
    known.insert(MARKER.into(), currency(subtotal));
    known.insert(
        "Pedido — descontos / acréscimos".into(),
        currency(
            total
                .checked_sub(subtotal)
                .ok_or(DomainError::Conflict("Ajuste do pedido fora do limite"))?,
        ),
    );
    if let Some(addresses) = snapshot["customer"]["addresses"].as_array()
        && let Some(address) = addresses
            .iter()
            .find(|address| address["primary"] == true)
            .or_else(|| addresses.first())
    {
        for (label, text) in [
            (
                "logradouro e número",
                joined(address, &["street", "number", "complement"], ", "),
            ),
            ("bairro", joined(address, &["district"], "")),
            ("CEP", joined(address, &["postalCode"], "")),
            ("cidade / UF", joined(address, &["city", "state"], " / ")),
        ] {
            if !text.is_empty() {
                known.insert(format!("Compradora — endereço — {label}"), text);
            }
        }
    }
    if let Some(phone) = snapshot["customer"]["phone"]
        .as_str()
        .filter(|phone| !phone.is_empty())
    {
        known.insert("Telefone / WhatsApp da compradora".into(), phone.into());
    }
    if let Some(terms) = snapshot
        .get("negotiatedPayments")
        .filter(|value| !value.is_null())
    {
        let entry = terms["entryAmountCents"]
            .as_i64()
            .filter(|value| *value >= 0)
            .ok_or(DomainError::Conflict("Entrada negociada inválida"))?;
        let installments = terms["installments"]
            .as_array()
            .ok_or(DomainError::Conflict("Parcelas negociadas inválidas"))?;
        let mut balance = 0_i64;
        for installment in installments {
            let amount = installment["amountCents"]
                .as_i64()
                .filter(|value| *value > 0)
                .ok_or(DomainError::Conflict("Parcela negociada inválida"))?;
            balance = balance
                .checked_add(amount)
                .ok_or(DomainError::Conflict("Saldo negociado fora do limite"))?;
        }
        if entry.checked_add(balance) != Some(total) {
            return Err(DomainError::Conflict(
                "Entrada e parcelas negociadas divergem do total do pedido",
            ));
        }
        known.insert("Valor acordado de entrada (R$)".into(), currency(entry));
        known.insert("Valor remanescente (R$)".into(), currency(balance));
    }
    values.extend(known.into_iter().filter(|(name, _)| names.contains(name)));
    Ok(())
}

const GROUPS: &[(&str, &[&str])] = &[
    (
        "Compradora — natureza",
        &["Pessoa física", "Pessoa jurídica"],
    ),
    (
        "Aquisição — destinação",
        &[
            "Uso próprio como destinatária final",
            "Uso profissional / empresarial",
            "Revenda",
            "Locação",
            "Outra",
        ],
    ),
    ("Pagamento — condição", &["À vista", "02 parcelas", "Outra"]),
    (
        "Saldo — vencimento",
        &["Na comunicação + 5 dias úteis", "Data específica"],
    ),
    (
        "Técnica — manual em português",
        &["Sim", "Não aplicável", "A entregar"],
    ),
    ("Técnica — conectividade", &["Sim", "Não"]),
    (
        "Frete — RESPONSÁVEL PELA CONTRATAÇÃO DO FRETE",
        &["Compradora", "Vendedora"],
    ),
    (
        "Frete — RESPONSÁVEL PELO PAGAMENTO DO FRETE",
        &["Compradora", "Vendedora"],
    ),
    (
        "Frete — modalidade",
        &["Retirada", "Entrega no endereço", "Outra"],
    ),
    ("Montagem — contratação", &["Contratada", "Não contratada"]),
    (
        "Instalação — contratação",
        &["Contratada em separado", "Não contratada"],
    ),
    ("Reserva de domínio", &["Sim", "Não"]),
];

fn choice_group(name: &str) -> Option<&str> {
    let (group, option) = name.rsplit_once(" — ")?;
    if GROUPS
        .iter()
        .any(|(known, options)| *known == group && options.contains(&option))
    {
        return Some(group);
    }
    let rest = group.strip_prefix("Disponibilidade ")?;
    let (row, kind) = rest.split_once(" — ")?;
    if !["1", "2", "3"].contains(&row) {
        return None;
    }
    match (kind, option) {
        ("origem", "Nacional" | "Importado") | ("condição", "Estoque" | "Encomenda") => {
            Some(group)
        }
        _ => None,
    }
}

fn native_money(raw: &str, signed: bool) -> bool {
    let raw = raw.trim();
    let raw = if signed {
        raw.strip_prefix('-').unwrap_or(raw)
    } else {
        raw
    };
    let Some((whole, fraction)) = raw.split_once(',') else {
        return false;
    };
    if fraction.len() != 2 || !fraction.bytes().all(|digit| digit.is_ascii_digit()) {
        return false;
    }
    let groups: Vec<_> = whole.split('.').collect();
    if groups.len() > 1
        && (groups[0].is_empty()
            || groups[0].len() > 3
            || groups[1..].iter().any(|group| group.len() != 3))
    {
        return false;
    }
    fixed(&format!("{}.{}", groups.concat(), fraction), 2).is_ok()
}

fn calendar(day: &str, month: u8, year: i32) -> bool {
    (1..=9999).contains(&year)
        && !day.is_empty()
        && day.len() <= 2
        && day.bytes().all(|digit| digit.is_ascii_digit())
        && day
            .parse::<u8>()
            .ok()
            .zip(time::Month::try_from(month).ok())
            .is_some_and(|(day, month)| time::Date::from_calendar_date(year, month, day).is_ok())
}

fn dates(values: &BTreeMap<String, String>) -> bool {
    let get = |name: &str| values.get(name).map_or("", |value| value.trim());
    let day = get("Data do contrato — dia");
    let month = get("Data do contrato — mês");
    let year = get("Data do contrato — ano (dois últimos dígitos)");
    if ![day, month, year].iter().all(|value| value.is_empty()) {
        let months = [
            "janeiro",
            "fevereiro",
            "março",
            "abril",
            "maio",
            "junho",
            "julho",
            "agosto",
            "setembro",
            "outubro",
            "novembro",
            "dezembro",
        ];
        let month = months
            .iter()
            .position(|value| *value == month.to_lowercase())
            .map(|month| month as u8 + 1);
        if year.len() != 2
            || !year.bytes().all(|digit| digit.is_ascii_digit())
            || !month.is_some_and(|month| {
                calendar(day, month, 2000 + year.parse::<i32>().unwrap_or(-2000))
            })
        {
            return false;
        }
    }
    let day = get("Pedido — data de emissão — dia");
    let month = get("Pedido — data de emissão — mês");
    let year = get("Pedido — data de emissão — ano");
    if ![day, month, year].iter().all(|value| value.is_empty())
        && (month.len() != 2
            || year.len() != 4
            || !month
                .bytes()
                .chain(year.bytes())
                .all(|digit| digit.is_ascii_digit())
            || !month
                .parse::<u8>()
                .ok()
                .is_some_and(|month| calendar(day, month, year.parse::<i32>().unwrap_or(0))))
    {
        return false;
    }
    let due = get("Saldo — data de vencimento");
    if !due.is_empty() {
        if due.len() != 10
            || !due.is_ascii()
            || due.as_bytes()[2] != b'/'
            || due.as_bytes()[5] != b'/'
        {
            return false;
        }
        if !due[6..].bytes().all(|digit| digit.is_ascii_digit())
            || !due[3..5].parse::<u8>().ok().is_some_and(|month| {
                calendar(&due[..2], month, due[6..].parse::<i32>().unwrap_or(0))
            })
        {
            return false;
        }
    }
    true
}

pub(super) fn validate(
    values: &BTreeMap<String, String>,
    template: &Value,
) -> Result<(), DomainError> {
    let names: HashSet<_> = template["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|field| field["name"].as_str().map(str::to_owned))
        .collect();
    if !active(&names) {
        return Ok(());
    }
    let mut marked = HashSet::new();
    for (name, value) in values {
        let value = value.trim();
        if let Some(group) = choice_group(name)
            && !value.is_empty()
            && (value != "X" || !marked.insert(group))
        {
            return Err(DomainError::Invalid(
                "Marque apenas uma opção por grupo, usando X ou deixando em branco",
            ));
        }
        let monetary = [
            "pedido_total",
            MARKER,
            "Pedido — descontos / acréscimos",
            "Valor acordado de entrada (R$)",
            "Valor remanescente (R$)",
            "Logística — VALOR DO FRETE",
            "Logística — VALOR DA MONTAGEM",
        ]
        .contains(&name.as_str())
            || name.starts_with("Produto ")
                && (name.ends_with(" — preço unitário") || name.ends_with(" — preço total"));
        if monetary
            && !value.is_empty()
            && !native_money(value, name == "Pedido — descontos / acréscimos")
        {
            return Err(DomainError::Invalid(
                "Informe moeda no formato brasileiro, por exemplo 1.234,56, sem repetir R$",
            ));
        }
    }
    if !dates(values) {
        return Err(DomainError::Invalid(
            "Confira as datas completas e seus dias, meses e anos no formato do documento",
        ));
    }
    Ok(())
}
