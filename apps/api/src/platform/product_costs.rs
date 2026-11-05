use super::{access, auth::AuthenticatedIdentity, state::AppState};
use crate::domains::{DomainError, db, response, revision};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductCostInput {
    pub product_line: String,
    pub purchase_cost_cents: i64,
    pub tax_credit_bps: i32,
    pub packaging_cents: i64,
}

impl ProductCostInput {
    fn validate(&self) -> Result<(), DomainError> {
        if !matches!(self.product_line.as_str(), "imported" | "national")
            || !(0..=1_000_000_000_000).contains(&self.purchase_cost_cents)
            || !(0..=1_000_000_000_000).contains(&self.packaging_cents)
            || !(0..=10_000).contains(&self.tax_credit_bps)
        {
            return Err(DomainError::Invalid(
                "Informe a linha, custos não negativos até R$ 10 bilhões e crédito entre 0 e 100%",
            ));
        }
        Ok(())
    }
}

async fn transaction<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
    identity: &AuthenticatedIdentity,
    id: Uuid,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>, String), DomainError> {
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
    access::require_permission(&member, "platform.company.manage")?;
    let name: String = sqlx::query_scalar("SELECT name FROM products WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::NotFound)?;
    Ok((tenant, tx, name))
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<(i64, Option<ProductCostInput>), DomainError> {
    let row: Option<(i64, String, i64, i32, i64)> = sqlx::query_as("SELECT revision,product_line,purchase_cost_cents,tax_credit_bps,packaging_cents FROM product_costs WHERE tenant_id=$1 AND product_id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?;
    Ok(row
        .map(
            |(revision, product_line, purchase_cost_cents, tax_credit_bps, packaging_cents)| {
                (
                    revision,
                    Some(ProductCostInput {
                        product_line,
                        purchase_cost_cents,
                        tax_credit_bps,
                        packaging_cents,
                    }),
                )
            },
        )
        .unwrap_or((1, None)))
}

fn snapshot(
    tenant: Uuid,
    id: Uuid,
    name: String,
    revision: i64,
    data: Option<ProductCostInput>,
) -> Response {
    response(
        StatusCode::OK,
        Some(revision),
        json!({"tenantId":tenant,"productId":id,"productName":name,"revision":revision,"canEdit":true,"data":data}),
    )
}

#[utoipa::path(get,path="/api/v1/product-costs/{id}",tag="Catalog",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=serde_json::Value),(status=403,description="Custos restritos à gestão"),(status=404,description="Produto não encontrado")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, name) = transaction(&state, &headers, &identity, id, false).await?;
    let (revision, data) = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(snapshot(tenant, id, name, revision, data))
}

#[utoipa::path(put,path="/api/v1/product-costs/{id}",tag="Catalog",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),request_body=ProductCostInput,responses((status=200,body=serde_json::Value),(status=403,description="Exige gestão"),(status=404,description="Produto não encontrado"),(status=412,description="Revisão alterada"),(status=422,description="Custo inválido"),(status=428,description="Revisão obrigatória")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    payload: Result<Json<ProductCostInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, name) = transaction(&state, &headers, &identity, id, true).await?;
    let expected = revision(&headers)?;
    let Json(data) =
        payload.map_err(|_| DomainError::Invalid("Custos inválidos ou campos desconhecidos"))?;
    data.validate()?;
    let (current, _) = load(&mut tx, tenant, id).await?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    sqlx::query("INSERT INTO product_costs(tenant_id,product_id,product_line,purchase_cost_cents,tax_credit_bps,packaging_cents,revision) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,product_id) DO UPDATE SET product_line=$3,purchase_cost_cents=$4,tax_credit_bps=$5,packaging_cents=$6,revision=$7,updated_at=now()")
        .bind(tenant).bind(id).bind(&data.product_line).bind(data.purchase_cost_cents).bind(data.tax_credit_bps).bind(data.packaging_cents).bind(next).execute(&mut *tx).await.map_err(db)?;
    // Never copy confidential values into the general audit stream.
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,details) SELECT $1,id,'product_costs.updated','product_costs',$3 FROM identities WHERE auth_subject=$2")
        .bind(tenant).bind(&identity.subject).bind(json!({"productId":id,"previousRevision":current,"revision":next})).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(snapshot(tenant, id, name, next, Some(data)))
}

