//! Receipt-driven commissions. All money uses integer cents and i128 intermediates.
//! Config: percentages are strings with scale 4 ("5.0000" = 5%).
//! Book: signed amount/base strings scale 2; competence is YYYY-MM; due is YYYY-MM-DD.
//! Payments allocate immutable entries through the requested month, including older debits.
use super::{
    DomainChange, DomainError, authorized, command_key, db, fixed, record, remember, replay,
    response, revision, sales, settlements,
};
use crate::platform::{
    access::{self, AccessError},
    auth::AuthenticatedIdentity,
    state::AppState,
};
use axum::{
    Extension, Json, Router,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

const READ: &str = "finance.commissions.read";
const MANAGE: &str = "finance.commissions.manage";
const PERCENT: i128 = 1_000_000;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/orders/{id}/commission",
            get(get_order).put(configure_order),
        )
        .route("/api/v1/commissions", get(list))
        .route("/api/v1/commissions/{id}", get(get_seller))
        .route("/api/v1/commissions/{id}/adjustments", post(adjust))
        .route("/api/v1/commissions/{id}/payments", post(pay))
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommissionTermsInput {
    seller_staff_id: Uuid,
    commission_rate: String,
    ipi_rate: String,
    payment_day: u8,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommissionAdjustmentInput {
    amount: String,
    competence: String,
    payment_day: u8,
    reason: String,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommissionPaymentInput {
    through_competence: String,
    occurred_on: String,
    reference: String,
}
#[derive(Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in=Query)]
pub struct CommissionQuery {
    offset: Option<u32>,
    limit: Option<u32>,
}

#[derive(FromRow)]
struct Terms {
    seller_staff_id: Uuid,
    seller_name: String,
    commission_rate: i64,
    ipi_rate: i64,
    payment_day: i16,
}
fn signed(value: i64) -> String {
    let magnitude = i128::from(value).abs();
    format!(
        "{}{}.{:02}",
        if value < 0 { "-" } else { "" },
        magnitude / 100,
        magnitude % 100
    )
}
fn signed_input(raw: &str) -> Result<i64, DomainError> {
    let value = if let Some(positive) = raw.strip_prefix('-') {
        -fixed(positive, 2)?
    } else {
        fixed(raw, 2)?
    };
    if value == 0 || value.unsigned_abs() > 99_999_999_999_999 {
        return Err(DomainError::Invalid(
            "Ajuste exige valor não nulo dentro do limite",
        ));
    }
    Ok(value)
}
fn rate(raw: &str) -> Result<i64, DomainError> {
    let value = fixed(raw, 4)?;
    if value > 1_000_000 {
        return Err(DomainError::Invalid(
            "Percentual deve estar entre 0.0000 e 100.0000",
        ));
    }
    Ok(value)
}
fn month(raw: &str) -> Result<time::Date, DomainError> {
    if raw.len() != 7 {
        return Err(DomainError::Invalid("Competência deve usar AAAA-MM"));
    }
    sales::date(&format!("{raw}-01"))
}
fn period(occurred: time::Date, day: i16) -> Result<(time::Date, time::Date), DomainError> {
    if !(1..=28).contains(&day) {
        return Err(DomainError::Invalid(
            "Dia do pagamento deve estar entre 1 e 28",
        ));
    }
    let competence = time::Date::from_calendar_date(occurred.year(), occurred.month(), 1)
        .map_err(|_| AccessError::Internal)?;
    let (year, next_month) = if occurred.month() == time::Month::December {
        (occurred.year() + 1, time::Month::January)
    } else {
        (occurred.year(), occurred.month().next())
    };
    if year > 2100 {
        return Err(DomainError::Invalid(
            "Vencimento da comissão fora do intervalo permitido",
        ));
    }
    let due = time::Date::from_calendar_date(year, next_month, day as u8)
        .map_err(|_| AccessError::Internal)?;
    Ok((competence, due))
}
fn calculate(received: i64, commission: i64, ipi: i64) -> Result<(i64, i64), DomainError> {
    if received <= 0 || !(0..=1_000_000).contains(&commission) || !(0..=1_000_000).contains(&ipi) {
        return Err(DomainError::Invalid("Base ou alíquota inválida"));
    }
    let denominator = PERCENT + i128::from(ipi);
    let round = |numerator: i128| {
        i64::try_from((numerator + denominator / 2) / denominator)
            .map_err(|_| DomainError::Invalid("Comissão fora do limite"))
    };
    Ok((
        round(i128::from(received) * PERCENT)?,
        round(i128::from(received) * i128::from(commission))?,
    ))
}
async fn terms(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<Option<Terms>, DomainError> {
    sqlx::query_as::<_,Terms>("SELECT seller_staff_id,seller_name,commission_rate,ipi_rate,payment_day FROM order_commission_terms WHERE tenant_id=$1 AND order_id=$2")
        .bind(tenant).bind(order).fetch_optional(&mut **tx).await.map_err(db)
}
async fn account(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    seller: Uuid,
) -> Result<i64, DomainError> {
    sqlx::query("INSERT INTO commission_accounts(tenant_id,seller_staff_id) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(tenant).bind(seller).execute(&mut **tx).await.map_err(db)?;
    sqlx::query_scalar("SELECT revision FROM commission_accounts WHERE tenant_id=$1 AND seller_staff_id=$2 FOR UPDATE").bind(tenant).bind(seller).fetch_one(&mut **tx).await.map_err(db)
}
async fn bump(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    seller: Uuid,
) -> Result<(), DomainError> {
    sqlx::query("UPDATE commission_accounts SET revision=revision+1 WHERE tenant_id=$1 AND seller_staff_id=$2").bind(tenant).bind(seller).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
async fn seller_name(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    active: bool,
) -> Result<String, DomainError> {
    let row = sqlx::query_as::<_, (String, bool, String)>(
        "SELECT name,is_seller,status FROM staff WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    if active && (!row.1 || row.2 != "active") {
        return Err(DomainError::Conflict(
            "Selecione um vendedor ativo desta empresa",
        ));
    }
    Ok(row.0)
}

/// Caller owns the tenant write lock. Financial permissions remain the settlement owner's.
/// Reads the persisted receipt so callers cannot provide a different order, date, or amount.
pub(super) async fn on_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    receipt: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
) -> Result<Value, DomainError> {
    let (order,received,occurred)=sqlx::query_as::<_,(Uuid,i64,time::Date)>("SELECT r.order_id,p.amount_cents,p.occurred_on FROM receivable_payments p JOIN receivables r ON r.tenant_id=p.tenant_id AND r.id=p.receivable_id WHERE p.tenant_id=$1 AND p.id=$2 AND p.kind='receipt'")
        .bind(tenant).bind(receipt).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let Some(config) = terms(tx, tenant, order).await? else {
        return Ok(json!({"status":"not_required","applied":false}));
    };
    if let Some(id) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM commission_entries WHERE tenant_id=$1 AND receipt_id=$2",
    )
    .bind(tenant)
    .bind(receipt)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    {
        return Ok(json!({"status":"applied","applied":true,"entryId":id}));
    }
    account(tx, tenant, config.seller_staff_id).await?;
    let (base, amount) = calculate(received, config.commission_rate, config.ipi_rate)?;
    let (competence, due) = period(occurred, config.payment_day)?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO commission_entries(id,tenant_id,seller_staff_id,seller_name,order_id,kind,receipt_id,competence,payment_due,base_cents,commission_rate,ipi_rate,payment_day,amount_cents,reason) VALUES($1,$2,$3,$4,$5,'receipt',$6,$7,$8,$9,$10,$11,$12,$13,'Comissão sobre recebimento')")
        .bind(id).bind(tenant).bind(config.seller_staff_id).bind(config.seller_name).bind(order).bind(receipt).bind(competence).bind(due).bind(base).bind(config.commission_rate).bind(config.ipi_rate).bind(config.payment_day).bind(amount).execute(&mut **tx).await.map_err(db)?;
    bump(tx, tenant, config.seller_staff_id).await?;
    record(tx,tenant,identity,headers,DomainChange{kind:"commission",id,event:"commission.accrued",details:json!({"orderId":order,"receiptId":receipt,"sellerStaffId":config.seller_staff_id,"amount":signed(amount),"baseAmount":signed(base),"competence":competence.to_string(),"paymentDue":due.to_string()})}).await?;
    Ok(json!({"status":"applied","applied":true,"entryId":id}))
}

#[derive(FromRow)]
struct Original {
    id: Uuid,
    seller_staff_id: Uuid,
    seller_name: String,
    order_id: Uuid,
    base_cents: i64,
    amount_cents: i64,
    commission_rate: i64,
    ipi_rate: i64,
    payment_day: i16,
}
/// Copies the original calculation exactly, even when its allocation has already been paid.
/// The original entry and payment allocations are never changed.
pub(super) async fn on_reversal(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    receipt: Uuid,
    reversal: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
) -> Result<Value, DomainError> {
    let (occurred,reason)=sqlx::query_as::<_,(time::Date,String)>("SELECT p.occurred_on,p.reference FROM receivable_payments p JOIN receivable_payments original ON original.tenant_id=p.tenant_id AND original.id=p.reverses_id AND original.receivable_id=p.receivable_id AND original.kind='receipt' AND original.amount_cents=p.amount_cents WHERE p.tenant_id=$1 AND p.id=$2 AND p.reverses_id=$3 AND p.kind='reversal' AND p.occurred_on>=original.occurred_on")
        .bind(tenant).bind(reversal).bind(receipt).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::Conflict("Estorno exige o recebimento original desta empresa"))?;
    let original=sqlx::query_as::<_,Original>("SELECT id,seller_staff_id,seller_name,order_id,base_cents,amount_cents,commission_rate,ipi_rate,payment_day FROM commission_entries WHERE tenant_id=$1 AND receipt_id=$2 AND kind='receipt'")
        .bind(tenant).bind(receipt).fetch_optional(&mut **tx).await.map_err(db)?;
    let Some(original) = original else {
        let configured:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM receivable_payments p JOIN receivables r ON r.tenant_id=p.tenant_id AND r.id=p.receivable_id JOIN order_commission_terms t ON t.tenant_id=r.tenant_id AND t.order_id=r.order_id WHERE p.tenant_id=$1 AND p.id=$2)").bind(tenant).bind(receipt).fetch_one(&mut **tx).await.map_err(db)?;
        if configured {
            return Err(DomainError::Conflict(
                "Recebimento configurado sem comissão original; concilie antes de estornar",
            ));
        }
        return Ok(json!({"status":"not_required","applied":false}));
    };
    if let Some(id) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM commission_entries WHERE tenant_id=$1 AND reverses_entry_id=$2",
    )
    .bind(tenant)
    .bind(original.id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    {
        return Ok(json!({"status":"applied","applied":true,"entryId":id}));
    }
    account(tx, tenant, original.seller_staff_id).await?;
    let (competence, due) = period(occurred, original.payment_day)?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO commission_entries(id,tenant_id,seller_staff_id,seller_name,order_id,kind,reversal_id,reverses_entry_id,competence,payment_due,base_cents,commission_rate,ipi_rate,payment_day,amount_cents,reason) VALUES($1,$2,$3,$4,$5,'reversal',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)")
        .bind(id).bind(tenant).bind(original.seller_staff_id).bind(original.seller_name).bind(original.order_id).bind(reversal).bind(original.id).bind(competence).bind(due).bind(-original.base_cents).bind(original.commission_rate).bind(original.ipi_rate).bind(original.payment_day).bind(-original.amount_cents).bind(reason).execute(&mut **tx).await.map_err(db)?;
    bump(tx, tenant, original.seller_staff_id).await?;
    record(tx,tenant,identity,headers,DomainChange{kind:"commission",id,event:"commission.reversed",details:json!({"orderId":original.order_id,"reversalId":reversal,"reversesEntryId":original.id,"sellerStaffId":original.seller_staff_id,"amount":signed(-original.amount_cents),"originalPaymentPreserved":true})}).await?;
    Ok(json!({"status":"applied","applied":true,"entryId":id}))
}

/// Revalidate current permissions before cancellation replay as well as first execution.
pub(super) async fn require_cancellation_permissions(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    order: Uuid,
) -> Result<(), DomainError> {
    let required:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM order_commission_terms WHERE tenant_id=$1 AND order_id=$2) OR EXISTS(SELECT 1 FROM commission_entries WHERE tenant_id=$1 AND order_id=$2)")
        .bind(tenant).bind(order).fetch_one(&mut **tx).await.map_err(db)?;
    if required {
        let rights = access::load_access(tx, tenant, &identity.subject).await?;
        access::require_permission(&rights, READ)?;
        access::require_permission(&rights, MANAGE)?;
    }
    Ok(())
}
pub(super) async fn order_reconciliation(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<Value, DomainError> {
    let (count,unreversed)=sqlx::query_as::<_,(i64,i64)>("SELECT count(*),count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM commission_entries reversed WHERE reversed.tenant_id=e.tenant_id AND reversed.reverses_entry_id=e.id)) FROM commission_entries e WHERE e.tenant_id=$1 AND e.order_id=$2 AND e.kind='receipt'")
        .bind(tenant).bind(order).fetch_one(&mut **tx).await.map_err(db)?;
    if unreversed > 0 {
        return Err(DomainError::Conflict(
            "Há comissões de recebimentos sem estorno; concilie antes de cancelar",
        ));
    }
    Ok(
        json!({"status":if count>0{"applied"}else{"not_required"},"applied":count>0,"reversedEntries":count,"paymentsPreserved":true}),
    )
}

async fn order_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
    can_edit: bool,
) -> Result<Value, DomainError> {
    sqlx::query_scalar("SELECT jsonb_build_object('tenantId',$1::uuid,'canEdit',$3::boolean AND o.status='draft','data',jsonb_build_object('orderId',o.id,'revision',o.revision,'status',CASE WHEN t.order_id IS NULL THEN 'not_required' ELSE 'configured' END,'locked',o.status<>'draft','sellerStaffId',t.seller_staff_id,'sellerName',t.seller_name,'commissionRate',(t.commission_rate::numeric/10000)::numeric(9,4)::text,'ipiRate',(t.ipi_rate::numeric/10000)::numeric(9,4)::text,'paymentDay',t.payment_day)) FROM sales_orders o LEFT JOIN order_commission_terms t ON t.tenant_id=o.tenant_id AND t.order_id=o.id WHERE o.tenant_id=$1 AND o.id=$2")
        .bind(tenant).bind(order).bind(can_edit).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}

