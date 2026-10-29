use axum::http::StatusCode;
use reqwest::Method;
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::super::{DomainError, db};
use super::{
    model::{self, Contract, Recipient},
    provider::Docuseal,
};

const UNKNOWN: &str = "Resultado ainda não confirmado. A atualização consulta a solicitação existente e não repete a criação ou o e-mail.";

pub async fn reconcile(
    tx: &mut Transaction<'_, Postgres>,
    contract: &Contract,
    provider: &Docuseal,
) -> Result<(), DomainError> {
    let external = match contract.external_id {
        Some(id) => id,
        None => {
            let key = model::correlation(contract.tenant_id, contract.id, 0);
            let found = provider
                .request(
                    Method::GET,
                    &format!("submitters?external_id={key}&limit=100"),
                    None,
                )
                .await?;
            let rows = found["data"]
                .as_array()
                .ok_or_else(super::provider::unavailable)?;
            if rows.is_empty() {
                return Err(DomainError::Conflict(UNKNOWN));
            }
            if rows.len() != 1 {
                return Err(DomainError::Conflict(
                    "Há mais de uma solicitação com a mesma referência. Necessária conferência no portal",
                ));
            }
            rows[0]["submission_id"]
                .as_i64()
                .ok_or_else(super::provider::unavailable)?
        }
    };
    let submission = provider
        .request(Method::GET, &format!("submissions/{external}"), None)
        .await?;
    let recipients: Vec<Recipient> = serde_json::from_value(contract.recipients.clone())
        .map_err(|_| super::provider::unavailable())?;
    let submitters = submission["submitters"]
        .as_array()
        .ok_or_else(super::provider::unavailable)?;
    if submission["id"].as_i64() != Some(external)
        || submission["template"]["id"].as_i64() != Some(contract.template_id)
        || submitters.len() != recipients.len()
    {
        return Err(DomainError::Conflict(
            "A solicitação do provedor não corresponde ao contrato",
        ));
    }
    for (index, recipient) in recipients.iter().enumerate() {
        let expected = model::correlation(contract.tenant_id, contract.id, index);
        if !submitters.iter().any(|s| {
            s["external_id"] == expected
                && s["email"]
                    .as_str()
                    .is_some_and(|email| email.eq_ignore_ascii_case(&recipient.email))
                && s["role"] == recipient.role
        }) {
            return Err(DomainError::Conflict(
                "Destinatários divergentes no provedor; envio bloqueado",
            ));
        }
    }
    let events = submission["submission_events"].as_array();
    let progress: Vec<Value> = submitters.iter().map(|s| {
        // sent_at can be populated while scheduling. Only the send_email event,
        // emitted after mail.deliver_now!, confirms provider-side transmission.
        let sent = events.is_some_and(|events| events.iter().any(|event| event["event_type"] == "send_email" && event["submitter_id"] == s["id"]));
        json!({"id":s["id"],"role":s["role"],"email":s["email"],"status":s["status"],"sendConfirmed":sent,"openedAt":s["opened_at"],"completedAt":s["completed_at"],"declinedAt":s["declined_at"]})
    }).collect();
    let completed = submission["completed_at"].is_string()
        && submitters.iter().all(|s| s["completed_at"].is_string());
    let mut next = contract.status.as_str();
    if completed {
        next = "completed";
    } else if contract.status != "completed" {
        if submission["status"] == "declined" {
            next = "declined";
        } else if submission["status"] == "expired" {
            next = "expired";
        } else if !["declined", "expired"].contains(&contract.status.as_str()) {
            if progress.iter().any(|p| p["openedAt"].is_string()) {
                next = "opened";
            } else if progress.iter().all(|p| p["sendConfirmed"] == true)
                && contract.status != "opened"
            {
                next = "sent";
            } else if contract.status == "creation_requested" {
                next = "created";
            }
        }
    }
    let documents = provider
        .request(
            Method::GET,
            &format!("submissions/{external}/documents"),
            None,
        )
        .await?;
    let documents = documents["documents"]
        .as_array()
        .ok_or_else(super::provider::unavailable)?;
    if documents.is_empty() || documents.len() > 10 {
        return Err(DomainError::Conflict("Quantidade de documentos inválida"));
    }
    let kind = if completed { "signed" } else { "preview" };
    for (index, document) in documents.iter().enumerate() {
        preserve(
            tx,
            provider,
            contract,
            kind,
            index as i32,
            document["url"]
                .as_str()
                .ok_or_else(super::provider::unavailable)?,
        )
        .await?;
    }
    let mut problem = None;
    if completed {
        if let Some(url) = submission["audit_log_url"].as_str() {
            preserve(tx, provider, contract, "audit", 0, url).await?;
        } else {
            problem = Some(
                "Assinatura confirmada; a trilha de assinatura ainda não está disponível. Atualize para preservá-la.",
            );
        }
    }
    if next == "send_requested" {
        problem = Some(
            "Envio solicitado; confirmação de transmissão pelo provedor ainda pendente. Consulte também a fila de e-mail do portal. Nenhum reenvio automático será realizado.",
        );
    }
    let changed = contract.external_id != Some(external)
        || contract.status != next
        || contract.progress != json!(progress)
        || contract.problem.as_deref() != problem;
    if changed {
        sqlx::query("UPDATE commercial_contracts SET external_id=$3,status=$4,progress=$5,problem=$6,completed_at=COALESCE(completed_at,$7::timestamptz),revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2")
            .bind(contract.tenant_id).bind(contract.id).bind(external).bind(next).bind(json!(progress)).bind(problem)
            .bind(if completed { submission["completed_at"].as_str() } else { None }).execute(&mut **tx).await.map_err(db)?;
        sqlx::query("INSERT INTO audit_log(tenant_id,action,entity_type,entity_id,details) VALUES($1,'contract.reconciled','commercial_contract',$2,$3)")
            .bind(contract.tenant_id).bind(contract.id.to_string()).bind(json!({"status":next,"externalId":external})).execute(&mut **tx).await.map_err(db)?;
    }
    Ok(())
}

