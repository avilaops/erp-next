//! Private, immutable evidence. Attaching a document never declares a payment.
use super::{
    DomainChange, DomainError, command_key, db, record, remember, replay, response, sales,
};
use crate::platform::{access, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

const MAX_BYTES: usize = 10 * 1024 * 1024;
const COLUMNS: &str = "id,order_id,payment_id,filename,media_type,byte_size,sha256,description,document_date::text,uploaded_at::text,uploaded_by";

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SupportingDocumentInput {
    pub filename: String,
    pub media_type: String,
    pub content_base64: String,
    pub description: String,
    pub document_date: Option<String>,
}

#[derive(Clone, FromRow, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SupportingDocument {
    pub id: Uuid,
    pub order_id: Uuid,
    pub payment_id: Option<Uuid>,
    pub filename: String,
    pub media_type: String,
    pub byte_size: i64,
    pub sha256: String,
    pub description: String,
    pub document_date: Option<String>,
    pub uploaded_at: String,
    pub uploaded_by: String,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SupportingDocumentList {
    tenant_id: Uuid,
    order_id: Uuid,
    can_attach_other: bool,
    can_attach_payment: bool,
    data: Vec<SupportingDocument>,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AttachDocumentInput {
    payment_id: Option<Uuid>,
    document: SupportingDocumentInput,
}
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SupportingDocumentResponse {
    tenant_id: Uuid,
    order_id: Uuid,
    data: SupportingDocument,
}

pub(super) struct PreparedDocument {
    filename: String,
    media_type: String,
    content: Vec<u8>,
    description: String,
    document_date: Option<time::Date>,
    sha256: String,
}
impl PreparedDocument {
    /// A command remembers intent and content identity, never the uploaded bytes.
    pub(super) fn fingerprint(&self) -> Value {
        json!({"filename":self.filename,"mediaType":self.media_type,"byteSize":self.content.len(),
            "sha256":self.sha256,"description":self.description,"documentDate":self.document_date.map(|d|d.to_string())})
    }
}

pub(super) fn prepare(input: SupportingDocumentInput) -> Result<PreparedDocument, DomainError> {
    let filename = input.filename.trim();
    let description = input.description.trim();
    if !(1..=180).contains(&filename.chars().count())
        || filename
            .chars()
            .any(|c| c.is_control() || "/\\:".contains(c))
        || matches!(filename, "." | "..")
        || !(3..=2000).contains(&description.chars().count())
        || description.chars().any(char::is_control)
    {
        return Err(DomainError::Invalid(
            "Nome de arquivo ou descrição inválidos",
        ));
    }
    if input.content_base64.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err(DomainError::Invalid("Arquivo deve ter no máximo 10 MiB"));
    }
    let content = STANDARD
        .decode(input.content_base64)
        .map_err(|_| DomainError::Invalid("Conteúdo do arquivo não é base64 válido"))?;
    if content.is_empty() || content.len() > MAX_BYTES {
        return Err(DomainError::Invalid("Arquivo deve ter de 1 byte a 10 MiB"));
    }
    let lower = filename.to_lowercase();
    let matches = match input.media_type.as_str() {
        "application/pdf" => lower.ends_with(".pdf") && content.starts_with(b"%PDF-"),
        "image/png" => lower.ends_with(".png") && content.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => {
            (lower.ends_with(".jpg") || lower.ends_with(".jpeg"))
                && content.starts_with(b"\xff\xd8\xff")
        }
        _ => false,
    };
    if !matches {
        return Err(DomainError::Invalid(
            "Arquivo deve ser PDF, PNG ou JPEG com tipo e conteúdo correspondentes",
        ));
    }
    let document_date = input
        .document_date
        .as_deref()
        .map(sales::date)
        .transpose()?;
    Ok(PreparedDocument {
        filename: filename.into(),
        media_type: input.media_type,
        sha256: format!("{:x}", Sha256::digest(&content)),
        content,
        description: description.into(),
        document_date,
    })
}

pub(super) async fn store(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
    payment: Option<Uuid>,
    document: PreparedDocument,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
) -> Result<SupportingDocument, DomainError> {
    let receivable: Option<Uuid> = if let Some(payment) = payment {
        Some(sqlx::query_scalar("SELECT p.receivable_id FROM receivable_payments p JOIN receivables r ON r.tenant_id=p.tenant_id AND r.id=p.receivable_id WHERE p.tenant_id=$1 AND p.id=$2 AND r.order_id=$3 AND p.kind='receipt'")
            .bind(tenant).bind(payment).bind(order).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?)
    } else {
        None
    };
    let id = Uuid::now_v7();
    let query = format!(
        "INSERT INTO order_supporting_documents(id,tenant_id,order_id,receivable_id,payment_id,filename,media_type,byte_size,sha256,content,description,document_date,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING {COLUMNS}"
    );
    let stored = sqlx::query_as::<_, SupportingDocument>(&query)
        .bind(id)
        .bind(tenant)
        .bind(order)
        .bind(receivable)
        .bind(payment)
        .bind(document.filename)
        .bind(document.media_type)
        .bind(document.content.len() as i64)
        .bind(document.sha256)
        .bind(document.content)
        .bind(document.description)
        .bind(document.document_date)
        .bind(&identity.subject)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    record(tx,tenant,identity,headers,DomainChange{kind:"supporting_document",id,event:"order.document_attached",
        details:json!({"orderId":order,"paymentId":payment,"sha256":stored.sha256,"byteSize":stored.byte_size})}).await?;
    Ok(stored)
}

struct Rights {
    sales: bool,
    finance: bool,
    attach_other: bool,
    attach_payment: bool,
}
async fn authorized<'a>(
    state: &'a AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>, Rights), DomainError> {
    let tenant = access::tenant_id(headers)?;
    let mut tx = access::tenant_transaction(state, tenant).await?;
    if write {
        sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    let access = access::load_access(&mut tx, tenant, &identity.subject).await?;
    let sales = access::require_permission(&access, "sales.orders.read").is_ok();
    let finance = access::require_permission(&access, "finance.receivables.read").is_ok();
    if !sales && !finance {
        return Err(access::AccessError::Forbidden.into());
    }
    let rights = Rights {
        sales,
        finance,
        attach_other: sales && access::require_permission(&access, "sales.orders.manage").is_ok(),
        attach_payment: finance
            && access::require_permission(&access, "finance.receivables.manage").is_ok(),
    };
    Ok((tenant, tx, rights))
}
async fn require_order(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<(), DomainError> {
    if !sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM sales_orders WHERE tenant_id=$1 AND id=$2)",
    )
    .bind(tenant)
    .bind(order)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?
    {
        return Err(DomainError::NotFound);
    }
    Ok(())
}

