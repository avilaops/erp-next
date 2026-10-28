use super::*;

// Entirely synthetic: no real signature, taxpayer, endpoint or SEFAZ authorization.
const KEY: &str = "35261011222333000181550010000000011000000010";
const DIGEST: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const RECEIPT: &str = "351000000000001";

fn expected() -> Expected {
    Expected::new(KEY, DIGEST, Some(RECEIPT)).unwrap()
}

fn response(service: Service, status: u16, extra: &str) -> String {
    let name = match service {
        Service::Authorization => "retEnviNFe",
        Service::Receipt => "retConsReciNFe",
        Service::Situation => "retConsSitNFe",
    };
    let correlation = match service {
        Service::Authorization => String::new(),
        Service::Receipt => format!("<nRec>{RECEIPT}</nRec>"),
        Service::Situation => format!("<chNFe>{KEY}</chNFe>"),
    };
    format!("<{name} xmlns='{NS}' versao='4.00'><tpAmb>2</tpAmb><cStat>{status}</cStat>{correlation}{extra}</{name}>")
}

fn protocol_xml(code: u16) -> String {
    format!("<protNFe versao='4.00'><infProt><tpAmb>2</tpAmb><chNFe>{KEY}</chNFe><cStat>{code}</cStat><nProt>135260000000001</nProt><dhRecbto>2026-10-28T03:00:00-03:00</dhRecbto><digVal>{DIGEST}</digVal></infProt></protNFe>")
}

#[test]
fn synthetic_authorization_matches_key_environment_and_digest() {
    // Generate DV independently rather than treating an arbitrary key as valid.
    assert!(valid_key(KEY));
    for service in [Service::Authorization, Service::Receipt, Service::Situation] {
        for code in [100, 150] {
            let outer = if service == Service::Situation { code } else { 104 };
            let outcome = parse(&response(service, outer, &protocol_xml(code)), service, &expected()).unwrap();
            assert!(matches!(outcome, Outcome::Authorized { .. }));
            assert_eq!(next(&outcome, None), Ok(Recovery::PersistProtocol));
        }
    }
}

#[test]
fn accepted_and_processing_never_authorize_or_resend() {
    let xml = response(Service::Authorization, 103, &format!("<infRec><nRec>{RECEIPT}</nRec></infRec>"));
    let outcome = parse(&xml, Service::Authorization, &expected()).unwrap();
    assert_eq!(next(&outcome, None), Ok(Recovery::QueryReceipt(RECEIPT.into())));
    let outcome = parse(&response(Service::Receipt, 105, ""), Service::Receipt, &expected()).unwrap();
    assert_eq!(outcome, Outcome::Processing);
    assert_eq!(next(&outcome, Some(RECEIPT)), Ok(Recovery::QueryReceipt(RECEIPT.into())));
    assert_eq!(next(&outcome, None), Err(Error::Correlation));
}

#[test]
fn timeout_duplicate_not_found_and_unknown_require_consultation() {
    assert_eq!(after_timeout(None), Ok(Recovery::QueryKey));
    assert_eq!(after_timeout(Some(RECEIPT)), Ok(Recovery::QueryReceipt(RECEIPT.into())));
    assert_eq!(after_timeout(Some("bad")), Err(Error::Correlation));
    for code in [106, 108, 109, 110, 204, 217, 301, 302, 539, 999] {
        let outcome = parse(&response(Service::Situation, code, ""), Service::Situation, &expected()).unwrap();
        assert_eq!(outcome, Outcome::Reconcile { code });
        assert_eq!(next(&outcome, None), Ok(Recovery::QueryKey));
    }
}

#[test]
fn rejection_is_not_authorization_and_does_not_allocate_a_new_number() {
    for code in [215, 225, 297, 298] {
        let outcome = parse(&response(Service::Authorization, 104, &protocol_xml(code)), Service::Authorization, &expected()).unwrap();
        assert_eq!(outcome, Outcome::Rejected { code });
        assert_eq!(next(&outcome, None), Ok(Recovery::ReviewRejection(code)));
    }
}

#[test]
fn current_cancellation_is_separate_from_historical_authorization() {
    for code in [101, 151] {
        let outcome = parse(&response(Service::Situation, code, ""), Service::Situation, &expected()).unwrap();
        assert_eq!(outcome, Outcome::Cancelled);
        assert_eq!(next(&outcome, None), Ok(Recovery::PersistCancellation));
    }
}

#[test]
fn malformed_or_uncorrelated_authorization_is_refused() {
    let xml = response(Service::Authorization, 104, &protocol_xml(100));
    for mutated in [
        xml.replace("<tpAmb>2", "<tpAmb>1"),
        xml.replace(KEY, &format!("{}1", &KEY[..43])),
        xml.replace(DIGEST, "AQEBAQEBAQEBAQEBAQEBAQEBAQE="),
        xml.replace("135260000000001", "1"),
        xml.replace("<cStat>100</cStat>", "<cStat>100</cStat><cStat>150</cStat>"),
        xml.replace("<protNFe", "<wrapper><protNFe").replace("</protNFe>", "</protNFe></wrapper>"),
        xml.replace("</retEnviNFe>", &format!("{}</retEnviNFe>", protocol_xml(100))),
        xml.replace("<tpAmb>2</tpAmb>", "<tpAmb>2</tpAmb><tpAmb>2</tpAmb>"),
        xml.replace("xmlns=", "xmlns:fake="),
        xml.replace("versao='4.00'", "versao='3.10'"),
    ] {
        assert!(parse(&mutated, Service::Authorization, &expected()).is_err(), "{mutated}");
    }
    assert!(parse(&response(Service::Authorization, 104, ""), Service::Authorization, &expected()).is_err());
}

#[test]
fn receipt_and_situation_are_bound_to_the_request() {
    let xml = response(Service::Receipt, 105, "").replace(RECEIPT, "351000000000002");
    assert_eq!(parse(&xml, Service::Receipt, &expected()), Err(Error::Correlation));
    let xml = response(Service::Situation, 100, &protocol_xml(150));
    assert_eq!(parse(&xml, Service::Situation, &expected()), Err(Error::Correlation));
    assert!(parse(&response(Service::Receipt, 105, ""), Service::Authorization, &expected()).is_err());
}

#[test]
fn parser_limits_and_dtd_do_not_expose_xml_in_errors() {
    assert_eq!(parse(&"x".repeat(MAX_BYTES + 1), Service::Authorization, &expected()), Err(Error::Xml));
    let xml = format!("<!DOCTYPE x [<!ENTITY secret 'sensitive'>]>{}", response(Service::Authorization, 225, ""));
    assert_eq!(parse(&xml, Service::Authorization, &expected()), Err(Error::Xml));
    assert!(Expected::new(KEY, "bad", None).is_err());
    assert!(Expected::new("1", DIGEST, None).is_err());
    assert!(Expected::new(KEY, DIGEST, Some("bad")).is_err());
}
