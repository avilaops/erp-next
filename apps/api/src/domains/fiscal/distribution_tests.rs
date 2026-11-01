use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::{Compression, write::GzEncoder};
use std::io::Write;

pub const KEY: &str = "35261004252011000110550010000000011000000017";
pub const ZERO: &str = "000000000000000";
pub const ONE: &str = "000000000000001";
pub const CNPJ: &str = "04252011000110";

pub fn summary() -> String {
    format!(
        "<resNFe xmlns=\"{NFE}\" versao=\"1.01\"><chNFe>{KEY}</chNFe><CNPJ>{CNPJ}</CNPJ><xNome>Fornecedor sintético</xNome><dhEmi>2026-10-01T12:00:00-03:00</dhEmi><vNF>10.01</vNF><cSitNFe>1</cSitNFe></resNFe>"
    )
}
pub fn zipped(xml: &str, nsu: &str, schema: &str) -> String {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(xml.as_bytes()).unwrap();
    format!(
        "<docZip NSU=\"{nsu}\" schema=\"{schema}\">{}</docZip>",
        STANDARD.encode(encoder.finish().unwrap())
    )
}
pub fn reply(status: &str, last: &str, max: &str, docs: &str) -> String {
    format!(
        "<retDistDFeInt xmlns=\"{NFE}\" versao=\"1.01\"><tpAmb>1</tpAmb><cStat>{status}</cStat><xMotivo>Sintético</xMotivo><ultNSU>{last}</ultNSU><maxNSU>{max}</maxNSU><loteDistDFeInt>{docs}</loteDistDFeInt></retDistDFeInt>"
    )
}
#[test]
fn summary_retains_original_bytes_cursor_and_exact_money() {
    let xml = summary();
    let batch = parse(
        &reply("138", ONE, ONE, &zipped(&xml, ONE, "resNFe_v1.01.xsd")),
        ZERO,
        CNPJ,
    )
    .unwrap();
    assert_eq!(batch.last_nsu, ONE);
    assert_eq!(batch.documents[0].xml, xml);
    assert_eq!(batch.documents[0].kind, "summary");
    assert_eq!(batch.documents[0].note.as_ref().unwrap().total_cents, 1001);
    assert_eq!(batch.documents[0].note.as_ref().unwrap().key, KEY);
}
#[test]
fn empty_and_consumption_block_responses_do_not_reset_the_cursor() {
    assert!(
        parse(&reply("137", ONE, ONE, ""), ONE, CNPJ)
            .unwrap()
            .documents
            .is_empty()
    );
    let blocked = format!(
        "<retDistDFeInt xmlns=\"{NFE}\"><tpAmb>1</tpAmb><cStat>656</cStat></retDistDFeInt>"
    );
    assert_eq!(parse(&blocked, ONE, CNPJ).unwrap().last_nsu, ONE);
}
#[test]
fn inconsistent_cursors_ambiguous_xml_and_overlarge_gzip_are_refused() {
    let zipped_summary = zipped(&summary(), ONE, "resNFe_v1.01.xsd");
    for xml in [
        reply("138", ONE, ZERO, &zipped_summary),
        reply("138", ZERO, ONE, &zipped_summary),
        reply("138", ONE, ONE, ""),
        reply("137", ONE, ONE, &zipped_summary),
        reply(
            "138",
            ONE,
            ONE,
            &format!("{zipped_summary}{zipped_summary}"),
        ),
        reply(
            "138",
            ONE,
            ONE,
            &zipped(&"x".repeat(921_601), ONE, "unknown.xsd"),
        ),
        reply("138", ONE, ONE, &zipped_summary).replace("<tpAmb>1</tpAmb>", "<tpAmb>2</tpAmb>"),
        reply("137", ONE, ONE, "")
            .replace("<cStat>137</cStat>", "<cStat>137</cStat><cStat>138</cStat>"),
        reply("137", ONE, ONE, "").replace(NFE, "urn:wrong"),
    ] {
        assert!(parse(&xml, ZERO, CNPJ).is_err(), "accepted invalid batch");
    }
    assert!(parse(&reply("137", ZERO, ZERO, ""), ONE, CNPJ).is_err());
}
#[test]
fn full_nfe_must_belong_to_recipient_and_environment() {
    let fixture = super::super::danfe::FIXTURE
        .replace("<CNPJ>19131243000197</CNPJ>", "<CNPJ>04252011000110</CNPJ>");
    let production = fixture.replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>");
    let batch = reply(
        "138",
        ONE,
        ONE,
        &zipped(&production, ONE, "procNFe_v4.00.xsd"),
    );
    assert_eq!(parse(&batch, ZERO, CNPJ).unwrap().documents[0].kind, "nfe");
    assert_eq!(
        parse(&batch, ZERO, "11222333000181").unwrap().documents[0].kind,
        "other"
    );
    assert!(
        parse(
            &reply("138", ONE, ONE, &zipped(&fixture, ONE, "procNFe_v4.00.xsd")),
            ZERO,
            CNPJ
        )
        .is_err()
    );
}

pub fn cpf_xml() -> (String, String) {
    let body = format!("{}00052998224725{}", &KEY[..6], &KEY[20..43]);
    let sum: u32 = body
        .bytes()
        .rev()
        .enumerate()
        .map(|(index, byte)| u32::from(byte - b'0') * (2 + index as u32 % 8))
        .sum();
    let digit = 11 - sum % 11;
    let key = format!("{body}{}", if digit >= 10 { 0 } else { digit });
    let full = super::super::danfe::FIXTURE
        .replace(KEY, &key)
        .replace("<CNPJ>04252011000110</CNPJ>", "<CPF>52998224725</CPF>")
        .replace("<CNPJ>19131243000197</CNPJ>", "<CNPJ>04252011000110</CNPJ>")
        .replace("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>");
    (key, full)
}
#[test]
fn cpf_issuer_and_other_distribution_roles_never_stall_the_cursor() {
    let (key, full) = cpf_xml();
    let summary = summary()
        .replace(KEY, &key)
        .replace("<CNPJ>04252011000110</CNPJ>", "<CPF>52998224725</CPF>");
    let docs = format!(
        "{}{}",
        zipped(&summary, ONE, "resNFe_v1.01.xsd"),
        zipped(&full, "000000000000002", "procNFe_v4.00.xsd")
    );
    let batch = parse(
        &reply("138", "000000000000002", "000000000000002", &docs),
        ZERO,
        CNPJ,
    )
    .unwrap();
    assert_eq!(
        batch.documents[0].note.as_ref().unwrap().issuer,
        "52998224725"
    );
    assert_eq!(batch.documents[1].kind, "nfe");
    let batch = parse(
        &reply("138", ONE, ONE, &zipped(&full, ONE, "procNFe_v4.00.xsd")),
        ZERO,
        "19131243000197",
    )
    .unwrap();
    assert_eq!(batch.documents[0].kind, "other");
    assert!(batch.documents[0].note.is_none());
}
