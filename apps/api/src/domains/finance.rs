use super::{
    DomainChange, DomainError, authorized, command_key, db, decimal, fixed, record, remember,
    replay, response, revision, sales,
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
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Row, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

/// Called by the authorized sales orchestrator in the same transaction; finance owns its records and outbox.
pub(super) async fn originate_order_receivable(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    order_id: Uuid,
) -> Result<(), DomainError> {
    let origin = sales::receivable_origin(tx, tenant, order_id).await?;
    if !(1..=99999999999999).contains(&origin.amount_cents) {
        return Err(DomainError::Invalid("Valor do recebível fora do limite"));
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO receivables(id,tenant_id,order_id,customer_name,due_date,amount_cents,status) VALUES($1,$2,$3,$4,$5,$6,'open')")
        .bind(id).bind(tenant).bind(origin.order_id).bind(&origin.customer_name).bind(origin.due_date).bind(origin.amount_cents).execute(&mut **tx).await.map_err(db)?;
    record(tx, tenant, identity, headers, DomainChange { kind: "receivable", id, event: "receivable.created",
        details: serde_json::json!({"orderId":origin.order_id,"amount":decimal(origin.amount_cents,2),"revision":1}) }).await?;
    Ok(())
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Receivable {
    id: Uuid,
    order_id: Uuid,
    customer_name: String,
    due_date: String,
    amount: String,
    received_amount: String,
    outstanding_amount: String,
    status: String,
    revision: i64,
    payment_id: Option<Uuid>,
}

// Totals come from the append-only ledger, not a second mutable balance.
const ACCOUNT_SELECT: &str = "SELECT r.id,r.order_id,r.customer_name,r.due_date::text AS due_date,(r.amount_cents::numeric/100)::numeric(16,2)::text AS amount,(totals.received::numeric/100)::numeric(16,2)::text AS received_amount,((r.amount_cents-totals.received)::numeric/100)::numeric(16,2)::text AS outstanding_amount,r.status,r.revision,r.payment_id FROM receivables r CROSS JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN p.kind='receipt' THEN p.amount_cents ELSE -p.amount_cents END),0)::bigint AS received FROM receivable_payments p WHERE p.tenant_id=r.tenant_id AND p.receivable_id=r.id) totals";
#[derive(FromRow, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    id: Uuid,
    kind: String,
    amount: String,
    method: String,
    reference: String,
    occurred_on: String,
    reverses_id: Option<Uuid>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceivableSnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: Receivable,
    payments: Vec<Payment>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceivableList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<Receivable>,
    total: i64,
    offset: u32,
    limit: u32,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PaymentInput {
    amount: String,
    method: String,
    reference: String,
    occurred_on: String,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReversalInput {
    payment_id: Uuid,
    reason: String,
    occurred_on: String,
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    can_edit: bool,
) -> Result<ReceivableSnapshot, DomainError> {
    // Read the totals and ledger in one statement so concurrent commits cannot
    // produce a detail with an old revision and a newer payment history.
    let query = format!(
        "SELECT account.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'amount',(p.amount_cents::numeric/100)::numeric(16,2)::text,'method',p.method,'reference',p.reference,'occurredOn',p.occurred_on::text,'reversesId',p.reverses_id) ORDER BY p.created_at,p.id) FROM receivable_payments p WHERE p.tenant_id=$1 AND p.receivable_id=$2),'[]'::jsonb) AS payments FROM ({ACCOUNT_SELECT} WHERE r.tenant_id=$1 AND r.id=$2) account"
    );
    let row = sqlx::query(&query)
        .bind(tenant)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::NotFound)?;
    let data = Receivable::from_row(&row).map_err(db)?;
    let payments = row
        .try_get::<sqlx::types::Json<Vec<Payment>>, _>("payments")
        .map_err(db)?
        .0;
    Ok(ReceivableSnapshot {
        tenant_id: tenant,
        can_edit,
        data,
        payments,
    })
}
fn reference(raw: &str) -> Result<String, DomainError> {
    let value = raw.trim();
    if !(3..=200).contains(&value.chars().count()) || value.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Referência ou motivo exige de 3 a 200 caracteres sem controles",
        ));
    }
    Ok(value.to_owned())
}

