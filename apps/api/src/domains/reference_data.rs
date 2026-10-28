//! Typed auxiliary catalogs. Operational stock and financial ledgers remain in their domains.
use super::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    revision,
};
use crate::platform::{access::AccessError, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json, Router,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::get,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProductCategoryInput {
    pub code: String,
    pub name: String,
    pub status: String,
    pub notes: Option<String>,
    pub parent_id: Option<Uuid>,
    pub sort_order: i32,
}
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FinancialCategoryInput {
    pub code: String,
    pub name: String,
    pub status: String,
    pub notes: Option<String>,
    pub parent_id: Option<Uuid>,
    pub direction: String,
}
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FinancialAccountInput {
    pub code: String,
    pub name: String,
    pub status: String,
    pub notes: Option<String>,
    pub account_type: String,
    pub bank: Option<String>,
    pub branch: Option<String>,
    pub account_number: Option<String>,
}
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PaymentMethodInput {
    pub code: String,
    pub name: String,
    pub status: String,
    pub notes: Option<String>,
    pub modality: String,
    pub settlement_days: i32,
}
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(untagged)]
pub enum ReferenceInput {
    ProductCategory(ProductCategoryInput),
    FinancialCategory(FinancialCategoryInput),
    FinancialAccount(FinancialAccountInput),
    PaymentMethod(PaymentMethodInput),
}
#[derive(Clone, Copy)]
enum Kind {
    ProductCategory,
    FinancialCategory,
    FinancialAccount,
    PaymentMethod,
}
impl Kind {
    // SQL identifiers and projections come exclusively from this compile-time allowlist.
    fn table(self) -> &'static str {
        match self {
            Self::ProductCategory => "product_categories",
            Self::FinancialCategory => "financial_categories",
            Self::FinancialAccount => "financial_accounts",
            Self::PaymentMethod => "payment_methods",
        }
    }
    fn permissions(self) -> (&'static str, &'static str) {
        match self {
            Self::ProductCategory => ("catalog.categories.read", "catalog.categories.manage"),
            Self::FinancialCategory => ("finance.categories.read", "finance.categories.manage"),
            Self::FinancialAccount => ("finance.accounts.read", "finance.accounts.manage"),
            Self::PaymentMethod => (
                "finance.payment_methods.read",
                "finance.payment_methods.manage",
            ),
        }
    }
    fn projection(self) -> &'static str {
        match self {
            Self::ProductCategory => "'parentId',parent_id,'sortOrder',sort_order",
            Self::FinancialCategory => "'parentId',parent_id,'direction',direction",
            Self::FinancialAccount => {
                "'accountType',account_type,'bank',bank,'branch',branch,'accountNumber',account_number"
            }
            Self::PaymentMethod => "'modality',modality,'settlementDays',settlement_days",
        }
    }
    fn event(self, updating: bool) -> &'static str {
        match (self, updating) {
            (Self::ProductCategory, false) => "product_category.created",
            (Self::ProductCategory, true) => "product_category.updated",
            (Self::FinancialCategory, false) => "financial_category.created",
            (Self::FinancialCategory, true) => "financial_category.updated",
            (Self::FinancialAccount, false) => "financial_account.created",
            (Self::FinancialAccount, true) => "financial_account.updated",
            (Self::PaymentMethod, false) => "payment_method.created",
            (Self::PaymentMethod, true) => "payment_method.updated",
        }
    }
}
fn text(value: &mut String, max: usize) -> Result<(), DomainError> {
    *value = value.trim().to_owned();
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Texto vazio, com caracteres de controle ou fora do limite",
        ));
    }
    Ok(())
}
fn optional(value: &mut Option<String>, max: usize) -> Result<(), DomainError> {
    *value = value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    if let Some(value) = value {
        text(value, max)?;
    }
    Ok(())
}
impl ReferenceInput {
    fn common(&self) -> (&str, &str, &str, &Option<String>) {
        match self {
            Self::ProductCategory(v) => (&v.code, &v.name, &v.status, &v.notes),
            Self::FinancialCategory(v) => (&v.code, &v.name, &v.status, &v.notes),
            Self::FinancialAccount(v) => (&v.code, &v.name, &v.status, &v.notes),
            Self::PaymentMethod(v) => (&v.code, &v.name, &v.status, &v.notes),
        }
    }
    fn validate(&mut self) -> Result<(), DomainError> {
        let (code, name, status, notes) = match self {
            Self::ProductCategory(v) => (&mut v.code, &mut v.name, &v.status, &mut v.notes),
            Self::FinancialCategory(v) => (&mut v.code, &mut v.name, &v.status, &mut v.notes),
            Self::FinancialAccount(v) => (&mut v.code, &mut v.name, &v.status, &mut v.notes),
            Self::PaymentMethod(v) => (&mut v.code, &mut v.name, &v.status, &mut v.notes),
        };
        *code = code.trim().to_ascii_uppercase();
        if code.is_empty()
            || code.len() > 40
            || !code.as_bytes()[0].is_ascii_alphanumeric()
            || !code
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._/-".contains(&c))
        {
            return Err(DomainError::Invalid(
                "Código exige de 1 a 40 caracteres ASCII, iniciando por letra ou número",
            ));
        }
        text(name, 200)?;
        optional(notes, 1000)?;
        if !["active", "archived"].contains(&status.as_str()) {
            return Err(DomainError::Invalid("Situação inválida"));
        }
        match self {
            Self::ProductCategory(v) if !(0..=999999).contains(&v.sort_order) => {
                return Err(DomainError::Invalid("Ordem deve estar entre 0 e 999999"));
            }
            Self::FinancialCategory(v)
                if !["income", "expense"].contains(&v.direction.as_str()) =>
            {
                return Err(DomainError::Invalid("Natureza deve ser receita ou despesa"));
            }
            Self::FinancialAccount(v) => {
                if !["bank", "cash", "internal"].contains(&v.account_type.as_str()) {
                    return Err(DomainError::Invalid("Tipo de conta inválido"));
                }
                optional(&mut v.bank, 100)?;
                optional(&mut v.branch, 30)?;
                optional(&mut v.account_number, 50)?;
                if v.account_type != "bank"
                    && [&v.bank, &v.branch, &v.account_number]
                        .iter()
                        .any(|v| v.is_some())
                {
                    return Err(DomainError::Invalid(
                        "Dados bancários só pertencem a contas do tipo bancária",
                    ));
                }
            }
            Self::PaymentMethod(v)
                if ![
                    "pix",
                    "cash",
                    "bank_transfer",
                    "credit_card",
                    "debit_card",
                    "boleto",
                    "other",
                ]
                .contains(&v.modality.as_str())
                    || !(0..=365).contains(&v.settlement_days) =>
            {
                return Err(DomainError::Invalid(
                    "Modalidade inválida ou prazo fora de 0 a 365 dias",
                ));
            }
            _ => {}
        }
        Ok(())
    }
}
#[derive(FromRow, Serialize, ToSchema)]
pub struct Reference {
    id: Uuid,
    revision: i64,
    #[serde(flatten)]
    #[sqlx(json)]
    data: ReferenceInput,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: Reference,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<Reference>,
    total: i64,
    offset: u32,
    limit: u32,
}

