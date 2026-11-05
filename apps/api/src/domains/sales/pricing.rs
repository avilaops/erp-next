//! Published-price simulator. Cost data never enters a seller response.
use super::pricing_model::{PublishedCost, Quote, QuoteInput};
use crate::domains::{DomainError, authorized, db, response};
use crate::platform::{
    access, auth::AuthenticatedIdentity, commercial_settings_model::CommercialParameters,
    state::AppState,
};
use axum::{
    Extension, Json,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub const READ: &str = "sales.orders.read";
pub const MANAGE: &str = "sales.orders.manage";
pub const DIRECTOR: &str = "platform.company.manage";
const CALCULATOR: &str = "commercial-quote-v1-unit-cents";

#[derive(Default, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct OptionsQuery {
    version_id: Option<Uuid>,
}

pub(super) fn line(code: &str) -> Result<(), DomainError> {
    if matches!(code, "imported" | "national") {
        Ok(())
    } else {
        Err(DomainError::Invalid("Linha comercial inválida"))
    }
}

#[utoipa::path(get,path="/api/v1/sales-simulator/{line}",operation_id="get_sales_simulator",tag="Sales",security(("bearerAuth"=[])),params(OptionsQuery,("line"=String,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem acesso a vendas")))]
pub async fn options(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(code): Path<String>,
    headers: HeaderMap,
    query: Result<Query<OptionsQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    line(&code)?;
    let Query(query) = query.map_err(|_| DomainError::Invalid("Versão inválida"))?;
    let (tenant, mut tx, can_create) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let versions: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'version',version,'publishedAt',published_at) FROM price_table_versions WHERE tenant_id=$1 AND product_line=$2 ORDER BY version DESC")
        .bind(tenant).bind(&code).fetch_all(&mut *tx).await.map_err(db)?;
    let version: Option<Uuid> = match query.version_id {
        Some(id) => Some(id),
        None => sqlx::query_scalar("SELECT active_price_version_id FROM commercial_settings WHERE tenant_id=$1 AND product_line=$2")
            .bind(tenant).bind(&code).fetch_optional(&mut *tx).await.map_err(db)?.flatten(),
    };
    let data = if let Some(version) = version {
        let meta: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'version',version,'publishedAt',published_at,'originState',policy_snapshot->>'originState','freeDiscountBps',policy_snapshot->'freeDiscountBps','minimumDownPaymentBps',policy_snapshot->'minimumDownPaymentBps','ipiBps',policy_snapshot->'ipiBps') FROM price_table_versions WHERE tenant_id=$1 AND id=$2 AND product_line=$3")
            .bind(tenant).bind(version).bind(&code).fetch_optional(&mut *tx).await.map_err(db)?;
        let mut meta = meta.ok_or(DomainError::NotFound)?;
        let items: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('productId',i.product_id,'sku',i.product_snapshot->>'sku','name',i.product_snapshot->>'name','unit',i.product_snapshot->>'unit','priceWithoutIpiCents',i.price_without_ipi_cents,'priceWithIpiCents',i.price_with_ipi_cents,'structureColors',COALESCE(p.structure_colors,'{}'::text[]),'upholsteryColors',COALESCE(p.upholstery_colors,'{}'::text[])) FROM price_table_items i JOIN products p ON p.tenant_id=i.tenant_id AND p.id=i.product_id WHERE i.tenant_id=$1 AND i.version_id=$2 AND p.status='active' AND p.unit=i.product_snapshot->>'unit' ORDER BY i.product_snapshot->>'sku',i.product_id")
            .bind(tenant).bind(version).fetch_all(&mut *tx).await.map_err(db)?;
        meta["items"] = json!(items);
        Some(meta)
    } else {
        None
    };
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"line":code,"canCreate":can_create,"versions":versions,"data":data}),
    ))
}

pub(super) struct PreparedQuote {
    pub line: String,
    pub quote: Quote,
    pub digest: String,
    pub product: Value,
    pub version: i64,
}

pub(super) async fn prepare(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    code: &str,
    input: &QuoteInput,
) -> Result<PreparedQuote, DomainError> {
    line(code)?;
    let row: Option<(i64, Value, Value, Value, i64)> = sqlx::query_as("SELECT v.version,v.policy_snapshot,i.product_snapshot,i.cost_snapshot,i.price_without_ipi_cents FROM price_table_versions v JOIN price_table_items i ON i.tenant_id=v.tenant_id AND i.version_id=v.id JOIN products p ON p.tenant_id=i.tenant_id AND p.id=i.product_id WHERE v.tenant_id=$1 AND v.id=$2 AND v.product_line=$3 AND i.product_id=$4 AND p.status='active' AND p.unit=i.product_snapshot->>'unit'")
        .bind(tenant).bind(input.version_id).bind(code).bind(input.product_id).fetch_optional(&mut **tx).await.map_err(db)?;
    let (version, policy, product, cost, price) = row.ok_or(DomainError::NotFound)?;
    let params: CommercialParameters = serde_json::from_value(policy)
        .map_err(|_| DomainError::Conflict("Política publicada incompatível"))?;
    let cost: PublishedCost = serde_json::from_value(cost)
        .map_err(|_| DomainError::Conflict("Custo publicado incompatível"))?;
    let quote = super::pricing_model::quote(input, price, &cost, &params)?;
    let raw = json!({"tenantId":tenant,"line":code,"input":input,"calculator":CALCULATOR,"sale":quote.sale,"director":quote.director});
    let digest = format!("{:x}", Sha256::digest(raw.to_string().as_bytes()));
    Ok(PreparedQuote {
        line: code.into(),
        quote,
        digest,
        product,
        version,
    })
}

pub(super) fn redact(
    prepared: PreparedQuote,
    input: &QuoteInput,
    director: bool,
    tenant: Uuid,
) -> Value {
    let mut result = json!({"tenantId":tenant,"line":prepared.line,"versionId":input.version_id,"version":prepared.version,"product":prepared.product,"input":input,"digest":prepared.digest,"sale":prepared.quote.sale});
    if director {
        result["director"] = json!(prepared.quote.director);
    }
    result
}

pub(super) async fn sees_costs(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    subject: &str,
) -> Result<bool, DomainError> {
    let rights = access::load_access(tx, tenant, subject).await?;
    Ok(access::require_permission(&rights, DIRECTOR).is_ok())
}

#[utoipa::path(post,path="/api/v1/sales-simulator/{line}/quote",operation_id="quote_sales_simulator",tag="Sales",security(("bearerAuth"=[])),params(("line"=String,Path),("X-Tenant-Id"=Uuid,Header)),request_body=QuoteInput,responses((status=200,body=Value),(status=404,description="Versão ou equipamento indisponível"),(status=422,description="Condições inválidas")))]
pub async fn quote(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(code): Path<String>,
    headers: HeaderMap,
    payload: Result<Json<QuoteInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let Json(input) = payload
        .map_err(|_| DomainError::Invalid("Preencha as condições sem campos desconhecidos"))?;
    let prepared = prepare(&mut tx, tenant, &code, &input).await?;
    let director = sees_costs(&mut tx, tenant, &identity.subject).await?;
    let result = redact(prepared, &input, director, tenant);
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}
