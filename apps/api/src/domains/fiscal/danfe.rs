use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use roxmltree::{Document, Node};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::ToSchema;

use super::{FiscalError, input, problem};
use crate::{
    domains::{authorized, db},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};

const NFE: &str = "http://www.portalfiscal.inf.br/nfe";
const DS: &str = "http://www.w3.org/2000/09/xmldsig#";
pub const MAX_XML_BYTES: usize = 900 * 1024;

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DanfeInput {
    /// XML nfeProc completo, modelo 55, com assinatura e protocolo de uso.
    pub xml: String,
}

#[derive(Debug)]
pub struct AuthorizedXml {
    pub key: String,
    pub issuer: String,
    pub issuer_name: String,
    pub recipient: Option<String>,
    pub environment: String,
    pub number: i64,
    pub series: i32,
    pub issued_at: OffsetDateTime,
    pub total_cents: i64,
    pub item_count: i32,
}

fn child<'a>(
    node: Node<'a, 'a>,
    namespace: &str,
    name: &str,
) -> Result<Node<'a, 'a>, &'static str> {
    let mut matches = node
        .children()
        .filter(|item| item.has_tag_name((namespace, name)));
    let value = matches
        .next()
        .ok_or("XML incompleto ou namespace incompatível")?;
    if matches.next().is_some() {
        return Err("XML contém elementos duplicados");
    }
    Ok(value)
}
fn value<'a>(node: Node<'a, 'a>, namespace: &str, name: &str) -> Result<&'a str, &'static str> {
    let field = child(node, namespace, name)?;
    if field.children().any(|node| node.is_element()) {
        return Err("Campo XML com estrutura inesperada");
    }
    field
        .text()
        .filter(|value| !value.is_empty())
        .ok_or("Campo XML obrigatório ausente")
}
fn digits(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// Checks envelope/protocol consistency. SEFAZ status and ICP-Brasil trust are separate checks.
pub fn inspect(xml: &str) -> Result<AuthorizedXml, &'static str> {
    if xml.len() > MAX_XML_BYTES {
        return Err("XML excede 900 KiB");
    }
    let document = Document::parse_with_options(
        xml,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: 100_000,
            ..Default::default()
        },
    )
    .map_err(|_| "XML inválido; DTD e entidades externas não são aceitos")?;
    let root = document.root_element();
    if !root.has_tag_name((NFE, "nfeProc"))
        || root.attribute("versao") != Some("4.00")
        || root.children().filter(|node| node.is_element()).count() != 2
    {
        return Err("Envie nfeProc 4.00 completo com protocolo");
    }
    let nfe = child(root, NFE, "NFe")?;
    let info = child(nfe, NFE, "infNFe")?;
    if info.attribute("versao") != Some("4.00")
        || nfe
            .children()
            .filter(|node| node.has_tag_name((NFE, "infNFe")))
            .count()
            != 1
    {
        return Err("NF-e 4.00 inválida");
    }
    let key = info
        .attribute("Id")
        .and_then(|value| value.strip_prefix("NFe"))
        .ok_or("Identificador da NF-e ausente")?;
    if !digits(key, 44) {
        return Err("Chave de acesso deve conter 44 dígitos");
    }
    let sum: u32 = key.as_bytes()[..43]
        .iter()
        .rev()
        .zip((2..=9).cycle())
        .map(|(byte, weight)| u32::from(byte - b'0') * weight)
        .sum();
    let candidate = 11 - sum % 11;
    let check = if candidate >= 10 { 0 } else { candidate };
    if u32::from(key.as_bytes()[43] - b'0') != check {
        return Err("Dígito verificador da chave inválido");
    }
    let ide = child(info, NFE, "ide")?;
    if value(ide, NFE, "mod")? != "55" || &key[20..22] != "55" {
        return Err("DANFE disponível somente para NF-e modelo 55");
    }
    let environment = value(ide, NFE, "tpAmb")?;
    if !["1", "2"].contains(&environment) {
        return Err("Ambiente da NF-e inválido");
    }
    let issuer_node = child(info, NFE, "emit")?;
    let (issuer, issuer_length) = match (
        issuer_node
            .children()
            .any(|node| node.has_tag_name((NFE, "CNPJ"))),
        issuer_node
            .children()
            .any(|node| node.has_tag_name((NFE, "CPF"))),
    ) {
        (true, false) => (value(issuer_node, NFE, "CNPJ")?, 14),
        (false, true) => (value(issuer_node, NFE, "CPF")?, 11),
        _ => return Err("Documento do emitente ausente ou ambíguo"),
    };
    if !digits(issuer, issuer_length) || key[6..20] != format!("{issuer:0>14}") {
        return Err("Emitente incompatível com a chave da NF-e");
    }
    let issuer_name = value(issuer_node, NFE, "xNome")?.trim();
    if issuer_name.is_empty() || issuer_name.chars().count() > 200 {
        return Err("Nome do emitente inválido");
    }
    let number = value(ide, NFE, "nNF")?
        .parse::<i64>()
        .ok()
        .filter(|value| (1..=999_999_999).contains(value))
        .ok_or("Número da NF-e inválido")?;
    let series = value(ide, NFE, "serie")?
        .parse::<i32>()
        .ok()
        .filter(|value| (0..=999).contains(value))
        .ok_or("Série da NF-e inválida")?;
    let issued_at = OffsetDateTime::parse(value(ide, NFE, "dhEmi")?, &Rfc3339)
        .map_err(|_| "Data de emissão da NF-e inválida")?;
    let total = child(child(info, NFE, "total")?, NFE, "ICMSTot")?;
    let total_cents = crate::domains::fixed(value(total, NFE, "vNF")?, 2)
        .map_err(|_| "Valor total da NF-e inválido")?;
    let item_count = info
        .children()
        .filter(|node| node.has_tag_name((NFE, "det")))
        .count();
    if !(1..=990).contains(&item_count) {
        return Err("Quantidade de itens da NF-e inválida");
    }
    let destination = child(info, NFE, "dest")?;
    let recipient = match (
        destination
            .children()
            .find(|node| node.has_tag_name((NFE, "CNPJ"))),
        destination
            .children()
            .find(|node| node.has_tag_name((NFE, "CPF"))),
    ) {
        (Some(_), None) => Some(value(destination, NFE, "CNPJ")?),
        (None, Some(_)) => Some(value(destination, NFE, "CPF")?),
        (None, None) => None,
        _ => return Err("Destinatário com documentos conflitantes"),
    };
    if recipient.is_some_and(|value| !digits(value, 11) && !digits(value, 14)) {
        return Err("Documento do destinatário inválido");
    }
    let protocol = child(root, NFE, "protNFe")?;
    if protocol.attribute("versao") != Some("4.00") {
        return Err("Protocolo deve usar versão 4.00");
    }
    let protocol = child(protocol, NFE, "infProt")?;
    if !["100", "150"].contains(&value(protocol, NFE, "cStat")?) {
        return Err("XML não contém protocolo de autorização de uso");
    }
    if value(protocol, NFE, "chNFe")? != key
        || value(protocol, NFE, "tpAmb")? != environment
        || !digits(value(protocol, NFE, "nProt")?, 15)
    {
        return Err("Protocolo incompatível com a NF-e");
    }
    value(protocol, NFE, "dhRecbto")?;
    let signature = child(nfe, DS, "Signature")?;
    let reference = child(child(signature, DS, "SignedInfo")?, DS, "Reference")?;
    if reference.attribute("URI")
        != info
            .attribute("Id")
            .map(|_| format!("#NFe{key}"))
            .as_deref()
    {
        return Err("Assinatura referencia outro documento");
    }
    let digest = value(reference, DS, "DigestValue")?
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect::<Vec<_>>();
    let protocol_digest = value(protocol, NFE, "digVal")?
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect::<Vec<_>>();
    let digest_bytes = STANDARD
        .decode(digest)
        .map_err(|_| "Digest da assinatura inválido")?;
    let protocol_bytes = STANDARD
        .decode(protocol_digest)
        .map_err(|_| "Digest do protocolo inválido")?;
    if ![20, 32].contains(&digest_bytes.len()) || protocol_bytes != digest_bytes {
        return Err("Digest do protocolo não corresponde à assinatura");
    }
    Ok(AuthorizedXml {
        key: key.to_owned(),
        issuer: issuer.to_owned(),
        issuer_name: issuer_name.to_owned(),
        recipient: recipient.map(str::to_owned),
        environment: environment.to_owned(),
        number,
        series,
        issued_at,
        total_cents,
        item_count: item_count as i32,
    })
}