#[utoipa::path(get,path="/api/v1/orders/{id}/documents",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=SupportingDocumentList),(status=403),(status=404)))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(order): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, rights) = authorized(&state, &identity, &headers, false).await?;
    require_order(&mut tx, tenant, order).await?;
    let query = format!(
        "SELECT {COLUMNS} FROM order_supporting_documents WHERE tenant_id=$1 AND order_id=$2 AND ((payment_id IS NULL AND $3) OR (payment_id IS NOT NULL AND $4)) ORDER BY uploaded_at,id"
    );
    let data = sqlx::query_as(&query)
        .bind(tenant)
        .bind(order)
        .bind(rights.sales)
        .bind(rights.finance)
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        SupportingDocumentList {
            tenant_id: tenant,
            order_id: order,
            can_attach_other: rights.attach_other,
            can_attach_payment: rights.attach_payment,
            data,
        },
    ))
}

fn attached_response(value: SupportingDocumentResponse) -> Response {
    let etag = HeaderValue::from_str(&format!("\"{}\"", value.data.sha256)).expect("SHA256 header");
    let mut result = response(StatusCode::CREATED, None, value);
    result.headers_mut().insert(header::ETAG, etag);
    result
}
#[utoipa::path(post,path="/api/v1/orders/{id}/documents",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),request_body=AttachDocumentInput,responses((status=201,body=SupportingDocumentResponse),(status=403),(status=404),(status=409),(status=422),(status=428)))]
pub async fn attach(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(order): Path<Uuid>,
    payload: Result<Json<AttachDocumentInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, rights) = authorized(&state, &identity, &headers, true).await?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("Documento inválido ou campos desconhecidos"))?;
    if !(if input.payment_id.is_some() {
        rights.attach_payment
    } else {
        rights.attach_other
    }) {
        return Err(access::AccessError::Forbidden.into());
    }
    require_order(&mut tx, tenant, order).await?;
    let prepared = prepare(input.document)?;
    let request =
        json!({"orderId":order,"paymentId":input.payment_id,"document":prepared.fingerprint()});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.document.attach",
        &request,
    )
    .await?
    {
        let result = serde_json::from_value(previous).map_err(|_| access::AccessError::Internal)?;
        tx.commit().await.map_err(db)?;
        return Ok(attached_response(result));
    }
    let data = store(
        &mut tx,
        tenant,
        order,
        input.payment_id,
        prepared,
        &identity,
        &headers,
    )
    .await?;
    let result = SupportingDocumentResponse {
        tenant_id: tenant,
        order_id: order,
        data,
    };
    let value = serde_json::to_value(&result).map_err(|_| access::AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.document.attach",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(attached_response(result))
}

