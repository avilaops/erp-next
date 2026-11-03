//! Evidence from authenticated production distribution, never a new transmission.
use super::distribution::{NFE, child, digits, text, valid_key, xml_document};
use crate::{
    domains::{DomainChange, DomainError, db, record},
    platform::auth::AuthenticatedIdentity,
};
use axum::http::HeaderMap;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Debug)]
pub(super) struct Evidence {
    pub key: String,
    pub event_type: String,
    pub sequence: String,
    pub code: String,
    pub protocol: String,
}

pub(super) fn inspect(xml: &str, recipient: &str) -> Result<Option<Evidence>, &'static str> {
    let document = xml_document(xml)?;
    let root = document.root_element();
    if !root.has_tag_name((NFE, "procEventoNFe")) {
        return Ok(None);
    }
    let request = child(child(root, "evento")?, "infEvento")?;
    let event_type = text(request, "tpEvento")?;
    if !["110111", "210200", "210210", "210220", "210240"].contains(&event_type) {
        return Ok(None);
    }
    let result = child(child(root, "retEvento")?, "infEvento")?;
    let code = text(result, "cStat")?;
    if code != "135" && !(event_type == "110111" && code == "155") {
        return Ok(None);
    }
    let key = text(request, "chNFe")?;
    let sequence = text(request, "nSeqEvento")?;
    if !valid_key(key)
        || !["1", "2"].contains(&sequence)
        || (["110111", "210210"].contains(&event_type) && sequence != "1")
        || text(request, "tpAmb")? != "1"
        || text(result, "tpAmb")? != "1"
        || text(result, "chNFe")? != key
        || text(result, "tpEvento")? != event_type
        || text(result, "nSeqEvento")? != sequence
        || request.attribute("Id") != Some(format!("ID{event_type}{key}{sequence:0>2}").as_str())
    {
        return Err("Evento distribuído não corresponde à resposta, sequência ou ambiente");
    }
    let has_cnpj = request.children().any(|n| n.has_tag_name((NFE, "CNPJ")));
    let has_cpf = request.children().any(|n| n.has_tag_name((NFE, "CPF")));
    let author = match (has_cnpj, has_cpf) {
        (true, false) => text(request, "CNPJ")?,
        (false, true) => text(request, "CPF")?,
        _ => return Err("Autor do evento ausente ou ambíguo"),
    };
    if !(digits(author, 14) || digits(author, 11)) {
        return Err("Autor do evento inválido");
    }
    if event_type == "110111" {
        if format!("{author:0>14}") != key[6..20] {
            return Err("Cancelamento não pertence ao emitente da NF-e");
        }
    } else if author != recipient {
        return Ok(None);
    }
    if result.children().any(|n| n.has_tag_name((NFE, "CNPJDest")))
        && text(result, "CNPJDest")? != recipient
    {
        return Ok(None);
    }
    let protocol = text(result, "nProt")?;
    if !digits(protocol, 15) {
        return Err("Protocolo do evento distribuído inválido");
    }
    Ok(Some(Evidence {
        key: key.into(),
        event_type: event_type.into(),
        sequence: sequence.into(),
        code: code.into(),
        protocol: protocol.into(),
    }))
}

pub(super) async fn reconcile(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    evidence: &Evidence,
    nsu: &str,
    xml: &str,
) -> Result<(), DomainError> {
    if evidence.event_type == "110111" || evidence.sequence != "1" {
        return Ok(());
    }
    let ids: Vec<Uuid> = sqlx::query_scalar("UPDATE fiscal_monitor_manifestations SET outcome='accepted',status=$4,protocol=$5,response_xml=$6,completed_at=clock_timestamp() WHERE tenant_id=$1 AND access_key=$2 AND event_type=$3 AND outcome='unknown' RETURNING id")
        .bind(tenant).bind(&evidence.key).bind(&evidence.event_type).bind(&evidence.code).bind(&evidence.protocol).bind(xml).fetch_all(&mut **tx).await.map_err(db)?;
    for id in ids {
        record(tx, tenant, identity, headers, DomainChange { kind: "fiscal_manifestation", id, event: "fiscal.manifestation.reconciled", details: serde_json::json!({"accessKey":evidence.key,"eventType":evidence.event_type,"sequence":evidence.sequence,"protocol":evidence.protocol,"evidenceNsu":nsu}) }).await?;
    }
    Ok(())
}

