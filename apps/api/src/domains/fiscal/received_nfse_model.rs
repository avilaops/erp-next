//! Correlates private-engine metadata with the exact source file before storage.
//! XSD validation belongs to the pinned Node engine. This is not signature trust.
use roxmltree::{Document, Node};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use utoipa::ToSchema;

use crate::platform::valid_document;

const NS: &str = "http://www.sped.fazenda.gov.br/nfse";
pub(super) const MAX_XML: usize = 1_048_576;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NfseParty {
    kind: String,
    value: String,
    name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NfseVerification {
    layout: String,
    correction: Option<String>,
    signature: String,
    current_status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReceivedNfseMetadata {
    pub(super) source: String,
    schema_version: String,
    pub(super) access_key: String,
    pub(super) environment: String,
    number: String,
    municipality_code: String,
    issued_at: String,
    processed_at: String,
    processing_code: String,
    issuer: NfseParty,
    provider: NfseParty,
    recipient: NfseParty,
    service_code: String,
    description: String,
    service_cents: String,
    net_cents: String,
    pub(super) xml_sha256: String,
    verification: NfseVerification,
}

fn child<'a>(node: Node<'a, 'a>, name: &str) -> Result<Node<'a, 'a>, ()> {
    let mut matches = node.children().filter(|item| item.has_tag_name((NS, name)));
    let result = matches.next().ok_or(())?;
    if matches.next().is_some() {
        return Err(());
    }
    Ok(result)
}

fn field(node: Node<'_, '_>, name: &str) -> Result<String, ()> {
    let node = child(node, name)?;
    if node.children().any(|item| item.is_element()) {
        return Err(());
    }
    let value: String = node
        .children()
        .filter(|item| item.is_text())
        .filter_map(|item| item.text())
        .collect();
    if value.is_empty() {
        return Err(());
    }
    Ok(value)
}

fn digits(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn party(node: Node<'_, '_>) -> Result<NfseParty, ()> {
    let names: Vec<&str> = ["CNPJ", "CPF", "NIF", "cNaoNIF"]
        .into_iter()
        .filter(|name| node.children().any(|item| item.has_tag_name((NS, *name))))
        .collect();
    if names.len() != 1 {
        return Err(());
    }
    let kind = names[0];
    let value = field(node, kind)?;
    let person = if kind == "CNPJ" { "juridica" } else { "fisica" };
    if matches!(kind, "CNPJ" | "CPF")
        && (!digits(&value, if kind == "CNPJ" { 14 } else { 11 })
            || !valid_document(&value, person))
    {
        return Err(());
    }
    let name = if node.children().any(|item| item.has_tag_name((NS, "xNome"))) {
        Some(field(node, "xNome")?)
    } else {
        None
    };
    Ok(NfseParty {
        kind: if kind == "cNaoNIF" { "no_nif" } else { kind }.to_owned(),
        value,
        name,
    })
}

fn cents(raw: &str) -> Result<String, ()> {
    let (whole, fraction) = raw.split_once('.').unwrap_or((raw, "00"));
    if whole.is_empty()
        || whole.len() > 15
        || whole.len() > 1 && whole.starts_with('0')
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !digits(fraction, 2)
    {
        return Err(());
    }
    let value =
        whole.parse::<u128>().map_err(|_| ())? * 100 + fraction.parse::<u128>().map_err(|_| ())?;
    Ok(value.to_string())
}

pub(super) fn correlate(
    mut result: Value,
    xml: &str,
    recipient: &str,
) -> Result<ReceivedNfseMetadata, ()> {
    let object = result.as_object_mut().ok_or(())?;
    if object
        .remove("xml")
        .and_then(|value| value.as_str().map(str::to_owned))
        .as_deref()
        != Some(xml)
    {
        return Err(());
    }
    let data: ReceivedNfseMetadata = serde_json::from_value(result).map_err(|_| ())?;
    if data.source != "nfse_nacional"
        || data.xml_sha256 != format!("{:x}", Sha256::digest(xml.as_bytes()))
        || !digits(&data.access_key, 50)
        || data.verification.signature != "not_verified"
        || data.verification.current_status != "not_queried"
    {
        return Err(());
    }
    match data.schema_version.as_str() {
        "1.00"
            if data.verification.layout == "official_schema_valid"
                && data.verification.correction.is_none() => {}
        "1.01"
            if data.verification.layout == "local_profile_valid"
                && data.verification.correction.as_deref()
                    == Some("nfse-1.01-dps-series-regex-v1") => {}
        _ => return Err(()),
    }
    let document = Document::parse_with_options(
        xml,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: 100_000,
            ..Default::default()
        },
    )
    .map_err(|_| ())?;
    let root = document.root_element();
    if !root.has_tag_name((NS, "NFSe"))
        || root.attribute("versao") != Some(data.schema_version.as_str())
    {
        return Err(());
    }
    let info = child(root, "infNFSe")?;
    let dps = child(info, "DPS")?;
    if dps.attribute("versao") != Some(data.schema_version.as_str())
        || info.attribute("Id") != Some(format!("NFS{}", data.access_key).as_str())
    {
        return Err(());
    }
    let detail = child(dps, "infDPS")?;
    let actual_recipient = party(child(detail, "toma")?)?;
    let environment = match field(detail, "tpAmb")?.as_str() {
        "1" => "production",
        "2" => "homologation",
        _ => return Err(()),
    };
    let service = child(child(detail, "serv")?, "cServ")?;
    if actual_recipient.kind != "CNPJ"
        || actual_recipient.value != recipient
        || actual_recipient != data.recipient
        || party(child(info, "emit")?)? != data.issuer
        || party(child(detail, "prest")?)? != data.provider
        || data.environment != environment
        || field(info, "nNFSe")? != data.number
        || field(info, "dhProc")? != data.processed_at
        || field(info, "cStat")? != data.processing_code
        || field(detail, "cLocEmi")? != data.municipality_code
        || field(detail, "dhEmi")? != data.issued_at
        || field(service, "cTribNac")? != data.service_code
        || field(service, "xDescServ")? != data.description
        || cents(&field(
            child(child(detail, "valores")?, "vServPrest")?,
            "vServ",
        )?)? != data.service_cents
        || cents(&field(child(info, "valores")?, "vLiq")?)? != data.net_cents
    {
        return Err(());
    }
    Ok(data)
}
