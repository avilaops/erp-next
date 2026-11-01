use super::*;

const RECIPIENT: &str = "19131243000197";

#[test]
fn received_requires_exact_recipient() {
    let note = inspect_received(super::super::danfe::FIXTURE, RECIPIENT).unwrap();
    assert_eq!(note.recipient, RECIPIENT);
    assert_eq!(note.issuer, "04252011000110");
    assert!(inspect_received(super::super::danfe::FIXTURE, "04252011000110").is_err());
    assert!(inspect_received(super::super::danfe::FIXTURE, "00000000000000").is_err());
    assert!(inspect_received(super::super::danfe::FIXTURE, "").is_err());
    assert!(inspect_received("<resNFe/>", RECIPIENT).is_err());
    let cpf = super::super::danfe::FIXTURE
        .replace("<CNPJ>19131243000197</CNPJ>", "<CPF>52998224725</CPF>");
    assert!(inspect_received(&cpf, "52998224725").is_err());
}

#[test]
fn received_metadata_is_exact() {
    let note = inspect_received(super::super::danfe::FIXTURE, RECIPIENT).unwrap();
    assert_eq!(note.key, "35261004252011000110550010000000011000000017");
    assert_eq!(note.environment, "2");
    assert_eq!(note.issuer_name, "EMITENTE DE TESTE SEM VALOR FISCAL");
    assert_eq!(note.number, 1);
    assert_eq!(note.series, 1);
    assert_eq!(note.issued_at, "2026-10-27T12:00:00-03:00");
    assert_eq!(note.total_cents, 1000);
    assert_eq!(note.item_count, 1);
    let cent = super::super::danfe::FIXTURE.replace("<vNF>10.00</vNF>", "<vNF>0.01</vNF>");
    assert_eq!(inspect_received(&cent, RECIPIENT).unwrap().total_cents, 1);
}

#[test]
fn received_refuses_ambiguous_or_inconsistent_metadata() {
    for (from, to) in [
        ("<nNF>1</nNF>", "<nNF>2</nNF>"),
        ("<serie>1</serie>", "<serie>2</serie>"),
        ("2026-10-27T12:00:00-03:00", "2026-10-27T12:00:00"),
        ("2026-10-27T12:00:00-03:00", "2026-02-30T12:00:00-03:00"),
        ("2026-10-27T12:00:00-03:00", "2026-09-27T12:00:00-03:00"),
        ("<vNF>10.00</vNF>", "<vNF>10.001</vNF>"),
        ("<vNF>10.00</vNF>", "<vNF>99999999999999999999.00</vNF>"),
        ("<vNF>10.00</vNF>", "<vNF>NaN</vNF>"),
        ("<vNF>10.00</vNF>", "<vNF>-1.00</vNF>"),
        ("<vNF>10.00</vNF>", "<vNF>01.00</vNF>"),
        ("<vNF>10.00</vNF>", "<vNF>1e2</vNF>"),
        ("<vNF>10.00</vNF>", "<vNF>10.00</vNF><vNF>20.00</vNF>"),
        (
            "<xNome>EMITENTE DE TESTE SEM VALOR FISCAL</xNome>",
            "<xNome> </xNome>",
        ),
        ("<nNF>1</nNF>", "<nNF>1</nNF><nNF>2</nNF>"),
        ("<total><ICMSTot>", "<total><ICMSTot/><ICMSTot>"),
        ("<det nItem=\"1\">", "<det nItem=\"0\">"),
        ("</det>", "</det><det nItem=\"1\"/>"),
    ] {
        let xml = super::super::danfe::FIXTURE.replace(from, to);
        assert!(
            inspect_received(&xml, RECIPIENT).is_err(),
            "accepted change: {from}"
        );
    }
}

#[test]
fn received_refuses_dtd_and_oversize() {
    let xml = super::super::danfe::FIXTURE.replace(
        "<nfeProc ",
        "<!DOCTYPE nfeProc [<!ENTITY x SYSTEM 'file:///private'>]><nfeProc ",
    );
    assert!(inspect_received(&xml, RECIPIENT).is_err());
    let xml = format!("{}{}", super::super::danfe::FIXTURE, " ".repeat(900 * 1024));
    assert!(inspect_received(&xml, RECIPIENT).is_err());
}

#[test]
fn received_requires_cnpj_element_not_just_matching_digits() {
    let xml = super::super::danfe::FIXTURE
        .replace("<CNPJ>19131243000197</CNPJ>", "<CPF>19131243000197</CPF>");
    assert!(inspect_received(&xml, RECIPIENT).is_err());
}

#[test]
fn received_refuses_split_scalar_content() {
    for (from, to) in [
        ("<nNF>1</nNF>", "<nNF>1<!--split-->2</nNF>"),
        ("<tpAmb>2</tpAmb>", "<tpAmb>2<!--split-->1</tpAmb>"),
        (
            "<CNPJ>04252011000110</CNPJ>",
            "<CNPJ>04252011000110<!--split-->1</CNPJ>",
        ),
        ("<vNF>10.00</vNF>", "<vNF>10.00<?split value?>1</vNF>"),
        (
            "<xNome>EMITENTE DE TESTE SEM VALOR FISCAL</xNome>",
            "<xNome>EMITENTE<!--split--> DE TESTE SEM VALOR FISCAL</xNome>",
        ),
    ] {
        let xml = super::super::danfe::FIXTURE.replace(from, to);
        assert!(inspect_received(&xml, RECIPIENT).is_err());
    }
}

#[test]
fn received_requires_iso_datetime_separator() {
    let xml = super::super::danfe::FIXTURE
        .replace("2026-10-27T12:00:00-03:00", "2026-10-27X12:00:00-03:00");
    assert!(inspect_received(&xml, RECIPIENT).is_err());
}

#[test]
fn purchase_items_preserve_landed_taxes_and_reject_quantity_or_money_loss() {
    let xml = super::super::danfe::FIXTURE;
    let items = inspect_purchase_items(xml, RECIPIENT).unwrap();
    assert_eq!(items[0].quantity_micros, 1_000_000);
    assert_eq!(items[0].unit_cost_cents, 1000);
    let taxed = xml
        .replace("</prod>", "<vFrete>2.00</vFrete></prod>")
        .replace("<vNF>10.00</vNF>", "<vNF>12.00</vNF>");
    let items = inspect_purchase_items(&taxed, RECIPIENT).unwrap();
    assert_eq!(items[0].landed_cents, 1200);
    assert_eq!(items[0].components["vFrete"], 200);
    for (from, to) in [
        ("<qCom>1.0000</qCom>", "<qCom>2.0000</qCom>"),
        ("<vUnCom>10.0000000000</vUnCom>", "<vUnCom>10.001</vUnCom>"),
        ("<vNF>10.00</vNF>", "<vNF>11.00</vNF>"),
    ] {
        assert!(inspect_purchase_items(&xml.replace(from, to), RECIPIENT).is_err());
    }
}