#[utoipa::path(get,path="/api/v1/orders/{id}/documents/{documentId}",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("documentId"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,description="Documento privado original"),(status=403),(status=404)))]
pub async fn download(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path((order, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, rights) = authorized(&state, &identity, &headers, false).await?;
    let row:Option<(Option<Uuid>,String,String,Vec<u8>)>=sqlx::query_as("SELECT payment_id,filename,media_type,content FROM order_supporting_documents WHERE tenant_id=$1 AND order_id=$2 AND id=$3")
        .bind(tenant).bind(order).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
    let (payment, name, media, content) = row.ok_or(DomainError::NotFound)?;
    if !(if payment.is_some() {
        rights.finance
    } else {
        rights.sales
    }) {
        return Err(access::AccessError::Forbidden.into());
    }
    tx.commit().await.map_err(db)?;
    let encoded: String = name
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                char::from(b).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    Ok((
        [
            (header::CONTENT_TYPE, media),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename*=UTF-8''{encoded}"),
            ),
            (header::CACHE_CONTROL, "private, no-store".into()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
        ],
        content,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(bytes: &[u8], filename: &str, media_type: &str) -> SupportingDocumentInput {
        SupportingDocumentInput {
            filename: filename.into(),
            media_type: media_type.into(),
            content_base64: STANDARD.encode(bytes),
            description: "Comprovante do recebimento".into(),
            document_date: Some("2026-11-13".into()),
        }
    }

    #[test]
    fn original_pdf_png_and_jpeg_preserve_bytes_and_have_content_free_fingerprints() {
        for (bytes, name, media) in [
            (
                &b"%PDF-1.4\nproof-fixture"[..],
                "comprovante.pdf",
                "application/pdf",
            ),
            (
                &b"\x89PNG\r\n\x1a\nfixture"[..],
                "comprovante.png",
                "image/png",
            ),
            (
                &b"\xff\xd8\xfffixture"[..],
                "comprovante.jpeg",
                "image/jpeg",
            ),
        ] {
            let document = prepare(input(bytes, name, media)).unwrap();
            assert_eq!(document.content, bytes);
            let intent = document.fingerprint();
            assert_eq!(intent["byteSize"], bytes.len());
            assert_eq!(intent["filename"], name);
            assert_eq!(intent["documentDate"], "2026-11-13");
            assert_eq!(intent["sha256"].as_str().unwrap().len(), 64);
            assert!(intent.get("contentBase64").is_none());
            assert!(intent.get("content").is_none());
        }
    }

    #[test]
    fn type_extension_magic_empty_and_invalid_base64_are_rejected() {
        for value in [
            input(b"not a PDF", "proof.pdf", "application/pdf"),
            input(b"%PDF-1.4", "proof.png", "image/png"),
            input(b"%PDF-1.4", "proof.png", "application/pdf"),
            input(b"%PDF-1.4", "proof.pdf", "text/html"),
            input(b"", "proof.pdf", "application/pdf"),
            SupportingDocumentInput {
                content_base64: "https://example.invalid/proof.pdf".into(),
                ..input(b"%PDF-1.4", "proof.pdf", "application/pdf")
            },
        ] {
            assert!(prepare(value).is_err());
        }
    }

    #[test]
    fn traversal_header_injection_and_invalid_description_or_date_are_rejected() {
        for name in [
            "../proof.pdf",
            "folder/proof.pdf",
            "folder\\proof.pdf",
            "C:proof.pdf",
            "proof\r\nX-Header.pdf",
            "",
        ] {
            assert!(
                prepare(input(b"%PDF-1.4", name, "application/pdf")).is_err(),
                "{name:?}"
            );
        }
        for description in ["", "ab", "proof\0value"] {
            let mut value = input(b"%PDF-1.4", "proof.pdf", "application/pdf");
            value.description = description.into();
            assert!(prepare(value).is_err());
        }
        for date in ["2026-02-30", "26-11-13", "2026-11-13T10:00:00Z"] {
            let mut value = input(b"%PDF-1.4", "proof.pdf", "application/pdf");
            value.document_date = Some(date.into());
            assert!(prepare(value).is_err());
        }
    }

    #[test]
    fn ten_mib_boundary_applies_to_decoded_content() {
        let mut bytes = vec![b'x'; MAX_BYTES];
        bytes[..5].copy_from_slice(b"%PDF-");
        assert_eq!(
            prepare(input(&bytes, "proof.pdf", "application/pdf"))
                .unwrap()
                .content
                .len(),
            MAX_BYTES
        );
        bytes.push(b'x');
        assert!(prepare(input(&bytes, "proof.pdf", "application/pdf")).is_err());
    }
}
