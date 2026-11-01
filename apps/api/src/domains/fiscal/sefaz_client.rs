//! Fixed official endpoints; A1 stays in process and is used only for mTLS/signing.
use base64::{Engine, engine::general_purpose::STANDARD};
use p12_keystore::{KeyStore, KeyStoreEntry, Pkcs12ImportPolicy};
use std::time::Duration;
use zeroize::Zeroizing;

use super::certificate_crypto::CertificateMaterial;

const DISTRIBUTION: &str =
    "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const EVENTS: &str = "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
pub const DIST_WSDL: &str = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe";
pub const EVENT_WSDL: &str = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4";

#[derive(Clone, Debug)]
pub struct Sefaz {
    distribution: String,
    events: String,
}
impl Sefaz {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        match std::env::var("SEFAZ_MONITOR_ENABLED")
            .as_deref()
            .unwrap_or("false")
        {
            "false" => Ok(None),
            "true" => Ok(Some(Self {
                distribution: DISTRIBUTION.into(),
                events: EVENTS.into(),
            })),
            _ => anyhow::bail!("SEFAZ_MONITOR_ENABLED must be true or false"),
        }
    }
    #[cfg(test)]
    pub(crate) fn test(endpoint: String) -> Self {
        Self {
            distribution: endpoint.clone(),
            events: endpoint,
        }
    }

    pub fn client(
        &self,
        material: &CertificateMaterial,
        certificates: &[Vec<u8>],
    ) -> Result<reqwest::Client, &'static str> {
        let (key, _) = key_chain(material)?;
        let mut pem = Zeroizing::new(String::new());
        pem.push_str(&pem_block("PRIVATE KEY", &key));
        for certificate in certificates {
            pem.push_str(&pem_block("CERTIFICATE", certificate));
        }
        let identity = reqwest::Identity::from_pem(pem.as_bytes())
            .map_err(|_| "Identidade mTLS indisponível")?;
        reqwest::Client::builder()
            .identity(identity)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| "Transporte fiscal indisponível")
    }
    pub async fn send(
        &self,
        client: &reqwest::Client,
        event: bool,
        body: String,
    ) -> Result<String, &'static str> {
        let (endpoint, wsdl, action) = if event {
            (&self.events, EVENT_WSDL, "nfeRecepcaoEvento")
        } else {
            (&self.distribution, DIST_WSDL, "nfeDistDFeInteresse")
        };
        let mut response = client
            .post(endpoint)
            .header(
                "Content-Type",
                format!("application/soap+xml; charset=utf-8; action=\"{wsdl}/{action}\""),
            )
            .body(body)
            .send()
            .await
            .map_err(|_| "Resultado fiscal não confirmado")?;
        if !response.status().is_success() {
            return Err("Serviço fiscal não confirmou a operação");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Resposta fiscal incompleta")?
        {
            if bytes.len() + chunk.len() > 10 * 1024 * 1024 {
                return Err("Resposta fiscal excede limites");
            }
            bytes.extend_from_slice(&chunk);
        }
        String::from_utf8(bytes).map_err(|_| "Resposta fiscal não é UTF-8")
    }
}
pub type KeyChain = (Zeroizing<Vec<u8>>, Vec<Vec<u8>>);

pub fn key_chain(material: &CertificateMaterial) -> Result<KeyChain, &'static str> {
    let store = KeyStore::from_pkcs12(
        &material.pkcs12,
        &material.password,
        Pkcs12ImportPolicy::Strict,
    )
    .map_err(|_| "Certificado indisponível")?;
    let mut chains = store.entries().filter_map(|(_, entry)| {
        if let KeyStoreEntry::PrivateKeyChain(chain) = entry {
            Some(chain)
        } else {
            None
        }
    });
    let chain = chains.next().ok_or("Certificado sem chave privada")?;
    if chains.next().is_some() || chain.certs().is_empty() {
        return Err("Identidade fiscal ambígua");
    }
    Ok((
        Zeroizing::new(chain.key().as_der().to_vec()),
        chain
            .certs()
            .iter()
            .map(|cert| cert.as_der().to_vec())
            .collect(),
    ))
}
fn pem_block(label: &str, bytes: &[u8]) -> Zeroizing<String> {
    let encoded = Zeroizing::new(STANDARD.encode(bytes));
    let lines = Zeroizing::new(
        encoded
            .as_bytes()
            .chunks(64)
            .map(|line| std::str::from_utf8(line).expect("base64"))
            .collect::<Vec<_>>()
            .join("\n"),
    );
    Zeroizing::new(format!(
        "-----BEGIN {label}-----\n{}\n-----END {label}-----\n",
        lines.as_str()
    ))
}
pub fn envelope(cnpj: &str, uf: &str, nsu: &str) -> Result<String, &'static str> {
    let code = match uf {
        "RO" => "11",
        "AC" => "12",
        "AM" => "13",
        "RR" => "14",
        "PA" => "15",
        "AP" => "16",
        "TO" => "17",
        "MA" => "21",
        "PI" => "22",
        "CE" => "23",
        "RN" => "24",
        "PB" => "25",
        "PE" => "26",
        "AL" => "27",
        "SE" => "28",
        "BA" => "29",
        "MG" => "31",
        "ES" => "32",
        "RJ" => "33",
        "SP" => "35",
        "PR" => "41",
        "SC" => "42",
        "RS" => "43",
        "MS" => "50",
        "MT" => "51",
        "GO" => "52",
        "DF" => "53",
        _ => return Err("UF da empresa inválida"),
    };
    if !super::distribution::digits(cnpj, 14) || !super::distribution::digits(nsu, 15) {
        return Err("Controle fiscal inválido");
    }
    Ok(format!(
        "<Envelope xmlns=\"http://www.w3.org/2003/05/soap-envelope\"><Body><nfeDistDFeInteresse xmlns=\"{DIST_WSDL}\"><nfeDadosMsg><distDFeInt xmlns=\"{}\" versao=\"1.01\"><tpAmb>1</tpAmb><cUFAutor>{code}</cUFAutor><CNPJ>{cnpj}</CNPJ><distNSU><ultNSU>{nsu}</ultNSU></distNSU></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></Body></Envelope>",
        super::distribution::NFE
    ))
}
