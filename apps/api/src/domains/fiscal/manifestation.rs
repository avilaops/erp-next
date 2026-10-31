use super::{
    FiscalError,
    certificate_crypto::CertificateMaterial,
    certificates,
    distribution::{NFE, child, digits, text, unique, valid_key, xml_document},
    sefaz_client,
};
use crate::{
    domains::{DomainChange, DomainError, authorized, command_key, db, record, response},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::Response,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use rsa::{
    RsaPrivateKey,
    pkcs1v15::SigningKey,
    pkcs8::DecodePrivateKey,
    signature::{SignatureEncoding, Signer},
};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use sqlx::FromRow;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestInput {
    pub event_type: String,
    pub justification: Option<String>,
}
impl ManifestInput {
    pub fn validate(&self) -> Result<&'static str, &'static str> {
        let description = match self.event_type.as_str() {
            "210200" => "Confirmacao da Operacao",
            "210210" => "Ciencia da Operacao",
            "210220" => "Desconhecimento da Operacao",
            "210240" => "Operacao nao Realizada",
            _ => return Err("Tipo de manifestação inválido"),
        };
        if self.event_type == "210240" {
            let value = self.justification.as_deref().unwrap_or("").trim();
            if !(15..=255).contains(&value.chars().count()) || value.chars().any(char::is_control) {
                return Err("Informe uma justificativa com 15 a 255 caracteres, sem controles");
            }
        } else if self.justification.is_some() {
            return Err("Justificativa só é permitida na operação não realizada");
        }
        Ok(description)
    }
}

const DS: &str = "http://www.w3.org/2000/09/xmldsig#";
const C14N: &str = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn signed_event(
    material: &CertificateMaterial,
    input: &ManifestInput,
    key: &str,
    cnpj: &str,
    now: OffsetDateTime,
) -> Result<String, &'static str> {
    let description = input.validate()?;
    if !valid_key(key) || !digits(cnpj, 14) {
        return Err("Identidade fiscal inválida");
    }
    let id = format!("ID{}{key}01", input.event_type);
    let date = now
        .replace_nanosecond(0)
        .map_err(|_| "Data do evento inválida")?
        .to_offset(time::UtcOffset::from_hms(-3, 0, 0).expect("fiscal offset"))
        .format(&Rfc3339)
        .map_err(|_| "Data do evento inválida")?;
    let justification = input
        .justification
        .as_ref()
        .map(|value| format!("<xJust>{}</xJust>", escape(value.trim())))
        .unwrap_or_default();
    let body = format!(
        "<cOrgao>91</cOrgao><tpAmb>1</tpAmb><CNPJ>{cnpj}</CNPJ><chNFe>{key}</chNFe><dhEvento>{date}</dhEvento><tpEvento>{}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao=\"1.00\"><descEvento>{description}</descEvento>{justification}</detEvento>",
        input.event_type
    );
    // Only this generated vocabulary is canonicalized. Arbitrary imported XML is never signed.
    let canonical = format!("<infEvento xmlns=\"{NFE}\" Id=\"{id}\">{body}</infEvento>");
    let digest = STANDARD.encode(Sha1::digest(canonical.as_bytes()));
    let signed_info = |namespace: &str| {
        format!(
            "<SignedInfo{namespace}><CanonicalizationMethod Algorithm=\"{C14N}\"></CanonicalizationMethod><SignatureMethod Algorithm=\"{DS}rsa-sha1\"></SignatureMethod><Reference URI=\"#{id}\"><Transforms><Transform Algorithm=\"{DS}enveloped-signature\"></Transform><Transform Algorithm=\"{C14N}\"></Transform></Transforms><DigestMethod Algorithm=\"{DS}sha1\"></DigestMethod><DigestValue>{digest}</DigestValue></Reference></SignedInfo>"
        )
    };
    let (key, certificates) = sefaz_client::key_chain(material)?;
    let private =
        RsaPrivateKey::from_pkcs8_der(&key).map_err(|_| "Chave de assinatura indisponível")?;
    let signature =
        SigningKey::<Sha1>::new(private).sign(signed_info(&format!(" xmlns=\"{DS}\"")).as_bytes());
    Ok(format!(
        "<evento xmlns=\"{NFE}\" versao=\"1.00\"><infEvento Id=\"{id}\">{body}</infEvento><Signature xmlns=\"{DS}\">{}<SignatureValue>{}</SignatureValue><KeyInfo><X509Data><X509Certificate>{}</X509Certificate></X509Data></KeyInfo></Signature></evento>",
        signed_info(""),
        STANDARD.encode(signature.to_bytes()),
        STANDARD.encode(&certificates[0])
    ))
}
fn envelope(event: &str) -> String {
    format!(
        "<Envelope xmlns=\"http://www.w3.org/2003/05/soap-envelope\"><Body><nfeDadosMsg xmlns=\"{}\"><envEvento xmlns=\"{NFE}\" versao=\"1.00\"><idLote>1</idLote>{event}</envEvento></nfeDadosMsg></Body></Envelope>",
        sefaz_client::EVENT_WSDL
    )
}

