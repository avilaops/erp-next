use super::{FiscalError, danfe, input, problem};
use crate::domains::list_sort::SortField;
use crate::{
    domains::{DomainError, authorized, db, response},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Json,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
const PERMISSION: &str = "fiscal.nfe.manage";
const READ_PERMISSION: &str = "fiscal.nfe.read";
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ImportOutgoingNfeInput {
    pub xml: String,
}
#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingNfeSnapshot {
    id: i64,
    access_key: String,
    issuer_document: String,
    issuer_name: String,
    recipient_document: Option<String>,
    recipient_name: String,
    number: i64,
    series: i32,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "serialize_timestamp")]
    issued_at: time::OffsetDateTime,
    total_cents: i64,
    item_count: i32,
    environment: i16,
    xml_sha256: String,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "serialize_timestamp")]
    created_at: time::OffsetDateTime,
}
fn serialize_timestamp<S: serde::Serializer>(
    value: &time::OffsetDateTime,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use time::format_description::well_known::Rfc3339;
    serializer.serialize_str(&value.format(&Rfc3339).map_err(serde::ser::Error::custom)?)
}
#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct OutgoingQuery {
    q: Option<String>,
    from: Option<String>,
    to: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,

    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
    #[serde(rename = "sortOrder")]
    sort_order: Option<String>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingPage {
    tenant_id: Uuid,
    can_import: bool,
    data: Vec<OutgoingNfeSnapshot>,
    total: i64,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingDetail {
    tenant_id: Uuid,
    data: OutgoingNfeSnapshot,
}
#[utoipa::path(get, path="/api/v1/fiscal/outgoing-imports/{id}", tag="Fiscal", operation_id="get_outgoing_import",
    security(("bearerAuth"=[])), params(("id"=i64,Path),("X-Tenant-Id"=Uuid,Header)), responses(
    (status=200,body=OutgoingDetail),(status=403,description="Sem permissão fiscal"),
    (status=404,description="Nota não encontrada nesta empresa")))]
