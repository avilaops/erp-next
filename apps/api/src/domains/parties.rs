use super::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    revision,
};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState, valid_document};
use axum::{
    Extension, Json,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PartyInput {
    pub person_type: String,
    pub legal_name: String,
    pub trade_name: Option<String>,
    pub tax_id: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub is_customer: bool,
    pub is_supplier: bool,
    pub status: String,
}

fn optional_text(value: &mut Option<String>, maximum: usize) -> Result<(), DomainError> {
    *value = value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    if value
        .as_ref()
        .is_some_and(|s| s.chars().count() > maximum || s.chars().any(char::is_control))
    {
        return Err(DomainError::Invalid(
            "Contato ou nome fantasia fora do limite permitido",
        ));
    }
    Ok(())
}

impl PartyInput {
    fn validate(&mut self) -> Result<(), DomainError> {
        self.legal_name = self.legal_name.trim().to_owned();
        if self.legal_name.is_empty()
            || self.legal_name.chars().count() > 200
            || self.legal_name.chars().any(char::is_control)
        {
            return Err(DomainError::Invalid(
                "Nome deve conter de 1 a 200 caracteres, sem caracteres de controle",
            ));
        }
        if !["fisica", "juridica"].contains(&self.person_type.as_str()) {
            return Err(DomainError::Invalid("Selecione pessoa física ou jurídica"));
        }
        if !self
            .tax_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "./- ".contains(c))
        {
            return Err(DomainError::Invalid(
                "CPF ou CNPJ contém caracteres inválidos",
            ));
        }
        self.tax_id = self
            .tax_id
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .map(|c| c.to_ascii_uppercase())
            .collect();
        if !valid_document(&self.tax_id, &self.person_type) {
            return Err(DomainError::Invalid(
                "Informe um CPF ou CNPJ válido para o tipo de pessoa",
            ));
        }
        optional_text(&mut self.trade_name, 200)?;
        optional_text(&mut self.email, 254)?;
        optional_text(&mut self.phone, 40)?;
        if let Some(email) = &self.email {
            let mut parts = email.split('@');
            let local = parts.next().unwrap_or("");
            let domain = parts.next().unwrap_or("");
            if local.is_empty()
                || domain.is_empty()
                || parts.next().is_some()
                || !email.is_ascii()
                || email.chars().any(char::is_whitespace)
            {
                return Err(DomainError::Invalid(
                    "Informe um endereço de e-mail válido ou deixe em branco",
                ));
            }
        }
        if !self.is_customer && !self.is_supplier {
            return Err(DomainError::Invalid(
                "Selecione cliente, fornecedor ou ambos",
            ));
        }
        if !["active", "archived"].contains(&self.status.as_str()) {
            return Err(DomainError::Invalid("Situação inválida"));
        }
        Ok(())
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Party {
    id: Uuid,
    revision: i64,
    #[serde(flatten)]
    data: PartyInput,
}
#[derive(FromRow)]
struct PartyRow {
    id: Uuid,
    revision: i64,
    person_type: String,
    legal_name: String,
    trade_name: Option<String>,
    tax_id: String,
    email: Option<String>,
    phone: Option<String>,
    is_customer: bool,
    is_supplier: bool,
    status: String,
}
impl From<PartyRow> for Party {
    fn from(row: PartyRow) -> Self {
        Self {
            id: row.id,
            revision: row.revision,
            data: PartyInput {
                person_type: row.person_type,
                legal_name: row.legal_name,
                trade_name: row.trade_name,
                tax_id: row.tax_id,
                email: row.email,
                phone: row.phone,
                is_customer: row.is_customer,
                is_supplier: row.is_supplier,
                status: row.status,
            },
        }
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PartySnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: Party,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PartyList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<Party>,
    total: i64,
    offset: u32,
    limit: u32,
}
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct PartyQuery {
    q: Option<String>,
    status: Option<String>,
    role: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Party, DomainError> {
    sqlx::query_as::<_, PartyRow>("SELECT id,revision,person_type,legal_name,trade_name,tax_id,email,phone,is_customer,is_supplier,status FROM parties WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.map(Into::into).ok_or(DomainError::NotFound)
}
fn party_error(error: sqlx::Error) -> DomainError {
    if error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation())
    {
        DomainError::Conflict(
            "CPF ou CNPJ já cadastrado nesta empresa. Atualize o cadastro existente para incluir outro papel",
        )
    } else {
        db(error)
    }
}

#[utoipa::path(get,path="/api/v1/parties",tag="Catalog",security(("bearerAuth"=[])),params(PartyQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=PartyList),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=422,description="Filtros inválidos")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<PartyQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let q = query.q.as_deref().unwrap_or("").trim();
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(25);
    if q.chars().count() > 160
        || offset > 100000
        || !(1..=100).contains(&limit)
        || query
            .status
            .as_deref()
            .is_some_and(|s| !["active", "archived"].contains(&s))
        || query
            .role
            .as_deref()
            .is_some_and(|s| !["customer", "supplier"].contains(&s))
    {
        return Err(DomainError::Invalid(
            "Busca, paginação, situação ou papel inválido",
        ));
    }
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.parties.read",
        "catalog.parties.manage",
        false,
    )
    .await?;
    let rows = sqlx::query_as::<_, PartyRow>("SELECT id,revision,person_type,legal_name,trade_name,tax_id,email,phone,is_customer,is_supplier,status FROM parties WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND (strpos(lower(legal_name),lower($3))>0 OR strpos(lower(COALESCE(trade_name,'')),lower($3))>0 OR strpos(tax_id,upper($3))>0) AND ($4::text IS NULL OR ($4='customer' AND is_customer) OR ($4='supplier' AND is_supplier)) ORDER BY legal_name,id LIMIT $5 OFFSET $6")
        .bind(tenant).bind(&query.status).bind(q).bind(&query.role).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total = sqlx::query_scalar("SELECT count(*) FROM parties WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND (strpos(lower(legal_name),lower($3))>0 OR strpos(lower(COALESCE(trade_name,'')),lower($3))>0 OR strpos(tax_id,upper($3))>0) AND ($4::text IS NULL OR ($4='customer' AND is_customer) OR ($4='supplier' AND is_supplier))")
        .bind(tenant).bind(&query.status).bind(q).bind(&query.role).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        PartyList {
            tenant_id: tenant,
            can_edit,
            data: rows.into_iter().map(Into::into).collect(),
            total,
            offset,
            limit,
        },
    ))
}

