use super::{draft_value, table};
use crate::domains::fiscal::{
    ibpt::IbptCatalog,
    ibpt_document::{snapshot, validate_for_issue},
    model::DraftInput,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn catalog(tenant: Uuid) -> IbptCatalog {
    let bytes = table();
    let mut catalog = IbptCatalog::default();
    catalog
        .import(tenant, &bytes, &format!("{:x}", Sha256::digest(&bytes)))
        .unwrap();
    catalog
}

#[test]
fn document_snapshot_uses_the_owned_source_and_never_substitutes_unavailability_with_zero() {
    let tenant = Uuid::now_v7();
    let input: DraftInput = serde_json::from_value(draft_value()).unwrap();
    let source = catalog(tenant);
    let saved = snapshot(&source, tenant, &input).unwrap().unwrap();
    assert_eq!(saved.tenant_id, tenant);
    assert_eq!(saved.items[0].item_code, "FIXTURE");
    assert_eq!(saved.items[0].code, "00000000");
    assert_eq!(saved.items[0].amount, "10.05");
    assert_eq!(saved.items[0].metadata.version, "26.2.C");
    assert_eq!(
        saved.items[0].metadata.sha256,
        format!("{:x}", Sha256::digest(table()))
    );
    assert_eq!(saved.amounts.federal, "1.01");
    assert_eq!(saved.amounts.state, "1.21");
    assert_eq!(saved.amounts.total, "2.22");
    assert!(snapshot(&source, Uuid::now_v7(), &input).is_err());
    assert!(snapshot(&IbptCatalog::default(), tenant, &input).is_err());
    let mut manual = input.clone();
    manual.ibpt = None;
    assert!(
        snapshot(&IbptCatalog::default(), tenant, &manual)
            .unwrap()
            .is_none()
    );
    for (field, value) in [
        ("uf", json!("RJ")),
        ("asOf", json!("2026-12-01")),
        ("items", json!([{"ex":"1","origin":"national"}])),
    ] {
        let mut changed = draft_value();
        changed["ibpt"][field] = value;
        let changed: DraftInput = serde_json::from_value(changed).unwrap();
        assert!(snapshot(&source, tenant, &changed).is_err(), "{field}");
    }
}

#[test]
fn document_snapshot_freezes_version_and_cents_across_a_catalog_refresh() {
    let tenant = Uuid::now_v7();
    let input: DraftInput = serde_json::from_value(draft_value()).unwrap();
    let mut source = catalog(tenant);
    let original = snapshot(&source, tenant, &input).unwrap().unwrap();
    let mut newer: serde_json::Value = serde_json::from_slice(&table()).unwrap();
    newer["version"] = json!("26.2.D");
    newer["rows"][0]["national"] = json!("15.0000");
    let bytes = serde_json::to_vec(&newer).unwrap();
    source
        .import(tenant, &bytes, &format!("{:x}", Sha256::digest(&bytes)))
        .unwrap();
    let mut latest = input.clone();
    latest.ibpt.as_mut().unwrap().items[0].version = None;
    let refreshed = snapshot(&source, tenant, &latest).unwrap().unwrap();
    assert_eq!(refreshed.items[0].metadata.version, "26.2.D");
    assert_eq!(refreshed.amounts.total, "2.72");
    let persisted = serde_json::to_vec(&original).unwrap();
    let restored = serde_json::from_slice(&persisted).unwrap();
    validate_for_issue(Some(&restored), tenant, &input, "2026-11-04T01:00:00Z").unwrap();
    assert_eq!(original.amounts.total, "2.22");
    assert_ne!(
        original.items[0].metadata.sha256,
        refreshed.items[0].metadata.sha256
    );
}

#[test]
fn document_snapshot_checks_issue_date_and_draft_bindings_before_numbering() {
    let tenant = Uuid::now_v7();
    let input: DraftInput = serde_json::from_value(draft_value()).unwrap();
    let saved = snapshot(&catalog(tenant), tenant, &input).unwrap().unwrap();
    validate_for_issue(Some(&saved), tenant, &input, "2026-11-03T10:00:00-03:00").unwrap();
    assert!(validate_for_issue(Some(&saved), tenant, &input, "2026-11-04T03:00:00Z").is_err());
    assert!(
        validate_for_issue(
            Some(&saved),
            Uuid::now_v7(),
            &input,
            "2026-11-03T10:00:00-03:00"
        )
        .is_err()
    );
    assert!(validate_for_issue(None, tenant, &input, "2026-11-03T10:00:00-03:00").is_err());
    for path in ["code", "ex", "itemCode", "amount"] {
        let mut value = serde_json::to_value(&saved).unwrap();
        value["items"][0][path] = json!("wrong");
        let changed = serde_json::from_value(value).unwrap();
        assert!(
            validate_for_issue(Some(&changed), tenant, &input, "2026-11-03T10:00:00-03:00")
                .is_err(),
            "{path}"
        );
    }
    let mut changed = saved.clone();
    changed.amounts.total = "0.00".into();
    assert!(
        validate_for_issue(Some(&changed), tenant, &input, "2026-11-03T10:00:00-03:00").is_err()
    );
}

#[test]
fn document_snapshot_base_includes_ipi_rounded_once_for_each_item() {
    let tenant = Uuid::now_v7();
    let mut value = draft_value();
    value["items"][0]["unitPrice"] = json!("0.0500000000");
    value["items"][0]["grossTotal"] = json!("0.05");
    value["items"][0]["csosn"] = serde_json::Value::Null;
    value["items"][0]["icmsCst"] = json!("00");
    let mut second = value["items"][0].clone();
    second["code"] = json!("SECOND");
    value["items"].as_array_mut().unwrap().push(second);
    value["productsTotal"] = json!("0.10");
    value["ibpt"]["items"] = json!([{"ex":"0","origin":"national"},{"ex":"0","origin":"national"}]);
    value["taxDeclaration"] = json!({"recipientTaxpayer":false,"recipientStateRegistration":null,
        "finalConsumer":true,"icmsRate":"0.0000","pisRate":null,"cofinsRate":null,
        "ipiCst":"50","ipiFrameCode":"999","ipiRate":"10.0000",
        "ipiInIcmsBase":false,"icmsOutOfContributions":false,
        "ibsCbs":{"cst":"000","classCode":"000001","ibsStateRate":"0.0000","ibsCityRate":"0.0000","cbsRate":"0.0000"}});
    let input: DraftInput = serde_json::from_value(value).unwrap();
    let saved = snapshot(&catalog(tenant), tenant, &input).unwrap().unwrap();
    assert_eq!(saved.items[0].amount, "0.06");
    assert_eq!(saved.items[1].amount, "0.06");
    assert_eq!(saved.items[0].amounts.total, "0.02");
    assert_eq!(saved.amounts.total, "0.04");
    assert_eq!(input.products_total, "0.10");
}
