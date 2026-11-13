//! One MVCC snapshot of every title and payment, without joining supporting files.
use super::{
    DomainError, authorized, db, decimal,
    finance::{self, ReceivableSnapshot},
    fixed, response,
};
use crate::platform::{access::AccessError, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Serialize;
use sqlx::Row;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OrderFinanceState {
    NotOriginated,
    Open,
    Partial,
    Paid,
    Cancelled,
    Inconsistent,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderFinanceSnapshot {
    tenant_id: Uuid,
    order_id: Uuid,
    order_status: String,
    order_amount: String,
    title_amount: String,
    received_amount: String,
    outstanding_amount: String,
    state: OrderFinanceState,
    can_edit: bool,
    receivables: Vec<ReceivableSnapshot>,
}

fn cents(raw: &str) -> Result<i64, DomainError> {
    if let Some(positive) = raw.strip_prefix('-') {
        fixed(positive, 2)?
            .checked_neg()
            .ok_or(AccessError::Internal.into())
    } else {
        fixed(raw, 2)
    }
}

fn money(value: i64) -> String {
    let absolute = value.unsigned_abs();
    format!(
        "{}{}.{:02}",
        if value < 0 { "-" } else { "" },
        absolute / 100,
        absolute % 100
    )
}

#[utoipa::path(get,path="/api/v1/orders/{id}/finance",tag="Finance",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=OrderFinanceSnapshot),(status=403),(status=404)))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(order): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "finance.receivables.read",
        "finance.receivables.manage",
        false,
    )
    .await?;
    let query = format!(
        r#"WITH accounts AS ({accounts} WHERE r.tenant_id=$1 AND r.order_id=$2)
      SELECT o.status,o.amount_cents,COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'tenantId',$1::uuid,'canEdit',$3::boolean,'data',jsonb_build_object(
          'id',a.id,'orderId',a.order_id,'customerName',a.customer_name,'dueDate',a.due_date,
          'amount',a.amount,'receivedAmount',a.received_amount,'outstandingAmount',a.outstanding_amount,
          'status',a.status,'revision',a.revision,'paymentId',a.payment_id,
          'orderInstallmentId',a.order_installment_id,'installmentNumber',a.installment_number,
          'installmentKind',a.installment_kind,'plannedPaymentMethodId',a.planned_payment_method_id),
        'payments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,
          'amount',(p.amount_cents::numeric/100)::numeric(16,2)::text,'method',p.method,
          'reference',p.reference,'occurredOn',p.occurred_on::text,'reversesId',p.reverses_id,
          'financialAccountId',p.financial_account_id,'paymentMethodId',p.payment_method_id,
          'paymentMethod',p.payment_method) ORDER BY p.created_at,p.id)
          FROM receivable_payments p WHERE p.tenant_id=$1 AND p.receivable_id=a.id),'[]'::jsonb))
          ORDER BY a.due_date,a.id) FROM accounts a),'[]'::jsonb) AS receivables
      FROM sales_orders o WHERE o.tenant_id=$1 AND o.id=$2"#,
        accounts = finance::ACCOUNT_SELECT
    );
    let row = sqlx::query(&query)
        .bind(tenant)
        .bind(order)
        .bind(can_edit)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::NotFound)?;
    let status: String = row.try_get("status").map_err(db)?;
    let amount: i64 = row.try_get("amount_cents").map_err(db)?;
    let receivables: Vec<ReceivableSnapshot> = row
        .try_get::<sqlx::types::Json<Vec<ReceivableSnapshot>>, _>("receivables")
        .map_err(db)?
        .0;
    let (mut title, mut received, mut outstanding) = (0i64, 0i64, 0i64);
    let mut inconsistent = false;
    for account in &receivables {
        let data = &account.data;
        let value = fixed(&data.amount, 2)?;
        let net = cents(&data.received_amount)?;
        let left = cents(&data.outstanding_amount)?;
        title = title.checked_add(value).ok_or(AccessError::Internal)?;
        received = received.checked_add(net).ok_or(AccessError::Internal)?;
        outstanding = outstanding.checked_add(left).ok_or(AccessError::Internal)?;
        inconsistent |= net < 0
            || left < 0
            || net > value
            || (data.status == "paid" && net != value)
            || (data.status == "open" && net >= value)
            || (status != "cancelled" && data.status == "cancelled");
    }
    let finance_state = if status == "cancelled" {
        OrderFinanceState::Cancelled
    } else if receivables.is_empty() {
        outstanding = amount;
        OrderFinanceState::NotOriginated
    } else if inconsistent || title != amount {
        OrderFinanceState::Inconsistent
    } else if outstanding == 0 {
        OrderFinanceState::Paid
    } else if received > 0 {
        OrderFinanceState::Partial
    } else {
        OrderFinanceState::Open
    };
    if status == "cancelled" {
        outstanding = 0;
    }
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        OrderFinanceSnapshot {
            tenant_id: tenant,
            order_id: order,
            order_status: status,
            order_amount: decimal(amount, 2),
            title_amount: decimal(title, 2),
            received_amount: money(received),
            outstanding_amount: money(outstanding),
            state: finance_state,
            can_edit,
            receivables,
        },
    ))
}