#[derive(Debug)]
pub struct EventResult {
    pub outcome: &'static str,
    pub status: String,
    pub protocol: Option<String>,
}
pub fn parse_result(
    xml: &str,
    key: &str,
    event_type: &str,
    cnpj: &str,
) -> Result<EventResult, &'static str> {
    let document = xml_document(xml)?;
    let root = unique(&document, "retEnvEvento")?;
    if text(root, "cStat")? != "128" {
        return Err("Lote de manifestação não confirmado");
    }
    let info = child(child(root, "retEvento")?, "infEvento")?;
    if text(info, "chNFe")? != key
        || text(info, "tpEvento")? != event_type
        || text(info, "nSeqEvento")? != "1"
        || text(info, "tpAmb")? != "1"
    {
        return Err("Resposta de outro evento ou ambiente");
    }
    if let Ok(dest) = child(info, "CNPJDest")
        && dest.text() != Some(cnpj)
    {
        return Err("Resposta de outro destinatário");
    }
    let status = text(info, "cStat")?;
    if !digits(status, 3) {
        return Err("Código de retorno inválido");
    }
    let protocol = if status == "135" {
        Some(text(info, "nProt")?.to_owned())
    } else {
        None
    };
    if protocol.as_ref().is_some_and(|value| !digits(value, 15)) {
        return Err("Protocolo do evento inválido");
    }
    Ok(EventResult {
        outcome: match status {
            "135" => "accepted",
            "136" | "573" => "unknown",
            _ => "rejected",
        },
        status: status.into(),
        protocol,
    })
}

#[derive(Serialize, FromRow, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSnapshot {
    id: Uuid,
    event_type: String,
    outcome: String,
    status: Option<String>,
    protocol: Option<String>,
}

