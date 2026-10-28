//! Structural policy only: XSD, XMLDSig and current SEFAZ status remain separate.
#![allow(dead_code)] // Persistent import is intentionally gated by the P0 contract.

use roxmltree::{Document, Node};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const NFE: &str = "http://www.portalfiscal.inf.br/nfe";

#[derive(Debug, PartialEq, Eq)]
pub struct ReceivedMetadata {
    pub key: String,
    pub environment: String,
    pub issuer: String,
    pub issuer_name: String,
    pub recipient: String,
    pub number: u32,
    pub series: u16,
    pub issued_at: String,
    pub total_cents: i64,
    pub item_count: u16,
}

fn child<'a>(node: Node<'a, 'a>, name: &str) -> Result<Node<'a, 'a>, &'static str> {
    let mut matches = node
        .children()
        .filter(|item| item.has_tag_name((NFE, name)));
    let value = matches.next().ok_or("Campo obrigatório ausente")?;
    if matches.next().is_some() {
        return Err("Campo fiscal duplicado");
    }
    Ok(value)
}

fn text<'a>(node: Node<'a, 'a>, name: &str) -> Result<&'a str, &'static str> {
    let field = child(node, name)?;
    if field.children().count() != 1 || !field.children().all(|node| node.is_text()) {
        return Err("Campo fiscal com estrutura inesperada");
    }
    field
        .text()
        .filter(|value| !value.trim().is_empty())
        .ok_or("Campo fiscal vazio")
}

fn unsigned(value: &str) -> Result<u32, &'static str> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Número fiscal inválido");
    }
    value.parse().map_err(|_| "Número fiscal fora do limite")
}

pub fn inspect_received(xml: &str, recipient_cnpj: &str) -> Result<ReceivedMetadata, &'static str> {
    let envelope = super::danfe::inspect(xml)?;
    if recipient_cnpj.len() != 14
        || !recipient_cnpj.bytes().all(|byte| byte.is_ascii_digit())
        || envelope.recipient.as_deref() != Some(recipient_cnpj)
    {
        return Err("Destinatário não corresponde ao CNPJ da empresa");
    }
    let document = Document::parse_with_options(
        xml,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: 100_000,
            ..Default::default()
        },
    )
    .map_err(|_| "XML fiscal inválido")?;
    // The envelope inspector uses borrowed scalar text. Refuse comments/PIs in
    // every scalar, including inherited protocol/identity fields, so no first
    // text node can hide additional fiscal content.
    for node in document.descendants().filter(|node| node.is_element()) {
        if !node.children().any(|child| child.is_element())
            && node.children().any(|child| !child.is_text())
        {
            return Err("Campo fiscal com comentário ou instrução de processamento");
        }
    }
    let info = child(child(document.root_element(), "NFe")?, "infNFe")?;
    if text(child(info, "dest")?, "CNPJ")? != recipient_cnpj {
        return Err("Destinatário deve ser identificado por CNPJ");
    }
    let ide = child(info, "ide")?;
    let number = unsigned(text(ide, "nNF")?)?;
    let series = unsigned(text(ide, "serie")?)?;
    if number == 0
        || number != unsigned(&envelope.key[25..34])?
        || series != unsigned(&envelope.key[22..25])?
    {
        return Err("Número ou série não corresponde à chave");
    }
    let issued_at = text(ide, "dhEmi")?;
    if issued_at.as_bytes().get(10) != Some(&b'T') {
        return Err("Data de emissão deve usar separador ISO T");
    }
    let issued = OffsetDateTime::parse(issued_at, &Rfc3339)
        .map_err(|_| "Data de emissão inválida ou sem fuso")?;
    if format!(
        "{:02}{:02}",
        issued.year().rem_euclid(100),
        u8::from(issued.month())
    ) != envelope.key[2..6]
    {
        return Err("Data de emissão não corresponde à chave");
    }
    let issuer_name = text(child(info, "emit")?, "xNome")?.to_owned();
    let total_cents =
        crate::domains::fixed(text(child(child(info, "total")?, "ICMSTot")?, "vNF")?, 2)
            .map_err(|_| "Total fiscal inválido")?;
    let mut items = std::collections::BTreeSet::new();
    for item in info
        .children()
        .filter(|node| node.has_tag_name((NFE, "det")))
    {
        let raw = item.attribute("nItem").ok_or("Item sem número")?;
        let index = unsigned(raw)?;
        if !(1..=990).contains(&index) || !items.insert(index) {
            return Err("Numeração de itens inválida ou duplicada");
        }
    }
    if items.is_empty() || items.iter().copied().ne(1..=items.len() as u32) {
        return Err("Itens fiscais ausentes ou com numeração incompleta");
    }
    Ok(ReceivedMetadata {
        key: envelope.key,
        environment: envelope.environment,
        issuer: envelope.issuer,
        issuer_name,
        recipient: recipient_cnpj.to_owned(),
        number,
        series: series as u16,
        issued_at: issued_at.to_owned(),
        total_cents,
        item_count: items.len() as u16,
    })
}

#[cfg(test)]
#[path = "received_model_tests.rs"]
mod tests;
