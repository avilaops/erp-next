use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;

use super::{FiscalError, danfe, input, problem};
use crate::{
    domains::{DomainError, authorized, db, response},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};

const PERMISSION: &str = "fiscal.received_nfe.manage";

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ImportReceivedNfeInput {
    pub xml: String,
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedNfeSnapshot {
    id: i64,
    access_key: String,
    issuer_document: String,
    issuer_name: String,
    recipient_document: String,
    number: i64,
    series: i32,
    #[schema(value_type = String, format = DateTime)]
    issued_at: time::OffsetDateTime,
    total_cents: i64,
    item_count: i32,
    environment: i16,
    xml_sha256: String,
    #[schema(value_type = String, format = DateTime)]
    created_at: time::OffsetDateTime,
}

#[utoipa::path(post, path="/api/v1/fiscal/received-nfes/import", tag="Fiscal",
    request_body=ImportReceivedNfeInput, security(("bearerAuth"=[])),
    params(("X-Tenant-Id"=uuid::Uuid,Header)), responses(
    (status=201,body=ReceivedNfeSnapshot,description="Documento importado"),
    (status=200,body=ReceivedNfeSnapshot,description="Importação idempotente repetida"),
    (status=403,description="Sem permissão ou destinatário de outra empresa"),
    (status=409,description="Mesma chave com XML diferente"),
    (status=413,description="Corpo excede 1 MiB"),(status=422,description="XML inválido")))]
pub async fn import(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<ImportReceivedNfeInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let payload = input(payload)?;
    let note = match danfe::inspect(&payload.xml) {
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
    let recipient = match note.recipient.as_deref() {
        Some(value) => value,
        None => {
            return Ok(problem(
                StatusCode::UNPROCESSABLE_ENTITY,
                "missing_recipient",
                "NF-e recebida deve identificar o destinatário",
                serde_json::json!({}),
            ));
        }
    };
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, true).await?;
    let tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    if recipient != tax_id {
        return Ok(problem(
            StatusCode::FORBIDDEN,
            "document_company_mismatch",
            "A empresa ativa não é destinatária desta NF-e",
            serde_json::json!({}),
        ));
    }
    let xml_sha256 = format!("{:x}", Sha256::digest(payload.xml.as_bytes()));
    if let Some(saved) = load_by_key(&mut tx, &note.key).await? {
        tx.commit().await.map_err(db)?;
        if saved.xml_sha256 != xml_sha256 {
            return Ok(problem(
                StatusCode::CONFLICT,
                "received_nfe_conflict",
                "A chave de acesso já foi importada com outro conteúdo",
                serde_json::json!({"accessKey":note.key}),
            ));
        }
        let mut result = response(StatusCode::OK, None, saved);
        result.headers_mut().insert(
            axum::http::HeaderName::from_static("idempotency-replayed"),
            HeaderValue::from_static("true"),
        );
        return Ok(result);
    }
    let environment = note
        .environment
        .parse::<i16>()
        .expect("validated NF-e environment");
    let saved = sqlx::query_as::<_, ReceivedNfeSnapshot>(
        r#"
        INSERT INTO fiscal_received_nfes(
            tenant_id,access_key,issuer_document,issuer_name,recipient_document,number,series,
            issued_at,total_cents,item_count,environment,xml,xml_sha256,imported_by_identity_id
        )
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,id
        FROM identities WHERE auth_subject=$14
        ON CONFLICT (tenant_id,access_key) DO NOTHING
        RETURNING id,access_key,issuer_document,issuer_name,recipient_document,number,series,
            issued_at,total_cents,item_count,environment,xml_sha256,created_at
        "#,
    )
    .bind(tenant)
    .bind(&note.key)
    .bind(&note.issuer)
    .bind(&note.issuer_name)
    .bind(recipient)
    .bind(note.number)
    .bind(note.series)
    .bind(note.issued_at)
    .bind(note.total_cents)
    .bind(note.item_count)
    .bind(environment)
    .bind(&payload.xml)
    .bind(&xml_sha256)
    .bind(&identity.subject)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?;
    let Some(saved) = saved else {
        let saved = load_by_key(&mut tx, &note.key)
            .await?
            .expect("conflicting access key exists after ON CONFLICT");
        tx.commit().await.map_err(db)?;
        if saved.xml_sha256 != xml_sha256 {
            return Ok(problem(
                StatusCode::CONFLICT,
                "received_nfe_conflict",
                "A chave de acesso já foi importada com outro conteúdo",
                serde_json::json!({"accessKey":note.key}),
            ));
        }
        let mut result = response(StatusCode::OK, None, saved);
        result.headers_mut().insert(
            axum::http::HeaderName::from_static("idempotency-replayed"),
            HeaderValue::from_static("true"),
        );
        return Ok(result);
    };
    record_import(&mut tx, tenant, &identity, &headers, &saved).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, None, saved))
}

async fn load_by_key(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
) -> Result<Option<ReceivedNfeSnapshot>, DomainError> {
    sqlx::query_as::<_, ReceivedNfeSnapshot>(
        r#"
        SELECT id,access_key,issuer_document,issuer_name,recipient_document,number,series,
            issued_at,total_cents,item_count,environment,xml_sha256,created_at
        FROM fiscal_received_nfes WHERE access_key=$1
        "#,
    )
    .bind(key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)
}

async fn record_import(
    tx: &mut Transaction<'_, Postgres>,
    tenant: uuid::Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    note: &ReceivedNfeSnapshot,
) -> Result<(), DomainError> {
    let details = serde_json::json!({
        "accessKey":note.access_key,
        "xmlSha256":note.xml_sha256,
    });
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,entity_id,request_id,details) SELECT $1,id,'fiscal.received_nfe.imported','fiscal_received_nfe',$3,$4,$5 FROM identities WHERE auth_subject=$2")
        .bind(tenant).bind(&identity.subject).bind(note.id.to_string())
        .bind(headers.get("x-request-id").and_then(|value| value.to_str().ok())).bind(&details)
        .execute(&mut **tx).await.map_err(db)?;
    sqlx::query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'fiscal_received_nfe',$2,'fiscal.received_nfe.imported',$3)")
        .bind(tenant).bind(note.id.to_string()).bind(details).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
