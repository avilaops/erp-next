use super::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    revision,
};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
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
pub struct StaffInput {
    pub name: String,
    pub job_title: Option<String>,
    pub code: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub is_employee: bool,
    pub is_seller: bool,
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
            "Contato ou cargo fora do limite permitido",
        ));
    }
    Ok(())
}

impl StaffInput {
    fn validate(&mut self) -> Result<(), DomainError> {
        self.name = self.name.trim().to_owned();
        if self.name.is_empty()
            || self.name.chars().count() > 200
            || self.name.chars().any(char::is_control)
        {
            return Err(DomainError::Invalid(
                "Nome deve conter de 1 a 200 caracteres, sem caracteres de controle",
            ));
        }
        self.code = self.code.trim().to_ascii_uppercase();
        if self.code.is_empty()
            || self.code.len() > 40
            || !self
                .code
                .bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || b"._-".contains(&c))
        {
            return Err(DomainError::Invalid(
                "Código deve ter de 1 a 40 caracteres A-Z, 0-9, ponto, hífen ou underscore",
            ));
        }
        optional_text(&mut self.job_title, 120)?;
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
        if !self.is_employee && !self.is_seller {
            return Err(DomainError::Invalid(
                "Selecione funcionário, vendedor ou ambos",
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
pub struct Staff {
    id: Uuid,
    revision: i64,
    #[serde(flatten)]
    data: StaffInput,
}
#[derive(FromRow)]
struct StaffRow {
    id: Uuid,
    revision: i64,
    name: String,
    job_title: Option<String>,
    code: String,
    email: Option<String>,
    phone: Option<String>,
    is_employee: bool,
    is_seller: bool,
    status: String,
}
impl From<StaffRow> for Staff {
    fn from(row: StaffRow) -> Self {
        Self {
            id: row.id,
            revision: row.revision,
            data: StaffInput {
                name: row.name,
                job_title: row.job_title,
                code: row.code,
                email: row.email,
                phone: row.phone,
                is_employee: row.is_employee,
                is_seller: row.is_seller,
                status: row.status,
            },
        }
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StaffSnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: Staff,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StaffList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<Staff>,
    total: i64,
    offset: u32,
    limit: u32,
}
#[derive(Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
pub struct StaffQuery {
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
) -> Result<Staff, DomainError> {
    sqlx::query_as::<_, StaffRow>("SELECT id,revision,code,name,job_title,email,phone,is_employee,is_seller,status FROM staff WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.map(Into::into).ok_or(DomainError::NotFound)
}
fn staff_error(error: sqlx::Error) -> DomainError {
    if error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation())
    {
        DomainError::Conflict("Código já cadastrado nesta empresa, inclusive em registro arquivado")
    } else {
        db(error)
    }
}

#[utoipa::path(get,path="/api/v1/staff",tag="Catalog",security(("bearerAuth"=[])),params(StaffQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=StaffList),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=422,description="Filtros inválidos")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<StaffQuery>, QueryRejection>,
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
            .is_some_and(|s| !["employee", "seller"].contains(&s))
    {
        return Err(DomainError::Invalid(
            "Busca, paginação, situação ou papel inválido",
        ));
    }
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.staff.read",
        "catalog.staff.manage",
        false,
    )
    .await?;
    let rows = sqlx::query_as::<_, StaffRow>("SELECT id,revision,code,name,job_title,email,phone,is_employee,is_seller,status FROM staff WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND (strpos(lower(name),lower($3))>0 OR strpos(lower(COALESCE(job_title,'')),lower($3))>0 OR strpos(code,upper($3))>0) AND ($4::text IS NULL OR ($4='employee' AND is_employee) OR ($4='seller' AND is_seller)) ORDER BY name,id LIMIT $5 OFFSET $6")
        .bind(tenant).bind(&query.status).bind(q).bind(&query.role).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total = sqlx::query_scalar("SELECT count(*) FROM staff WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND (strpos(lower(name),lower($3))>0 OR strpos(lower(COALESCE(job_title,'')),lower($3))>0 OR strpos(code,upper($3))>0) AND ($4::text IS NULL OR ($4='employee' AND is_employee) OR ($4='seller' AND is_seller))")
        .bind(tenant).bind(&query.status).bind(q).bind(&query.role).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        StaffList {
            tenant_id: tenant,
            can_edit,
            data: rows.into_iter().map(Into::into).collect(),
            total,
            offset,
            limit,
        },
    ))
}

#[utoipa::path(get,path="/api/v1/staff/{id}",tag="Catalog",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=StaffSnapshot),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=404,description="Cadastro não encontrado")))]
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
        "catalog.staff.read",
        "catalog.staff.manage",
        false,
    )
    .await?;
    let data = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data.revision),
        StaffSnapshot {
            tenant_id: tenant,
            can_edit,
            data,
        },
    ))
}