pub async fn get_document(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        READ_PERMISSION,
        PERMISSION,
        false,
    )
    .await?;
    let data = sqlx::query_as::<_, OutgoingNfeSnapshot>(
        "SELECT id,access_key,issuer_document,issuer_name,recipient_document,recipient_name,number,series,issued_at,total_cents,item_count,environment,xml_sha256,created_at FROM fiscal_outgoing_imports WHERE tenant_id=$1 AND id=$2",
    ).bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        OutgoingDetail {
            tenant_id: tenant,
            data,
        },
    ))
}
fn filter_date(value: Option<&str>) -> Result<Option<time::Date>, DomainError> {
    let format = time::format_description::parse_borrowed::<2>("[year]-[month]-[day]")
        .expect("static date format");
    value
        .map(|raw| {
            time::Date::parse(raw, &format)
                .map_err(|_| DomainError::Invalid("Data inválida; use AAAA-MM-DD"))
        })
        .transpose()
}
#[utoipa::path(get, path="/api/v1/fiscal/outgoing-imports", tag="Fiscal",
    security(("bearerAuth"=[])), params(OutgoingQuery,("X-Tenant-Id"=Uuid,Header)), responses(
    (status=200,body=OutgoingPage),(status=403,description="Sem permissão fiscal"),
    (status=422,description="Filtros inválidos")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<OutgoingQuery>, QueryRejection>,
) -> Result<Response, FiscalError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let ordering = crate::domains::list_sort::order_by(
        query.sort_by.as_deref(),
        query.sort_order.as_deref(),
        &[
            SortField::typed("number", "fiscal_outgoing_imports.number"),
            SortField::text("recipientName", "recipient_name"),
            SortField::typed("issuedAt", "issued_at"),
            SortField::typed("totalCents", "total_cents"),
            SortField::text(
                "environment",
                "CASE environment WHEN 2 THEN 'Homologação · sem valor fiscal' ELSE 'Produção declarada no XML' END",
            ),
        ],
        "issued_at DESC,id DESC",
        "fiscal_outgoing_imports.id",
    )?;
    let q = query.q.unwrap_or_default().trim().to_lowercase();
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(25);
    let from = filter_date(query.from.as_deref())?;
    let to = filter_date(query.to.as_deref())?;
    if q.chars().count() > 200
        || !(1..=100).contains(&limit)
        || from.zip(to).is_some_and(|(a, b)| a > b)
    {
        return Err(DomainError::Invalid("Confira o período e os filtros da consulta").into());
    }
    let (tenant, mut tx, can_import) = authorized(
        &state,
        &headers,
        &identity,
        READ_PERMISSION,
        PERMISSION,
        false,
    )
    .await?;
    let data = sqlx::query_as::<_, OutgoingNfeSnapshot>(&format!(
        "SELECT id,access_key,issuer_document,issuer_name,recipient_document,recipient_name,number,series,issued_at,total_cents,item_count,environment,xml_sha256,created_at FROM fiscal_outgoing_imports WHERE tenant_id=$1 AND strpos(lower(recipient_name || ' ' || coalesce(recipient_document,'') || ' ' || issuer_name || ' ' || issuer_document || ' ' || access_key || ' ' || number::text),$2)>0 AND ($3::date IS NULL OR (issued_at AT TIME ZONE 'America/Sao_Paulo')::date >= $3) AND ($4::date IS NULL OR (issued_at AT TIME ZONE 'America/Sao_Paulo')::date <= $4) {ordering} LIMIT $5 OFFSET $6"
    )).bind(tenant).bind(&q).bind(from).bind(to).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total = sqlx::query_scalar(
        "SELECT count(*) FROM fiscal_outgoing_imports WHERE tenant_id=$1 AND strpos(lower(recipient_name || ' ' || coalesce(recipient_document,'') || ' ' || issuer_name || ' ' || issuer_document || ' ' || access_key || ' ' || number::text),$2)>0 AND ($3::date IS NULL OR (issued_at AT TIME ZONE 'America/Sao_Paulo')::date >= $3) AND ($4::date IS NULL OR (issued_at AT TIME ZONE 'America/Sao_Paulo')::date <= $4)"
    ).bind(tenant).bind(&q).bind(from).bind(to).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        OutgoingPage {
            tenant_id: tenant,
            can_import,
            data,
            total,
        },
    ))
}
#[utoipa::path(get, path="/api/v1/fiscal/outgoing-imports/{id}/xml", tag="Fiscal", operation_id="download_outgoing_import_xml",
    security(("bearerAuth"=[])), params(("id"=i64,Path),("X-Tenant-Id"=Uuid,Header)), responses(
    (status=200,description="XML original armazenado",content_type="application/xml",body=String),
    (status=403,description="Sem permissão fiscal"),(status=404,description="Nota não encontrada")))]
pub async fn download_xml(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Response, FiscalError> {
    download(&state, &identity, &headers, id, false).await
}
#[utoipa::path(get, path="/api/v1/fiscal/outgoing-imports/{id}/danfe", tag="Fiscal", operation_id="download_outgoing_import_danfe",
    security(("bearerAuth"=[])), params(("id"=i64,Path),("X-Tenant-Id"=Uuid,Header)), responses(
    (status=200,description="DANFE do XML armazenado",content_type="application/pdf",body=Vec<u8>),
    (status=403,description="Sem permissão fiscal"),(status=404,description="Nota não encontrada"),
    (status=422,description="XML recusado pelo gerador"),(status=502,description="Falha no gerador"),
    (status=503,description="Gerador não configurado")))]
