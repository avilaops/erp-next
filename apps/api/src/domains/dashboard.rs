//! Company-scoped operational indicators. Missing permission is never a zero.
use crate::{
    domains::{DomainError, db, response},
    platform::{access, auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension,
    extract::{Query, State, rejection::QueryRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct DashboardQuery {
    period: Option<String>,
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSales {
    pub orders: i64,
    pub cancelled: i64,
    pub amount: String,
    pub average: String,
}

#[derive(Serialize, FromRow, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMonth {
    pub month: String,
    pub orders: i64,
    pub amount: String,
    pub average: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    tenant_id: Uuid,
    period: String,
    start_date: String,
    end_date: String,
    sales: Option<DashboardSales>,
    sales_series: Option<Vec<DashboardMonth>>,
    receivables: Option<String>,
    purchase_payables: Option<String>,
    products: Option<i64>,
    customers: Option<i64>,
}

#[utoipa::path(get,path="/api/v1/dashboard",tag="Sales",params(DashboardQuery,("X-Tenant-Id"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=DashboardSnapshot),(status=403,description="Sem acesso à empresa"),(status=422,description="Período inválido")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<DashboardQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let Query(query) = query.map_err(|_| DomainError::Invalid("Período inválido"))?;
    let period = query.period.unwrap_or_else(|| "6M".into());
    let interval = match period.as_str() {
        "7D" => "6 days",
        "30D" => "29 days",
        "3M" => "3 months",
        "6M" => "6 months",
        "12M" => "12 months",
        _ => return Err(DomainError::Invalid("Período inválido")),
    };
    let tenant = access::tenant_id(&headers)?;
    let mut tx = access::tenant_transaction(&state, tenant).await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    let allowed = |permission: &str| access::require_permission(&rights, permission).is_ok();
    let (start, end): (time::Date, time::Date) = sqlx::query_as("SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - $1::interval)::date, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date")
        .bind(interval).fetch_one(&mut *tx).await.map_err(db)?;
    let mut result = DashboardSnapshot {
        tenant_id: tenant,
        period,
        start_date: start.to_string(),
        end_date: end.to_string(),
        sales: None,
        sales_series: None,
        receivables: None,
        purchase_payables: None,
        products: None,
        customers: None,
    };
    if allowed("sales.orders.read") {
        result.sales = Some(sqlx::query_as("SELECT count(*) FILTER(WHERE status<>'cancelled') AS orders,count(*) FILTER(WHERE status='cancelled') AS cancelled,(COALESCE(sum(amount_cents) FILTER(WHERE status<>'cancelled'),0)/100)::numeric(30,2)::text AS amount,(COALESCE(avg(amount_cents) FILTER(WHERE status<>'cancelled'),0)/100)::numeric(30,2)::text AS average FROM sales_orders WHERE tenant_id=$1 AND created_at>=($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND created_at<(($3::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')")
            .bind(tenant).bind(start).bind(end).fetch_one(&mut *tx).await.map_err(db)?);
        result.sales_series = Some(sqlx::query_as("SELECT to_char(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM') AS month,count(*) AS orders,(sum(amount_cents)/100)::numeric(30,2)::text AS amount,(avg(amount_cents)/100)::numeric(30,2)::text AS average FROM sales_orders WHERE tenant_id=$1 AND status<>'cancelled' AND created_at>=($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND created_at<(($3::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') GROUP BY month ORDER BY month")
            .bind(tenant).bind(start).bind(end).fetch_all(&mut *tx).await.map_err(db)?);
    }
    // Current outstanding balances include partial settlements and reversals,
    // independently of the order period. They are not bank account balances.
    if allowed("finance.receivables.read") {
        result.receivables = Some(sqlx::query_scalar("SELECT (COALESCE(sum(r.amount_cents-COALESCE(p.paid,0)),0)/100)::numeric(30,2)::text FROM receivables r LEFT JOIN LATERAL (SELECT sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) AS paid FROM receivable_payments WHERE tenant_id=r.tenant_id AND receivable_id=r.id) p ON true WHERE r.tenant_id=$1 AND r.status<>'cancelled'")
            .bind(tenant).fetch_one(&mut *tx).await.map_err(db)?);
    }
    if allowed("finance.payables.read") {
        result.purchase_payables = Some(sqlx::query_scalar("SELECT (COALESCE(sum(r.amount_cents-COALESCE(p.paid,0)),0)/100)::numeric(30,2)::text FROM payables r LEFT JOIN LATERAL (SELECT sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) AS paid FROM payable_payments WHERE tenant_id=r.tenant_id AND payable_id=r.id) p ON true WHERE r.tenant_id=$1 AND r.status<>'cancelled'")
            .bind(tenant).fetch_one(&mut *tx).await.map_err(db)?);
    }
    if allowed("catalog.products.read") {
        result.products = Some(
            sqlx::query_scalar(
                "SELECT count(*) FROM products WHERE tenant_id=$1 AND status='active'",
            )
            .bind(tenant)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?,
        );
    }
    if allowed("catalog.parties.read") {
        result.customers = Some(sqlx::query_scalar("SELECT count(*) FROM parties WHERE tenant_id=$1 AND status='active' AND is_customer").bind(tenant).fetch_one(&mut *tx).await.map_err(db)?);
    }
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}
