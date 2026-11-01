use super::{
    DomainChange, DomainError, authorized, db, decimal,
    finance::{Payment, PaymentInput, ReversalInput},
    fixed, record, response, sales, settlements,
};
use crate::platform::{access::AccessError, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Serialize;
use sqlx::{FromRow, Postgres, Row, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Payable {
    id: Uuid,
    receipt_id: Uuid,
    supplier_name: String,
    due_date: String,
    amount: String,
    paid_amount: String,
    outstanding_amount: String,
    status: String,
    revision: i64,
    payment_id: Option<Uuid>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PayableSnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: Payable,
    payments: Vec<Payment>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PayableList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<Payable>,
    total: i64,
    offset: u32,
    limit: u32,
}

const ACCOUNT_SELECT: &str = "SELECT r.id,r.receipt_id,r.supplier_name,r.due_date::text AS due_date,(r.amount_cents::numeric/100)::numeric(16,2)::text AS amount,(totals.paid::numeric/100)::numeric(16,2)::text AS paid_amount,((CASE WHEN r.status='cancelled' THEN 0 ELSE r.amount_cents-totals.paid END)::numeric/100)::numeric(16,2)::text AS outstanding_amount,r.status,r.revision,r.payment_id FROM payables r CROSS JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN p.kind='payment' THEN p.amount_cents ELSE -p.amount_cents END),0)::bigint AS paid FROM payable_payments p WHERE p.tenant_id=r.tenant_id AND p.payable_id=r.id) totals";

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    can_edit: bool,
) -> Result<PayableSnapshot, DomainError> {
    let query = format!(
        "SELECT account.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'amount',(p.amount_cents::numeric/100)::numeric(16,2)::text,'method',p.method,'reference',p.reference,'occurredOn',p.occurred_on::text,'reversesId',p.reverses_id) ORDER BY p.created_at,p.id) FROM payable_payments p WHERE p.tenant_id=$1 AND p.payable_id=$2),'[]'::jsonb) AS payments FROM ({ACCOUNT_SELECT} WHERE r.tenant_id=$1 AND r.id=$2) account"
    );
    let row = sqlx::query(&query)
        .bind(tenant)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::NotFound)?;
    let data = Payable::from_row(&row).map_err(db)?;
    let payments = row
        .try_get::<sqlx::types::Json<Vec<Payment>>, _>("payments")
        .map_err(db)?
        .0;
    Ok(PayableSnapshot {
        tenant_id: tenant,
        can_edit,
        data,
        payments,
    })
}

pub(super) async fn originate_purchase_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    receipt: Uuid,
) -> Result<Option<Uuid>, DomainError> {
    let source = super::purchasing::payable_origin(tx, tenant, receipt).await?;
    if source.amount_cents == 0 {
        return Ok(None);
    }
    if !(1..=99999999999999).contains(&source.amount_cents) {
        return Err(DomainError::Invalid("Valor da obrigação fora do limite"));
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO payables(id,tenant_id,receipt_id,supplier_name,due_date,amount_cents) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(tenant).bind(source.receipt_id).bind(source.supplier_name).bind(source.due_date).bind(source.amount_cents).execute(&mut **tx).await.map_err(db)?;
    record(tx,tenant,identity,headers,DomainChange{kind:"payable",id,event:"payable.created",details:serde_json::json!({"receiptId":receipt,"amount":decimal(source.amount_cents,2),"revision":1})}).await?;
    Ok(Some(id))
}

pub(super) async fn settlement_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<settlements::Snapshot, DomainError> {
    let current = load(tx, tenant, id, true).await?;
    let snapshot = settlements::Snapshot {
        revision: current.data.revision,
        status: current.data.status.clone(),
        outstanding: fixed(&current.data.outstanding_amount, 2)?,
        settled: fixed(&current.data.paid_amount, 2)?,
        payments: current.payments.clone(),
        value: serde_json::to_value(current).map_err(|_| AccessError::Internal)?,
    };
    Ok(snapshot)
}

#[utoipa::path(get,path="/api/v1/payables",tag="Finance",security(("bearerAuth"=[])),params(sales::OrderQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=PayableList),(status=400,description="Empresa inválida"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=422,description="Filtros inválidos"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<sales::OrderQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let (offset, limit) = sales::page(
        query
            .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
            .0,
    )?;
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "finance.payables.read",
        "finance.payables.manage",
        false,
    )
    .await?;
    let data = sqlx::query_as::<_, Payable>(&format!(
        "{ACCOUNT_SELECT} WHERE r.tenant_id=$1 ORDER BY r.due_date,r.id LIMIT $2 OFFSET $3"
    ))
    .bind(tenant)
    .bind(i64::from(limit))
    .bind(i64::from(offset))
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    let total = sqlx::query_scalar("SELECT count(*) FROM payables WHERE tenant_id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        PayableList {
            tenant_id: tenant,
            can_edit,
            data,
            total,
            offset,
            limit,
        },
    ))
}
#[utoipa::path(get,path="/api/v1/payables/{id}",tag="Finance",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=PayableSnapshot),(status=400,description="Empresa/ID inválido"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=404,description="Conta inexistente"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
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
        "finance.payables.read",
        "finance.payables.manage",
        false,
    )
    .await?;
    let result = load(&mut tx, tenant, id, can_edit).await?;
    let revision = result.data.revision;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(revision), result))
}

#[utoipa::path(post,path="/api/v1/payables/{id}/payments",tag="Finance",request_body=PaymentInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=PayableSnapshot),(status=400,description="Empresa/revisão inválida"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=404,description="Conta inexistente"),(status=409,description="Valor/estado/chave em conflito"),(status=412,description="Revisão antiga"),(status=422,description="Pagamento inválido"),(status=428,description="Precondição obrigatória"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
pub async fn pay(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<PaymentInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    settlements::pay(
        settlements::Kind::Payable,
        state,
        identity,
        headers,
        id,
        payload,
    )
    .await
}
#[utoipa::path(post,path="/api/v1/payables/{id}/reverse-payment",tag="Finance",request_body=ReversalInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=PayableSnapshot),(status=400,description="Empresa/revisão inválida"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=404,description="Conta inexistente"),(status=409,description="Lançamento/estado/chave em conflito"),(status=412,description="Revisão antiga"),(status=422,description="Estorno inválido"),(status=428,description="Precondição obrigatória"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
pub async fn reverse(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ReversalInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    settlements::reverse(
        settlements::Kind::Payable,
        state,
        identity,
        headers,
        id,
        payload,
    )
    .await
}