// Older immutable monitor rows have no derived key/situation. Read their XML
// in bounded pages; never backfill by changing the original documents.
async fn legacy_evidence(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    key: &str,
) -> Result<Vec<(String, Evidence, String)>, DomainError> {
    let recipient: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    let mut after = 0_i64;
    let mut evidence = Vec::new();
    loop {
        let rows: Vec<(i64,String,String)>=sqlx::query_as("SELECT id,nsu,xml FROM fiscal_monitor_documents WHERE tenant_id=$1 AND kind='event' AND access_key IS NULL AND id>$3 AND strpos(xml,$2)>0 ORDER BY id LIMIT 10")
            .bind(tenant).bind(key).bind(after).fetch_all(&mut **tx).await.map_err(db)?;
        if rows.is_empty() {
            break;
        }
        for (id, nsu, xml) in rows {
            after = id;
            if let Some(proof) = inspect(&xml, &recipient).ok().flatten()
                && proof.key == key
            {
                evidence.push((nsu, proof, xml));
            }
        }
    }
    Ok(evidence)
}

pub(super) async fn has_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    key: &str,
    event_type: Option<&str>,
) -> Result<bool, DomainError> {
    let indexed: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_monitor_documents WHERE tenant_id=$1 AND access_key=$2 AND (($3::text='110111' AND situation='3') OR ($3::text IS NOT NULL AND situation LIKE 'event:' || $3 || ':%') OR ($3::text IS NULL AND situation LIKE 'event:210%:%' AND situation NOT LIKE 'event:210210:%')))")
        .bind(tenant).bind(key).bind(event_type).fetch_one(&mut **tx).await.map_err(db)?;
    if indexed {
        return Ok(true);
    }
    Ok(legacy_evidence(tx, tenant, key)
        .await?
        .iter()
        .any(|(_, proof, _)| match event_type {
            Some(kind) => proof.event_type == kind,
            None => ["210200", "210220", "210240"].contains(&proof.event_type.as_str()),
        }))
}

pub(super) async fn reconcile_stored(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
) -> Result<(), DomainError> {
    let keys: Vec<String>=sqlx::query_scalar("SELECT DISTINCT access_key FROM fiscal_monitor_manifestations WHERE tenant_id=$1 AND outcome='unknown'").bind(tenant).fetch_all(&mut **tx).await.map_err(db)?;
    for key in keys {
        for (nsu, proof, xml) in legacy_evidence(tx, tenant, &key).await? {
            reconcile(tx, tenant, identity, headers, &proof, &nsu, &xml).await?;
        }
    }
    Ok(())
}

/// Homologation never inherits production evidence for the same access key.
pub(crate) async fn ensure_operable(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    key: &str,
    environment: i16,
) -> Result<(), DomainError> {
    if environment == 1 {
        let blocked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_monitor_documents WHERE tenant_id=$1 AND access_key=$2 AND situation IN ('2','3'))")
            .bind(tenant).bind(key).fetch_one(&mut **tx).await.map_err(db)?;
        if blocked || has_event(tx, tenant, key, Some("110111")).await? {
            return Err(DomainError::Conflict(
                "NF-e com cancelamento ou denegação conhecidos; confira e estorne os efeitos existentes explicitamente",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const KEY: &str = "35261004252011000110550010000000011000000017";
    fn proof() -> String {
        format!(
            "<procEventoNFe xmlns=\"{NFE}\"><evento><infEvento Id=\"ID210200{KEY}01\"><tpAmb>1</tpAmb><CNPJ>19131243000197</CNPJ><chNFe>{KEY}</chNFe><tpEvento>210200</tpEvento><nSeqEvento>1</nSeqEvento></infEvento></evento><retEvento><infEvento><tpAmb>1</tpAmb><chNFe>{KEY}</chNFe><tpEvento>210200</tpEvento><nSeqEvento>1</nSeqEvento><cStat>135</cStat><nProt>135260000000001</nProt></infEvento></retEvento></procEventoNFe>"
        )
    }
    #[test]
    fn evidence_requires_correlated_environment_author_sequence_key_and_protocol() {
        let xml = proof();
        assert!(inspect(&xml, "19131243000197").unwrap().is_some());
        assert!(inspect(&xml, "04252011000110").unwrap().is_none());
        for invalid in [
            xml.replacen("<tpAmb>1", "<tpAmb>2", 1),
            xml.replacen("<nSeqEvento>1", "<nSeqEvento>2", 1),
            xml.replace("135260000000001", "123"),
            xml.replacen("<tpEvento>210200", "<tpEvento>210220", 1),
        ] {
            assert!(inspect(&invalid, "19131243000197").is_err());
        }
        assert!(
            inspect(&xml.replace("<cStat>135", "<cStat>136"), "19131243000197")
                .unwrap()
                .is_none()
        );
        assert!(
            inspect(
                &xml.replace(
                    "<CNPJ>19131243000197</CNPJ>",
                    "<CNPJ>19131243000197</CNPJ><CNPJ>19131243000197</CNPJ>"
                ),
                "19131243000197"
            )
            .is_err()
        );
    }
}