#[utoipa::path(get,path="/api/v1/receivables",tag="Finance",security(("bearerAuth"=[])),params(sales::OrderQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ReceivableList),(status=403,description="Sem permissão"),(status=422,description="Filtros inválidos")))]
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
        "finance.receivables.read",
        "finance.receivables.manage",
        false,
    )
    .await?;
    let query = format!(
        "{ACCOUNT_SELECT} WHERE r.tenant_id=$1 ORDER BY r.due_date,r.id LIMIT $2 OFFSET $3"
    );
    let data = sqlx::query_as::<_, Receivable>(&query)
        .bind(tenant)
        .bind(i64::from(limit))
        .bind(i64::from(offset))
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;
    let total = sqlx::query_scalar("SELECT count(*) FROM receivables WHERE tenant_id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        ReceivableList {
            tenant_id: tenant,
            can_edit,
            data,
            total,
            offset,
            limit,
        },
    ))
}
#[utoipa::path(get,path="/api/v1/receivables/{id}",tag="Finance",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ReceivableSnapshot),(status=403,description="Sem permissão"),(status=404,description="Conta não encontrada")))]
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
        "finance.receivables.read",
        "finance.receivables.manage",
        false,
    )
    .await?;
    let value = load(&mut tx, tenant, id, can_edit).await?;
    let rev = value.data.revision;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(rev), value))
}
#[utoipa::path(post,path="/api/v1/receivables/{id}/payments",tag="Finance",request_body=PaymentInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=ReceivableSnapshot),(status=403,description="Sem permissão"),(status=409,description="Valor ou estado em conflito"),(status=412,description="Revisão divergente"),(status=422,description="Recebimento inválido"),(status=428,description="Precondições obrigatórias")))]
pub async fn pay(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<PaymentInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "finance.receivables.read",
        "finance.receivables.manage",
        true,
    )
    .await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let amount = fixed(&input.amount, 2)?;
    if amount <= 0 {
        return Err(DomainError::Invalid("Recebimento exige valor positivo"));
    }
    let occurred = sales::date(&input.occurred_on)?;
    input.reference = reference(&input.reference)?;
    if !["cash", "bank_transfer", "card", "other"].contains(&input.method.as_str()) {
        return Err(DomainError::Invalid("Meio de recebimento inválido"));
    }
    let request = serde_json::json!({"id":id,"revision":expected,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "receivable.pay",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, previous));
    }
    let current = load(&mut tx, tenant, id, true).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    let outstanding = fixed(&current.data.outstanding_amount, 2)?;
    if current.data.status != "open" || amount > outstanding {
        return Err(DomainError::Conflict(
            "O recebimento não pode ultrapassar o saldo restante de uma conta em aberto",
        ));
    }
    let remaining = outstanding
        .checked_sub(amount)
        .ok_or(AccessError::Internal)?;
    let paid = remaining == 0;
    let payment = Uuid::now_v7();
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    sqlx::query("INSERT INTO receivable_payments(id,tenant_id,receivable_id,kind,amount_cents,method,reference,occurred_on) VALUES($1,$2,$3,'receipt',$4,$5,$6,$7)")
        .bind(payment).bind(tenant).bind(id).bind(amount).bind(&input.method).bind(&input.reference).bind(occurred).execute(&mut *tx).await.map_err(db)?;
    sqlx::query(
        "UPDATE receivables SET status=$3,payment_id=$4,revision=$5 WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .bind(if paid { "paid" } else { "open" })
    .bind(paid.then_some(payment))
    .bind(next)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"receivable",id,event:if paid { "receivable.paid" } else { "receivable.payment_recorded" },details:serde_json::json!({"paymentId":payment,"amount":decimal(amount,2),"outstandingAmount":decimal(remaining,2),"previousRevision":expected,"revision":next,"source":"manual_declaration"})}).await?;
    let value = serde_json::to_value(load(&mut tx, tenant, id, true).await?)
        .map_err(|_| AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "receivable.pay",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), value))
}
#[utoipa::path(post,path="/api/v1/receivables/{id}/reverse-payment",tag="Finance",request_body=ReversalInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=ReceivableSnapshot),(status=403,description="Sem permissão"),(status=409,description="Pagamento ou estado em conflito"),(status=412,description="Revisão divergente"),(status=422,description="Estorno inválido"),(status=428,description="Precondições obrigatórias")))]
pub async fn reverse(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ReversalInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "finance.receivables.read",
        "finance.receivables.manage",
        true,
    )
    .await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    input.reason = reference(&input.reason)?;
    let occurred = sales::date(&input.occurred_on)?;
    let request = serde_json::json!({"id":id,"revision":expected,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "receivable.reverse",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, previous));
    }
    let current = load(&mut tx, tenant, id, true).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if current
        .payments
        .iter()
        .any(|p| p.reverses_id == Some(input.payment_id))
    {
        return Err(DomainError::Conflict("Este recebimento já foi estornado"));
    }
    let original = current
        .payments
        .iter()
        .find(|p| p.id == input.payment_id && p.kind == "receipt")
        .ok_or(DomainError::Conflict(
            "Selecione um recebimento ativo desta conta para estornar",
        ))?;
    let original_amount = fixed(&original.amount, 2)?;
    let received = fixed(&current.data.received_amount, 2)?;
    if original_amount > received {
        return Err(AccessError::Internal.into());
    }
    if occurred < sales::date(&original.occurred_on)? {
        return Err(DomainError::Invalid(
            "Estorno não pode anteceder a data do recebimento",
        ));
    }
    let payment = Uuid::now_v7();
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    sqlx::query("INSERT INTO receivable_payments(id,tenant_id,receivable_id,kind,amount_cents,method,reference,occurred_on,reverses_id) VALUES($1,$2,$3,'reversal',$4,$5,$6,$7,$8)")
        .bind(payment).bind(tenant).bind(id).bind(original_amount).bind(&original.method).bind(&input.reason).bind(occurred).bind(input.payment_id).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("UPDATE receivables SET status='open',payment_id=NULL,revision=$3 WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(next).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"receivable",id,event:"receivable.payment_reversed",details:serde_json::json!({"paymentId":payment,"reversesId":input.payment_id,"previousRevision":expected,"revision":next})}).await?;
    let value = serde_json::to_value(load(&mut tx, tenant, id, true).await?)
        .map_err(|_| AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "receivable.reverse",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), value))
}
