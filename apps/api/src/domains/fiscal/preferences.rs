//! Fiscal configuration is user supplied; saving never issues a document.
use super::certificate_crypto::SealedCertificate;
use crate::{
    domains::{DomainChange, DomainError, authorized, db, record, response, revision},
    platform::{access, auth::AuthenticatedIdentity, state::AppState, valid_document},
};
use axum::{
    Extension, Json,
    extract::{Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use zeroize::Zeroizing;

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NfceSettings {
    environment: String,
    state: String,
    series: u16,
    next_number: u32,
    csc_id: String,
    #[schema(value_type = Option<String>, format = Password)]
    csc: Option<Zeroizing<String>>,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OperationNature {
    id: Uuid,
    code: String,
    name: String,
    direction: String,
    purpose: u8,
    model: u8,
    internal_cfop: String,
    interstate_cfop: String,
    foreign_cfop: String,
    active: bool,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OperationNatures {
    items: Vec<OperationNature>,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthorizedXmlPerson {
    id: Uuid,
    name: String,
    email: String,
    tax_id: String,
    role: String,
    active: bool,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FiscalDeliverySettings {
    notification_email: Option<String>,
    authorized_people: Vec<AuthorizedXmlPerson>,
}
#[derive(Deserialize, ToSchema)]
#[serde(untagged)]
pub enum FiscalPreferencesInput {
    Nfce(NfceSettings),
    Natures(OperationNatures),
    Delivery(FiscalDeliverySettings),
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FiscalPreferencesSnapshot {
    tenant_id: Uuid,
    revision: i64,
    can_edit: bool,
    secret_storage_available: bool,
    data: Value,
}
#[derive(FromRow)]
struct Row {
    revision: i64,
    data: Value,
    secret_key_id: Option<String>,
    secret_nonce: Option<Vec<u8>>,
    secret_ciphertext: Option<Vec<u8>>,
    secret_context: Option<String>,
}
fn default_data(section: &str) -> Result<Value, DomainError> {
    match section {
        "nfce" => Ok(Value::Null),
        "operation-natures" => Ok(json!({"items":[]})),
        "delivery" => Ok(json!({"notificationEmail":null,"authorizedPeople":[]})),
        _ => Err(DomainError::NotFound),
    }
}
fn clean(value: &mut String, maximum: usize) -> Result<(), DomainError> {
    *value = value.trim().to_string();
    if value.is_empty() || value.chars().count() > maximum || value.chars().any(char::is_control) {
        return Err(DomainError::Invalid("Código ou descrição fiscal inválidos"));
    }
    Ok(())
}
impl OperationNatures {
    fn validate(&mut self) -> Result<(), DomainError> {
        if self.items.len() > 200 {
            return Err(DomainError::Invalid("Limite de 200 naturezas de operação"));
        }
        let mut ids = std::collections::HashSet::new();
        let mut codes = std::collections::HashSet::new();
        for item in &mut self.items {
            clean(&mut item.code, 30)?;
            clean(&mut item.name, 60)?;
            if item.id.is_nil()
                || !ids.insert(item.id)
                || !codes.insert(item.code.to_lowercase())
                || !["incoming", "outgoing"].contains(&item.direction.as_str())
                || !(1..=4).contains(&item.purpose)
                || ![55, 65].contains(&item.model)
            {
                return Err(DomainError::Invalid(
                    "Natureza duplicada ou operação, finalidade e modelo inválidos",
                ));
            }
            let prefixes = if item.direction == "incoming" {
                *b"123"
            } else {
                *b"567"
            };
            for (cfop, prefix) in [
                &item.internal_cfop,
                &item.interstate_cfop,
                &item.foreign_cfop,
            ]
            .into_iter()
            .zip(prefixes)
            {
                if !cfop.is_empty()
                    && (cfop.len() != 4
                        || !cfop.bytes().all(|b| b.is_ascii_digit())
                        || cfop.as_bytes()[0] != prefix)
                {
                    return Err(DomainError::Invalid(
                        "CFOP incompatível com entrada/saída ou destino",
                    ));
                }
            }
        }
        Ok(())
    }
}
fn email(value: &mut String) -> Result<(), DomainError> {
    clean(value, 254)?;
    let mut parts = value.split('@');
    let local = parts.next().unwrap_or("");
    let domain = parts.next().unwrap_or("");
    if local.is_empty()
        || domain.is_empty()
        || parts.next().is_some()
        || !value.is_ascii()
        || value.chars().any(char::is_whitespace)
        || !domain.contains('.')
    {
        return Err(DomainError::Invalid("Informe um e-mail fiscal válido"));
    }
    Ok(())
}
impl FiscalDeliverySettings {
    fn validate(&mut self) -> Result<(), DomainError> {
        if let Some(value) = &mut self.notification_email {
            email(value)?;
        }
        if self.authorized_people.len() > 50 {
            return Err(DomainError::Invalid(
                "Limite de 50 pessoas autorizadas ao XML",
            ));
        }
        let mut ids = std::collections::HashSet::new();
        let mut emails = std::collections::HashSet::new();
        let mut tax_ids = std::collections::HashSet::new();
        for person in &mut self.authorized_people {
            if person.id.is_nil() || !ids.insert(person.id) {
                return Err(DomainError::Invalid(
                    "Pessoa autorizada duplicada ou sem identificador",
                ));
            }
            clean(&mut person.name, 120)?;
            clean(&mut person.role, 60)?;
            email(&mut person.email)?;
            if !emails.insert(person.email.to_ascii_lowercase()) {
                return Err(DomainError::Invalid(
                    "E-mail repetido na lista de pessoas autorizadas",
                ));
            }
            if !person
                .tax_id
                .chars()
                .all(|value| value.is_ascii_digit() || "./- ".contains(value))
            {
                return Err(DomainError::Invalid("CPF ou CNPJ do autorizado inválido"));
            }
            person.tax_id = person.tax_id.chars().filter(char::is_ascii_digit).collect();
            let person_type = match person.tax_id.len() {
                11 => "fisica",
                14 => "juridica",
                _ => "",
            };
            if !valid_document(&person.tax_id, person_type)
                || !tax_ids.insert(person.tax_id.clone())
            {
                return Err(DomainError::Invalid(
                    "Informe CPF ou CNPJ válido e não repetido para cada autorizado",
                ));
            }
        }
        Ok(())
    }
}
fn nfce_data(value: &mut NfceSettings) -> Result<Value, DomainError> {
    clean(&mut value.csc_id, 6)?;
    if !["homologation", "production"].contains(&value.environment.as_str())
        || super::model::state_code(&value.state).is_none()
        || value.series > 999
        || !(1..=999_999_999).contains(&value.next_number)
        || !value.csc_id.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(DomainError::Invalid(
            "Informe ambiente, UF, série, próxima numeração e identificador do CSC válidos",
        ));
    }
    if let Some(csc) = &value.csc
        && (csc.len() < 16
            || csc.len() > 36
            || !csc.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
    {
        return Err(DomainError::Invalid(
            "CSC inválido; informe o código fornecido pela SEFAZ",
        ));
    }
    Ok(
        json!({"environment":value.environment,"state":value.state,"series":value.series,"nextNumber":value.next_number,"cscId":value.csc_id,"cscConfigured":true}),
    )
}
#[utoipa::path(get,path="/api/v1/fiscal/settings/{section}",operation_id="get_fiscal_preferences",tag="Fiscal",security(("bearerAuth"=[])),params(("section"=String,Path)),responses((status=200,body=FiscalPreferencesSnapshot),(status=403,description="Sem acesso fiscal"),(status=404,description="Seção desconhecida")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(section): Path<String>,
) -> Result<Response, DomainError> {
    let empty = default_data(&section)?;
    let tenant = access::tenant_id(&headers)?;
    let mut tx = access::tenant_transaction(&state, tenant).await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    let can_read_config = access::require_permission(&rights, "fiscal.config.read").is_ok();
    let can_read_natures = section == "operation-natures"
        && access::require_permission(&rights, "fiscal.nfe.read").is_ok();
    if !can_read_config && !can_read_natures {
        return Err(access::AccessError::Forbidden.into());
    }
    let can_edit =
        can_read_config && access::require_permission(&rights, "fiscal.config.manage").is_ok();
    let row: Option<Row> = sqlx::query_as("SELECT revision,data,secret_key_id,secret_nonce,secret_ciphertext,secret_context FROM fiscal_preferences WHERE tenant_id=$1 AND section=$2").bind(tenant).bind(section).fetch_optional(&mut *tx).await.map_err(db)?;
    let (revision, data) = row.map(|r| (r.revision, r.data)).unwrap_or((1, empty));
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        FiscalPreferencesSnapshot {
            tenant_id: tenant,
            revision,
            can_edit,
            secret_storage_available: state.certificates.is_some(),
            data,
        },
    ))
}
#[utoipa::path(put,path="/api/v1/fiscal/settings/{section}",operation_id="put_fiscal_preferences",tag="Fiscal",security(("bearerAuth"=[])),params(("section"=String,Path),("If-Match"=String,Header)),request_body=FiscalPreferencesInput,responses((status=200,body=FiscalPreferencesSnapshot),(status=403,description="Sem gestão fiscal"),(status=404,description="Seção desconhecida"),(status=412,description="Revisão desatualizada"),(status=422,description="Configuração inválida"),(status=428,description="If-Match obrigatório"),(status=409,description="Armazenamento seguro indisponível")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(section): Path<String>,
    input: Result<Json<FiscalPreferencesInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    default_data(&section)?;
    let expected = revision(&headers)?;
    let Json(value) = input.map_err(|_| DomainError::Invalid("Configuração fiscal inválida"))?;
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.config.read",
        "fiscal.config.manage",
        true,
    )
    .await?;
    let row: Option<Row> = sqlx::query_as("SELECT revision,data,secret_key_id,secret_nonce,secret_ciphertext,secret_context FROM fiscal_preferences WHERE tenant_id=$1 AND section=$2").bind(tenant).bind(&section).fetch_optional(&mut *tx).await.map_err(db)?;
    let current = row.as_ref().map(|r| r.revision).unwrap_or(1);
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    let mut secret: Option<(SealedCertificate, String)> = None;
    let data = match (section.as_str(), value) {
        ("nfce", FiscalPreferencesInput::Nfce(mut value)) => {
            let data = nfce_data(&mut value)?;
            let vault = state.certificates.as_ref().ok_or(DomainError::Conflict(
                "Armazenamento seguro de CSC não configurado",
            ))?;
            let company_tax_id: String =
                sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
                    .bind(tenant)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(db)?;
            let context = format!(
                "avila-erp:nfce-csc:v1:{tenant}:{company_tax_id}:{}:{}:{next}",
                value.environment, value.csc_id
            );
            let plaintext = if let Some(csc) = value.csc {
                Zeroizing::new(csc.as_bytes().to_vec())
            } else {
                let old = row
                    .as_ref()
                    .ok_or(DomainError::Invalid("Informe o CSC no primeiro cadastro"))?;
                if old.data["environment"] != data["environment"]
                    || old.data["cscId"] != data["cscId"]
                    || old.data["state"] != data["state"]
                {
                    return Err(DomainError::Invalid(
                        "Informe o CSC novamente ao mudar ambiente, UF ou identificador",
                    ));
                }
                let sealed = SealedCertificate {
                    key_id: old
                        .secret_key_id
                        .clone()
                        .ok_or(access::AccessError::Internal)?,
                    nonce: old
                        .secret_nonce
                        .clone()
                        .ok_or(access::AccessError::Internal)?,
                    ciphertext: old
                        .secret_ciphertext
                        .clone()
                        .ok_or(access::AccessError::Internal)?,
                };
                let old_context = old
                    .secret_context
                    .as_deref()
                    .ok_or(access::AccessError::Internal)?;
                if !old_context
                    .starts_with(&format!("avila-erp:nfce-csc:v1:{tenant}:{company_tax_id}:"))
                {
                    return Err(DomainError::Conflict(
                        "Informe o CSC novamente após alterar o documento da empresa",
                    ));
                }
                vault
                    .open_settings_secret(old_context, &sealed)
                    .map_err(|_| DomainError::Conflict("CSC indisponível; informe novamente"))?
            };
            secret = Some((
                vault
                    .seal_settings_secret(&context, &plaintext)
                    .map_err(|_| access::AccessError::Internal)?,
                context,
            ));
            data
        }
        ("operation-natures", FiscalPreferencesInput::Natures(mut value)) => {
            value.validate()?;
            serde_json::to_value(value).map_err(|_| access::AccessError::Internal)?
        }
        ("delivery", FiscalPreferencesInput::Delivery(mut value)) => {
            value.validate()?;
            serde_json::to_value(value).map_err(|_| access::AccessError::Internal)?
        }
        _ => {
            return Err(DomainError::Invalid(
                "Configuração incompatível com a seção",
            ));
        }
    };
    sqlx::query("INSERT INTO fiscal_preferences(tenant_id,section,revision,data,secret_key_id,secret_nonce,secret_ciphertext,secret_context) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,section) DO UPDATE SET revision=$3,data=$4,secret_key_id=$5,secret_nonce=$6,secret_ciphertext=$7,secret_context=$8,updated_at=now()")
        .bind(tenant).bind(&section).bind(next).bind(&data).bind(secret.as_ref().map(|s|&s.0.key_id)).bind(secret.as_ref().map(|s|&s.0.nonce)).bind(secret.as_ref().map(|s|&s.0.ciphertext)).bind(secret.as_ref().map(|s|&s.1)).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "fiscal_preferences",
            id: tenant,
            event: "fiscal.preferences.updated",
            details: json!({"section":section,"revision":next}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        FiscalPreferencesSnapshot {
            tenant_id: tenant,
            revision: next,
            can_edit,
            secret_storage_available: state.certificates.is_some(),
            data,
        },
    ))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EventQuery {
    kind: String,
    cursor: Option<Uuid>,
    limit: Option<i64>,
}
#[derive(Serialize, FromRow, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FiscalEventRecord {
    id: Uuid,
    document_id: Option<Uuid>,
    kind: String,
    sequence: i32,
    status: String,
    environment: String,
    series: Option<i32>,
    number: Option<i64>,
    access_key: Option<String>,
    request: Value,
    result: Value,
    created_at: String,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FiscalEventsPage {
    tenant_id: Uuid,
    data: Vec<FiscalEventRecord>,
    next_cursor: Option<Uuid>,
}
#[utoipa::path(get,path="/api/v1/fiscal/nfe-events",operation_id="list_fiscal_events",tag="Fiscal",security(("bearerAuth"=[])),params(EventQuery),responses((status=200,body=FiscalEventsPage),(status=403,description="Sem acesso fiscal"),(status=422,description="Filtros inválidos")))]
pub async fn events(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(query): Query<EventQuery>,
) -> Result<Response, DomainError> {
    let limit = query.limit.unwrap_or(25);
    if !["inutilizacao", "correcao"].contains(&query.kind.as_str()) || !(1..=100).contains(&limit) {
        return Err(DomainError::Invalid(
            "Informe correção ou inutilização e limite de 1 a 100",
        ));
    }
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.read",
        false,
    )
    .await?;
    let mut data: Vec<FiscalEventRecord> = sqlx::query_as("SELECT e.id,e.document_id,e.kind,e.sequence,e.status,coalesce(d.environment,e.request->>'environment','homologation') AS environment,d.series,d.number,d.access_key,e.request,e.result,e.created_at::text AS created_at FROM fiscal_nfe_events e LEFT JOIN fiscal_nfe_documents d ON d.tenant_id=e.tenant_id AND d.id=e.document_id WHERE e.tenant_id=$1 AND e.kind=$2 AND ($3::uuid IS NULL OR e.id<$3) ORDER BY e.id DESC LIMIT $4")
        .bind(tenant).bind(query.kind).bind(query.cursor).bind(limit+1).fetch_all(&mut *tx).await.map_err(db)?;
    let more = data.len() > limit as usize;
    data.truncate(limit as usize);
    let next_cursor = more.then(|| data.last().expect("nonempty page").id);
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        FiscalEventsPage {
            tenant_id: tenant,
            data,
            next_cursor,
        },
    ))
}
