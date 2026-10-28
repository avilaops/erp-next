use axum::{
    Extension, Router,
    extract::{Path, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use time::format_description::well_known::Rfc3339;
use utoipa::ToSchema;

use super::problem;
use crate::{
    domains::{db, response},
    platform::{service_auth, service_auth::ServiceIdentity, state::AppState},
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/notas-recebidas", get(list))
        .route("/api/v1/notas-recebidas/{id}/xml", get(download_xml))
        .route("/api/v1/notas-recebidas/{id}/danfe", get(download_danfe))
}

#[derive(FromRow)]
struct NoteRow {
    id: i64,
    access_key: String,
    number: i64,
    series: i32,
    issued_at: time::OffsetDateTime,
    total_cents: i64,
    item_count: i32,
    issuer_document: String,
    issuer_name: String,
}

#[derive(Serialize, ToSchema)]
struct Supplier {
    documento: String,
    nome: String,
    vinculado: bool,
    id: Option<i64>,
}

#[derive(Serialize, ToSchema)]
struct LojasNote {
    id: i64,
    chave: String,
    numero: i64,
    serie: i32,
    emitida_em: String,
    valor: f64,
    itens: i32,
    compra_id: Option<i64>,
    fornecedor: Supplier,
}

impl From<NoteRow> for LojasNote {
    fn from(value: NoteRow) -> Self {
        Self {
            id: value.id,
            chave: value.access_key,
            numero: value.number,
            serie: value.series,
            emitida_em: value
                .issued_at
                .format(&Rfc3339)
                .expect("database timestamp supports RFC 3339"),
            valor: value.total_cents as f64 / 100.0,
            itens: value.item_count,
            compra_id: None,
            fornecedor: Supplier {
                documento: value.issuer_document,
                nome: value.issuer_name,
                vinculado: false,
                id: None,
            },
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct LojasPage {
    notas: Vec<LojasNote>,
    pendencias: Vec<serde_json::Value>,
}

#[utoipa::path(get, path="/api/v1/notas-recebidas", tag="Fiscal",
    security(("serviceKey"=[])), responses((status=200,body=LojasPage),
    (status=401,description="Credencial de integração inválida")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<ServiceIdentity>,
) -> Response {
    let mut tx = match service_auth::transaction(&state, &identity).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let rows = match sqlx::query_as::<_, NoteRow>(
        "SELECT id,access_key,number,series,issued_at,total_cents,item_count,issuer_document,issuer_name FROM fiscal_received_nfes ORDER BY issued_at DESC,id DESC",
    )
    .fetch_all(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => return db(error).into_response(),
    };
    if let Err(error) = tx.commit().await {
        return db(error).into_response();
    }
    response(
        StatusCode::OK,
        None,
        LojasPage {
            notas: rows.into_iter().map(Into::into).collect(),
            pendencias: Vec::new(),
        },
    )
}

#[derive(FromRow)]
struct StoredDocument {
    access_key: String,
    environment: i16,
    xml: String,
    xml_sha256: String,
}

async fn document(
    state: &AppState,
    identity: &ServiceIdentity,
    id: i64,
) -> Result<StoredDocument, Response> {
    let mut tx = service_auth::transaction(state, identity).await?;
    let document = sqlx::query_as::<_, StoredDocument>(
        "SELECT access_key,environment,xml,xml_sha256 FROM fiscal_received_nfes WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| db(error).into_response())?;
    tx.commit()
        .await
        .map_err(|error| db(error).into_response())?;
    document.ok_or_else(|| {
        problem(
            StatusCode::NOT_FOUND,
            "received_nfe_not_found",
            "Nota fiscal não encontrada nesta empresa",
            serde_json::json!({}),
        )
    })
}

#[utoipa::path(get, path="/api/v1/notas-recebidas/{id}/xml", tag="Fiscal",
    security(("serviceKey"=[])), params(("id"=i64,Path)), responses(
    (status=200,description="XML original da NF-e",content_type="application/xml",body=String),
    (status=401,description="Credencial de integração inválida"),
    (status=404,description="Nota não encontrada")))]
pub async fn download_xml(
    State(state): State<AppState>,
    Extension(identity): Extension<ServiceIdentity>,
    Path(id): Path<i64>,
) -> Response {
    let document = match document(&state, &identity, id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mut result = Response::new(axum::body::Body::from(document.xml));
    for (name, value) in [
        (
            header::CONTENT_TYPE,
            "application/xml; charset=utf-8".to_owned(),
        ),
        (
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"NFE-{}.xml\"", document.access_key),
        ),
        (header::CACHE_CONTROL, "no-store".to_owned()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
        (
            axum::http::HeaderName::from_static("x-xml-sha256"),
            document.xml_sha256,
        ),
    ] {
        result.headers_mut().insert(
            name,
            HeaderValue::from_str(&value).expect("bounded document response header"),
        );
    }
    result
}

#[utoipa::path(get, path="/api/v1/notas-recebidas/{id}/danfe", tag="Fiscal",
    security(("serviceKey"=[])), params(("id"=i64,Path)), responses(
    (status=200,description="DANFE gerado do XML armazenado; sem consulta de situação na SEFAZ",content_type="application/pdf",body=Vec<u8>),
    (status=401,description="Credencial de integração inválida"),(status=404,description="Nota não encontrada"),
    (status=422,description="Serviço fiscal recusou o XML"),(status=502,description="Resposta inválida do serviço fiscal"),
    (status=503,description="Gerador não configurado")))]
pub async fn download_danfe(
    State(state): State<AppState>,
    Extension(identity): Extension<ServiceIdentity>,
    Path(id): Path<i64>,
) -> Response {
    let document = match document(&state, &identity, id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(client) = state.danfe.as_ref() else {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "danfe_unavailable",
            "Gerador de DANFE ainda não configurado",
            serde_json::json!({}),
        );
    };
    let pdf = match client.render(&document.xml, &document.access_key).await {
        Ok(value) => value,
        Err(super::danfe_client::RenderError::Invalid) => {
            return problem(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_authorized_xml",
                "O serviço fiscal recusou o XML ou sua assinatura",
                serde_json::json!({}),
            );
        }
        Err(super::danfe_client::RenderError::Gateway) => {
            return problem(
                StatusCode::BAD_GATEWAY,
                "danfe_provider_failed",
                "Não foi possível validar e gerar o DANFE no serviço fiscal",
                serde_json::json!({}),
            );
        }
    };
    let recheck = match service_auth::transaction(&state, &identity).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Err(error) = recheck.commit().await {
        return db(error).into_response();
    }
    let pdf_hash = format!("{:x}", Sha256::digest(&pdf));
    let mut result = Response::new(axum::body::Body::from(pdf));
    for (name, value) in [
        (header::CONTENT_TYPE, "application/pdf".to_owned()),
        (
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"DANFE-{}.pdf\"", document.access_key),
        ),
        (header::CACHE_CONTROL, "no-store".to_owned()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
        (
            axum::http::HeaderName::from_static("x-xml-sha256"),
            document.xml_sha256,
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
            document.environment.to_string(),
        ),
    ] {
        result.headers_mut().insert(
            name,
            HeaderValue::from_str(&value).expect("bounded document response header"),
        );
    }
    result
}