fn select(kind: Kind) -> String {
    format!(
        "SELECT id,revision,jsonb_build_object('code',code,'name',name,'status',status,'notes',notes,{}) AS data FROM {}",
        kind.projection(),
        kind.table()
    )
}
async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    kind: Kind,
    id: Uuid,
) -> Result<Reference, DomainError> {
    sqlx::query_as::<_, Reference>(&format!("{} WHERE tenant_id=$1 AND id=$2", select(kind)))
        .bind(tenant)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::NotFound)
}
async fn list_records(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    query: Result<Query<super::catalog::ProductQuery>, QueryRejection>,
    kind: Kind,
) -> Result<Response, DomainError> {
    let Query(query) = query.map_err(|_| DomainError::Invalid("Filtros inválidos"))?;
    let (q, offset, limit) = super::catalog::page(&query)?;
    let (read, manage) = kind.permissions();
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, read, manage, false).await?;
    let filter = "WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND (strpos(lower(name),lower($3))>0 OR strpos(lower(code),lower($3))>0)";
    let data = sqlx::query_as::<_, Reference>(&format!(
        "{} {filter} ORDER BY name,id LIMIT $4 OFFSET $5",
        select(kind)
    ))
    .bind(tenant)
    .bind(&query.status)
    .bind(&q)
    .bind(i64::from(limit))
    .bind(i64::from(offset))
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    let total = sqlx::query_scalar(&format!("SELECT count(*) FROM {} {filter}", kind.table()))
        .bind(tenant)
        .bind(&query.status)
        .bind(&q)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        ReferenceList {
            tenant_id: tenant,
            can_edit,
            data,
            total,
            offset,
            limit,
        },
    ))
}
async fn get_record(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Uuid,
    kind: Kind,
) -> Result<Response, DomainError> {
    let (read, manage) = kind.permissions();
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, read, manage, false).await?;
    let data = load(&mut tx, tenant, kind, id).await?;
    let rev = data.revision;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(rev),
        ReferenceSnapshot {
            tenant_id: tenant,
            can_edit,
            data,
        },
    ))
}
async fn hierarchy(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    kind: Kind,
    id: Uuid,
    input: &ReferenceInput,
) -> Result<(), DomainError> {
    let (parent, direction) = match input {
        ReferenceInput::ProductCategory(v) => (v.parent_id, None),
        ReferenceInput::FinancialCategory(v) => (v.parent_id, Some(v.direction.as_str())),
        _ => return Ok(()),
    };
    let status = input.common().2;
    if let Some(parent) = parent {
        let ancestor = load(tx, tenant, kind, parent).await.map_err(|e| match e {
            DomainError::NotFound => {
                DomainError::Conflict("Categoria superior não pertence a esta empresa")
            }
            other => other,
        })?;
        let (_, _, parent_status, _) = ancestor.data.common();
        if status == "active" && parent_status != "active" {
            return Err(DomainError::Conflict(
                "Categoria ativa exige categoria superior ativa",
            ));
        }
        if let ReferenceInput::FinancialCategory(v) = ancestor.data
            && Some(v.direction.as_str()) != direction
        {
            return Err(DomainError::Conflict(
                "Categorias da mesma hierarquia devem ter a mesma natureza",
            ));
        }
        // UNION also terminates safely if historical data already contains a cycle.
        let cycle: bool = sqlx::query_scalar(&format!("WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM {table} WHERE tenant_id=$1 AND id=$2 UNION SELECT p.id,p.parent_id FROM {table} p JOIN ancestors a ON p.id=a.parent_id WHERE p.tenant_id=$1) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=$3)",table=kind.table()))
            .bind(tenant).bind(parent).bind(id).fetch_one(&mut **tx).await.map_err(db)?;
        if cycle {
            return Err(DomainError::Conflict(
                "A categoria superior criaria um ciclo",
            ));
        }
    }
    let active_child: bool = sqlx::query_scalar(&format!(
        "SELECT EXISTS(SELECT 1 FROM {} WHERE tenant_id=$1 AND parent_id=$2 AND status='active')",
        kind.table()
    ))
    .bind(tenant)
    .bind(id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    if status == "archived" && active_child {
        return Err(DomainError::Conflict(
            "Arquive ou mova as subcategorias ativas antes da categoria superior",
        ));
    }
    if let Some(direction) = direction {
        let incompatible: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM financial_categories WHERE tenant_id=$1 AND parent_id=$2 AND direction<>$3)")
            .bind(tenant).bind(id).bind(direction).fetch_one(&mut **tx).await.map_err(db)?;
        if incompatible {
            return Err(DomainError::Conflict(
                "A natureza não pode divergir das subcategorias existentes",
            ));
        }
    }
    Ok(())
}
async fn store(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    kind: Kind,
    id: Uuid,
    next: i64,
    input: &ReferenceInput,
    updating: bool,
) -> Result<(), DomainError> {
    let (columns, values, changes) = match input {
        ReferenceInput::ProductCategory(_) => (
            "parent_id,sort_order",
            "$8,$9",
            "parent_id=$8,sort_order=$9",
        ),
        ReferenceInput::FinancialCategory(_) => {
            ("parent_id,direction", "$8,$9", "parent_id=$8,direction=$9")
        }
        ReferenceInput::FinancialAccount(_) => (
            "account_type,bank,branch,account_number",
            "$8,$9,$10,$11",
            "account_type=$8,bank=$9,branch=$10,account_number=$11",
        ),
        ReferenceInput::PaymentMethod(_) => (
            "modality,settlement_days",
            "$8,$9",
            "modality=$8,settlement_days=$9",
        ),
    };
    let sql = if updating {
        format!(
            "UPDATE {} SET code=$3,name=$4,status=$5,notes=$6,revision=$7,updated_at=now(),{changes} WHERE id=$1 AND tenant_id=$2 AND revision=$7-1",
            kind.table()
        )
    } else {
        format!(
            "INSERT INTO {}(id,tenant_id,code,name,status,notes,revision,{columns}) VALUES($1,$2,$3,$4,$5,$6,$7,{values})",
            kind.table()
        )
    };
    let (code, name, status, notes) = input.common();
    let query = sqlx::query(&sql)
        .bind(id)
        .bind(tenant)
        .bind(code)
        .bind(name)
        .bind(status)
        .bind(notes)
        .bind(next);
    let query = match input {
        ReferenceInput::ProductCategory(v) => query.bind(v.parent_id).bind(v.sort_order),
        ReferenceInput::FinancialCategory(v) => query.bind(v.parent_id).bind(&v.direction),
        ReferenceInput::FinancialAccount(v) => query
            .bind(&v.account_type)
            .bind(&v.bank)
            .bind(&v.branch)
            .bind(&v.account_number),
        ReferenceInput::PaymentMethod(v) => query.bind(&v.modality).bind(v.settlement_days),
    };
    let result = query.execute(&mut **tx).await.map_err(|e| {
        if e.as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            DomainError::Conflict("Código já cadastrado nesta empresa")
        } else {
            db(e)
        }
    })?;
    if result.rows_affected() != 1 {
        return Err(DomainError::StaleRevision);
    }
    Ok(())
}
async fn write_record(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Option<Uuid>,
    kind: Kind,
    payload: Result<ReferenceInput, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = if id.is_some() {
        Some(revision(&headers)?)
    } else {
        None
    };
    let (read, manage) = kind.permissions();
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, read, manage, true).await?;
    let mut input =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    input.validate()?;
    let event = kind.event(id.is_some());
    let request = serde_json::json!({"id":id,"revision":expected,"input":input});
    let status = if id.is_some() {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    if let Some(value) = replay(&mut tx, tenant, &identity.subject, key, event, &request).await? {
        let rev = value["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        let mut reply = response(status, rev, value);
        reply.headers_mut().insert(
            "idempotency-replayed",
            axum::http::HeaderValue::from_static("true"),
        );
        return Ok(reply);
    }
    let next = if let Some(id) = id {
        let previous = load(&mut tx, tenant, kind, id).await?;
        if Some(previous.revision) != expected {
            return Err(DomainError::StaleRevision);
        }
        previous
            .revision
            .checked_add(1)
            .ok_or(AccessError::Internal)?
    } else {
        1
    };
    let record_id = id.unwrap_or_else(Uuid::now_v7);
    hierarchy(&mut tx, tenant, kind, record_id, &input).await?;
    store(&mut tx, tenant, kind, record_id, next, &input, id.is_some()).await?;
    // Audit metadata excludes bank account identifiers and free-text notes.
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:kind.table(),id:record_id,event,details:serde_json::json!({"revision":next,"previousRevision":expected,"status":input.common().2})}).await?;
    let value = serde_json::to_value(ReferenceSnapshot {
        tenant_id: tenant,
        can_edit: true,
        data: load(&mut tx, tenant, kind, record_id).await?,
    })
    .map_err(|_| AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        event,
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(status, Some(next), value))
}

