use std::{collections::BTreeMap, sync::Arc, time::Duration};

use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, AeadCore, OsRng, Payload},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use p12_keystore::{KeyStore, KeyStoreEntry, Pkcs12ImportPolicy};
use rsa::{
    RsaPrivateKey, RsaPublicKey,
    pkcs8::{DecodePrivateKey, DecodePublicKey},
    traits::PublicKeyParts,
};
use rustls_pki_types::{CertificateDer, UnixTime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use utoipa::ToSchema;
use x509_parser::{
    extensions::{GeneralName, ParsedExtension},
    prelude::{FromDer, X509Certificate},
};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const MAX_A1_BYTES: usize = 64 * 1024;

fn issuer_candidates(pem: &[u8]) -> anyhow::Result<Vec<CertificateDer<'static>>> {
    anyhow::ensure!(
        pem.len() <= 8 * 1024 * 1024,
        "Fiscal A1 issuer bundle exceeds limit"
    );
    let certificates = x509_parser::pem::Pem::iter_from_buffer(pem)
        .map(|value| {
            let pem = value.map_err(|_| anyhow::anyhow!("Invalid fiscal A1 issuer bundle"))?;
            anyhow::ensure!(pem.label == "CERTIFICATE", "Invalid fiscal A1 issuer label");
            let (_, cert) = X509Certificate::from_der(&pem.contents)
                .map_err(|_| anyhow::anyhow!("Invalid fiscal A1 issuer certificate"))?;
            anyhow::ensure!(
                cert.subject() != cert.issuer()
                    && cert
                        .basic_constraints()?
                        .is_some_and(|extension| extension.value.ca),
                "Fiscal A1 issuer candidates must be intermediate CA certificates"
            );
            Ok(CertificateDer::from(pem.contents))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    anyhow::ensure!(
        !certificates.is_empty() && certificates.len() <= 4096,
        "Invalid fiscal A1 issuer count"
    );
    Ok(certificates)
}

fn chain_error(error: webpki::Error) -> &'static str {
    // Only a diagnostic category is logged: never the PFX, password or identity.
    let (reason, message) = match error {
        webpki::Error::UnknownIssuer => (
            "unknown_issuer",
            "Não foi possível completar a cadeia ICP-Brasil com os certificados do arquivo e do repositório oficial. Exporte o PFX com a cadeia completa ou solicite a atualização das intermediárias no ERP",
        ),
        webpki::Error::CertExpired { .. } => (
            "expired_issuer",
            "Um certificado da cadeia está vencido. Exporte o A1 com a cadeia atualizada da certificadora",
        ),
        webpki::Error::CertNotValidYet { .. } => (
            "future_issuer",
            "Um certificado da cadeia ainda não está vigente",
        ),
        webpki::Error::InvalidSignatureForPublicKey => (
            "invalid_signature",
            "A assinatura de um certificado da cadeia é inválida",
        ),
        webpki::Error::RequiredEkuNotFoundContext(_) => (
            "incompatible_usage",
            "A cadeia do certificado não permite autenticação de cliente para uso fiscal",
        ),
        webpki::Error::UnsupportedCriticalExtension => (
            "unsupported_critical_extension",
            "A cadeia contém uma extensão crítica ainda não suportada pelo validador do ERP. Solicite a análise de compatibilidade",
        ),
        webpki::Error::UnsupportedSignatureAlgorithmContext(_)
        | webpki::Error::UnsupportedSignatureAlgorithmForPublicKeyContext(_) => (
            "unsupported_algorithm",
            "A cadeia usa um algoritmo de assinatura não suportado pelo validador do ERP",
        ),
        webpki::Error::NameConstraintViolation | webpki::Error::PathLenConstraintViolated => (
            "path_constraint",
            "A cadeia viola as restrições de certificação da autoridade emissora",
        ),
        _ => (
            "invalid_chain",
            "A estrutura da cadeia do certificado não passou na validação ICP-Brasil",
        ),
    };
    tracing::warn!(reason, "fiscal A1 chain validation rejected");
    message
}

#[cfg(test)]
#[path = "certificate_crypto_tests.rs"]
pub(crate) mod tests;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Keyring {
    active: String,
    keys: BTreeMap<String, Zeroizing<String>>,
}

pub struct CertificateVault {
    active: String,
    keys: BTreeMap<String, Zeroizing<Vec<u8>>>,
    roots: Vec<CertificateDer<'static>>,
    intermediates: Vec<CertificateDer<'static>>,
    permits: Arc<tokio::sync::Semaphore>,
}

impl std::fmt::Debug for CertificateVault {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CertificateVault { credentials: [REDACTED] }")
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CertificateMetadata {
    pub subject: String,
    pub issuer: String,
    pub tax_id: String,
    pub fingerprint: String,
    pub serial_number: String,
    pub valid_from: i64,
    pub valid_until: i64,
    pub validated_at: i64,
    pub chain_verified: bool,
    pub revocation_checked: bool,
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub struct CertificateMaterial {
    pub pkcs12: Vec<u8>,
    pub password: String,
}

pub struct SealedCertificate {
    pub key_id: String,
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

impl CertificateVault {
    pub fn from_env() -> anyhow::Result<Option<Arc<Self>>> {
        let keyring = std::env::var("FISCAL_A1_KEYRING")
            .ok()
            .filter(|value| !value.is_empty())
            .map(Zeroizing::new);
        let roots = std::env::var("FISCAL_A1_CA_BUNDLE_FILE")
            .ok()
            .filter(|value| !value.is_empty());
        if keyring.is_none() && roots.is_none() {
            return Ok(None);
        }
        let keyring = keyring.ok_or_else(|| anyhow::anyhow!("FISCAL_A1_KEYRING is required"))?;
        let roots = if let Some(path) = roots {
            std::fs::read(path)?
        } else {
            include_bytes!("../../../../../deploy/fiscal/icp-brasil-roots.pem").to_vec()
        };
        Ok(Some(Arc::new(Self::new(&keyring, &roots)?)))
    }

    pub(crate) fn new(keyring: &str, pem: &[u8]) -> anyhow::Result<Self> {
        let parsed: Keyring = serde_json::from_str(keyring)
            .map_err(|_| anyhow::anyhow!("Invalid fiscal A1 keyring"))?;
        anyhow::ensure!(
            (1..=10).contains(&parsed.keys.len()),
            "Invalid fiscal A1 key count"
        );
        let mut keys = BTreeMap::new();
        for (id, encoded) in parsed.keys {
            anyhow::ensure!(
                !id.is_empty()
                    && id.len() <= 40
                    && id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'),
                "Invalid fiscal A1 key identifier"
            );
            let key = Zeroizing::new(
                STANDARD
                    .decode(encoded.as_bytes())
                    .map_err(|_| anyhow::anyhow!("Invalid fiscal A1 encryption key"))?,
            );
            anyhow::ensure!(
                key.len() == 32,
                "Fiscal A1 encryption keys require 32 bytes"
            );
            keys.insert(id, key);
        }
        anyhow::ensure!(
            keys.contains_key(&parsed.active),
            "Active fiscal A1 key is missing"
        );
        anyhow::ensure!(
            pem.len() <= 2 * 1024 * 1024,
            "Fiscal A1 CA bundle exceeds limit"
        );
        let roots = x509_parser::pem::Pem::iter_from_buffer(pem)
            .map(|value| {
                let pem = value.map_err(|_| anyhow::anyhow!("Invalid fiscal A1 CA bundle"))?;
                anyhow::ensure!(pem.label == "CERTIFICATE", "Invalid fiscal A1 trust anchor");
                let (_, root) = X509Certificate::from_der(&pem.contents)
                    .map_err(|_| anyhow::anyhow!("Invalid fiscal A1 root certificate"))?;
                anyhow::ensure!(
                    root.subject() == root.issuer()
                        && root
                            .basic_constraints()
                            .ok()
                            .flatten()
                            .is_some_and(|value| value.value.ca),
                    "Fiscal A1 trust anchors must be root CA certificates"
                );
                let certificate = CertificateDer::from(pem.contents);
                webpki::anchor_from_trusted_cert(&certificate)
                    .map_err(|_| anyhow::anyhow!("Invalid fiscal A1 trust anchor"))?;
                Ok(certificate)
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        anyhow::ensure!(
            !roots.is_empty() && roots.len() <= 100,
            "Fiscal A1 CA bundle requires trust anchors"
        );
        Ok(Self {
            active: parsed.active,
            keys,
            roots,
            intermediates: issuer_candidates(include_bytes!(
                "../../../../../deploy/fiscal/icp-brasil-intermediates.pem"
            ))?,
            permits: Arc::new(tokio::sync::Semaphore::new(2)),
        })
    }

    pub async fn validate(
        self: &Arc<Self>,
        material: Arc<CertificateMaterial>,
        tax_id: String,
    ) -> Result<CertificateMetadata, &'static str> {
        let permit = self.permits.clone().try_acquire_owned().map_err(
            |_| "Há outras verificações de certificado em andamento. Tente novamente em instantes",
        )?;
        let vault = self.clone();
        tokio::time::timeout(
            Duration::from_secs(20),
            tokio::task::spawn_blocking(move || {
                let _permit = permit;
                vault.inspect(
                    &material.pkcs12,
                    &material.password,
                    &tax_id,
                    OffsetDateTime::now_utc(),
                )
            }),
        )
        .await
        .map_err(|_| "A verificação do certificado excedeu o tempo limite")?
        .map_err(|_| "Não foi possível verificar o certificado")?
    }

    pub(crate) fn inspect(
        &self,
        bytes: &[u8],
        password: &str,
        tax_id: &str,
        now: OffsetDateTime,
    ) -> Result<CertificateMetadata, &'static str> {
        if bytes.is_empty()
            || bytes.len() > MAX_A1_BYTES
            || password.len() > 1024
            || password.contains('\0')
        {
            return Err("Selecione um certificado A1 de até 64 KiB e informe sua senha");
        }
        let store = KeyStore::from_pkcs12(bytes, password, Pkcs12ImportPolicy::Strict)
            .map_err(|_| "Senha incorreta ou arquivo PFX/P12 inválido")?;
        let chains = store
            .entries()
            .filter_map(|(_, value)| match value {
                KeyStoreEntry::PrivateKeyChain(chain) => Some(chain),
                _ => None,
            })
            .collect::<Vec<_>>();
        if chains.len() != 1 {
            return Err("O arquivo deve conter exatamente um certificado com sua chave privada");
        }
        let chain = chains[0];
        let leaf = chain
            .certs()
            .first()
            .ok_or("O arquivo não contém o certificado da empresa")?;
        let (_, certificate) =
            X509Certificate::from_der(leaf.as_der()).map_err(|_| "Certificado X.509 inválido")?;
        let valid_from = certificate.validity().not_before.timestamp();
        let valid_until = certificate.validity().not_after.timestamp();
        if now.unix_timestamp() < valid_from {
            return Err("O certificado ainda não está vigente");
        }
        if now.unix_timestamp() >= valid_until {
            return Err("O certificado está vencido. Envie um certificado renovado");
        }
        let alternatives = certificate
            .subject_alternative_name()
            .map_err(|_| "Identificação do certificado inválida")?
            .ok_or("O certificado não possui o CNPJ ICP-Brasil da empresa")?;
        let mut documents = Vec::new();
        for name in &alternatives.value.general_names {
            if let GeneralName::OtherName(oid, value) = name
                && oid.to_id_string() == "2.16.76.1.3.3"
            {
                use x509_parser::der_parser::der::{parse_der, parse_der_tagged_explicit};
                let (remaining, value) = parse_der_tagged_explicit(0_u32, parse_der)(value)
                    .map_err(|_| "CNPJ do certificado inválido")?;
                if !remaining.is_empty() {
                    return Err("CNPJ do certificado inválido");
                }
                let (_, _, inner) = value
                    .as_tagged()
                    .map_err(|_| "CNPJ do certificado inválido")?;
                let text = inner
                    .as_str()
                    .ok()
                    .or_else(|| {
                        inner
                            .as_slice()
                            .ok()
                            .and_then(|data| std::str::from_utf8(data).ok())
                    })
                    .ok_or("CNPJ do certificado inválido")?;
                documents.push(text.to_owned());
            }
        }
        if documents.len() != 1 || documents[0] != tax_id {
            return Err("O CNPJ do certificado não corresponde à empresa ativa");
        }
        let a1 =
            certificate
                .extensions()
                .iter()
                .any(|extension| match extension.parsed_extension() {
                    ParsedExtension::CertificatePolicies(policies) => {
                        policies.iter().any(|policy| {
                            let oid = policy.policy_id.to_id_string();
                            oid == "2.16.76.1.2.1" || oid.starts_with("2.16.76.1.2.1.")
                        })
                    }
                    _ => false,
                });
        if !a1 {
            return Err("Envie um certificado e-CNPJ A1 emitido na ICP-Brasil");
        }
        if !certificate
            .key_usage()
            .map_err(|_| "Uso da chave inválido")?
            .is_some_and(|usage| usage.value.digital_signature())
        {
            return Err("O certificado não permite assinatura digital");
        }
        let public = RsaPublicKey::from_public_key_der(certificate.public_key().raw)
            .map_err(|_| "O certificado fiscal exige chave RSA")?;
        if !(2048..=8192).contains(&public.n().bits()) {
            return Err("O certificado exige chave RSA entre 2048 e 8192 bits");
        }
        let private = RsaPrivateKey::from_pkcs8_der(chain.key().as_der())
            .map_err(|_| "A chave privada do certificado é inválida")?;
        private
            .validate()
            .map_err(|_| "A chave privada do certificado é inválida")?;
        if private.to_public_key() != public {
            return Err("A chave privada não corresponde ao certificado");
        }
        let leaf_der = CertificateDer::from(leaf.as_der());
        let anchors = self
            .roots
            .iter()
            .map(webpki::anchor_from_trusted_cert)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Cadeia de confiança indisponível")?;
        let mut intermediates = chain
            .certs()
            .iter()
            .skip(1)
            .map(|cert| CertificateDer::from(cert.as_der()))
            .collect::<Vec<_>>();
        // Some PKCS#12 exporters put CA certificates in separate trusted bags.
        // They are issuer candidates only: an uploaded CA never becomes an anchor.
        for (_, entry) in store.entries() {
            if let KeyStoreEntry::Certificate(cert) = entry {
                intermediates.push(CertificateDer::from(cert.as_der()));
            }
        }
        // Resolve incomplete exports locally using the checksum-pinned ITI archive.
        // Never fetch AIA URLs from an uploaded certificate (SSRF / availability).
        intermediates.extend(self.intermediates.iter().cloned());
        webpki::EndEntityCert::try_from(&leaf_der)
            .and_then(|certificate| {
                certificate
                    .verify_for_usage(
                        webpki::ALL_VERIFICATION_ALGS,
                        &anchors,
                        &intermediates,
                        UnixTime::since_unix_epoch(Duration::from_secs(
                            now.unix_timestamp().max(0) as u64,
                        )),
                        webpki::KeyUsage::client_auth(),
                        None,
                        None,
                    )
                    .map(|_| ())
            })
            .map_err(chain_error)?;
        Ok(CertificateMetadata {
            subject: certificate.subject().to_string(),
            issuer: certificate.issuer().to_string(),
            tax_id: tax_id.to_owned(),
            fingerprint: format!("{:x}", Sha256::digest(leaf.as_der())),
            serial_number: certificate.raw_serial_as_string(),
            valid_from,
            valid_until,
            validated_at: now.unix_timestamp(),
            chain_verified: true,
            revocation_checked: false,
        })
    }

    fn aad(tenant: uuid::Uuid, revision: i64, metadata: &CertificateMetadata) -> Vec<u8> {
        let metadata = serde_json::to_vec(metadata).expect("serializable certificate metadata");
        format!(
            "avila-erp:fiscal-a1:v1:{tenant}:{revision}:{:x}",
            Sha256::digest(metadata)
        )
        .into_bytes()
    }

    pub fn seal(
        &self,
        tenant: uuid::Uuid,
        revision: i64,
        metadata: &CertificateMetadata,
        material: &CertificateMaterial,
    ) -> anyhow::Result<SealedCertificate> {
        let cipher = Aes256Gcm::new_from_slice(&self.keys[&self.active])
            .map_err(|_| anyhow::anyhow!("Encryption unavailable"))?;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let plaintext = Zeroizing::new(serde_json::to_vec(material)?);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &plaintext,
                    aad: &Self::aad(tenant, revision, metadata),
                },
            )
            .map_err(|_| anyhow::anyhow!("Certificate encryption failed"))?;
        Ok(SealedCertificate {
            key_id: self.active.clone(),
            nonce: nonce.to_vec(),
            ciphertext,
        })
    }

    pub fn open(
        &self,
        tenant: uuid::Uuid,
        revision: i64,
        metadata: &CertificateMetadata,
        sealed: &SealedCertificate,
    ) -> anyhow::Result<CertificateMaterial> {
        anyhow::ensure!(sealed.nonce.len() == 12, "Invalid encrypted certificate");
        let key = self
            .keys
            .get(&sealed.key_id)
            .ok_or_else(|| anyhow::anyhow!("Certificate encryption key unavailable"))?;
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|_| anyhow::anyhow!("Decryption unavailable"))?;
        let plaintext = Zeroizing::new(
            cipher
                .decrypt(
                    Nonce::from_slice(&sealed.nonce),
                    Payload {
                        msg: &sealed.ciphertext,
                        aad: &Self::aad(tenant, revision, metadata),
                    },
                )
                .map_err(|_| anyhow::anyhow!("Certificate authentication failed"))?,
        );
        Ok(serde_json::from_slice(&plaintext)?)
    }
}
