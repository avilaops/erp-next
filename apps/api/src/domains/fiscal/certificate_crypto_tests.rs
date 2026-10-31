use super::*;
use uuid::Uuid;

pub(crate) fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/a1-synthetic.json")).unwrap()
}

pub(crate) fn vault() -> Arc<CertificateVault> {
    let fixture = fixture();
    Arc::new(
        CertificateVault::new(
            &serde_json::json!({"active":"test-v1","keys":{"test-v1":STANDARD.encode([7_u8;32])}})
                .to_string(),
            fixture["rootPem"].as_str().unwrap().as_bytes(),
        )
        .unwrap(),
    )
}

fn inspect(name: &str, password: &str, tax_id: &str) -> Result<CertificateMetadata, &'static str> {
    let fixture = fixture();
    vault().inspect(
        &STANDARD.decode(fixture[name].as_str().unwrap()).unwrap(),
        password,
        tax_id,
        OffsetDateTime::from_unix_timestamp(1793232000).unwrap(),
    )
}

#[test]
fn modern_and_legacy_pfx_require_real_private_key_company_policy_validity_and_trusted_chain() {
    let fixture = fixture();
    let password = fixture["password"].as_str().unwrap();
    for kind in ["valid", "legacy"] {
        let metadata = inspect(kind, password, "04252011000110")
            .unwrap_or_else(|reason| panic!("{kind}: {reason}"));
        assert_eq!(metadata.tax_id, "04252011000110");
        assert!(metadata.chain_verified);
        assert!(!metadata.revocation_checked);
        assert_eq!(metadata.fingerprint.len(), 64);
    }
    for (kind, password, tax_id, message) in [
        (
            "valid",
            "wrong-password",
            "04252011000110",
            "Senha incorreta",
        ),
        ("otherCompany", password, "04252011000110", "CNPJ"),
        ("expired", password, "04252011000110", "vencido"),
        ("future", password, "04252011000110", "vigente"),
    ] {
        assert!(
            inspect(kind, password, tax_id)
                .err()
                .unwrap()
                .contains(message)
        );
    }
}

#[test]
fn encryption_authenticates_tenant_revision_metadata_and_ciphertext_and_supports_key_rotation() {
    let fixture = fixture();
    let password = fixture["password"].as_str().unwrap();
    let vault = vault();
    let tenant = Uuid::now_v7();
    let metadata = inspect("valid", password, "04252011000110").unwrap();
    let material = CertificateMaterial {
        pkcs12: STANDARD.decode(fixture["valid"].as_str().unwrap()).unwrap(),
        password: password.into(),
    };
    let sealed = vault.seal(tenant, 1, &metadata, &material).unwrap();
    let another = vault.seal(tenant, 1, &metadata, &material).unwrap();
    assert_ne!(sealed.nonce, another.nonce);
    assert!(
        !sealed
            .ciphertext
            .windows(password.len())
            .any(|value| value == password.as_bytes())
    );
    assert_eq!(
        vault.open(tenant, 1, &metadata, &sealed).unwrap().pkcs12,
        material.pkcs12
    );
    assert!(vault.open(Uuid::now_v7(), 1, &metadata, &sealed).is_err());
    assert!(vault.open(tenant, 2, &metadata, &sealed).is_err());
    let mut changed_metadata = metadata.clone();
    changed_metadata.valid_until += 86400;
    assert!(vault.open(tenant, 1, &changed_metadata, &sealed).is_err());
    let rotated = CertificateVault::new(&serde_json::json!({"active":"test-v2","keys":{"test-v1":STANDARD.encode([7_u8;32]),"test-v2":STANDARD.encode([8_u8;32])}}).to_string(), fixture["rootPem"].as_str().unwrap().as_bytes()).unwrap();
    assert!(rotated.open(tenant, 1, &metadata, &sealed).is_ok());
    let new = rotated.seal(tenant, 2, &metadata, &material).unwrap();
    assert_eq!(new.key_id, "test-v2");
    assert!(vault.open(tenant, 2, &metadata, &new).is_err());
}