#[utoipa::path(post, path="/api/v1/fiscal/danfe", tag="Fiscal", request_body=DanfeInput,
    security(("bearerAuth"=[])), params(("X-Tenant-Id"=uuid::Uuid,Header)),
    responses((status=200,description="DANFE em PDF; protocolo conferido no XML, sem consulta de situação na SEFAZ",content_type="application/pdf",body=Vec<u8>),
    (status=401,description="Sem sessão"),(status=403,description="Sem permissão fiscal ou XML de outra empresa"),
    (status=413,description="Corpo excede 1 MiB"),(status=422,description="XML, protocolo, XSD ou assinatura inválidos"),
    (status=502,description="Resposta inválida do serviço fiscal"),(status=503,description="Gerador não configurado")))]
pub async fn generate(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<DanfeInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.read",
        false,
    )
    .await?;
    let payload = input(payload)?;
    let note = match inspect(&payload.xml) {
        Ok(value) => value,
        Err(title) => {
            return Ok(problem(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_authorized_xml",
                title,
                serde_json::json!({}),
            ));
        }
    };
    let tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    if note.issuer != tax_id && note.recipient.as_deref() != Some(tax_id.as_str()) {
        return Ok(problem(
            StatusCode::FORBIDDEN,
            "document_company_mismatch",
            "O XML não pertence à empresa ativa",
            serde_json::json!({}),
        ));
    }
    tx.commit().await.map_err(db)?;
    let Some(client) = state.danfe.as_ref() else {
        return Ok(problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "danfe_unavailable",
            "Gerador de DANFE ainda não configurado",
            serde_json::json!({}),
        ));
    };
    let pdf = match client.render(&payload.xml, &note.key).await {
        Ok(value) => value,
        Err(super::danfe_client::RenderError::Invalid) => {
            return Ok(problem(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_authorized_xml",
                "O serviço fiscal recusou o XML ou sua assinatura",
                serde_json::json!({}),
            ));
        }
        Err(super::danfe_client::RenderError::Gateway) => {
            return Ok(problem(
                StatusCode::BAD_GATEWAY,
                "danfe_provider_failed",
                "Não foi possível validar e gerar o DANFE no serviço fiscal",
                serde_json::json!({}),
            ));
        }
    };
    // Long provider work must not return a document after access was revoked.
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.read",
        false,
    )
    .await?;
    let current_tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    if note.issuer != current_tax_id && note.recipient.as_deref() != Some(current_tax_id.as_str()) {
        return Ok(problem(
            StatusCode::FORBIDDEN,
            "document_company_mismatch",
            "O cadastro da empresa mudou durante a geração",
            serde_json::json!({}),
        ));
    }
    tx.commit().await.map_err(db)?;
    let pdf_hash = format!("{:x}", Sha256::digest(&pdf));
    let mut response = Response::new(axum::body::Body::from(pdf));
    for (name, value) in [
        (header::CONTENT_TYPE, "application/pdf".to_owned()),
        (
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"DANFE-{}.pdf\"", note.key),
        ),
        (header::CACHE_CONTROL, "no-store".to_owned()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
        (
            axum::http::HeaderName::from_static("x-xml-sha256"),
            format!("{:x}", Sha256::digest(payload.xml.as_bytes())),
        ),
        (
            axum::http::HeaderName::from_static("x-pdf-sha256"),
            pdf_hash,
        ),
        (
            axum::http::HeaderName::from_static("x-nfe-authorization-check"),
            "xml-protocol-only".to_owned(),
        ),
        (
            axum::http::HeaderName::from_static("x-nfe-environment"),
            note.environment,
        ),
    ] {
        response.headers_mut().insert(
            name,
            HeaderValue::from_str(&value).expect("bounded ASCII response header"),
        );
    }
    Ok(response)
}

