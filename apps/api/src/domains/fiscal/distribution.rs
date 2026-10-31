//! Distribution is read-only fiscal ingestion; it never receives stock or creates payables.
use base64::{Engine, engine::general_purpose::STANDARD};
use roxmltree::{Document, Node};
use std::io::Read;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub const NFE: &str = "http://www.portalfiscal.inf.br/nfe";

#[derive(Debug)]
pub struct Batch {
    pub status: String,
    pub last_nsu: String,
    pub max_nsu: String,
    pub documents: Vec<DistributedDocument>,
}
#[derive(Debug)]
pub struct DistributedDocument {
    pub nsu: String,
    pub schema: String,
    pub xml: String,
    pub kind: String,
    pub note: Option<Summary>,
}
#[derive(Debug)]
pub struct Summary {
    pub key: String,
    pub issuer: String,
    pub name: String,
    pub issued_at: time::OffsetDateTime,
    pub total_cents: i64,
    pub situation: String,
}
pub fn digits(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_digit())
}
pub fn valid_key(key: &str) -> bool {
    if !digits(key, 44) || &key[20..22] != "55" {
        return false;
    }
    let sum: u32 = key[..43]
        .bytes()
        .rev()
        .enumerate()
        .map(|(i, byte)| u32::from(byte - b'0') * (2 + i as u32 % 8))
        .sum();
    let check = 11 - sum % 11;
    u32::from(key.as_bytes()[43] - b'0') == if check >= 10 { 0 } else { check }
}
pub fn xml_document(xml: &str) -> Result<Document<'_>, &'static str> {
    if xml.len() > 10 * 1024 * 1024 || xml.to_ascii_uppercase().contains("<!DOCTYPE") {
        return Err("XML fiscal excede limites ou contém DTD");
    }
    Document::parse_with_options(
        xml,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: 100_000,
            ..Default::default()
        },
    )
    .map_err(|_| "XML fiscal inválido")
}
pub fn child<'a>(node: Node<'a, 'a>, name: &str) -> Result<Node<'a, 'a>, &'static str> {
    let mut children = node
        .children()
        .filter(|item| item.has_tag_name((NFE, name)));
    let value = children.next().ok_or("Campo fiscal obrigatório ausente")?;
    if children.next().is_some() {
        return Err("Campo fiscal duplicado");
    }
    Ok(value)
}
pub fn text<'a>(node: Node<'a, 'a>, name: &str) -> Result<&'a str, &'static str> {
    let value = child(node, name)?;
    if value.children().count() != 1 || !value.children().all(|part| part.is_text()) {
        return Err("Campo fiscal com estrutura ambígua");
    }
    value
        .text()
        .filter(|value| !value.is_empty())
        .ok_or("Campo fiscal vazio")
}
pub fn unique<'a>(document: &'a Document<'a>, name: &str) -> Result<Node<'a, 'a>, &'static str> {
    let mut matches = document
        .descendants()
        .filter(|node| node.has_tag_name((NFE, name)));
    let node = matches.next().ok_or("Resposta fiscal não reconhecida")?;
    if matches.next().is_some() {
        return Err("Resposta fiscal ambígua");
    }
    Ok(node)
}
pub fn parse(xml: &str, previous: &str, recipient: &str) -> Result<Batch, &'static str> {
    if !digits(previous, 15) || !digits(recipient, 14) {
        return Err("Controle fiscal inválido");
    }
    let document = xml_document(xml)?;
    // Some SOAP implementations return the fiscal XML as escaped text.
    if let Some(result) = document
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "nfeDistDFeInteresseResult")
        && !result.children().any(|node| node.is_element())
    {
        let nested = result.text().ok_or("Resposta fiscal vazia")?;
        let parsed = xml_document(nested)?;
        return parse_result(unique(&parsed, "retDistDFeInt")?, previous, recipient);
    }
    parse_result(unique(&document, "retDistDFeInt")?, previous, recipient)
}
fn parse_result(
    root: Node<'_, '_>,
    previous: &str,
    recipient: &str,
) -> Result<Batch, &'static str> {
    if text(root, "tpAmb")? != "1" {
        return Err("Ambiente de distribuição incompatível");
    }
    let status = text(root, "cStat")?;
    if !["137", "138", "656"].contains(&status) {
        return Err("Distribuição recusada pela SEFAZ");
    }
    let lots = root
        .children()
        .filter(|node| node.has_tag_name((NFE, "loteDistDFeInt")))
        .collect::<Vec<_>>();
    if lots.len() > 1 {
        return Err("Lote fiscal duplicado");
    }
    let zipped = lots
        .first()
        .map(|lot| {
            lot.children()
                .filter(|node| node.is_element())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if status != "138" && !zipped.is_empty() {
        return Err("Lote incompatível com cStat");
    }
    if status == "656" {
        return Ok(Batch {
            status: status.into(),
            last_nsu: previous.into(),
            max_nsu: previous.into(),
            documents: Vec::new(),
        });
    }
    let last = text(root, "ultNSU")?;
    let max = text(root, "maxNSU")?;
    if !digits(last, 15)
        || !digits(max, 15)
        || last < previous
        || last > max
        || (status == "137" && last != max)
        || (status == "138" && (last == previous || zipped.is_empty() || zipped.len() > 50))
    {
        return Err("Controle de distribuição inconsistente");
    }
    let mut documents = Vec::new();
    let mut preceding = previous.to_owned();
    let mut total = 0;
    for zipped in zipped {
        if !zipped.has_tag_name((NFE, "docZip"))
            || zipped.children().count() != 1
            || !zipped.children().all(|part| part.is_text())
        {
            return Err("Documento compactado inválido");
        }
        let nsu = zipped.attribute("NSU").ok_or("Documento sem NSU")?;
        let schema = zipped.attribute("schema").ok_or("Documento sem schema")?;
        if !digits(nsu, 15)
            || nsu <= preceding.as_str()
            || nsu > last
            || schema.len() > 100
            || !schema.ends_with(".xsd")
            || !schema
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        {
            return Err("NSU ou schema inválido");
        }
        let compressed = STANDARD
            .decode(zipped.text().unwrap_or("").trim())
            .map_err(|_| "Base64 fiscal inválido")?;
        let mut decoder = flate2::read::GzDecoder::new(compressed.as_slice())
            .take((super::danfe::MAX_XML_BYTES + 1) as u64);
        let mut bytes = Vec::new();
        decoder
            .read_to_end(&mut bytes)
            .map_err(|_| "Gzip fiscal inválido")?;
        total += bytes.len();
        if bytes.is_empty() || bytes.len() > super::danfe::MAX_XML_BYTES || total > 8 * 1024 * 1024
        {
            return Err("Lote fiscal excede limites");
        }
        let xml = String::from_utf8(bytes).map_err(|_| "XML fiscal deve ser UTF-8")?;
        let (kind, note) = inspect(&xml, schema, recipient)?;
        documents.push(DistributedDocument {
            nsu: nsu.into(),
            schema: schema.into(),
            xml,
            kind: kind.into(),
            note,
        });
        preceding = nsu.into();
    }
    Ok(Batch {
        status: status.into(),
        last_nsu: last.into(),
        max_nsu: max.into(),
        documents,
    })
}
fn inspect(
    xml: &str,
    schema: &str,
    recipient: &str,
) -> Result<(&'static str, Option<Summary>), &'static str> {
    let document = xml_document(xml)?;
    let root = document.root_element();
    if schema.starts_with("resNFe_") {
        if !root.has_tag_name((NFE, "resNFe")) {
            return Err("Resumo incompatível com schema");
        }
        let key = text(root, "chNFe")?;
        let (issuer, issuer_length) = match (
            root.children().any(|node| node.has_tag_name((NFE, "CNPJ"))),
            root.children().any(|node| node.has_tag_name((NFE, "CPF"))),
        ) {
            (true, false) => (text(root, "CNPJ")?, 14),
            (false, true) => (text(root, "CPF")?, 11),
            _ => return Err("Emitente fiscal ausente ou ambíguo"),
        };
        let name = text(root, "xNome")?;
        let issued = OffsetDateTime::parse(text(root, "dhEmi")?, &Rfc3339)
            .map_err(|_| "Data fiscal inválida")?;
        let situation = text(root, "cSitNFe")?;
        let total_cents =
            crate::domains::fixed(text(root, "vNF")?, 2).map_err(|_| "Valor fiscal inválido")?;
        if !valid_key(key)
            || !digits(issuer, issuer_length)
            || format!("{issuer:0>14}") != key[6..20]
            || name.trim().is_empty()
            || name.chars().count() > 200
            || !["1", "2", "3"].contains(&situation)
            || !(0..=99_999_999_999_999).contains(&total_cents)
        {
            return Err("Resumo fiscal inválido");
        }
        return Ok((
            "summary",
            Some(Summary {
                key: key.into(),
                issuer: issuer.into(),
                name: name.into(),
                issued_at: issued,
                total_cents,
                situation: situation.into(),
            }),
        ));
    }
    if schema.starts_with("procNFe_") {
        let note = super::danfe::inspect(xml)?;
        if note.environment != "1" {
            return Err("NF-e de ambiente incompatível");
        }
        // distNSU also includes documents where this CNPJ is carrier/autXML.
        // Preserve their original XML without importing a received NF-e or blocking progress.
        if note.recipient.as_deref() != Some(recipient) {
            return Ok(("other", None));
        }
        super::received_model::inspect_received(xml, recipient)?;
        return Ok((
            "nfe",
            Some(Summary {
                key: note.key,
                issuer: note.issuer,
                name: note.issuer_name,
                issued_at: note.issued_at,
                total_cents: note.total_cents,
                situation: "1".into(),
            }),
        ));
    }
    Ok((
        if schema.to_ascii_lowercase().contains("evento") {
            "event"
        } else {
            "other"
        },
        None,
    ))
}

#[cfg(test)]
#[path = "distribution_tests.rs"]
pub(crate) mod tests;
