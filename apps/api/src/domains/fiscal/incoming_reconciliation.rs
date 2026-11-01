//! An uncertain manifestation is reconciled only from official distributed
//! evidence. Neither this module nor its HTTP command retransmits the event.
use super::{FiscalError, PERMISSION, QueryInput, input};
use crate::{
    domains::{
        DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
        revision,
    },
    platform::{auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use roxmltree::Node;
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

const NS: &str = "http://www.portalfiscal.inf.br/nfe";

fn child<'a>(node: Node<'a, 'a>, name: &str) -> Result<Node<'a, 'a>, DomainError> {
    let mut nodes = node.children().filter(|n| n.has_tag_name((NS, name)));
    let value = nodes
        .next()
        .ok_or(DomainError::Invalid("Evento de manifestação incompleto"))?;
    if nodes.next().is_some() {
        return Err(DomainError::Invalid("Campo de manifestação duplicado"));
    }
    Ok(value)
}
fn scalar<'a>(node: Node<'a, 'a>, name: &str) -> Result<&'a str, DomainError> {
    let node = child(node, name)?;
    if node.children().any(|n| !n.is_text()) {
        return Err(DomainError::Invalid("Campo de manifestação ambíguo"));
    }
    node.text()
        .filter(|s| !s.is_empty())
        .ok_or(DomainError::Invalid("Campo de manifestação vazio"))
}

struct Evidence {
    key: String,
    kind: &'static str,
    code: String,
    protocol: String,
}
fn evidence(xml: &str, recipient: &str) -> Result<Option<Evidence>, DomainError> {
    let document = roxmltree::Document::parse_with_options(
        xml,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: 100_000,
            ..Default::default()
        },
    )
    .map_err(|_| DomainError::Invalid("XML de evento inválido"))?;
    let root = document.root_element();
    if !root.has_tag_name((NS, "procEventoNFe")) {
        return Ok(None);
    }
    let result = child(child(root, "retEvento")?, "infEvento")?;
    // An incomplete or rejected result remains stored as a document, but never
    // supplies evidence of registration.
    let code = match result.children().find(|n| n.has_tag_name((NS, "cStat"))) {
        Some(_) => scalar(result, "cStat")?,
        None => return Ok(None),
    };
    if !["135", "136"].contains(&code) {
        return Ok(None);
    }
    let request = child(child(root, "evento")?, "infEvento")?;
    let event_type = scalar(request, "tpEvento")?;
    let kind = match event_type {
        "210210" => "ciencia",
        "210200" => "confirmacao",
        "210220" => "desconhecimento",
        "210240" => "nao_realizada",
        _ => return Ok(None),
    };
    if scalar(request, "CNPJ")? != recipient {
        return Ok(None);
    }
    let key = scalar(request, "chNFe")?;
    let sequence = scalar(request, "nSeqEvento")?;
    if !super::valid_access_key(key)
        || scalar(result, "chNFe")? != key
        || scalar(result, "tpEvento")? != event_type
        || scalar(result, "nSeqEvento")? != sequence
        || scalar(request, "tpAmb")? != "2"
        || scalar(result, "tpAmb")? != "2"
    {
        return Err(DomainError::Invalid(
            "Resultado não corresponde à manifestação da empresa",
        ));
    }
    if sequence != "1" {
        return Ok(None);
    }
    if result.children().any(|n| n.has_tag_name((NS, "CNPJDest")))
        && scalar(result, "CNPJDest")? != recipient
    {
        return Err(DomainError::Invalid(
            "Destinatário do resultado não corresponde à empresa",
        ));
    }
    let protocol = scalar(result, "nProt")?;
    if protocol.len() != 15 || !protocol.bytes().all(|b| b.is_ascii_digit()) {
        return Err(DomainError::Invalid("Protocolo da manifestação inválido"));
    }
    Ok(Some(Evidence {
        key: key.to_owned(),
        kind,
        code: code.to_owned(),
        protocol: protocol.to_owned(),
    }))
}

pub(super) async fn consume(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    nsu: i64,
    xml: &str,
) -> Result<(), DomainError> {
    let recipient: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    let Some(proof) = evidence(xml, &recipient)? else {
        return Ok(());
    };
    let result = json!({"registered":true,"code":proof.code,"protocol":proof.protocol,"reason":"Manifestação comprovada pelo evento distribuído","xml":xml,"evidenceNsu":format!("{nsu:015}")});
    let updated:Vec<Uuid>=sqlx::query_scalar("UPDATE fiscal_recipient_manifestations SET status='accepted',response=$4,revision=revision+1 WHERE tenant_id=$1 AND environment=2 AND access_key=$2 AND kind=$3 AND status IN ('pending','unknown') RETURNING id").bind(tenant).bind(&proof.key).bind(proof.kind).bind(result).fetch_all(&mut **tx).await.map_err(db)?;
    for id in updated {
        record(tx,tenant,identity,headers,DomainChange{kind:"recipient_manifestation",id,event:"fiscal.manifestation.reconciled",details:json!({"accessKey":proof.key,"kind":proof.kind,"code":proof.code,"protocol":proof.protocol,"evidenceNsu":format!("{nsu:015}")})}).await?;
    }
    Ok(())
}