#[cfg(test)]
pub const FIXTURE: &str = include_str!("../../../tests/fixtures/nfe-protocol-synthetic.xml");

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn envelope_consistency_does_not_claim_signature_or_sefaz_authenticity() {
        let note = inspect(FIXTURE).unwrap();
        assert_eq!(note.key, "35261004252011000110550010000000011000000017");
        assert_eq!(note.issuer, "04252011000110");
        assert_eq!(note.environment, "2");
        assert_eq!(note.recipient.as_deref(), Some("19131243000197"));
        assert!(
            inspect(&FIXTURE.replace(
                "<digVal>AAAAAAAAAAAAAAAAAAAAAAAAAAA=</digVal>",
                "<digVal>AAAAAAA\nAAAAAAAAAAAAAAAAAAAA=</digVal>"
            ))
            .is_ok()
        );
    }
    #[test]
    fn invalid_protocol_key_namespace_digest_and_non_nfe_documents_are_refused() {
        for xml in [
            FIXTURE.replace("<cStat>100</cStat>", "<cStat>101</cStat>"),
            FIXTURE.replace("<tpAmb>2</tpAmb><finNFe>", "<tpAmb>1</tpAmb><finNFe>"),
            FIXTURE.replace("<mod>55</mod>", "<mod>65</mod>"),
            FIXTURE.replace("<nProt>135260000000001</nProt>", "<nProt>1</nProt>"),
            FIXTURE.replace(
                "<digVal>AAAAAAAAAAAAAAAAAAAAAAAAAAA=</digVal>",
                "<digVal>BBBBBBBBBBBBBBBBBBBBBBBBBBB=</digVal>",
            ),
            FIXTURE.replace(
                "http://www.portalfiscal.inf.br/nfe",
                "https://untrusted.example/nfe",
            ),
            FIXTURE.replace(
                "NFe35261004252011000110550010000000011000000017",
                "NFe35261004252011000110550010000000011000000010",
            ),
            FIXTURE.replace(
                "URI=\"#NFe35261004252011000110550010000000011000000017\"",
                "URI=\"#other\"",
            ),
            FIXTURE.replace(
                "<chNFe>35261004252011000110550010000000011000000017</chNFe>",
                "<chNFe>35261004252011000110550010000000011000000010</chNFe>",
            ),
            "<resNFe xmlns=\"http://www.portalfiscal.inf.br/nfe\"/>".to_owned(),
        ] {
            assert!(inspect(&xml).is_err(), "changed envelope accepted");
        }
    }
    #[test]
    fn duplicate_documents_dtd_and_size_overflow_are_refused() {
        assert!(inspect(&FIXTURE.replace("<ide>", "<ide><mod>55</mod>")).is_err());
        assert!(
            inspect(&FIXTURE.replace(
                "<nfeProc ",
                "<!DOCTYPE nfeProc [<!ENTITY example SYSTEM 'file:///private'>]><nfeProc "
            ))
            .is_err()
        );
        assert!(inspect(&"x".repeat(MAX_XML_BYTES + 1)).is_err());
        let duplicate = FIXTURE.replace("</nfeProc>", "<NFe/></nfeProc>");
        assert!(inspect(&duplicate).is_err());
    }
}
