//! Correlates private inspection facts with the immutable captured source.
//! The engine owns XSD/cryptographic checking; no authority trust is inferred here.
use roxmltree::{Document, Node};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use utoipa::ToSchema;

const NS: &str = "http://www.portalfiscal.inf.br/cte";
const DS: &str = "http://www.w3.org/2000/09/xmldsig#";
pub(super) const PROFILE: &str = "PL_CTe_400_NT2026.004_RTC_1.00_2026-10-16";
pub(super) const VERSION: &str = "cte-received-v1";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CteParty {
    kind: String,
    value: String,
    name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CteVerification {
    layout: String,
    signature: String,
    certificate_trust: String,
    current_status: String,
    protocol_authenticity: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CteProtocol {
    code: String,
    number: String,
    received_at: String,
    digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReceivedCteMetadata {
    source: String,
    schema_version: String,
    profile: String,
    environment: String,
    company_tax_id: String,
    access_key: String,
    number: String,
    series: String,
    issued_at: String,
    modal: String,
    document_type: String,
    carrier: CteParty,
    sender: Option<CteParty>,
    dispatcher: Option<CteParty>,
    receiver: Option<CteParty>,
    recipient: Option<CteParty>,
    taker: CteParty,
    taker_role: String,
    company_roles: Vec<String>,
    service_cents: String,
    receivable_cents: String,
    nfe_references: Vec<String>,
    cte_references: Vec<String>,
    protocol: CteProtocol,
    pub(super) xml_sha256: String,
    verification: CteVerification,
}

impl ReceivedCteMetadata {
    pub(super) fn commercial_facts(self) -> Result<super::CteCommercialFacts, ()> {
        if self.carrier.kind != "CNPJ" {
            return Err(());
        }
        Ok(super::CteCommercialFacts {
            carrier_tax_id: self.carrier.value,
            carrier_name: self.carrier.name,
            service_cents: self.service_cents.parse().map_err(|_| ())?,
        })
    }
}

fn optional_child<'a>(
    node: Node<'a, 'a>,
    name: &str,
    ns: &str,
) -> Result<Option<Node<'a, 'a>>, ()> {
    let mut matches = node.children().filter(|item| item.has_tag_name((ns, name)));
    let result = matches.next();
    if matches.next().is_some() {
        return Err(());
    }
    Ok(result)
}
fn child<'a>(node: Node<'a, 'a>, name: &str) -> Result<Node<'a, 'a>, ()> {
    optional_child(node, name, NS)?.ok_or(())
}
fn text(node: Node<'_, '_>) -> Result<String, ()> {
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
fn field(node: Node<'_, '_>, name: &str) -> Result<String, ()> {
    text(child(node, name)?)
}
fn party(node: Node<'_, '_>) -> Result<CteParty, ()> {
    let mut found = Vec::new();
    for kind in ["CNPJ", "CPF"] {
        if let Some(identity) = optional_child(node, kind, NS)? {
            found.push((kind, text(identity)?));
        }
    }
    if found.len() != 1 {
        return Err(());
    }
    let (kind, value) = found.pop().ok_or(())?;
    let name = optional_child(node, "xNome", NS)?.map(text).transpose()?;
    Ok(CteParty {
        kind: kind.to_owned(),
        value,
        name,
    })
}
fn optional_party(node: Node<'_, '_>, name: &str) -> Result<Option<CteParty>, ()> {
    optional_child(node, name, NS)?.map(party).transpose()
}
fn cents(value: &str) -> Result<String, ()> {
    let (whole, fraction) = value.split_once('.').unwrap_or((value, "00"));
    if whole.is_empty()
        || whole.len() > 13
        || whole.len() > 1 && whole.starts_with('0')
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || fraction.len() != 2
        || !fraction.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(());
    }
    Ok(
        (whole.parse::<u128>().map_err(|_| ())? * 100
            + fraction.parse::<u128>().map_err(|_| ())?)
        .to_string(),
    )
}
fn valid_key(key: &str, models: &[&str]) -> bool {
    let bytes = key.as_bytes();
    if bytes.len() != 44
        || !bytes[..6]
            .iter()
            .chain(bytes[18..].iter())
            .all(|b| b.is_ascii_digit())
        || !bytes[6..18]
            .iter()
            .all(|b| b.is_ascii_digit() || b.is_ascii_uppercase())
        || !models.contains(&&key[20..22])
    {
        return false;
    }
    let mut total = 0u32;
    let mut weight = 2u32;
    for byte in bytes[..43].iter().rev() {
        total += u32::from(*byte - b'0') * weight;
        weight = if weight == 9 { 2 } else { weight + 1 };
    }
    let remainder = total % 11;
    let digit = if remainder < 2 { 0 } else { 11 - remainder };
    u32::from(bytes[43] - b'0') == digit
}
fn references(info: Node<'_, '_>, names: &[&str], nested: bool) -> Result<Vec<String>, ()> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for node in info.descendants().filter(|node| {
        node.is_element()
            && node.tag_name().namespace() == Some(NS)
            && names.contains(&node.tag_name().name())
    }) {
        let value = if nested {
            field(node, "chave")?
        } else {
            text(node)?
        };
        if seen.insert(value.clone()) {
            result.push(value);
        }
        if result.len() > 2000 {
            return Err(());
        }
    }
    Ok(result)
}