#[utoipa::path(get,path="/api/v1/orders/{id}/commission",tag="Finance",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão"),(status=404,description="Pedido não encontrado")))]
pub async fn get_order(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    let can_edit = can_edit && access::require_permission(&rights, "sales.orders.manage").is_ok();
    let result = order_snapshot(&mut tx, tenant, id, can_edit).await?;
    let rev = result["data"]["revision"].as_i64();
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, rev, result))
}
#[utoipa::path(put,path="/api/v1/orders/{id}/commission",tag="Finance",request_body=CommissionTermsInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão"),(status=409,description="Pedido já confirmado"),(status=412,description="Revisão antiga"),(status=422,description="Configuração inválida")))]
pub async fn configure_order(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<CommissionTermsInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, "sales.orders.manage")?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let commission = rate(&input.commission_rate)?;
    let ipi = rate(&input.ipi_rate)?;
    if !(1..=28).contains(&input.payment_day) {
        return Err(DomainError::Invalid(
            "Dia do pagamento deve estar entre 1 e 28",
        ));
    }
    let request = json!({"id":id,"revision":expected,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "commission.configure",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, previous));
    }
    let (status,current,received)=sqlx::query_as::<_,(String,i64,bool)>("SELECT o.status,o.revision,EXISTS(SELECT 1 FROM receivables r JOIN receivable_payments p ON p.tenant_id=r.tenant_id AND p.receivable_id=r.id WHERE r.tenant_id=o.tenant_id AND r.order_id=o.id) FROM sales_orders o WHERE o.tenant_id=$1 AND o.id=$2 FOR UPDATE")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    if status != "draft" || received {
        return Err(DomainError::Conflict(
            "Comissão só pode ser configurada antes da confirmação e do primeiro recebimento",
        ));
    }
    let name = seller_name(&mut tx, tenant, input.seller_staff_id, true).await?;
    sqlx::query("INSERT INTO order_commission_terms(tenant_id,order_id,seller_staff_id,seller_name,commission_rate,ipi_rate,payment_day) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,order_id) DO UPDATE SET seller_staff_id=EXCLUDED.seller_staff_id,seller_name=EXCLUDED.seller_name,commission_rate=EXCLUDED.commission_rate,ipi_rate=EXCLUDED.ipi_rate,payment_day=EXCLUDED.payment_day")
        .bind(tenant).bind(id).bind(input.seller_staff_id).bind(name).bind(commission).bind(ipi).bind(i16::from(input.payment_day)).execute(&mut *tx).await.map_err(db)?;
    account(&mut tx, tenant, input.seller_staff_id).await?;
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    sqlx::query(
        "UPDATE sales_orders SET revision=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .bind(next)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"sales_order",id,event:"commission.configured",details:json!({"previousRevision":expected,"revision":next,"sellerStaffId":input.seller_staff_id,"commissionRate":input.commission_rate,"ipiRate":input.ipi_rate,"paymentDay":input.payment_day})}).await?;
    let result = order_snapshot(&mut tx, tenant, id, true).await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "commission.configure",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}

