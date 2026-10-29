use std::sync::Arc;

use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;
use zeroize::Zeroizing;

use super::certificate_crypto::{
    CertificateMaterial, CertificateMetadata, MAX_A1_BYTES, SealedCertificate,
};
use super::{FiscalError, expected_revision, input, problem};
use crate::{
    domains::{DomainChange, DomainError, authorized, db, record, response},
    platform::{access, auth::AuthenticatedIdentity, state::AppState},
};

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CertificateInput {
    #[schema(value_type = String, format = Byte)]
    pkcs12_base64: Zeroizing<String>,
    #[schema(value_type = String, format = Password)]
    password: Zeroizing<String>,
}

#[derive(FromRow)]
struct CertificateRow {
    revision: i64,
    metadata: Option<serde_json::Value>,
    encryption_key_id: Option<String>,
    nonce: Option<Vec<u8>>,
    ciphertext: Option<Vec<u8>>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CertificateStatus {
    NotConfigured,
    Active,
    Expiring,
    Expired,
    NotYetValid,
    CompanyMismatch,
    Unavailable,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CertificateSnapshot {
    tenant_id: Uuid,
    revision: i64,
    can_edit: bool,
    upload_available: bool,
    company_tax_id: String,
    status: CertificateStatus,
    data: Option<CertificateMetadata>,
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<Option<CertificateRow>, DomainError> {
    sqlx::query_as("SELECT revision,metadata,encryption_key_id,nonce,ciphertext FROM fiscal_a1_certificates WHERE tenant_id=$1")
        .bind(tenant).fetch_optional(&mut **tx).await.map_err(db)
}

async fn company_tax_id(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<String, DomainError> {
    sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)
}

fn snapshot(
    state: &AppState,
    tenant: Uuid,
    tax_id: String,
    row: Option<CertificateRow>,
    can_edit: bool,
) -> Result<CertificateSnapshot, DomainError> {
    let revision = row.as_ref().map_or(0, |value| value.revision);
    let metadata = row
        .as_ref()
        .and_then(|value| value.metadata.clone())
        .map(serde_json::from_value::<CertificateMetadata>)
        .transpose()
        .map_err(|_| access::AccessError::Internal)?;
    let status = match (metadata.as_ref(), row.as_ref()) {
        (Some(metadata), Some(row)) => {
            let available = state
                .certificates
                .as_ref()
                .zip(row.encryption_key_id.as_ref())
                .zip(row.nonce.as_ref())
                .zip(row.ciphertext.as_ref())
                .is_some_and(|(((vault, key), nonce), ciphertext)| {
                    vault
                        .open(
                            tenant,
                            revision,
                            metadata,
                            &SealedCertificate {
                                key_id: key.clone(),
                                nonce: nonce.clone(),
                                ciphertext: ciphertext.clone(),
                            },
                        )
                        .is_ok()
                });
            let now = OffsetDateTime::now_utc().unix_timestamp();
            if !available {
                CertificateStatus::Unavailable
            } else if metadata.tax_id != tax_id {
                CertificateStatus::CompanyMismatch
            } else if metadata.valid_from > now {
                CertificateStatus::NotYetValid
            } else if metadata.valid_until <= now {
                CertificateStatus::Expired
            } else if metadata.valid_until - now <= 30 * 86400 {
                CertificateStatus::Expiring
            } else {
                CertificateStatus::Active
            }
        }
        _ => CertificateStatus::NotConfigured,
    };
    Ok(CertificateSnapshot {
        tenant_id: tenant,
        revision,
        can_edit,
        upload_available: state.certificates.is_some(),
        company_tax_id: tax_id,
        status,
        data: metadata,
    })
}

pub async fn verified(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<bool, DomainError> {
    let tax_id = company_tax_id(tx, tenant).await?;
    let row = load(tx, tenant).await?;
    Ok(matches!(
        snapshot(state, tenant, tax_id, row, false)?.status,
        CertificateStatus::Active | CertificateStatus::Expiring
    ))
}

#[utoipa::path(get,path="/api/v1/fiscal/certificate",tag="Fiscal",operation_id="get_fiscal_certificate",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=CertificateSnapshot),(status=403,description="Sem permissão fiscal")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.config.read",
        "fiscal.config.manage",
        false,
    )
    .await?;
    let tax_id = company_tax_id(&mut tx, tenant).await?;
    let result = snapshot(
        &state,
        tenant,
        tax_id,
        load(&mut tx, tenant).await?,
        can_edit,
    )?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(result.revision), result))
}