pub async fn download_danfe(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Response, FiscalError> {
    download(&state, &identity, &headers, id, true).await
}
async fn download(
    state: &AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    id: i64,
    pdf: bool,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) =
        authorized(state, headers, identity, READ_PERMISSION, PERMISSION, false).await?;
    let document = sqlx::query_as::<_, (String,String,String,i16)>(
        "SELECT access_key,xml,xml_sha256,environment FROM fiscal_outgoing_imports WHERE tenant_id=$1 AND id=$2"
    ).bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    let bytes = if pdf {
        let Some(client) = state.danfe.as_ref() else {
            return Ok(problem(
                StatusCode::SERVICE_UNAVAILABLE,
                "danfe_unavailable",
                "Gerador de DANFE ainda não configurado",
                serde_json::json!({}),
            ));
        };
        let model = document
            .0
            .get(20..22)
            .and_then(|value| value.parse::<u8>().ok())
            .unwrap_or(0);
        match client.render(&document.1, &document.0, model).await {
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
                    "Não foi possível gerar o DANFE no serviço fiscal",
                    serde_json::json!({}),
                ));
            }
        }
    } else {
        document.1.into_bytes()
    };
    // Recheck authorization after a potentially slow provider request.
    let (_, tx, _) =
        authorized(state, headers, identity, READ_PERMISSION, PERMISSION, false).await?;
    tx.commit().await.map_err(db)?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let (prefix, extension, content_type) = if pdf {
        ("DANFE", "pdf", "application/pdf")
    } else {
        ("NFE", "xml", "application/xml; charset=utf-8")
    };
    let mut result = Response::new(axum::body::Body::from(bytes));
    for (name, value) in [
        (header::CONTENT_TYPE, content_type.to_owned()),
        (
            header::CONTENT_DISPOSITION,
            format!(
                "attachment; filename=\"{prefix}-{}.{extension}\"",
                document.0
            ),
        ),
        (header::CACHE_CONTROL, "no-store".to_owned()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
        (
            axum::http::HeaderName::from_static("x-xml-sha256"),
            document.2,
        ),
        (
            axum::http::HeaderName::from_static("x-nfe-environment"),
            document.3.to_string(),
        ),
    ] {
        result.headers_mut().insert(
            name,
            HeaderValue::from_str(&value).expect("bounded document metadata"),
        );
    }
    if pdf {
        result.headers_mut().insert(
            "x-pdf-sha256",
            HeaderValue::from_str(&digest).expect("SHA-256"),
        );
        result.headers_mut().insert(
            "x-nfe-authorization-check",
            HeaderValue::from_static("xml-protocol-only"),
        );
    }
    Ok(result)
}
#[utoipa::path(post, path="/api/v1/fiscal/outgoing-imports/import", tag="Fiscal", operation_id="import_outgoing_nfe_xml",
    request_body=ImportOutgoingNfeInput, security(("bearerAuth"=[])),
    params(("X-Tenant-Id"=uuid::Uuid,Header)), responses(
    (status=201,body=OutgoingNfeSnapshot,description="XML autorizado de saída arquivado"),
    (status=200,body=OutgoingNfeSnapshot,description="Importação idempotente repetida"),
    (status=403,description="Sem permissão ou emitente de outra empresa"),
    (status=409,description="Mesma chave com XML diferente"),
    (status=413,description="Corpo excede 1 MiB"),(status=422,description="XML inválido")))]
