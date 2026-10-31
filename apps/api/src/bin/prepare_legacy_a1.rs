//! Operator-only transform: encrypted legacy A1 on stdin, validated/sealed A1 on stdout.
//! This command never writes a database or sends a request to SEFAZ.

#[allow(dead_code)]
#[path = "../domains/fiscal/certificate_crypto.rs"]
mod certificate_crypto;

use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use anyhow::{Context, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use certificate_crypto::{CertificateMaterial, CertificateVault, MAX_A1_BYTES};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use time::OffsetDateTime;
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyInput {
    tenant_id: Uuid,
    tax_id: String,
    revision: i64,
    fingerprint: String,
    ciphertext: String,
    iv: String,
    auth_tag: String,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct LegacyMaterial {
    pfx: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Prepared {
    tenant_id: Uuid,
    revision: i64,
    metadata: certificate_crypto::CertificateMetadata,
    encryption_key_id: String,
    nonce: String,
    ciphertext: String,
}

fn prepare(
    input: LegacyInput,
    legacy_key: &[u8],
    vault: &CertificateVault,
    now: OffsetDateTime,
) -> anyhow::Result<Prepared> {
    ensure!(
        !input.tenant_id.is_nil() && input.revision > 0,
        "Invalid destination"
    );
    ensure!(
        input.tax_id.len() == 14 && input.tax_id.bytes().all(|b| b.is_ascii_digit()),
        "Invalid destination CNPJ"
    );
    ensure!(
        input.ciphertext.len() <= 2 * MAX_A1_BYTES,
        "Legacy envelope exceeds limit"
    );
    let cipher = Aes256Gcm::new_from_slice(legacy_key)
        .map_err(|_| anyhow::anyhow!("Invalid legacy vault key"))?;
    let iv = STANDARD.decode(&input.iv).context("Invalid legacy IV")?;
    let tag = STANDARD
        .decode(&input.auth_tag)
        .context("Invalid legacy tag")?;
    ensure!(iv.len() == 12 && tag.len() == 16, "Invalid legacy envelope");
    let mut ciphertext = STANDARD
        .decode(&input.ciphertext)
        .context("Invalid legacy ciphertext")?;
    ciphertext.extend(tag);
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(Nonce::from_slice(&iv), ciphertext.as_slice())
            .map_err(|_| anyhow::anyhow!("Legacy certificate authentication failed"))?,
    );
    let legacy: LegacyMaterial = serde_json::from_slice(&plaintext)
        .map_err(|_| anyhow::anyhow!("Invalid authenticated legacy material"))?;
    let material = CertificateMaterial {
        pkcs12: STANDARD
            .decode(&legacy.pfx)
            .context("Invalid legacy PKCS12 encoding")?,
        password: legacy.password.clone(),
    };
    let metadata = vault
        .inspect(&material.pkcs12, &material.password, &input.tax_id, now)
        .map_err(anyhow::Error::msg)?;
    ensure!(
        metadata.fingerprint == input.fingerprint,
        "Legacy certificate fingerprint mismatch"
    );
    let sealed = vault.seal(input.tenant_id, input.revision, &metadata, &material)?;
    let opened = vault.open(input.tenant_id, input.revision, &metadata, &sealed)?;
    ensure!(
        opened.pkcs12 == material.pkcs12 && opened.password == material.password,
        "Destination certificate verification failed"
    );
    Ok(Prepared {
        tenant_id: input.tenant_id,
        revision: input.revision,
        metadata,
        encryption_key_id: sealed.key_id,
        nonce: STANDARD.encode(sealed.nonce),
        ciphertext: STANDARD.encode(sealed.ciphertext),
    })
}

fn main() -> anyhow::Result<()> {
    let mut input = Zeroizing::new(String::new());
    std::io::stdin()
        .take(256 * 1024 + 1)
        .read_to_string(&mut input)?;
    ensure!(input.len() <= 256 * 1024, "Input exceeds limit");
    let request: LegacyInput = serde_json::from_str(&input).context("Invalid migration input")?;
    let encoded =
        Zeroizing::new(std::env::var("ERP_CERT_KEY").context("Legacy vault key required")?);
    let key = Zeroizing::new(
        STANDARD
            .decode(encoded.trim())
            .context("Invalid legacy vault key encoding")?,
    );
    let vault = CertificateVault::from_env()?.context("Destination vault required")?;
    let result = prepare(request, &key, &vault, OffsetDateTime::now_utc())?;
    serde_json::to_writer(std::io::stdout().lock(), &result)?;
    std::io::stdout().write_all(b"\n")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::AeadCore;

    fn legacy_input() -> LegacyInput {
        let fixture = certificate_crypto::tests::fixture();
        let vault = certificate_crypto::tests::vault();
        let pfx = fixture["valid"].as_str().unwrap();
        let password = fixture["password"].as_str().unwrap();
        let now = OffsetDateTime::from_unix_timestamp(1793232000).unwrap();
        let metadata = vault
            .inspect(
                &STANDARD.decode(pfx).unwrap(),
                password,
                "04252011000110",
                now,
            )
            .unwrap();
        let cipher = Aes256Gcm::new_from_slice(&[3_u8; 32]).unwrap();
        let nonce = Aes256Gcm::generate_nonce(&mut aes_gcm::aead::OsRng);
        let encrypted = cipher
            .encrypt(
                &nonce,
                serde_json::json!({"pfx":pfx,"password":password})
                    .to_string()
                    .as_bytes(),
            )
            .unwrap();
        let split = encrypted.len() - 16;
        LegacyInput {
            tenant_id: Uuid::now_v7(),
            tax_id: "04252011000110".into(),
            revision: 1,
            fingerprint: metadata.fingerprint,
            ciphertext: STANDARD.encode(&encrypted[..split]),
            iv: STANDARD.encode(nonce),
            auth_tag: STANDARD.encode(&encrypted[split..]),
        }
    }

    #[test]
    fn legacy_a1_is_validated_resealed_and_contains_no_plaintext_password() {
        let vault = certificate_crypto::tests::vault();
        let result = prepare(
            legacy_input(),
            &[3_u8; 32],
            &vault,
            OffsetDateTime::from_unix_timestamp(1793232000).unwrap(),
        )
        .unwrap();
        let json = serde_json::to_string(&result).unwrap();
        assert!(
            !json.contains(
                certificate_crypto::tests::fixture()["password"]
                    .as_str()
                    .unwrap()
            )
        );
        assert!(result.metadata.chain_verified);
        assert_eq!(result.revision, 1);
        let sealed = certificate_crypto::SealedCertificate {
            key_id: result.encryption_key_id,
            nonce: STANDARD.decode(result.nonce).unwrap(),
            ciphertext: STANDARD.decode(result.ciphertext).unwrap(),
        };
        let material = vault
            .open(result.tenant_id, 1, &result.metadata, &sealed)
            .unwrap();
        assert_eq!(
            STANDARD.encode(&material.pkcs12),
            certificate_crypto::tests::fixture()["valid"]
        );
        assert!(
            vault
                .open(Uuid::now_v7(), 1, &result.metadata, &sealed)
                .is_err()
        );
        assert!(
            vault
                .open(result.tenant_id, 2, &result.metadata, &sealed)
                .is_err()
        );
    }

    #[test]
    fn wrong_key_modified_envelope_company_and_fingerprint_are_refused() {
        let vault = certificate_crypto::tests::vault();
        let now = OffsetDateTime::from_unix_timestamp(1793232000).unwrap();
        assert!(prepare(legacy_input(), &[4_u8; 32], &vault, now).is_err());
        let mut input = legacy_input();
        input.auth_tag = STANDARD.encode([0_u8; 16]);
        assert!(prepare(input, &[3_u8; 32], &vault, now).is_err());
        let mut input = legacy_input();
        input.tax_id = "11111111000191".into();
        assert!(prepare(input, &[3_u8; 32], &vault, now).is_err());
        let mut input = legacy_input();
        input.fingerprint = "0".repeat(64);
        assert!(prepare(input, &[3_u8; 32], &vault, now).is_err());
    }
}
