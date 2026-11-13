use crate::{
    domains::{DomainError, authorized, db, response},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension,
    extract::{Query, State, rejection::QueryRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Deserialize;
use serde_json::{Value, json};
use utoipa::IntoParams;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in=Query)]
#[serde(deny_unknown_fields)]
pub struct MetricsQuery {
    pub month: Option<String>,
}
fn month(
    query: Result<Query<MetricsQuery>, QueryRejection>,
) -> Result<Option<time::Date>, DomainError> {
    query
        .map_err(|_| DomainError::Invalid("Competência inválida"))?
        .0
        .month
        .map(|month| {
            if month.len() != 7 {
                return Err(DomainError::Invalid("Competência deve usar AAAA-MM"));
            }
            super::date(&format!("{month}-01"))
        })
        .transpose()
}

#[utoipa::path(get,path="/api/v1/commercial/metrics/orders",operation_id="get_commercial_metrics_orders",tag="Sales",params(MetricsQuery,("X-Tenant-Id"=uuid::Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value)))]
pub async fn orders(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<MetricsQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let month = month(query)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "sales.orders.read",
        "sales.orders.manage",
        false,
    )
    .await?;
    let data: Value=sqlx::query_scalar("WITH period AS(SELECT COALESCE($2::date,date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')::date) AS start), completed AS(SELECT o.* FROM sales_orders o,period p WHERE o.tenant_id=$1 AND o.status='completed' AND EXISTS(SELECT 1 FROM audit_log a WHERE a.tenant_id=o.tenant_id AND a.entity_id=o.id::text AND a.action='order.completed' AND (a.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date>=p.start AND (a.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date<(p.start+interval '1 month')::date)) SELECT jsonb_build_object('month',(SELECT to_char(start,'YYYY-MM') FROM period),'openCents',(SELECT COALESCE(sum(amount_cents),0) FROM sales_orders WHERE tenant_id=$1 AND status IN('draft','accepted','confirmed')),'openCount',(SELECT count(*) FROM sales_orders WHERE tenant_id=$1 AND status IN('draft','accepted','confirmed')),'completedCents',(SELECT COALESCE(sum(amount_cents),0) FROM completed),'completedCount',(SELECT count(*) FROM completed),'pendingApprovalCount',(SELECT count(*) FROM commercial_order_quotes q JOIN sales_orders o ON o.tenant_id=q.tenant_id AND o.id=q.order_id WHERE q.tenant_id=$1 AND o.status='draft' AND q.approval_status='pending'),'averageDiscountBps',(SELECT round(avg((q.public_snapshot->'sale'->>'discountBps')::numeric)) FROM completed c JOIN commercial_order_quotes q ON q.tenant_id=c.tenant_id AND q.order_id=c.id))")
        .bind(tenant).bind(month).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data}),
    ))
}

#[utoipa::path(get,path="/api/v1/commercial/metrics/commissions",operation_id="get_commercial_metrics_commissions",tag="Finance",params(MetricsQuery,("X-Tenant-Id"=uuid::Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value)))]
pub async fn commissions(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<MetricsQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let month = month(query)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "finance.commissions.read",
        "finance.commissions.manage",
        false,
    )
    .await?;
    let data: Value=sqlx::query_scalar("WITH period AS(SELECT COALESCE($2::date,date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')::date) AS start), entries AS(SELECT e.* FROM commission_entries e,period p WHERE e.tenant_id=$1 AND e.competence=p.start), remaining AS(SELECT t.commission_rate,t.ipi_rate,GREATEST(0,o.amount_cents-COALESCE((SELECT sum(CASE p.kind WHEN 'receipt' THEN p.amount_cents ELSE -p.amount_cents END) FROM receivables r JOIN receivable_payments p ON p.tenant_id=r.tenant_id AND p.receivable_id=r.id WHERE r.tenant_id=o.tenant_id AND r.order_id=o.id),0)) AS gross FROM order_commission_terms t JOIN sales_orders o ON o.tenant_id=t.tenant_id AND o.id=t.order_id WHERE t.tenant_id=$1 AND o.status IN('accepted','confirmed','completed')) SELECT jsonb_build_object('month',(SELECT to_char(start,'YYYY-MM') FROM period),'receivedBaseCents',(SELECT COALESCE(sum(base_cents),0) FROM entries),'commissionCents',(SELECT COALESCE(sum(amount_cents),0) FROM entries),'sellerCount',(SELECT count(DISTINCT seller_staff_id) FROM entries),'outstandingCents',(SELECT COALESCE(sum(e.amount_cents),0) FROM commission_entries e WHERE e.tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM commission_payment_entries p WHERE p.tenant_id=e.tenant_id AND p.entry_id=e.id)),'futureCents',(SELECT COALESCE(sum(round(round(gross::numeric*1000000/(1000000+ipi_rate))*commission_rate/1000000)),0) FROM remaining))")
        .bind(tenant).bind(month).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data}),
    ))
}
