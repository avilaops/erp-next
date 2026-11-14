use super::list_sort::{SortField, order_by};
use super::{
    DomainChange, DomainError, authorized, command_key, db, decimal, fixed, record, remember,
    replay, response, revision,
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
use std::collections::HashSet;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

const SORT_FIELDS: &[SortField] = &[
    SortField::text("code", "l.code"),
    SortField::text("name", "l.name"),
    SortField::text(
        "status",
        "CASE l.status WHEN 'active' THEN 'Ativa' WHEN 'archived' THEN 'Arquivada' END",
    ),
    SortField::typed("validFrom", "l.valid_from"),
    SortField::typed("validUntil", "l.valid_until"),
    SortField::typed(
        "itemCount",
        "(SELECT count(*) FROM price_list_items i WHERE i.tenant_id=l.tenant_id AND i.price_list_id=l.id)",
    ),
];

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PriceListItemInput {
    pub product_id: Uuid,
    pub price: String,
}
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PriceListInput {
    pub code: String,
    pub name: String,
    pub status: String,
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
    pub notes: Option<String>,
    pub items: Vec<PriceListItemInput>,
}
impl PriceListInput {
    fn validate(&mut self) -> Result<(), DomainError> {
        self.code = self.code.trim().to_ascii_uppercase();
        self.name = self.name.trim().to_owned();
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
        if self.name.is_empty()
            || self.name.chars().count() > 200
            || self.name.chars().any(char::is_control)
        {
            return Err(DomainError::Invalid(
                "Nome deve conter de 1 a 200 caracteres",
            ));
        }
        if !["active", "archived"].contains(&self.status.as_str()) {
            return Err(DomainError::Invalid("Situação inválida"));
        }
        self.notes = self
            .notes
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        if self
            .notes
            .as_ref()
            .is_some_and(|s| s.chars().count() > 1000 || s.chars().any(char::is_control))
        {
            return Err(DomainError::Invalid(
                "Observações devem ter até 1000 caracteres",
            ));
        }
        for date in [&self.valid_from, &self.valid_until].into_iter().flatten() {
            super::sales::date(date)?;
        }
        if matches!((&self.valid_from,&self.valid_until),(Some(from),Some(until)) if from>until) {
            return Err(DomainError::Invalid(
                "Fim da vigência deve ser igual ou posterior ao início",
            ));
        }
        if !(1..=1000).contains(&self.items.len()) {
            return Err(DomainError::Invalid("Inclua de 1 a 1000 produtos"));
        }
        let mut ids = HashSet::new();
        for item in &self.items {
            if !ids.insert(item.product_id) {
                return Err(DomainError::Invalid("Produto repetido na tabela"));
            }
            if !(0..=99_999_999_999_999).contains(&fixed(&item.price, 2)?) {
                return Err(DomainError::Invalid("Preço fora do limite"));
            }
        }
        Ok(())
    }
}
#[derive(Serialize, ToSchema, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PriceListSummary {
    pub id: Uuid,
    pub revision: i64,
    pub code: String,
    pub name: String,
    pub status: String,
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
    pub item_count: i64,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PriceListItem {
    product_id: Uuid,
    name: String,
    sku: String,
    unit: String,
    price: String,
}
#[derive(Serialize, ToSchema, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PriceList {
    id: Uuid,
    revision: i64,
    code: String,
    name: String,
    status: String,
    valid_from: Option<String>,
    valid_until: Option<String>,
    notes: Option<String>,
    #[sqlx(skip)]
    items: Vec<PriceListItem>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PriceListSnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: PriceList,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PriceListCollection {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<PriceListSummary>,
    total: i64,
    offset: u32,
    limit: u32,
}
#[derive(Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in=Query)]
pub struct PriceListQuery {
    q: Option<String>,
    status: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
    #[serde(rename = "sortOrder")]
    sort_order: Option<String>,
}
async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<PriceList, DomainError> {
    let mut result=sqlx::query_as::<_,PriceList>("SELECT id,revision,code,name,status,valid_from::text,valid_until::text,notes FROM price_lists WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let rows=sqlx::query_as::<_,(Uuid,String,String,String,i64)>("SELECT i.product_id,p.name,p.sku,p.unit,i.price_cents FROM price_list_items i JOIN products p ON p.tenant_id=i.tenant_id AND p.id=i.product_id WHERE i.tenant_id=$1 AND i.price_list_id=$2 ORDER BY p.name,p.id").bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?;
    result.items = rows
        .into_iter()
        .map(|(product_id, name, sku, unit, cents)| PriceListItem {
            product_id,
            name,
            sku,
            unit,
            price: decimal(cents, 2),
        })
        .collect();
    Ok(result)
}
fn write_error(error: sqlx::Error) -> DomainError {
    if error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation())
    {
        DomainError::Conflict("Código já cadastrado nesta empresa, inclusive em tabela arquivada")
    } else {
        db(error)
    }
}
async fn validate_products(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Option<Uuid>,
    input: &PriceListInput,
) -> Result<(), DomainError> {
    let ids: Vec<Uuid> = input.items.iter().map(|i| i.product_id).collect();
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM products p WHERE p.tenant_id=$1 AND p.id=ANY($2) AND (p.status='active' OR EXISTS(SELECT 1 FROM price_list_items i WHERE i.tenant_id=p.tenant_id AND i.product_id=p.id AND i.price_list_id=$3))").bind(tenant).bind(&ids).bind(id).fetch_one(&mut **tx).await.map_err(db)?;
    if count != ids.len() as i64 {
        return Err(DomainError::Invalid(
            "Produtos devem pertencer à empresa e estar ativos ao serem incluídos",
        ));
    }
    Ok(())
}
async fn save_items(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    input: &PriceListInput,
) -> Result<(), DomainError> {
    sqlx::query("DELETE FROM price_list_items WHERE tenant_id=$1 AND price_list_id=$2")
        .bind(tenant)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    let ids: Vec<Uuid> = input.items.iter().map(|i| i.product_id).collect();
    let prices: Vec<i64> = input
        .items
        .iter()
        .map(|i| fixed(&i.price, 2))
        .collect::<Result<_, _>>()?;
    sqlx::query("INSERT INTO price_list_items(tenant_id,price_list_id,product_id,price_cents) SELECT $1,$2,product_id,price FROM unnest($3::uuid[],$4::bigint[]) AS item(product_id,price)").bind(tenant).bind(id).bind(ids).bind(prices).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

#[utoipa::path(get,path="/api/v1/price-lists",tag="Catalog",security(("bearerAuth"=[])),params(PriceListQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=PriceListCollection),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=422,description="Filtros inválidos")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<PriceListQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let q = query.q.as_deref().unwrap_or("").trim();
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(25);
    let ordering = order_by(
        query.sort_by.as_deref(),
        query.sort_order.as_deref(),
        SORT_FIELDS,
        "l.name,l.id",
        "l.id",
    )?;
    if q.chars().count() > 160
        || offset > 100000
        || !(1..=100).contains(&limit)
        || query
            .status
            .as_deref()
            .is_some_and(|s| !["active", "archived"].contains(&s))
    {
        return Err(DomainError::Invalid(
            "Busca, paginação ou situação inválida",
        ));
    }
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        false,
    )
    .await?;
    let sql = format!(
        "SELECT l.id,l.revision,l.code,l.name,l.status,l.valid_from::text,l.valid_until::text,(SELECT count(*) FROM price_list_items i WHERE i.tenant_id=l.tenant_id AND i.price_list_id=l.id) AS item_count FROM price_lists l WHERE l.tenant_id=$1 AND ($2::text IS NULL OR l.status=$2) AND (strpos(lower(l.name),lower($3))>0 OR strpos(l.code,upper($3))>0) {ordering} LIMIT $4 OFFSET $5"
    );
    let data = sqlx::query_as::<_, PriceListSummary>(&sql)
        .bind(tenant)
        .bind(&query.status)
        .bind(q)
        .bind(i64::from(limit))
        .bind(i64::from(offset))
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;
    let total=sqlx::query_scalar("SELECT count(*) FROM price_lists WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND (strpos(lower(name),lower($3))>0 OR strpos(code,upper($3))>0)").bind(tenant).bind(&query.status).bind(q).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        PriceListCollection {
            tenant_id: tenant,
            can_edit,
            data,
            total,
            offset,
            limit,
        },
    ))
}
#[utoipa::path(get,path="/api/v1/price-lists/{id}",tag="Catalog",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=PriceListSnapshot),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=404,description="Tabela não encontrada")))]
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
        "catalog.products.read",
        "catalog.products.manage",
        false,
    )
    .await?;
    let data = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data.revision),
        PriceListSnapshot {
            tenant_id: tenant,
            can_edit,
            data,
        },
    ))
}
#[utoipa::path(post,path="/api/v1/price-lists",tag="Catalog",request_body=PriceListInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=PriceListSnapshot),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=409,description="Código ou chave em conflito"),(status=422,description="Tabela inválida"),(status=428,description="Chave obrigatória")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<PriceListInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        true,
    )
    .await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    input.validate()?;
    let request = serde_json::json!({"id":null,"revision":null,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "price_lists.create",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, rev, previous));
    }
    validate_products(&mut tx, tenant, None, &input).await?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO price_lists(tenant_id,id,code,name,status,valid_from,valid_until,notes) VALUES($1,$2,$3,$4,$5,$6::text::date,$7::text::date,$8)").bind(tenant).bind(id).bind(&input.code).bind(&input.name).bind(&input.status).bind(&input.valid_from).bind(&input.valid_until).bind(&input.notes).execute(&mut *tx).await.map_err(write_error)?;
    save_items(&mut tx, tenant, id, &input).await?;
    let result = serde_json::to_value(PriceListSnapshot {
        tenant_id: tenant,
        can_edit: true,
        data: load(&mut tx, tenant, id).await?,
    })
    .map_err(|_| crate::platform::access::AccessError::Internal)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "price_list",
            id,
            event: "price_list.created",
            details: serde_json::json!({"revision":1,"itemCount":input.items.len()}),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "price_lists.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}