pub async fn import(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<ImportOutgoingNfeInput>, JsonRejection>,
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
    if let Err(title) = validate_outgoing(&payload.xml, &note) {
        return Ok(problem(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_outgoing_xml",
            title,
            serde_json::json!({}),
        ));
    }
    let recipient_name = match recipient_name(&payload.xml) {
        Ok(name) => name,
        Err(title) => {
            return Ok(problem(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_outgoing_xml",
                title,
                serde_json::json!({}),
            ));
        }
    };
    let recipient = note.recipient.as_deref();
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, true).await?;
    let tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    if note.issuer != tax_id {
        return Ok(problem(
            StatusCode::FORBIDDEN,
            "document_company_mismatch",
            "A empresa ativa não é emitente desta NF-e",
            serde_json::json!({}),
        ));
    }
    // An XML archive must not create a second representation of an issuance record.
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM fiscal_nfe_documents WHERE tenant_id=$1 AND access_key=$2)",
    )
    .bind(tenant)
    .bind(&note.key)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    if exists {
        return Ok(problem(
            StatusCode::CONFLICT,
            "outgoing_issuance_exists",
            "A chave de acesso já pertence a uma emissão desta empresa",
            serde_json::json!({"accessKey":note.key}),
        ));
    }
    let xml_sha256 = format!("{:x}", Sha256::digest(payload.xml.as_bytes()));
    if let Some(saved) = load_by_key(&mut tx, tenant, &note.key).await? {
        tx.commit().await.map_err(db)?;
        if saved.xml_sha256 != xml_sha256 {
            return Ok(problem(
                StatusCode::CONFLICT,
                "outgoing_import_conflict",
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
    // The configured fiscal service validates the schema and cryptographic signature.
    // Fail closed before writing the document when validation is unavailable or rejected.
    if let Err((status, code, title)) =
        validate_provider(state.danfe.as_ref(), &payload.xml, &note).await
    {
        return Ok(problem(status, code, title, serde_json::json!({})));
    }
    let environment = note
        .environment
        .parse::<i16>()
        .expect("validated NF-e environment");
    let saved = sqlx::query_as::<_, OutgoingNfeSnapshot>(
        r#"
        INSERT INTO fiscal_outgoing_imports(
            tenant_id,access_key,issuer_document,issuer_name,recipient_document,recipient_name,number,series,
            issued_at,total_cents,item_count,environment,xml,xml_sha256,imported_by_identity_id
        )
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,id
        FROM identities WHERE auth_subject=$15
        ON CONFLICT (tenant_id,access_key) DO NOTHING
        RETURNING id,access_key,issuer_document,issuer_name,recipient_document,recipient_name,number,series,
            issued_at,total_cents,item_count,environment,xml_sha256,created_at
        "#,
    )
    .bind(tenant)
    .bind(&note.key)
    .bind(&note.issuer)
    .bind(&note.issuer_name)
    .bind(recipient)
    .bind(&recipient_name)
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
        let saved = load_by_key(&mut tx, tenant, &note.key)
            .await?
            .expect("conflicting access key exists after ON CONFLICT");
        tx.commit().await.map_err(db)?;
        if saved.xml_sha256 != xml_sha256 {
            return Ok(problem(
                StatusCode::CONFLICT,
                "outgoing_import_conflict",
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
    tenant: Uuid,
    key: &str,
) -> Result<Option<OutgoingNfeSnapshot>, DomainError> {
    sqlx::query_as::<_, OutgoingNfeSnapshot>(
        r#"
        SELECT id,access_key,issuer_document,issuer_name,recipient_document,recipient_name,number,series,
            issued_at,total_cents,item_count,environment,xml_sha256,created_at
        FROM fiscal_outgoing_imports WHERE tenant_id=$1 AND access_key=$2
        "#,
    )
    .bind(tenant)
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
    note: &OutgoingNfeSnapshot,
) -> Result<(), DomainError> {
    let details = serde_json::json!({
        "accessKey":note.access_key,
        "xmlSha256":note.xml_sha256,
    });
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,entity_id,request_id,details) SELECT $1,id,'fiscal.outgoing_import.imported','fiscal_outgoing_import',$3,$4,$5 FROM identities WHERE auth_subject=$2")
        .bind(tenant).bind(&identity.subject).bind(note.id.to_string())
        .bind(headers.get("x-request-id").and_then(|value| value.to_str().ok())).bind(&details)
        .execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
fn recipient_name(xml: &str) -> Result<String, &'static str> {
    let doc = roxmltree::Document::parse(xml).map_err(|_| "XML inválido")?;
    let ns = "http://www.portalfiscal.inf.br/nfe";
    let dest = doc
        .root_element()
        .children()
        .find(|n| n.has_tag_name((ns, "NFe")))
        .and_then(|n| n.children().find(|n| n.has_tag_name((ns, "infNFe"))))
        .and_then(|n| n.children().find(|n| n.has_tag_name((ns, "dest"))))
        .ok_or("Destinatário ausente")?;
    let mut names = dest.children().filter(|n| n.has_tag_name((ns, "xNome")));
    let name = names
        .next()
        .filter(|n| !n.children().any(|c| c.is_element()))
        .and_then(|n| n.text())
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.chars().count() <= 200)
        .ok_or("Nome do destinatário inválido")?;
    if names.next().is_some() {
        return Err("Nome do destinatário duplicado");
    }
    Ok(name.to_owned())
}

/// Restrict this archive to authorized NF-e model 55 outbound documents.
fn validate_outgoing(xml: &str, note: &danfe::AuthorizedXml) -> Result<(), &'static str> {
    if note.model != 55 {
        return Err("Importação de saída aceita somente NF-e modelo 55");
    }
    let doc = roxmltree::Document::parse(xml).map_err(|_| "XML inválido")?;
    let namespace = "http://www.portalfiscal.inf.br/nfe";
    let info = doc
        .root_element()
        .children()
        .find(|n| n.has_tag_name((namespace, "NFe")))
        .and_then(|n| n.children().find(|n| n.has_tag_name((namespace, "infNFe"))))
        .ok_or("NF-e ausente")?;
    let ide = info
        .children()
        .find(|n| n.has_tag_name((namespace, "ide")))
        .ok_or("Identificação ausente")?;
    let mut fields = ide
        .children()
        .filter(|n| n.has_tag_name((namespace, "tpNF")));
    if fields.next().and_then(|n| n.text()) != Some("1") || fields.next().is_some() {
        return Err("XML deve identificar operação de saída (tpNF=1)");
    }
    Ok(())
}
async fn validate_provider(
    client: Option<&super::danfe_client::DanfeClient>,
    xml: &str,
    note: &danfe::AuthorizedXml,
) -> Result<(), (StatusCode, &'static str, &'static str)> {
    let client = client.ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "fiscal_validation_unavailable",
        "Validador fiscal ainda não configurado",
    ))?;
    match client.render(xml, &note.key, note.model).await {
        Ok(_) => Ok(()),
        Err(super::danfe_client::RenderError::Invalid) => Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_authorized_xml",
            "O serviço fiscal recusou o XML ou sua assinatura",
        )),
        Err(super::danfe_client::RenderError::Gateway) => Err((
            StatusCode::BAD_GATEWAY,
            "fiscal_validation_failed",
            "Não foi possível validar o XML no serviço fiscal",
        )),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const XML: &str = include_str!("../../../tests/fixtures/nfe-protocol-synthetic.xml");
    #[test]
    fn requires_outbound_model_55() {
        let note = danfe::inspect(XML).unwrap();
        let outbound = XML.replace("<tpNF>0</tpNF>", "<tpNF>1</tpNF>");
        assert!(validate_outgoing(&outbound, &note).is_ok());
        assert!(
            validate_outgoing(&outbound.replace("<tpNF>1</tpNF>", "<tpNF>0</tpNF>"), &note)
                .is_err()
        );
        assert!(validate_outgoing(&outbound.replace("<tpNF>1</tpNF>", ""), &note).is_err());
        assert!(
            validate_outgoing(
                &outbound.replace("<tpNF>1</tpNF>", "<tpNF>1</tpNF><tpNF>1</tpNF>"),
                &note
            )
            .is_err()
        );
        let mut wrong_model = danfe::inspect(XML).unwrap();
        wrong_model.model = 65;
        assert!(validate_outgoing(&outbound, &wrong_model).is_err());
    }
    #[test]
    fn foreign_recipient_name_does_not_require_a_brazilian_document() {
        let foreign = XML.replace(
            "<CNPJ>19131243000197</CNPJ>",
            "<idEstrangeiro>FOREIGN-123</idEstrangeiro>",
        );
        assert!(danfe::inspect(&foreign).unwrap().recipient.is_none());
        assert_eq!(
            recipient_name(&foreign).unwrap(),
            "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"
        );
        assert!(
            recipient_name(&foreign.replace(
                "<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome>",
                ""
            ))
            .is_err()
        );
    }

    #[tokio::test]
    async fn validation_fails_closed() {
        let note = danfe::inspect(XML).unwrap();
        assert_eq!(
            validate_provider(None, XML, &note).await.unwrap_err().0,
            StatusCode::SERVICE_UNAVAILABLE
        );
        for mode in ["schema-invalid", "signature-invalid", "tool-error"] {
            let (client, task, _) = super::super::danfe_test_support::provider(mode).await;
            assert!(validate_provider(Some(&client), XML, &note).await.is_err());
            task.abort();
        }
        let (client, task, calls) = super::super::danfe_test_support::provider("structured").await;
        assert!(validate_provider(Some(&client), XML, &note).await.is_ok());
        assert!(
            calls
                .lock()
                .unwrap()
                .iter()
                .any(|s| s == "fiscal_validar_assinatura_nfe")
        );
        task.abort();
    }
}
