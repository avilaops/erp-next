//! Company-scoped registration preferences, with fiscal profile validation owned by Fiscal.
use super::fiscal::tax_profiles::TaxProfile;
use crate::domains::{DomainError, db, response, revision};
use crate::platform::{access, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductSettings {
    pub require_ncm: bool,
    pub require_cest: bool,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PartySettings {
    pub require_email: bool,
    pub require_phone: bool,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContactTypes {
    pub labels: Vec<String>,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaxProfiles {
    pub profiles: Vec<TaxProfile>,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(untagged)]
pub enum RegistrationInput {
    Products(ProductSettings),
    Parties(PartySettings),
    Contacts(ContactTypes),
    Taxes(TaxProfiles),
}
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationSnapshot {
    tenant_id: Uuid,
    revision: i64,
    can_edit: bool,
    data: Value,
}
fn default_data(section: &str) -> Result<Value, DomainError> {
    Ok(match section {
        "products" => json!({"requireNcm":false,"requireCest":false}),
        "parties" => json!({"requireEmail":false,"requirePhone":false}),
        "contact-types" => json!({"labels":[]}),
        "tax-profiles" => json!({"profiles":[]}),
        _ => return Err(DomainError::NotFound),
    })
}
fn parse<T: serde::de::DeserializeOwned>(data: Value) -> Result<T, DomainError> {
    serde_json::from_value(data)
        .map_err(|_| DomainError::Invalid("Configuração inválida ou campos desconhecidos"))
}
fn validate(section: &str, data: Value) -> Result<Value, DomainError> {
    Ok(match section {
        "products" => json!(parse::<ProductSettings>(data)?),
        "parties" => json!(parse::<PartySettings>(data)?),
        "contact-types" => {
            let mut v = parse::<ContactTypes>(data)?;
            if v.labels.len() > 30 {
                return Err(DomainError::Invalid("Máximo de 30 tipos de contatos"));
            }
            let mut seen = std::collections::HashSet::new();
            for label in &mut v.labels {
                *label = label.trim().to_string();
                if label.is_empty()
                    || label.chars().count() > 80
                    || label.chars().any(char::is_control)
                    || !seen.insert(label.to_lowercase())
                {
                    return Err(DomainError::Invalid(
                        "Tipos de contato vazios, duplicados ou inválidos",
                    ));
                }
            }
            json!(v)
        }
        "tax-profiles" => {
            let mut v = parse::<TaxProfiles>(data)?;
            if v.profiles.len() > 30 {
                return Err(DomainError::Invalid("Máximo de 30 perfis tributários"));
            }
            let mut seen = std::collections::HashSet::new();
            for profile in &mut v.profiles {
                profile.validate()?;
                if !seen.insert(profile.name.to_lowercase()) {
                    return Err(DomainError::Invalid("Nome de perfil duplicado"));
                }
            }
            json!(v)
        }
        _ => return Err(DomainError::NotFound),
    })
}
pub async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    section: &str,
) -> Result<(i64, Value), DomainError> {
    let default = default_data(section)?;
    Ok(sqlx::query_as(
        "SELECT revision,data FROM registration_settings WHERE tenant_id=$1 AND section=$2",
    )
    .bind(tenant)
    .bind(section)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .unwrap_or((1, default)))
}
async fn transaction<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
    identity: &AuthenticatedIdentity,
    section: &str,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>, bool), DomainError> {
    default_data(section)?;
    let tenant = access::tenant_id(headers)?;
    let mut tx = access::tenant_transaction(state, tenant).await?;
    if write {
        sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    let member = access::load_access(&mut tx, tenant, &identity.subject).await?;
    let can_edit = access::require_permission(&member, "platform.company.manage").is_ok();
    if write {
        access::require_permission(&member, "platform.company.manage")?;
    } else if !can_edit
        && ![
            "platform.company.read",
            match section {
                "products" => "catalog.products.read",
                "tax-profiles" => "fiscal.nfe.read",
                _ => "catalog.parties.read",
            },
        ]
        .iter()
        .any(|p| access::require_permission(&member, p).is_ok())
    {
        return Err(access::AccessError::Forbidden.into());
    }
    Ok((tenant, tx, can_edit))
}
#[utoipa::path(get,path="/api/v1/registration-settings/{section}",operation_id="get_registration_settings",tag="Catalog",security(("bearerAuth"=[])),params(("section"=String,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=RegistrationSnapshot),(status=403,description="Sem acesso"),(status=404,description="Seção desconhecida")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(section): Path<String>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) =
        transaction(&state, &headers, &identity, &section, false).await?;
    let (revision, data) = load(&mut tx, tenant, &section).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        RegistrationSnapshot {
            tenant_id: tenant,
            revision,
            can_edit,
            data,
        },
    ))
}
#[utoipa::path(put,path="/api/v1/registration-settings/{section}",operation_id="put_registration_settings",tag="Catalog",security(("bearerAuth"=[])),params(("section"=String,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),request_body=RegistrationInput,responses((status=200,body=RegistrationSnapshot),(status=403,description="Exige gestão da empresa"),(status=404,description="Seção desconhecida"),(status=412,description="Revisão alterada"),(status=422,description="Configuração inválida"),(status=428,description="If-Match obrigatório")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(section): Path<String>,
    payload: Result<Json<RegistrationInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let Json(value) = payload.map_err(|_| DomainError::Invalid("JSON inválido"))?;
    let data = validate(
        &section,
        serde_json::to_value(value).map_err(|_| access::AccessError::Internal)?,
    )?;
    let (tenant, mut tx, can_edit) =
        transaction(&state, &headers, &identity, &section, true).await?;
    let (current, _) = load(&mut tx, tenant, &section).await?;
    if expected != current {
        return Err(DomainError::StaleRevision);
    }
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    sqlx::query("INSERT INTO registration_settings(tenant_id,section,data,revision) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,section) DO UPDATE SET data=$3,revision=$4,updated_at=now()").bind(tenant).bind(&section).bind(&data).bind(next).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,details) SELECT $1,id,'registration_settings.updated','registration_settings',$3 FROM identities WHERE auth_subject=$2").bind(tenant).bind(&identity.subject).bind(json!({"section":section,"previousRevision":current,"revision":next})).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        RegistrationSnapshot {
            tenant_id: tenant,
            revision: next,
            can_edit,
            data,
        },
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validation_rejects_unknown_fields_and_duplicates() {
        assert!(
            validate(
                "products",
                json!({"requireNcm":true,"requireCest":false,"admin":true})
            )
            .is_err()
        );
        assert!(
            validate(
                "contact-types",
                json!({"labels":["Financeiro"," financeiro "]})
            )
            .is_err()
        );
        assert!(validate("bad", json!({})).is_err());
    }
    #[test]
    fn tax_defaults_are_explicit_and_preserve_zeroes() {
        let data = json!({"profiles":[{"name":"Importados","operationNature":"Venda de mercadorias","pisRate":"1.6500","cofinsRate":"7.6000","ibsCbsCst":"000","classCode":"000001","active":true}]});
        assert_eq!(validate("tax-profiles", data.clone()).unwrap(), data);
        let mut invalid = data;
        invalid["profiles"][0]["pisRate"] = json!("100.0000");
        assert!(validate("tax-profiles", invalid).is_err());
    }
}