#[test]
fn production_trust_anchors_reject_the_synthetic_test_ca() {
    let fixture = fixture();
    let official = CertificateVault::new(
        &serde_json::json!({"active":"test","keys":{"test":STANDARD.encode([7_u8;32])}})
            .to_string(),
        include_bytes!("../../../../../deploy/fiscal/icp-brasil-roots.pem"),
    )
    .unwrap();
    let result = official.inspect(
        &STANDARD.decode(fixture["valid"].as_str().unwrap()).unwrap(),
        fixture["password"].as_str().unwrap(),
        "04252011000110",
        OffsetDateTime::from_unix_timestamp(1793232000).unwrap(),
    );
    assert!(result.err().unwrap().contains("cadeia"));
}

#[test]
fn incomplete_exports_resolve_from_issuer_candidates_without_trusting_them() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/a1-chain-synthetic.json"
    ))
    .unwrap();
    let keyring =
        serde_json::json!({"active":"test","keys":{"test":STANDARD.encode([7_u8;32])}}).to_string();
    let mut vault =
        CertificateVault::new(&keyring, fixture["rootPem"].as_str().unwrap().as_bytes()).unwrap();
    let now = OffsetDateTime::from_unix_timestamp(1793232000).unwrap();
    let inspect = |vault: &CertificateVault, name: &str| {
        vault.inspect(
            &STANDARD.decode(fixture[name].as_str().unwrap()).unwrap(),
            fixture["password"].as_str().unwrap(),
            "04252011000110",
            now,
        )
    };
    assert!(inspect(&vault, "complete").unwrap().chain_verified);
    assert!(
        inspect(&vault, "leafOnly")
            .unwrap_err()
            .contains("completar a cadeia")
    );
    vault.intermediates =
        issuer_candidates(fixture["intermediatePem"].as_str().unwrap().as_bytes()).unwrap();
    assert!(inspect(&vault, "leafOnly").unwrap().chain_verified);
    assert!(
        inspect(&vault, "incompatibleUsage")
            .unwrap_err()
            .contains("autenticação")
    );
    vault.intermediates = issuer_candidates(
        fixture["expiredIntermediatePem"]
            .as_str()
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    assert!(inspect(&vault, "leafOnly").unwrap_err().contains("vencido"));
    // Even a correctly signed issuer candidate cannot introduce a new trusted root.
    let mut production = CertificateVault::new(
        &keyring,
        include_bytes!("../../../../../deploy/fiscal/icp-brasil-roots.pem"),
    )
    .unwrap();
    production.intermediates =
        issuer_candidates(fixture["intermediatePem"].as_str().unwrap().as_bytes()).unwrap();
    assert!(
        inspect(&production, "leafOnly")
            .unwrap_err()
            .contains("cadeia")
    );
    // A damaged issuer signature must not be accepted through name matching alone.
    let mut broken = production.intermediates[0].to_vec();
    *broken.last_mut().unwrap() ^= 1;
    vault.intermediates = vec![CertificateDer::from(broken)];
    assert!(inspect(&vault, "leafOnly").is_err());
    assert!(issuer_candidates(fixture["rootPem"].as_str().unwrap().as_bytes()).is_err());
}

#[test]
fn official_issuer_bundle_matches_its_reviewed_manifest() {
    let pem = include_bytes!("../../../../../deploy/fiscal/icp-brasil-intermediates.pem");
    let manifest: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../deploy/fiscal/icp-brasil-intermediates.json"
    ))
    .unwrap();
    assert_eq!(
        format!("{:x}", Sha256::digest(pem)),
        manifest["bundleSha256"].as_str().unwrap()
    );
    let certificates = issuer_candidates(pem).unwrap();
    let entries = manifest["certificates"].as_array().unwrap();
    assert_eq!(certificates.len(), entries.len());
    for (certificate, entry) in certificates.iter().zip(entries) {
        assert_eq!(
            format!("{:x}", Sha256::digest(certificate.as_ref())),
            entry["sha256"].as_str().unwrap()
        );
    }
}