async fn preserve(
    tx: &mut Transaction<'_, Postgres>,
    provider: &Docuseal,
    contract: &Contract,
    kind: &str,
    position: i32,
    url: &str,
) -> Result<(), DomainError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM commercial_contract_files WHERE tenant_id=$1 AND contract_id=$2 AND kind=$3 AND position=$4)")
        .bind(contract.tenant_id).bind(contract.id).bind(kind).bind(position).fetch_one(&mut **tx).await.map_err(db)?;
    if exists {
        return Ok(());
    }
    let content = provider.pdf(url).await?;
    sqlx::query("INSERT INTO commercial_contract_files(id,tenant_id,contract_id,kind,position,sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(Uuid::now_v7()).bind(contract.tenant_id).bind(contract.id).bind(kind).bind(position).bind(model::digest(&content)).bind(content)
        .execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

pub async fn verify_preview(
    tx: &mut Transaction<'_, Postgres>,
    contract: &Contract,
    provider: &Docuseal,
) -> Result<(), DomainError> {
    let external = contract
        .external_id
        .ok_or_else(super::provider::unavailable)?;
    let response = provider
        .request(
            Method::GET,
            &format!("submissions/{external}/documents"),
            None,
        )
        .await?;
    let documents = response["documents"]
        .as_array()
        .ok_or_else(super::provider::unavailable)?;
    let hashes: Vec<String> = sqlx::query_scalar("SELECT sha256 FROM commercial_contract_files WHERE tenant_id=$1 AND contract_id=$2 AND kind='preview' ORDER BY position")
        .bind(contract.tenant_id).bind(contract.id).fetch_all(&mut **tx).await.map_err(db)?;
    if documents.len() != hashes.len() || hashes.is_empty() {
        return Err(DomainError::Conflict(
            "A prévia mudou no portal. O envio foi bloqueado",
        ));
    }
    for (document, hash) in documents.iter().zip(hashes) {
        let bytes = provider
            .pdf(
                document["url"]
                    .as_str()
                    .ok_or_else(super::provider::unavailable)?,
            )
            .await?;
        if model::digest(&bytes) != hash {
            return Err(DomainError::Conflict(
                "O documento mudou depois da revisão. O envio foi bloqueado",
            ));
        }
    }
    Ok(())
}

pub async fn detail(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    can_edit: bool,
    can_send: bool,
    email_ready: bool,
) -> Result<axum::response::Response, DomainError> {
    let contract = model::load(tx, tenant, id).await?;
    let files: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'kind',kind,'position',position,'sha256',sha256) FROM commercial_contract_files WHERE tenant_id=$1 AND contract_id=$2 ORDER BY kind,position")
        .bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?;
    Ok(super::super::response(
        StatusCode::OK,
        Some(contract.revision),
        json!({"tenantId":tenant,"canEdit":can_edit,"canSend":can_send,"emailReady":email_ready,"data":contract,"files":files}),
    ))
}