pub(super) fn correlate(
    mut result: Value,
    xml: &str,
    company: &str,
) -> Result<ReceivedCteMetadata, ()> {
    if xml.is_empty() || xml.len() > 2_097_152 {
        return Err(());
    }
    if result
        .as_object_mut()
        .ok_or(())?
        .remove("xml")
        .and_then(|value| value.as_str().map(str::to_owned))
        .as_deref()
        != Some(xml)
    {
        return Err(());
    }
    let data: ReceivedCteMetadata = serde_json::from_value(result).map_err(|_| ())?;
    if data.source != "cte_distribution"
        || data.schema_version != "4.00"
        || data.profile != PROFILE
        || data.environment != "homologation"
        || data.company_tax_id != company
        || data.xml_sha256 != format!("{:x}", Sha256::digest(xml.as_bytes()))
        || !valid_key(&data.access_key, &["57"])
        || data.verification.layout != "official_schema_valid"
        || data.verification.signature != "consistent"
        || data.verification.certificate_trust != "not_verified"
        || data.verification.current_status != "not_queried"
        || data.verification.protocol_authenticity != "not_verified"
    {
        return Err(());
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
    if !root.has_tag_name((NS, "cteProc")) || root.attribute("versao") != Some("4.00") {
        return Err(());
    }
    let cte = child(root, "CTe")?;
    let info = child(cte, "infCte")?;
    if info.attribute("versao") != Some("4.00")
        || info.attribute("Id") != Some(format!("CTe{}", data.access_key).as_str())
    {
        return Err(());
    }
    let ide = child(info, "ide")?;
    let issued = field(ide, "dhEmi")?;
    if !issued.is_ascii() || issued.len() < 19 {
        return Err(());
    }
    let key = &data.access_key;
    if field(ide, "mod")? != "57"
        || field(ide, "tpAmb")? != "2"
        || field(ide, "cUF")? != key[..2]
        || format!("{}{}", &issued[2..4], &issued[5..7]) != key[2..6]
        || field(ide, "serie")? != data.series
        || format!("{:0>3}", data.series) != key[22..25]
        || field(ide, "nCT")? != data.number
        || format!("{:0>9}", data.number) != key[25..34]
        || field(ide, "tpEmis")? != key[34..35]
        || field(ide, "cCT")? != key[35..43]
        || field(ide, "cDV")? != key[43..]
        || issued != data.issued_at
        || field(ide, "modal")? != data.modal
        || field(ide, "tpCTe")? != data.document_type
        || !matches!(data.document_type.as_str(), "0" | "1" | "3")
    {
        return Err(());
    }
    let carrier = party(child(info, "emit")?)?;
    let sender = optional_party(info, "rem")?;
    let dispatcher = optional_party(info, "exped")?;
    let receiver = optional_party(info, "receb")?;
    let recipient = optional_party(info, "dest")?;
    if format!("{:0>14}", carrier.value) != key[6..20] {
        return Err(());
    }
    let toma3 = optional_child(ide, "toma3", NS)?;
    let toma4 = optional_child(ide, "toma4", NS)?;
    if toma3.is_some() == toma4.is_some() {
        return Err(());
    }
    let other = toma4.map(party).transpose()?;
    let (taker_role, taker) = if let Some(node) = toma3 {
        match field(node, "toma")?.as_str() {
            "0" => ("sender", sender.as_ref()),
            "1" => ("dispatcher", dispatcher.as_ref()),
            "2" => ("receiver", receiver.as_ref()),
            "3" => ("recipient", recipient.as_ref()),
            _ => return Err(()),
        }
    } else {
        if field(toma4.ok_or(())?, "toma")? != "4" {
            return Err(());
        }
        ("other", other.as_ref())
    };
    let taker = taker.ok_or(())?;
    let mut roles = Vec::new();
    for (name, person) in [
        ("carrier", Some(&carrier)),
        ("sender", sender.as_ref()),
        ("dispatcher", dispatcher.as_ref()),
        ("receiver", receiver.as_ref()),
        ("recipient", recipient.as_ref()),
        ("taker", Some(taker)),
    ] {
        if person.is_some_and(|party| party.kind == "CNPJ" && party.value == company) {
            roles.push(name.to_owned());
        }
    }
    if info
        .children()
        .filter(|node| node.has_tag_name((NS, "autXML")))
        .map(party)
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|person| person.kind == "CNPJ" && person.value == company)
    {
        roles.push("authorized_xml".to_owned());
    }
    let nfe = references(info, &["infNFe"], true)?;
    let cte_refs = references(info, &["chCTe", "chCte", "chCTeMultimodal"], false)?;
    let values = child(info, "vPrest")?;
    if carrier != data.carrier
        || sender != data.sender
        || dispatcher != data.dispatcher
        || receiver != data.receiver
        || recipient != data.recipient
        || *taker != data.taker
        || taker_role != data.taker_role
        || roles.is_empty()
        || roles != data.company_roles
        || cents(&field(values, "vTPrest")?)? != data.service_cents
        || cents(&field(values, "vRec")?)? != data.receivable_cents
        || nfe != data.nfe_references
        || cte_refs != data.cte_references
        || nfe.iter().any(|key| !valid_key(key, &["55"]))
        || cte_refs
            .iter()
            .any(|value| !valid_key(value, &["57", "67"]) || value == key)
    {
        return Err(());
    }
    let protocol = child(root, "protCTe")?;
    let receipt = child(protocol, "infProt")?;
    if protocol.attribute("versao") != Some("4.00")
        || field(receipt, "tpAmb")? != "2"
        || field(receipt, "chCTe")? != *key
        || field(receipt, "cStat")? != data.protocol.code
        || field(receipt, "nProt")? != data.protocol.number
        || field(receipt, "dhRecbto")? != data.protocol.received_at
        || field(receipt, "digVal")? != data.protocol.digest
    {
        return Err(());
    }
    let signature = optional_child(cte, "Signature", DS)?.ok_or(())?;
    let signed_info = optional_child(signature, "SignedInfo", DS)?.ok_or(())?;
    let reference = optional_child(signed_info, "Reference", DS)?.ok_or(())?;
    if reference.attribute("URI") != Some(format!("#CTe{key}").as_str())
        || text(optional_child(reference, "DigestValue", DS)?.ok_or(())?)? != data.protocol.digest
    {
        return Err(());
    }
    Ok(data)
}
