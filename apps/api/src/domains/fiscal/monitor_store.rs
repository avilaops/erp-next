use super::distribution::Batch;
use crate::{
    domains::{DomainError, db},
    platform::{access, auth::AuthenticatedIdentity},
};
use axum::http::HeaderMap;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub(super) async fn save_batch(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    run: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    batch: &Batch,
) -> Result<(), DomainError> {
    let recipient: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    for document in &batch.documents {
        let hash = format!("{:x}", Sha256::digest(document.xml.as_bytes()));
        let received_id = if document.kind == "nfe" {
            Some(
                super::received::store_distributed(tx, tenant, identity, headers, &document.xml)
                    .await?,
            )
        } else {
            None
        };
        let note = document.note.as_ref();
        let evidence = if document.kind == "event" {
            super::production_events::inspect(&document.xml, &recipient)
                .map_err(DomainError::Invalid)?
        } else {
            None
        };
        let event_situation = evidence.as_ref().map(|event| {
            if event.event_type == "110111" {
                "3".to_owned()
            } else {
                format!("event:{}:{}", event.event_type, event.sequence)
            }
        });
        sqlx::query("INSERT INTO fiscal_monitor_documents(tenant_id,run_id,nsu,schema,kind,access_key,issuer_document,issuer_name,issued_at,total_cents,situation,xml,xml_sha256,received_nfe_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)")
            .bind(tenant).bind(run).bind(&document.nsu).bind(&document.schema).bind(&document.kind)
            .bind(note.map(|value| &value.key).or_else(|| evidence.as_ref().map(|event| &event.key))).bind(note.map(|value| &value.issuer))
            .bind(note.map(|value| &value.name)).bind(note.map(|value| value.issued_at))
            .bind(note.map(|value| value.total_cents)).bind(note.map(|value| &value.situation).or(event_situation.as_ref()))
            .bind(&document.xml).bind(hash).bind(received_id).execute(&mut **tx).await.map_err(db)?;
        if let Some(evidence) = evidence {
            super::production_events::reconcile(
                tx,
                tenant,
                identity,
                headers,
                &evidence,
                &document.nsu,
                &document.xml,
            )
            .await?;
        }
    }
    super::production_events::reconcile_stored(tx, tenant, identity, headers).await?;
    let pause = batch.status != "138" || batch.last_nsu == batch.max_nsu;
    // A blocked response never replaces the known maximum NSU with its optional fields.
    sqlx::query("UPDATE fiscal_monitor_state SET last_nsu=CASE WHEN $2='656' THEN last_nsu ELSE $3 END,max_nsu=CASE WHEN $2='656' THEN max_nsu ELSE $4 END,last_status=$2,next_query_at=CASE WHEN $5 THEN clock_timestamp()+interval '1 hour' ELSE clock_timestamp()+interval '2 seconds' END,updated_at=clock_timestamp() WHERE tenant_id=$1")
        .bind(tenant).bind(&batch.status).bind(&batch.last_nsu).bind(&batch.max_nsu).bind(pause)
        .execute(&mut **tx).await.map_err(db)?;
    let result = sqlx::query("UPDATE fiscal_monitor_runs SET outcome='applied',status=$3,document_count=$4,completed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2 AND outcome='pending'")
        .bind(tenant).bind(run).bind(&batch.status).bind(batch.documents.len() as i32).execute(&mut **tx).await.map_err(db)?;
    if result.rows_affected() != 1 {
        return Err(access::AccessError::Internal.into());
    }
    Ok(())
}