#[utoipa::path(put,path="/api/v1/price-lists/{id}",tag="Catalog",request_body=PriceListInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=PriceListSnapshot),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=404,description="Tabela não encontrada"),(status=409,description="Código ou chave em conflito"),(status=412,description="Revisão divergente"),(status=422,description="Tabela inválida"),(status=428,description="Revisão ou chave obrigatória")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<PriceListInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        true,
    )
    .await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    input.validate()?;
    let request = serde_json::json!({"id":id,"revision":expected,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "price_lists.update",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, previous));
    }
    let previous = load(&mut tx, tenant, id).await?;
    if previous.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    validate_products(&mut tx, tenant, Some(id), &input).await?;
    let next = expected
        .checked_add(1)
        .ok_or(crate::platform::access::AccessError::Internal)?;
    sqlx::query("UPDATE price_lists SET code=$3,name=$4,status=$5,valid_from=$6::text::date,valid_until=$7::text::date,notes=$8,revision=$9,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(&input.code).bind(&input.name).bind(&input.status).bind(&input.valid_from).bind(&input.valid_until).bind(&input.notes).bind(next).execute(&mut *tx).await.map_err(write_error)?;
    save_items(&mut tx, tenant, id, &input).await?;
    let result = serde_json::to_value(PriceListSnapshot {
        tenant_id: tenant,
        can_edit: true,
        data: load(&mut tx, tenant, id).await?,
    })
    .map_err(|_| crate::platform::access::AccessError::Internal)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"price_list",id,event:"price_list.updated",details:serde_json::json!({"previousRevision":expected,"revision":next,"itemCount":input.items.len()})}).await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "price_lists.update",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> PriceListInput {
        serde_json::from_value(serde_json::json!({"code":" retail ","name":" Retail ","status":"active","validFrom":"2026-11-08","validUntil":"2026-11-08","notes":null,"items":[{"productId":Uuid::now_v7(),"price":"0.00"}]})).unwrap()
    }
    #[test]
    fn validates_exact_prices_distinct_items_and_inclusive_dates() {
        let mut value = input();
        value.validate().unwrap();
        assert_eq!(value.code, "RETAIL");
        value.valid_until = Some("2026-11-07".into());
        assert!(value.validate().is_err());
        for price in ["-1.00", "1.001", "1e2", "1000000000000.00"] {
            let mut value = input();
            value.items[0].price = price.into();
            assert!(value.validate().is_err());
        }
        let mut value = input();
        value.items.push(value.items[0].clone());
        assert!(value.validate().is_err());
        let mut value = input();
        value.items.clear();
        assert!(value.validate().is_err());
    }
}