#[utoipa::path(get,path="/api/v1/parties/{id}",tag="Catalog",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=PartySnapshot),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=404,description="Cadastro não encontrado")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.parties.read",
        "catalog.parties.manage",
        false,
    )
    .await?;
    let data = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data.revision),
        PartySnapshot {
            tenant_id: tenant,
            can_edit,
            data,
        },
    ))
}

#[utoipa::path(post,path="/api/v1/parties",tag="Catalog",request_body=PartyInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=PartySnapshot),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=409,description="Documento ou chave em conflito"),(status=422,description="Cadastro inválido"),(status=428,description="Chave obrigatória")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<PartyInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.parties.read",
        "catalog.parties.manage",
        true,
    )
    .await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    input.validate()?;
    let request =
        serde_json::to_value(&input).map_err(|_| crate::platform::access::AccessError::Internal)?;
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "party.create",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, rev, previous));
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO parties(id,tenant_id,person_type,legal_name,trade_name,tax_id,email,phone,is_customer,is_supplier,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(id).bind(tenant).bind(&input.person_type).bind(&input.legal_name).bind(&input.trade_name).bind(&input.tax_id).bind(&input.email).bind(&input.phone).bind(input.is_customer).bind(input.is_supplier).bind(&input.status).execute(&mut *tx).await.map_err(party_error)?;
    let result = serde_json::to_value(PartySnapshot {
        tenant_id: tenant,
        can_edit: true,
        data: load(&mut tx, tenant, id).await?,
    })
    .map_err(|_| crate::platform::access::AccessError::Internal)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "party", id, event: "party.created", details: serde_json::json!({"revision":1,"isCustomer":input.is_customer,"isSupplier":input.is_supplier}) }).await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "party.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}

#[utoipa::path(put,path="/api/v1/parties/{id}",tag="Catalog",request_body=PartyInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=PartySnapshot),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=404,description="Cadastro não encontrado"),(status=409,description="Documento em conflito"),(status=412,description="Revisão divergente"),(status=422,description="Cadastro inválido"),(status=428,description="Revisão obrigatória")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<PartyInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.parties.read",
        "catalog.parties.manage",
        true,
    )
    .await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    input.validate()?;
    let previous = load(&mut tx, tenant, id).await?;
    if previous.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if (input.tax_id != previous.data.tax_id || input.person_type != previous.data.person_type)
        && sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM sales_orders WHERE tenant_id=$1 AND customer_id=$2)",
        )
        .bind(tenant)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?
    {
        return Err(DomainError::Conflict(
            "Documento e tipo de pessoa não podem mudar após vinculação a um pedido",
        ));
    }
    let next = expected
        .checked_add(1)
        .ok_or(crate::platform::access::AccessError::Internal)?;
    sqlx::query("UPDATE parties SET person_type=$3,legal_name=$4,trade_name=$5,tax_id=$6,email=$7,phone=$8,is_customer=$9,is_supplier=$10,status=$11,revision=$12,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).bind(&input.person_type).bind(&input.legal_name).bind(&input.trade_name).bind(&input.tax_id).bind(&input.email).bind(&input.phone).bind(input.is_customer).bind(input.is_supplier).bind(&input.status).bind(next).execute(&mut *tx).await.map_err(party_error)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "party", id, event: "party.updated", details: serde_json::json!({"previousRevision":expected,"revision":next,"isCustomer":input.is_customer,"isSupplier":input.is_supplier}) }).await?;
    let data = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        PartySnapshot {
            tenant_id: tenant,
            can_edit: true,
            data,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> PartyInput {
        serde_json::from_value(serde_json::json!({"personType":"juridica","legalName":" Indústria de teste ","tradeName":" ","taxId":"04.252.011/0001-10","email":null,"phone":null,"isCustomer":true,"isSupplier":true,"status":"active"})).unwrap()
    }

    #[test]
    fn identity_and_roles_are_validated_without_external_registration_claims() {
        let mut party = input();
        party.validate().unwrap();
        assert_eq!(party.tax_id, "04252011000110");
        assert_eq!(party.legal_name, "Indústria de teste");
        assert_eq!(party.trade_name, None);
        party.tax_id = "12abc34501de35".into();
        party.validate().unwrap();
        assert_eq!(party.tax_id, "12ABC34501DE35");
        party.is_customer = false;
        party.is_supplier = false;
        assert!(party.validate().is_err());
        for document in [
            "11111111111111",
            "04!252011000110",
            "04252011000111",
            "é4252011000110",
        ] {
            let mut party = input();
            party.tax_id = document.into();
            assert!(party.validate().is_err());
        }
        let mut person = input();
        person.person_type = "fisica".into();
        person.tax_id = "529.982.247-25".into();
        person.validate().unwrap();
        person.email = Some("invalid@@example.test".into());
        assert!(person.validate().is_err());
    }
}