// Concrete handlers keep each HTTP request schema and permission boundary explicit.
macro_rules! endpoints {
    ($list:ident,$get:ident,$create:ident,$update:ident,$path:literal,$item:literal,$variant:ident,$input:ty) => {
        #[utoipa::path(get,path=$path,tag="Reference data",security(("bearerAuth"=[])),params(super::catalog::ProductQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ReferenceList),(status=403,description="Sem permissão"),(status=422,description="Filtro inválido")))]
        pub async fn $list(State(state):State<AppState>,Extension(identity):Extension<AuthenticatedIdentity>,headers:HeaderMap,query:Result<Query<super::catalog::ProductQuery>,QueryRejection>)->Result<Response,DomainError>{list_records(state,identity,headers,query,Kind::$variant).await}
        #[utoipa::path(get,path=$item,tag="Reference data",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ReferenceSnapshot),(status=403,description="Sem permissão"),(status=404,description="Registro inexistente")))]
        pub async fn $get(State(state):State<AppState>,Extension(identity):Extension<AuthenticatedIdentity>,headers:HeaderMap,Path(id):Path<Uuid>)->Result<Response,DomainError>{get_record(state,identity,headers,id,Kind::$variant).await}
        #[utoipa::path(post,path=$path,tag="Reference data",request_body=$input,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=ReferenceSnapshot),(status=403,description="Sem permissão"),(status=409,description="Vínculo ou código em conflito"),(status=422,description="Cadastro inválido"),(status=428,description="Chave obrigatória")))]
        pub async fn $create(State(state):State<AppState>,Extension(identity):Extension<AuthenticatedIdentity>,headers:HeaderMap,payload:Result<Json<$input>,JsonRejection>)->Result<Response,DomainError>{write_record(state,identity,headers,None,Kind::$variant,payload.map(|Json(v)|ReferenceInput::$variant(v))).await}
        #[utoipa::path(put,path=$item,tag="Reference data",request_body=$input,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=ReferenceSnapshot),(status=403,description="Sem permissão"),(status=404,description="Registro inexistente"),(status=409,description="Vínculo ou código em conflito"),(status=412,description="Revisão divergente"),(status=422,description="Cadastro inválido"),(status=428,description="Revisão e chave obrigatórias")))]
        pub async fn $update(State(state):State<AppState>,Extension(identity):Extension<AuthenticatedIdentity>,headers:HeaderMap,Path(id):Path<Uuid>,payload:Result<Json<$input>,JsonRejection>)->Result<Response,DomainError>{write_record(state,identity,headers,Some(id),Kind::$variant,payload.map(|Json(v)|ReferenceInput::$variant(v))).await}
    }
}
endpoints!(
    list_product_categories,
    get_product_category,
    create_product_category,
    update_product_category,
    "/api/v1/product-categories",
    "/api/v1/product-categories/{id}",
    ProductCategory,
    ProductCategoryInput
);
endpoints!(
    list_financial_categories,
    get_financial_category,
    create_financial_category,
    update_financial_category,
    "/api/v1/financial-categories",
    "/api/v1/financial-categories/{id}",
    FinancialCategory,
    FinancialCategoryInput
);
endpoints!(
    list_financial_accounts,
    get_financial_account,
    create_financial_account,
    update_financial_account,
    "/api/v1/financial-accounts",
    "/api/v1/financial-accounts/{id}",
    FinancialAccount,
    FinancialAccountInput
);
endpoints!(
    list_payment_methods,
    get_payment_method,
    create_payment_method,
    update_payment_method,
    "/api/v1/payment-methods",
    "/api/v1/payment-methods/{id}",
    PaymentMethod,
    PaymentMethodInput
);

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/product-categories",
            get(list_product_categories).post(create_product_category),
        )
        .route(
            "/api/v1/product-categories/{id}",
            get(get_product_category).put(update_product_category),
        )
        .route(
            "/api/v1/financial-categories",
            get(list_financial_categories).post(create_financial_category),
        )
        .route(
            "/api/v1/financial-categories/{id}",
            get(get_financial_category).put(update_financial_category),
        )
        .route(
            "/api/v1/financial-accounts",
            get(list_financial_accounts).post(create_financial_account),
        )
        .route(
            "/api/v1/financial-accounts/{id}",
            get(get_financial_account).put(update_financial_account),
        )
        .route(
            "/api/v1/payment-methods",
            get(list_payment_methods).post(create_payment_method),
        )
        .route(
            "/api/v1/payment-methods/{id}",
            get(get_payment_method).put(update_payment_method),
        )
}