pub(super) async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Value, DomainError> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'accessKey',access_key,'kind',kind,'status',status,'revision',revision,'issuedAt',issued_at,'result',response) FROM fiscal_recipient_manifestations WHERE tenant_id=$1 AND id=$2 AND environment=2").bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}

#[utoipa::path(get,path="/api/v1/fiscal/manifestations/{id}",tag="Fiscal",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=Uuid,Path)),responses((status=200,body=Value),(status=404,description="Manifestação ausente nesta empresa")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, false).await?;
    let result = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        result["revision"].as_i64(),
        result,
    ))
}

#[utoipa::path(post,path="/api/v1/fiscal/manifestations/{id}/reconcile",tag="Fiscal",request_body=QueryInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=Uuid,Path),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=Value),(status=404,description="Manifestação ausente nesta empresa"),(status=412,description="Revisão desatualizada"),(status=428,description="Revisão e chave obrigatórias")))]
pub async fn reconcile(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<QueryInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    input(payload)?;
    let expected = revision(&headers)?;
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, true).await?;
    let request = json!({"id":id,"revision":expected});
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.manifestation.reconcile",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(
            StatusCode::OK,
            result["revision"].as_i64(),
            result,
        ));
    }
    let current = load(&mut tx, tenant, id).await?;
    if current["revision"].as_i64() != Some(expected) {
        return Err(DomainError::StaleRevision.into());
    }
    if matches!(current["status"].as_str(), Some("pending" | "unknown")) {
        let documents:Vec<(i64,String)>=sqlx::query_as("SELECT nsu,xml FROM fiscal_distribution_documents WHERE tenant_id=$1 AND environment=2 AND access_key=$2 AND kind='event' ORDER BY nsu").bind(tenant).bind(current["accessKey"].as_str().ok_or(DomainError::NotFound)?).fetch_all(&mut *tx).await.map_err(db)?;
        for (nsu, xml) in documents {
            consume(&mut tx, tenant, &identity, &headers, nsu, &xml).await?;
        }
    }
    let mut result = load(&mut tx, tenant, id).await?;
    if matches!(result["status"].as_str(), Some("pending" | "unknown")) {
        result["reconciliation"] = json!({"status":"awaiting_distribution_evidence","message":"Nenhum evento oficial correspondente foi distribuído. Consulte o monitor de notas, respeitando o intervalo da SEFAZ. O evento original não foi reenviado."});
    }
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.manifestation.reconcile",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        result["revision"].as_i64(),
        result,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn xml() -> String {
        format!(
            "<procEventoNFe xmlns=\"{NS}\"><evento><infEvento><tpAmb>2</tpAmb><CNPJ>04252011000110</CNPJ><chNFe>35261004252011000110550010000000011000000017</chNFe><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento></infEvento></evento><retEvento><infEvento><tpAmb>2</tpAmb><chNFe>35261004252011000110550010000000011000000017</chNFe><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><cStat>135</cStat><nProt>135260000000001</nProt></infEvento></retEvento></procEventoNFe>"
        )
    }
    #[test]
    fn manifestation_evidence_requires_matching_author_key_sequence_environment_and_protocol() {
        assert!(evidence(&xml(), "04252011000110").unwrap().is_some());
        assert!(
            evidence(
                &xml().replace("<cStat>135</cStat>", "<cStat>136</cStat>"),
                "04252011000110"
            )
            .unwrap()
            .is_some()
        );
        assert!(
            evidence(
                &xml().replace("<nSeqEvento>1</nSeqEvento>", "<nSeqEvento>2</nSeqEvento>"),
                "04252011000110"
            )
            .unwrap()
            .is_none()
        );
        assert!(evidence(&xml(), "19131243000197").unwrap().is_none());
        assert!(
            evidence(
                &xml().replace("<cStat>135</cStat>", "<cStat>573</cStat>"),
                "04252011000110"
            )
            .unwrap()
            .is_none()
        );
        for (from, to) in [
            (
                "<nSeqEvento>1</nSeqEvento><cStat>",
                "<nSeqEvento>2</nSeqEvento><cStat>",
            ),
            ("<tpAmb>2</tpAmb>", "<tpAmb>1</tpAmb>"),
            ("<nProt>135260000000001</nProt>", "<nProt>1</nProt>"),
            (
                "<tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><cStat>",
                "<tpEvento>210200</tpEvento><nSeqEvento>1</nSeqEvento><cStat>",
            ),
        ] {
            assert!(evidence(&xml().replace(from, to), "04252011000110").is_err());
        }
    }
}