#[utoipa::path(post,path="/api/v1/fiscal/monitor/documents/{id}/manifest",tag="Fiscal",operation_id="manifest_monitor_nfe",request_body=ManifestInput,security(("bearerAuth"=[])),params(("id"=i64,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=202,body=ManifestSnapshot),(status=403,description="Sem permissão"),(status=404,description="Documento ausente"),(status=409,description="Evento já registrado ou incompatível"),(status=422,description="Manifestação inválida"),(status=428,description="Chave obrigatória"),(status=503,description="Manifestação desativada")))]
pub async fn manifest(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    payload: Result<Json<ManifestInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.monitor.read",
        "fiscal.monitor.manifest",
        true,
    )
    .await?;
    let input = super::input(payload)?;
    input.validate().map_err(DomainError::Invalid)?;
    let command = command_key(&headers)?;
    let previous = sqlx::query_as::<_, (Uuid,i64,String,Option<String>,String,String,Option<String>,Option<String>)>("SELECT id,document_id,event_type,justification,auth_subject,outcome,status,protocol FROM fiscal_monitor_manifestations WHERE tenant_id=$1 AND command_key=$2")
        .bind(tenant).bind(command).fetch_optional(&mut *tx).await.map_err(db)?;
    if let Some((record, document, event_type, justification, actor, outcome, status, protocol)) =
        previous
    {
        if document != id
            || event_type != input.event_type
            || justification != input.justification
            || actor != identity.subject
        {
            return Err(DomainError::Conflict(
                "Chave de manifestação reutilizada com outros dados",
            )
            .into());
        }
        tx.commit().await.map_err(db)?;
        let mut reply = response(
            StatusCode::ACCEPTED,
            None,
            ManifestSnapshot {
                id: record,
                event_type,
                outcome,
                status,
                protocol,
            },
        );
        reply
            .headers_mut()
            .insert("idempotency-replayed", HeaderValue::from_static("true"));
        return Ok(reply);
    }
    let Some(service) = state.monitor.as_ref() else {
        return Ok(super::monitor::unavailable());
    };
    let (key,kind,situation): (Option<String>,String,Option<String>) = sqlx::query_as("SELECT access_key,kind,situation FROM fiscal_monitor_documents WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if kind != "summary" || situation.as_deref() != Some("1") {
        return Err(DomainError::Conflict(
            "Manifestação exige resumo autorizado recebido pela empresa",
        )
        .into());
    }
    let key = key.ok_or(DomainError::Conflict("Documento sem chave de acesso"))?;
    let already: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_monitor_manifestations WHERE tenant_id=$1 AND access_key=$2 AND event_type=$3)")
        .bind(tenant).bind(&key).bind(&input.event_type).fetch_one(&mut *tx).await.map_err(db)?;
    if already {
        return Err(DomainError::Conflict(
            "Este evento já tem uma solicitação; confira o resultado registrado",
        )
        .into());
    }
    let material = certificates::active_material(&state, &mut tx, tenant).await?;
    let (cnpj,origin_tax): (String,String) = sqlx::query_as("SELECT t.tax_id,s.tax_id FROM tenants t JOIN fiscal_monitor_state s ON s.tenant_id=t.id WHERE t.id=$1")
        .bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    if cnpj != origin_tax {
        return Err(DomainError::Conflict("CNPJ difere da origem da distribuição").into());
    }
    let signed = signed_event(&material, &input, &key, &cnpj, OffsetDateTime::now_utc())
        .map_err(DomainError::Invalid)?;
    let chain = state
        .certificates
        .as_ref()
        .ok_or(crate::platform::access::AccessError::Internal)?
        .transport_certificates(&material)
        .map_err(DomainError::Invalid)?;
    let client = service
        .client(&material, &chain)
        .map_err(DomainError::Invalid)?;
    drop(material);
    let record_id = Uuid::now_v7();
    sqlx::query("INSERT INTO fiscal_monitor_manifestations(id,tenant_id,document_id,access_key,event_type,justification,command_key,auth_subject,signed_xml) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(record_id).bind(tenant).bind(id).bind(&key).bind(&input.event_type).bind(&input.justification).bind(command).bind(&identity.subject).bind(&signed).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "fiscal_manifestation",
            id: record_id,
            event: "fiscal.manifestation.requested",
            details: serde_json::json!({"accessKey":key,"eventType":input.event_type}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    // Never resend after timeout, crash, duplicate or an uncorrelated response.
    let raw = service.send(&client, true, envelope(&signed)).await;
    let outcome = raw
        .as_ref()
        .ok()
        .and_then(|xml| parse_result(xml, &key, &input.event_type, &cnpj).ok());
    let (_, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.monitor.read",
        "fiscal.monitor.manifest",
        true,
    )
    .await?;
    let (outcome, status, protocol) = outcome
        .map(|result| (result.outcome, Some(result.status), result.protocol))
        .unwrap_or(("unknown", None, None));
    sqlx::query("UPDATE fiscal_monitor_manifestations SET outcome=$3,status=$4,protocol=$5,response_xml=$6,completed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(record_id).bind(outcome).bind(&status).bind(&protocol).bind(raw.ok()).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange {kind:"fiscal_manifestation",id:record_id,event:"fiscal.manifestation.result",details:serde_json::json!({"eventType":input.event_type,"outcome":outcome,"status":status,"protocol":protocol})}).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::ACCEPTED,
        None,
        ManifestSnapshot {
            id: record_id,
            event_type: input.event_type,
            outcome: outcome.into(),
            status,
            protocol,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn official_codes_and_justification_are_not_inverted_or_inferred() {
        for (code, description) in [
            ("210200", "Confirmacao da Operacao"),
            ("210210", "Ciencia da Operacao"),
            ("210220", "Desconhecimento da Operacao"),
        ] {
            assert_eq!(
                ManifestInput {
                    event_type: code.into(),
                    justification: None
                }
                .validate()
                .unwrap(),
                description
            );
        }
        assert!(
            ManifestInput {
                event_type: "210240".into(),
                justification: None
            }
            .validate()
            .is_err()
        );
        assert!(
            ManifestInput {
                event_type: "210240".into(),
                justification: Some("Não houve entrega dos produtos".into())
            }
            .validate()
            .is_ok()
        );
        assert!(
            ManifestInput {
                event_type: "210200".into(),
                justification: Some("texto indevido".into())
            }
            .validate()
            .is_err()
        );
        assert!(
            ManifestInput {
                event_type: "999999".into(),
                justification: None
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn accepted_event_requires_exact_correlation_and_protocol() {
        let key = "35261004252011000110550010000000011000000017";
        let xml = format!(
            "<retEnvEvento xmlns=\"{NFE}\"><cStat>128</cStat><retEvento><infEvento><tpAmb>1</tpAmb><cStat>135</cStat><chNFe>{key}</chNFe><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><nProt>135260000000001</nProt></infEvento></retEvento></retEnvEvento>"
        );
        assert_eq!(
            parse_result(&xml, key, "210210", "04252011000110")
                .unwrap()
                .outcome,
            "accepted"
        );
        for bad in [
            xml.replace("<tpEvento>210210", "<tpEvento>210200"),
            xml.replace("<tpAmb>1", "<tpAmb>2"),
            xml.replace("<nSeqEvento>1", "<nSeqEvento>2"),
            xml.replace("<nProt>135260000000001</nProt>", ""),
            xml.replace(key, "35261004252011000110550010000000011000000018"),
        ] {
            assert!(parse_result(&bad, key, "210210", "04252011000110").is_err());
        }
        assert_eq!(
            parse_result(
                &xml.replace("<cStat>135", "<cStat>573"),
                key,
                "210210",
                "04252011000110"
            )
            .unwrap()
            .outcome,
            "unknown"
        );
    }

    #[test]
    fn generated_signature_verifies_over_canonical_signed_info() {
        use rsa::{
            pkcs1v15::{Signature, VerifyingKey},
            signature::Verifier,
        };
        let fixture = super::super::certificate_crypto::tests::fixture();
        let material = CertificateMaterial {
            pkcs12: STANDARD.decode(fixture["valid"].as_str().unwrap()).unwrap(),
            password: fixture["password"].as_str().unwrap().into(),
        };
        let key = "35261004252011000110550010000000011000000017";
        let input = ManifestInput {
            event_type: "210240".into(),
            justification: Some("Não recebemos <nenhum> produto & entrega".into()),
        };
        let xml = signed_event(
            &material,
            &input,
            key,
            "04252011000110",
            OffsetDateTime::parse("2026-10-31T20:33:00.123456789Z", &Rfc3339).unwrap(),
        )
        .unwrap();
        let doc = xml_document(&xml).unwrap();
        assert_eq!(
            doc.descendants()
                .find(|node| node.has_tag_name((NFE, "dhEvento")))
                .unwrap()
                .text(),
            Some("2026-10-31T17:33:00-03:00")
        );
        let info = doc
            .descendants()
            .find(|node| node.has_tag_name((DS, "SignedInfo")))
            .unwrap();
        let signature = doc
            .descendants()
            .find(|node| node.has_tag_name((DS, "SignatureValue")))
            .unwrap()
            .text()
            .unwrap();
        let (private, _) = sefaz_client::key_chain(&material).unwrap();
        let public = RsaPrivateKey::from_pkcs8_der(&private)
            .unwrap()
            .to_public_key();
        let canonical =
            xml[info.range()].replacen("<SignedInfo>", &format!("<SignedInfo xmlns=\"{DS}\">"), 1);
        VerifyingKey::<Sha1>::new(public)
            .verify(
                canonical.as_bytes(),
                &Signature::try_from(STANDARD.decode(signature).unwrap().as_slice()).unwrap(),
            )
            .unwrap();
        let info = doc
            .descendants()
            .find(|node| node.has_tag_name((NFE, "infEvento")))
            .unwrap();
        let canonical = xml[info.range()].replacen(
            "<infEvento Id=",
            &format!("<infEvento xmlns=\"{NFE}\" Id="),
            1,
        );
        let expected = STANDARD.encode(Sha1::digest(canonical.as_bytes()));
        assert_eq!(
            doc.descendants()
                .find(|node| node.has_tag_name((DS, "DigestValue")))
                .unwrap()
                .text(),
            Some(expected.as_str())
        );
    }
}
