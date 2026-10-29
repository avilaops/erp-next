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
pub struct ReceivedQuery {
    q: Option<String>,
    from: Option<String>,
    to: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedPage {
    tenant_id: Uuid,
    can_import: bool,
    data: Vec<ReceivedNfeSnapshot>,
    total: i64,
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

#[utoipa::path(get, path="/api/v1/fiscal/received-nfes", tag="Fiscal",
    security(("bearerAuth"=[])), params(ReceivedQuery,("X-Tenant-Id"=Uuid,Header)), responses(
    (status=200,body=ReceivedPage),(status=403,description="Sem permissão fiscal"),
    (status=422,description="Filtros inválidos")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<ReceivedQuery>, QueryRejection>,
) -> Result<Response, FiscalError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
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
    let (tenant, mut tx, can_import) =
        authorized(&state, &headers, &identity, PERMISSION, PERMISSION, false).await?;
    let data = sqlx::query_as::<_, ReceivedNfeSnapshot>(
        "SELECT id,access_key,issuer_document,issuer_name,recipient_document,number,series,issued_at,total_cents,item_count,environment,xml_sha256,created_at FROM fiscal_received_nfes WHERE tenant_id=$1 AND strpos(lower(issuer_name || ' ' || issuer_document || ' ' || access_key || ' ' || number::text),$2)>0 AND ($3::date IS NULL OR (issued_at AT TIME ZONE 'UTC')::date >= $3) AND ($4::date IS NULL OR (issued_at AT TIME ZONE 'UTC')::date <= $4) ORDER BY issued_at DESC,id DESC LIMIT $5 OFFSET $6"
    ).bind(tenant).bind(&q).bind(from).bind(to).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total = sqlx::query_scalar(
        "SELECT count(*) FROM fiscal_received_nfes WHERE tenant_id=$1 AND strpos(lower(issuer_name || ' ' || issuer_document || ' ' || access_key || ' ' || number::text),$2)>0 AND ($3::date IS NULL OR (issued_at AT TIME ZONE 'UTC')::date >= $3) AND ($4::date IS NULL OR (issued_at AT TIME ZONE 'UTC')::date <= $4)"
    ).bind(tenant).bind(&q).bind(from).bind(to).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        ReceivedPage {
            tenant_id: tenant,
            can_import,
            data,
            total,
        },
    ))
}

#[utoipa::path(get, path="/api/v1/fiscal/received-nfes/{id}/xml", tag="Fiscal",
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

#[utoipa::path(get, path="/api/v1/fiscal/received-nfes/{id}/danfe", tag="Fiscal",
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
        authorized(state, headers, identity, PERMISSION, PERMISSION, false).await?;
    let document = sqlx::query_as::<_, (String,String,String,i16)>(
        "SELECT access_key,xml,xml_sha256,environment FROM fiscal_received_nfes WHERE tenant_id=$1 AND id=$2"
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
        match client.render(&document.1, &document.0).await {
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
    let (_, tx, _) = authorized(state, headers, identity, PERMISSION, PERMISSION, false).await?;
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