#[utoipa::path(post,path="/api/v1/staff",tag="Catalog",request_body=StaffInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=StaffSnapshot),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=409,description="Código ou chave em conflito"),(status=422,description="Cadastro inválido"),(status=428,description="Chave obrigatória")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<StaffInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.staff.read",
        "catalog.staff.manage",
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
        "staff.create",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, rev, previous));
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO staff(id,tenant_id,code,name,job_title,email,phone,is_employee,is_seller,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(id).bind(tenant).bind(&input.code).bind(&input.name).bind(&input.job_title)
        .bind(&input.email).bind(&input.phone).bind(input.is_employee).bind(input.is_seller).bind(&input.status)
        .execute(&mut *tx).await.map_err(staff_error)?;
    let result = serde_json::to_value(StaffSnapshot {
        tenant_id: tenant,
        can_edit: true,
        data: load(&mut tx, tenant, id).await?,
    })
    .map_err(|_| crate::platform::access::AccessError::Internal)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "staff", id, event: "staff.created", details: serde_json::json!({"revision":1,"isEmployee":input.is_employee,"isSeller":input.is_seller}) }).await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "staff.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}

#[utoipa::path(put,path="/api/v1/staff/{id}",tag="Catalog",request_body=StaffInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=StaffSnapshot),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=404,description="Cadastro não encontrado"),(status=409,description="Código em conflito"),(status=412,description="Revisão divergente"),(status=422,description="Cadastro inválido"),(status=428,description="Revisão obrigatória")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<StaffInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.staff.read",
        "catalog.staff.manage",
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
    let next = expected
        .checked_add(1)
        .ok_or(crate::platform::access::AccessError::Internal)?;
    sqlx::query("UPDATE staff SET code=$3,name=$4,job_title=$5,email=$6,phone=$7,is_employee=$8,is_seller=$9,status=$10,revision=$11,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).bind(&input.code).bind(&input.name).bind(&input.job_title)
        .bind(&input.email).bind(&input.phone).bind(input.is_employee).bind(input.is_seller).bind(&input.status).bind(next)
        .execute(&mut *tx).await.map_err(staff_error)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "staff", id, event: "staff.updated", details: serde_json::json!({"previousRevision":expected,"revision":next,"isEmployee":input.is_employee,"isSeller":input.is_seller}) }).await?;
    let data = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        StaffSnapshot {
            tenant_id: tenant,
            can_edit: true,
            data,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> StaffInput {
        serde_json::from_value(serde_json::json!({"code":" eq-001 ","name":" Maria ","email":null,"phone":null,"jobTitle":null,"isEmployee":true,"isSeller":true,"status":"active"})).unwrap()
    }
    #[test]
    fn validates_codes_functions_and_optional_fields() {
        let mut value = input();
        value.validate().unwrap();
        assert_eq!(value.code, "EQ-001");
        assert_eq!(value.name, "Maria");
        for code in [
            "",
            "a b",
            "ação",
            "bad/control",
            "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        ] {
            let mut value = input();
            value.code = code.into();
            assert!(value.validate().is_err());
        }
        let mut value = input();
        value.is_employee = false;
        value.is_seller = false;
        assert!(value.validate().is_err());
        let mut value = input();
        value.job_title = Some("x".repeat(121));
        assert!(value.validate().is_err());
        let mut value = input();
        value.email = Some("bad@@example.test".into());
        assert!(value.validate().is_err());
        let mut value = serde_json::to_value(input()).unwrap();
        value["tenantId"] = serde_json::json!(Uuid::now_v7());
        assert!(serde_json::from_value::<StaffInput>(value).is_err());
    }
}