const BALANCE: &str = "SELECT s.id AS seller_staff_id,s.name AS seller_name,COALESCE(a.revision,1) AS revision,COALESCE((SELECT sum(e.amount_cents)::bigint FROM commission_entries e WHERE e.tenant_id=s.tenant_id AND e.seller_staff_id=s.id AND NOT EXISTS(SELECT 1 FROM commission_payment_entries x WHERE x.tenant_id=e.tenant_id AND x.entry_id=e.id)),0) AS open_cents,COALESCE((SELECT sum(p.amount_cents)::bigint FROM commission_payments p WHERE p.tenant_id=s.tenant_id AND p.seller_staff_id=s.id),0) AS paid_cents FROM staff s LEFT JOIN commission_accounts a ON a.tenant_id=s.tenant_id AND a.seller_staff_id=s.id";
#[derive(FromRow)]
struct Balance {
    seller_staff_id: Uuid,
    seller_name: String,
    revision: i64,
    open_cents: i64,
    paid_cents: i64,
}
impl Balance {
    fn value(self) -> Value {
        json!({"sellerStaffId":self.seller_staff_id,"sellerName":self.seller_name,"revision":self.revision,"openAmount":signed(self.open_cents),"paidAmount":signed(self.paid_cents)})
    }
}
async fn book(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    can_edit: bool,
) -> Result<Value, DomainError> {
    // A single statement keeps revision, totals and the ledger in the same MVCC snapshot.
    let query = format!(
        "SELECT jsonb_build_object('tenantId',$1::uuid,'canEdit',$3::boolean,'data',jsonb_build_object('sellerStaffId',b.seller_staff_id,'sellerName',b.seller_name,'revision',b.revision,'openAmount',round(b.open_cents::numeric/100,2)::text,'paidAmount',round(b.paid_cents::numeric/100,2)::text),'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'sellerName',e.seller_name,'orderId',e.order_id,'receiptId',e.receipt_id,'reversalId',e.reversal_id,'reversesEntryId',e.reverses_entry_id,'competence',to_char(e.competence,'YYYY-MM'),'paymentDue',e.payment_due::text,'amount',(e.amount_cents::numeric/100)::numeric(16,2)::text,'baseAmount',(e.base_cents::numeric/100)::numeric(16,2)::text,'commissionRate',(e.commission_rate::numeric/10000)::numeric(9,4)::text,'ipiRate',(e.ipi_rate::numeric/10000)::numeric(9,4)::text,'reason',e.reason,'paymentId',x.payment_id) ORDER BY e.created_at,e.id) FROM commission_entries e LEFT JOIN commission_payment_entries x ON x.tenant_id=e.tenant_id AND x.entry_id=e.id WHERE e.tenant_id=$1 AND e.seller_staff_id=$2),'[]'::jsonb),'payments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'throughCompetence',to_char(p.through_competence,'YYYY-MM'),'amount',(p.amount_cents::numeric/100)::numeric(16,2)::text,'occurredOn',p.occurred_on::text,'reference',p.reference) ORDER BY p.created_at,p.id) FROM commission_payments p WHERE p.tenant_id=$1 AND p.seller_staff_id=$2),'[]'::jsonb)) FROM ({BALANCE} WHERE s.tenant_id=$1 AND s.id=$2 AND (s.is_seller OR a.seller_staff_id IS NOT NULL)) b"
    );
    sqlx::query_scalar(&query)
        .bind(tenant)
        .bind(id)
        .bind(can_edit)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::NotFound)
}
#[utoipa::path(get,path="/api/v1/commissions",tag="Finance",security(("bearerAuth"=[])),params(CommissionQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão"),(status=422,description="Paginação inválida")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<CommissionQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let (offset, limit) = (query.offset.unwrap_or(0), query.limit.unwrap_or(25));
    if offset > 100000 || !(1..=100).contains(&limit) {
        return Err(DomainError::Invalid("Paginação inválida"));
    }
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    // Writes and permission changes hold FOR UPDATE on this row. Keep all list
    // statements in a coherent snapshot and recheck rights after waiting for it.
    sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR SHARE")
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, READ)?;
    let can_edit = access::require_permission(&rights, MANAGE).is_ok();
    let rows=sqlx::query_as::<_,Balance>(&format!("{BALANCE} WHERE s.tenant_id=$1 AND (s.is_seller OR a.seller_staff_id IS NOT NULL) ORDER BY s.name,s.id LIMIT $2 OFFSET $3")).bind(tenant).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM staff s WHERE s.tenant_id=$1 AND (s.is_seller OR EXISTS(SELECT 1 FROM commission_accounts a WHERE a.tenant_id=s.tenant_id AND a.seller_staff_id=s.id))").bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    let totals=sqlx::query_as::<_,(i64,i64)>("SELECT COALESCE((SELECT sum(e.amount_cents)::bigint FROM commission_entries e WHERE e.tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM commission_payment_entries x WHERE x.tenant_id=e.tenant_id AND x.entry_id=e.id)),0),COALESCE((SELECT sum(p.amount_cents)::bigint FROM commission_payments p WHERE p.tenant_id=$1),0)").bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":rows.into_iter().map(Balance::value).collect::<Vec<_>>(),"total":total,"offset":offset,"limit":limit,"totals":{"openAmount":signed(totals.0),"paidAmount":signed(totals.1)}}),
    ))
}
#[utoipa::path(get,path="/api/v1/commissions/{id}",tag="Finance",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão"),(status=404,description="Vendedor não encontrado")))]
pub async fn get_seller(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let result = book(&mut tx, tenant, id, can_edit).await?;
    let rev = result["data"]["revision"].as_i64();
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, rev, result))
}
#[utoipa::path(post,path="/api/v1/commissions/{id}/adjustments",tag="Finance",request_body=CommissionAdjustmentInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=Value),(status=403,description="Sem permissão"),(status=412,description="Revisão antiga"),(status=422,description="Ajuste inválido")))]
pub async fn adjust(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<CommissionAdjustmentInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let amount = signed_input(&input.amount)?;
    let competence = month(&input.competence)?;
    let (_, due) = period(competence, i16::from(input.payment_day))?;
    input.reason = settlements::reference(&input.reason)?;
    let request = json!({"id":id,"revision":expected,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "commission.adjust",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, rev, previous));
    }
    let name = seller_name(&mut tx, tenant, id, true).await?;
    let current = account(&mut tx, tenant, id).await?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    let entry = Uuid::now_v7();
    sqlx::query("INSERT INTO commission_entries(id,tenant_id,seller_staff_id,seller_name,kind,competence,payment_due,base_cents,payment_day,amount_cents,reason) VALUES($1,$2,$3,$4,'adjustment',$5,$6,0,$7,$8,$9)").bind(entry).bind(tenant).bind(id).bind(name).bind(competence).bind(due).bind(i16::from(input.payment_day)).bind(amount).bind(&input.reason).execute(&mut *tx).await.map_err(db)?;
    bump(&mut tx, tenant, id).await?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"commission",id:entry,event:"commission.adjusted",details:json!({"sellerStaffId":id,"amount":signed(amount),"reason":input.reason,"competence":input.competence,"previousRevision":expected})}).await?;
    let result = book(&mut tx, tenant, id, true).await?;
    let rev = result["data"]["revision"].as_i64();
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "commission.adjust",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, rev, result))
}
#[utoipa::path(post,path="/api/v1/commissions/{id}/payments",tag="Finance",request_body=CommissionPaymentInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão"),(status=409,description="Saldo não positivo"),(status=412,description="Revisão antiga"),(status=422,description="Pagamento inválido")))]
pub async fn pay(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<CommissionPaymentInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let through = month(&input.through_competence)?;
    let occurred = sales::date(&input.occurred_on)?;
    input.reference = settlements::reference(&input.reference)?;
    if occurred < through {
        return Err(DomainError::Invalid(
            "Pagamento não pode anteceder a competência",
        ));
    }
    let request = json!({"id":id,"revision":expected,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "commission.pay",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, previous));
    }
    seller_name(&mut tx, tenant, id, false).await?;
    let current = account(&mut tx, tenant, id).await?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    // The tenant/account locks already serialize allocations. Ledger rows are
    // immutable; locking them would unnecessarily require UPDATE privileges.
    let entries=sqlx::query_as::<_,(Uuid,i64,time::Date)>("SELECT e.id,e.amount_cents,COALESCE(p.occurred_on,e.competence) FROM commission_entries e LEFT JOIN receivable_payments p ON p.tenant_id=e.tenant_id AND p.id=COALESCE(e.receipt_id,e.reversal_id) WHERE e.tenant_id=$1 AND e.seller_staff_id=$2 AND e.competence<=$3 AND NOT EXISTS(SELECT 1 FROM commission_payment_entries x WHERE x.tenant_id=e.tenant_id AND x.entry_id=e.id) ORDER BY e.competence,e.id")
        .bind(tenant).bind(id).bind(through).fetch_all(&mut *tx).await.map_err(db)?;
    if entries
        .iter()
        .any(|(_, _, source_date)| occurred < *source_date)
    {
        return Err(DomainError::Invalid(
            "Pagamento não pode anteceder os recebimentos ou estornos incluídos",
        ));
    }
    let sum = entries
        .iter()
        .try_fold(0_i128, |total, (_, amount, _)| {
            total.checked_add(i128::from(*amount))
        })
        .ok_or(AccessError::Internal)?;
    if !(1..=99_999_999_999_999).contains(&sum) {
        return Err(DomainError::Conflict(
            "Saldo líquido até a competência deve ser positivo e dentro do limite; débitos descontam o próximo pagamento",
        ));
    }
    let amount = i64::try_from(sum).map_err(|_| AccessError::Internal)?;
    let payment = Uuid::now_v7();
    sqlx::query("INSERT INTO commission_payments(id,tenant_id,seller_staff_id,through_competence,amount_cents,occurred_on,reference) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(payment).bind(tenant).bind(id).bind(through).bind(amount).bind(occurred).bind(&input.reference).execute(&mut *tx).await.map_err(db)?;
    for (entry, _, _) in &entries {
        sqlx::query("INSERT INTO commission_payment_entries(tenant_id,seller_staff_id,payment_id,entry_id) VALUES($1,$2,$3,$4)").bind(tenant).bind(id).bind(payment).bind(entry).execute(&mut *tx).await.map_err(db)?;
    }
    bump(&mut tx, tenant, id).await?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"commission_payment",id:payment,event:"commission.paid",details:json!({"sellerStaffId":id,"amount":signed(amount),"throughCompetence":input.through_competence,"entryIds":entries.iter().map(|(entry,_,_)|*entry).collect::<Vec<_>>(),"source":"manual_declaration","previousRevision":expected})}).await?;
    let result = book(&mut tx, tenant, id, true).await?;
    let rev = result["data"]["revision"].as_i64();
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "commission.pay",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, rev, result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commissions_round_original_formula_once_without_rounding_the_base_first() {
        assert_eq!(calculate(5500, 50000, 100000).unwrap(), (5000, 250));
        assert_eq!(calculate(101, 50000, 100000).unwrap(), (92, 5));
        assert_eq!(calculate(1, 500000, 0).unwrap(), (1, 1));
        assert_eq!(
            calculate(99_999_999_999_999, 1_000_000, 1_000_000).unwrap(),
            (50_000_000_000_000, 50_000_000_000_000)
        );
        assert!(calculate(1, 1_000_001, 0).is_err());
        assert_eq!(signed(-1), "-0.01");
        assert_eq!(signed(i64::MIN), "-92233720368547758.08");
        assert_eq!(signed_input("-0.01").unwrap(), -1);
        assert!(signed_input("-0.00").is_err());
    }
    #[test]
    fn month_and_payment_dates_handle_year_rollover_and_reject_inexact_transport() {
        let (competence, due) = period(sales::date("2026-12-31").unwrap(), 28).unwrap();
        assert_eq!(competence.to_string(), "2026-12-01");
        assert_eq!(due.to_string(), "2027-01-28");
        assert!(period(competence, 29).is_err());
        assert!(period(sales::date("2100-12-31").unwrap(), 10).is_err());
        assert!(month("2026-1").is_err());
        for raw in ["5", "5.00", "-1.0000", "100.0001", "NaN"] {
            assert!(rate(raw).is_err(), "{raw}");
        }
        assert_eq!(rate("5.0000").unwrap(), 50000);
    }
}
