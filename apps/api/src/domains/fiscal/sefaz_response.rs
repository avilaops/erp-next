//! Staged SEFAZ response boundary; no HTTP route or network adapter is enabled.
//! Call only with the payload extracted from an authenticated SEFAZ SOAP response.
//! Parsing establishes correlation, not authenticity, XSD validity or tax approval.
#![allow(dead_code)]

use base64::{Engine, engine::general_purpose::STANDARD};
use roxmltree::{Document, Node};

const NS: &str = "http://www.portalfiscal.inf.br/nfe";
const MAX_BYTES: usize = 900 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Service {
    Authorization,
    Receipt,
    Situation,
}

/// Correlation comes from the immutable signed submission, never from the response.
#[derive(Clone)]
pub struct Expected {
    key: String,
    digest: Vec<u8>,
    receipt: Option<String>,
}

impl Expected {
    pub fn new(key: &str, digest_base64: &str, receipt: Option<&str>) -> Result<Self, Error> {
        if !valid_key(key) || receipt.is_some_and(|value| !digits(value, 15)) {
            return Err(Error::Correlation);
        }
        Ok(Self {
            key: key.to_owned(),
            digest: digest(digest_base64)?,
            receipt: receipt.map(str::to_owned),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Accepted { receipt: String },
    Processing,
    /// Matched protocol, not proof of a real authorization without trusted transport.
    Authorized { protocol: String, received_at: String },
    /// A later consultation may report cancellation; preserve the authorization XML.
    Cancelled,
    Rejected { code: u16 },
    /// Ambiguous, duplicate, unavailable, not found or unknown status: consult, never resend.
    Reconcile { code: u16 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Xml,
    Structure,
    Correlation,
    Environment,
}

fn digits(value: &str, count: usize) -> bool {
    value.len() == count && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn valid_key(key: &str) -> bool {
    if !digits(key, 44) || &key[20..22] != "55" {
        return false;
    }
    let sum: u32 = key.as_bytes()[..43]
        .iter()
        .rev()
        .zip((2..=9).cycle())
        .map(|(byte, weight)| u32::from(byte - b'0') * weight)
        .sum();
    let candidate = 11 - sum % 11;
    let check = if candidate >= 10 { 0 } else { candidate };
    u32::from(key.as_bytes()[43] - b'0') == check
}

fn digest(value: &str) -> Result<Vec<u8>, Error> {
    let bytes: Vec<u8> = value.bytes().filter(|byte| !byte.is_ascii_whitespace()).collect();
    let decoded = STANDARD.decode(bytes).map_err(|_| Error::Correlation)?;
    if ![20, 32].contains(&decoded.len()) {
        return Err(Error::Correlation);
    }
    Ok(decoded)
}

fn one<'a>(parent: Node<'a, 'a>, name: &str) -> Result<Node<'a, 'a>, Error> {
    let mut nodes = parent.children().filter(|node| node.has_tag_name((NS, name)));
    let node = nodes.next().ok_or(Error::Structure)?;
    if nodes.next().is_some() {
        return Err(Error::Structure);
    }
    Ok(node)
}

fn value<'a>(parent: Node<'a, 'a>, name: &str) -> Result<&'a str, Error> {
    let node = one(parent, name)?;
    if node.children().any(|node| node.is_element()) {
        return Err(Error::Structure);
    }
    node.text().filter(|text| !text.is_empty()).ok_or(Error::Structure)
}

fn status(node: Node<'_, '_>) -> Result<u16, Error> {
    let code = value(node, "cStat")?;
    if !digits(code, 3) {
        return Err(Error::Structure);
    }
    code.parse().map_err(|_| Error::Structure)
}

fn homologation(node: Node<'_, '_>) -> Result<(), Error> {
    if value(node, "tpAmb")? != "2" {
        return Err(Error::Environment);
    }
    Ok(())
}

/// Single-document batches only. SOAP envelopes must be unwrapped by a trusted adapter.
/// Unknown codes fail closed into reconciliation, never automatic retransmission.
pub fn parse(xml: &str, service: Service, expected: &Expected) -> Result<Outcome, Error> {
    if xml.len() > MAX_BYTES {
        return Err(Error::Xml);
    }
    let doc = Document::parse_with_options(
        xml,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: 20_000,
            ..Default::default()
        },
    ).map_err(|_| Error::Xml)?;
    let root = doc.root_element();
    let name = match service {
        Service::Authorization => "retEnviNFe",
        Service::Receipt => "retConsReciNFe",
        Service::Situation => "retConsSitNFe",
    };
    if !root.has_tag_name((NS, name)) || root.attribute("versao") != Some("4.00") {
        return Err(Error::Structure);
    }
    homologation(root)?;
    // Reject nested/wrapped or foreign protocol copies and duplicate scalar fields.
    for name in ["tpAmb", "cStat", "chNFe", "nRec", "infRec", "protNFe"] {
        let count = root.children().filter(|node| node.is_element() && node.tag_name().name() == name).count();
        if count > 1 || root.children().any(|node| node.is_element() && node.tag_name().name() == name && node.tag_name().namespace() != Some(NS)) {
            return Err(Error::Structure);
        }
    }
    if service == Service::Receipt
        && expected.receipt.as_deref() != Some(value(root, "nRec")?)
    {
        return Err(Error::Correlation);
    }
    if service == Service::Situation && value(root, "chNFe")? != expected.key {
        return Err(Error::Correlation);
    }
    let code = status(root)?;
    let protocols: Vec<_> = root.descendants().filter(|node| node.has_tag_name((NS, "protNFe"))).collect();
    if protocols.len() > 1 || protocols.iter().any(|node| node.parent() != Some(root)) {
        return Err(Error::Structure);
    }
    match (service, code) {
        (Service::Authorization, 103) if protocols.is_empty() => {
            let receipt = value(one(root, "infRec")?, "nRec")?;
            if !digits(receipt, 15) {
                return Err(Error::Structure);
            }
            Ok(Outcome::Accepted { receipt: receipt.to_owned() })
        }
        (Service::Receipt, 105) if protocols.is_empty() => Ok(Outcome::Processing),
        (Service::Authorization | Service::Receipt, 104) => protocol(root, expected),
        (Service::Situation, 100 | 150) => {
            let outcome = protocol(root, expected)?;
            if status(one(one(root, "protNFe")?, "infProt")?)? != code {
                return Err(Error::Correlation);
            }
            Ok(outcome)
        }
        (Service::Situation, 101 | 151) => Ok(Outcome::Cancelled),
        _ if !protocols.is_empty() => Err(Error::Structure),
        // Only explicit, known validation failures are classified as rejection here.
        // Duplication 204/539 and all unknown codes deliberately require reconciliation.
        (_, 215 | 225 | 297 | 298) => Ok(Outcome::Rejected { code }),
        _ => Ok(Outcome::Reconcile { code }),
    }
}

fn protocol(root: Node<'_, '_>, expected: &Expected) -> Result<Outcome, Error> {
    let wrapper = one(root, "protNFe")?;
    if wrapper.attribute("versao") != Some("4.00") {
        return Err(Error::Structure);
    }
    let info = one(wrapper, "infProt")?;
    for name in ["tpAmb", "chNFe", "cStat", "nProt", "dhRecbto", "digVal"] {
        if info.children().filter(|node| node.is_element() && node.tag_name().name() == name).count() > 1
            || info.children().any(|node| node.is_element() && node.tag_name().name() == name && node.tag_name().namespace() != Some(NS))
        {
            return Err(Error::Structure);
        }
    }
    if wrapper.children().filter(|node| node.is_element()).count() != 1 {
        return Err(Error::Structure);
    }
    homologation(info)?;
    if value(info, "chNFe")? != expected.key {
        return Err(Error::Correlation);
    }
    let code = status(info)?;
    match code {
        100 | 150 => {
            let number = value(info, "nProt")?;
            let received_at = value(info, "dhRecbto")?;
            // Full timestamp/schema validation is the pinned XSD adapter's responsibility.
            if !digits(number, 15) || received_at.len() > 40 || received_at.chars().any(char::is_control) {
                return Err(Error::Structure);
            }
            if digest(value(info, "digVal")?)? != expected.digest {
                return Err(Error::Correlation);
            }
            Ok(Outcome::Authorized { protocol: number.to_owned(), received_at: received_at.to_owned() })
        }
        204 | 539 | 108 | 109 => Ok(Outcome::Reconcile { code }),
        110 | 301 | 302 => Ok(Outcome::Reconcile { code }),
        215 | 225 | 297 | 298 => Ok(Outcome::Rejected { code }),
        _ => Ok(Outcome::Reconcile { code }),
    }
}

/// Recovery intent only. Persistence/CAS, permissions and scheduling belong to the caller.
/// No variant authorizes retransmission or allocation of a replacement number.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Recovery {
    QueryKey,
    QueryReceipt(String),
    PersistProtocol,
    PersistCancellation,
    ReviewRejection(u16),
}

pub fn after_timeout(receipt: Option<&str>) -> Result<Recovery, Error> {
    match receipt {
        Some(value) if digits(value, 15) => Ok(Recovery::QueryReceipt(value.to_owned())),
        Some(_) => Err(Error::Correlation),
        None => Ok(Recovery::QueryKey),
    }
}

pub fn next(outcome: &Outcome, receipt: Option<&str>) -> Result<Recovery, Error> {
    match outcome {
        Outcome::Accepted { receipt } => after_timeout(Some(receipt)),
        Outcome::Processing => match receipt {
            Some(_) => after_timeout(receipt),
            None => Err(Error::Correlation),
        },
        Outcome::Authorized { .. } => Ok(Recovery::PersistProtocol),
        Outcome::Cancelled => Ok(Recovery::PersistCancellation),
        Outcome::Rejected { code } => Ok(Recovery::ReviewRejection(*code)),
        Outcome::Reconcile { .. } => Ok(Recovery::QueryKey),
    }
}

#[cfg(test)]
#[path = "sefaz_response_tests.rs"]
mod tests;