#[utoipa::path(put,path="/api/v1/fiscal/certificate",tag="Fiscal",operation_id="put_fiscal_certificate",request_body=CertificateInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=CertificateSnapshot),(status=403,description="Sem permissão fiscal"),(status=412,description="Revisão desatualizada"),(status=413,description="Arquivo excede limite"),(status=422,description="Arquivo, senha, empresa, validade ou cadeia inválida"),(status=428,description="If-Match obrigatório"),(status=503,description="Armazenamento seguro indisponível")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<CertificateInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    // Release database locks before the bounded, CPU intensive PKCS#12 validation.
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.config.read",
        "fiscal.config.manage",
        true,
    )
    .await?;
    let expected = expected_revision(&headers)?;
    let current = load(&mut tx, tenant).await?.map_or(0, |row| row.revision);
    if current != expected {
        return Err(DomainError::StaleRevision.into());
    }
    let tax_id = company_tax_id(&mut tx, tenant).await?;
    if tax_id.len() != 14 {
        return Err(DomainError::Invalid(
            "Cadastre o CNPJ da empresa antes de conectar o certificado",
        )
        .into());
    }
    let Some(vault) = state.certificates.clone() else {
        return Ok(problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "certificate_storage_unavailable",
            "O armazenamento seguro de certificados precisa ser configurado",
            serde_json::json!({}),
        ));
    };
    tx.commit().await.map_err(db)?;
    let value = input(payload)?;
    if value.pkcs12_base64.len() > MAX_A1_BYTES.div_ceil(3) * 4 {
        return Ok(problem(
            StatusCode::PAYLOAD_TOO_LARGE,
            "certificate_too_large",
            "O certificado deve ter até 64 KiB",
            serde_json::json!({}),
        ));
    }
    let bytes = STANDARD
        .decode(value.pkcs12_base64.as_bytes())
        .map_err(|_| DomainError::Invalid("Arquivo PFX/P12 inválido"))?;
    if bytes.len() > MAX_A1_BYTES {
        return Ok(problem(
            StatusCode::PAYLOAD_TOO_LARGE,
            "certificate_too_large",
            "O certificado deve ter até 64 KiB",
            serde_json::json!({}),
        ));
    }
    let material = Arc::new(CertificateMaterial {
        pkcs12: bytes,
        password: value.password.to_string(),
    });
    let metadata = vault
        .validate(material.clone(), tax_id.clone())
        .await
        .map_err(DomainError::Invalid)?;
    let (actual_tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.config.read",
        "fiscal.config.manage",
        true,
    )
    .await?;
    if actual_tenant != tenant || company_tax_id(&mut tx, tenant).await? != tax_id {
        return Err(DomainError::Conflict(
            "A empresa mudou durante a verificação. Recarregue a tela",
        )
        .into());
    }
    let current = load(&mut tx, tenant).await?.map_or(0, |row| row.revision);
    if current != expected {
        return Err(DomainError::StaleRevision.into());
    }
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    let encrypted = vault
        .seal(tenant, next, &metadata, &material)
        .map_err(|_| access::AccessError::Internal)?;
    let details = serde_json::to_value(&metadata).map_err(|_| access::AccessError::Internal)?;
    sqlx::query("INSERT INTO fiscal_a1_certificates(tenant_id,revision,metadata,encryption_key_id,nonce,ciphertext,updated_by_identity_id) VALUES($1,$2,$3,$4,$5,$6,(SELECT id FROM identities WHERE auth_subject=$7)) ON CONFLICT(tenant_id) DO UPDATE SET revision=excluded.revision,metadata=excluded.metadata,encryption_key_id=excluded.encryption_key_id,nonce=excluded.nonce,ciphertext=excluded.ciphertext,updated_by_identity_id=excluded.updated_by_identity_id,updated_at=clock_timestamp()")
        .bind(tenant).bind(next).bind(details).bind(&encrypted.key_id).bind(&encrypted.nonce).bind(&encrypted.ciphertext).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "fiscal_certificate", id: tenant, event: "fiscal.certificate.connected", details: serde_json::json!({"revision":next,"fingerprint":metadata.fingerprint,"validUntil":metadata.valid_until}) }).await?;
    let result = snapshot(&state, tenant, tax_id, load(&mut tx, tenant).await?, true)?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}

#[utoipa::path(delete,path="/api/v1/fiscal/certificate",tag="Fiscal",operation_id="remove_fiscal_certificate",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=CertificateSnapshot),(status=403,description="Sem permissão fiscal"),(status=404,description="Certificado não cadastrado"),(status=412,description="Revisão desatualizada"),(status=428,description="If-Match obrigatório")))]
pub async fn remove(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.config.read",
        "fiscal.config.manage",
        true,
    )
    .await?;
    let expected = expected_revision(&headers)?;
    let current = load(&mut tx, tenant).await?.ok_or(DomainError::NotFound)?;
    if current.revision != expected {
        return Err(DomainError::StaleRevision.into());
    }
    if current.metadata.is_none() {
        return Err(DomainError::NotFound.into());
    }
    let next = current
        .revision
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    sqlx::query("UPDATE fiscal_a1_certificates SET revision=$2,metadata=NULL,encryption_key_id=NULL,nonce=NULL,ciphertext=NULL,updated_by_identity_id=(SELECT id FROM identities WHERE auth_subject=$3),updated_at=clock_timestamp() WHERE tenant_id=$1")
        .bind(tenant).bind(next).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "fiscal_certificate",
            id: tenant,
            event: "fiscal.certificate.removed",
            details: serde_json::json!({"revision":next}),
        },
    )
    .await?;
    let tax_id = company_tax_id(&mut tx, tenant).await?;
    let result = snapshot(&state, tenant, tax_id, load(&mut tx, tenant).await?, true)?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}
