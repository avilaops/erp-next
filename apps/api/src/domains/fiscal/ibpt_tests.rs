use super::ibpt::*;
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[path = "ibpt_document_tests.rs"]
mod document_tests;

fn table() -> Vec<u8> {
    serde_json::to_vec(&json!({"uf":"SP","classification":"ncm","version":"26.2.C","source":"IBPT — fixture sintética","key":"fixture-only","validFrom":"2026-10-20","validTo":"2026-11-30","licenseReference":"synthetic-test-not-a-real-license","rows":[{"code":"00000000","ex":"0","national":"10.0000","imported":"20.0000","state":"12.0000","municipal":"0.0000"}]})).unwrap()
}
fn request() -> IbptInput {
    serde_json::from_value(json!({"uf":"SP","classification":"ncm","code":"00000000","ex":"0","origin":"national","amount":"10.05","asOf":"2026-11-03"})).unwrap()
}

fn draft_value() -> serde_json::Value {
    json!({
        "environment":"homologation", "model":55, "operationNature":"Venda",
        "taxRuleReference":"fixture-instruction",
        "recipient":{"taxId":"52998224725","legalName":"Destinatário sintético",
            "state":"SP","municipalityCode":"3550308","postalCode":"01001000",
            "street":"Rua sintética","number":"1","district":"Centro"},
        "items":[{"code":"FIXTURE","description":"Item sintético","unit":"UN",
            "ncm":"00000000","cfop":"5102","quantity":"1.0000",
            "unitPrice":"10.0500000000","grossTotal":"10.05","origin":0,
            "icmsCst":null,"csosn":"102","pisCst":"07","cofinsCst":"07"}],
        "productsTotal":"10.05",
        "ibpt":{"uf":"SP","asOf":"2026-11-03",
            "items":[{"ex":"0","origin":"national","version":"26.2.C"}]}
    })
}

#[test]
fn draft_ibpt_selection_requires_explicit_valid_date_uf_and_one_choice_per_item() {
    use super::model::{DraftInput, ProfileInput};
    let profile: ProfileInput = serde_json::from_value(json!({
        "environment":"homologation","state":"SP","municipalityCode":"3550308",
        "stateRegistration":"110042490114","crt":1,"series":1
    }))
    .unwrap();
    let input: DraftInput = serde_json::from_value(draft_value()).unwrap();
    assert_eq!(input.validate(&profile).unwrap(), 1005);
    for (field, invalid) in [
        ("uf", json!("XX")),
        ("asOf", json!("2026-02-30")),
        ("items", json!([])),
        ("items", json!([{"ex":"","origin":"national"}])),
        (
            "items",
            json!([{"ex":"0","origin":"national","version":"invalid"}]),
        ),
    ] {
        let mut value = draft_value();
        value["ibpt"][field] = invalid;
        let input: DraftInput = serde_json::from_value(value).unwrap();
        assert!(input.validate(&profile).is_err(), "{field}");
    }
}

#[test]
fn ibpt_import_requires_integrity_license_validity_and_unique_classification_keys() {
    let tenant = Uuid::now_v7();
    let bytes = table();
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let mut catalog = IbptCatalog::default();
    catalog.import(tenant, &bytes, &hash).unwrap();
    assert!(catalog.import(tenant, &bytes, &"0".repeat(64)).is_err());
    for (field, value) in [
        ("licenseReference", json!("")),
        ("validTo", json!("")),
        ("validTo", json!("2026-10-01")),
        ("uf", json!("XX")),
    ] {
        let mut value_table: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        value_table[field] = value;
        let raw = serde_json::to_vec(&value_table).unwrap();
        assert!(
            IbptCatalog::default()
                .import(tenant, &raw, &format!("{:x}", Sha256::digest(&raw)))
                .is_err()
        );
    }
    let mut duplicate: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let row = duplicate["rows"][0].clone();
    duplicate["rows"].as_array_mut().unwrap().push(row);
    let raw = serde_json::to_vec(&duplicate).unwrap();
    assert!(
        IbptCatalog::default()
            .import(tenant, &raw, &format!("{:x}", Sha256::digest(&raw)))
            .is_err()
    );
}

#[test]
fn ibpt_quote_is_informative_exact_and_isolated_by_tenant_uf_ex_and_date() {
    let tenant = Uuid::now_v7();
    let bytes = table();
    let mut catalog = IbptCatalog::default();
    catalog
        .import(tenant, &bytes, &format!("{:x}", Sha256::digest(&bytes)))
        .unwrap();
    let quote = catalog.quote(tenant, &request()).unwrap();
    assert_eq!(quote.status, IbptStatus::Available);
    let amounts = quote.amounts.unwrap();
    assert_eq!(amounts.federal, "1.01");
    assert_eq!(amounts.state, "1.21");
    assert_eq!(amounts.total, "2.22");
    assert_eq!(
        catalog.quote(Uuid::now_v7(), &request()).unwrap().status,
        IbptStatus::NotConfigured
    );
    for (field, value, status) in [
        ("uf", "RJ", IbptStatus::NotConfigured),
        ("ex", "1", IbptStatus::CodeNotFound),
        ("asOf", "2026-12-01", IbptStatus::OutsideValidity),
        ("asOf", "2026-10-19", IbptStatus::OutsideValidity),
    ] {
        let mut value_request = serde_json::to_value(request()).unwrap();
        value_request[field] = json!(value);
        let input = serde_json::from_value(value_request).unwrap();
        let quote = catalog.quote(tenant, &input).unwrap();
        assert_eq!(quote.status, status);
        assert!(quote.amounts.is_none());
    }
    let mut imported = request();
    imported.origin = GoodsOrigin::Imported;
    assert_eq!(
        catalog
            .quote(tenant, &imported)
            .unwrap()
            .amounts
            .unwrap()
            .federal,
        "2.01"
    );
}

#[test]
fn ibpt_manifest_loads_versioned_files_and_rejects_paths_and_corrupted_data() {
    let directory = std::env::temp_dir().join(format!("erp-ibpt-fixture-{}", Uuid::now_v7()));
    std::fs::create_dir(&directory).unwrap();
    let tenant = Uuid::now_v7();
    let bytes = table();
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let manifest = directory.join("manifest.json");
    std::fs::write(directory.join("table.json"), &bytes).unwrap();
    std::fs::write(
        &manifest,
        serde_json::to_vec(&json!([{"tenantId":tenant,"file":"table.json","sha256":hash}]))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        IbptCatalog::load(&manifest)
            .unwrap()
            .quote(tenant, &request())
            .unwrap()
            .status,
        IbptStatus::Available
    );
    std::fs::write(directory.join("table.json"), b"{}").unwrap();
    assert!(IbptCatalog::load(&manifest).is_err());
    std::fs::write(
        &manifest,
        serde_json::to_vec(&json!([{"tenantId":tenant,"file":"../table.json","sha256":hash}]))
            .unwrap(),
    )
    .unwrap();
    assert!(IbptCatalog::load(&manifest).is_err());
    std::fs::remove_dir_all(directory).unwrap();
}
