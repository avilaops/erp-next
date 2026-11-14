//! Transactional internal point of sale. No fiscal or external payment side effects.
use super::list_sort::SortField;
use super::{
    DomainChange, DomainError, authorized, command_key, db, decimal, fixed, record, remember,
    replay, response, revision, sales,
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
use serde_json::{Value, json};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;
const READ: &str = "sales.pos.read";
const MANAGE: &str = "sales.pos.manage";

#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenInput {
    register: String,
    cash_account_id: Uuid,
    opening_amount: String,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MovementInput {
    direction: String,
    amount: String,
    reason: String,
    source_account_id: Option<Uuid>,
    target_account_id: Option<Uuid>,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemInput {
    product_id: Uuid,
    quantity: String,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaymentInput {
    method: String,
    amount: String,
    account_id: Uuid,
    tendered: Option<String>,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckoutInput {
    items: Vec<ItemInput>,
    payments: Vec<PaymentInput>,
    expected_total: String,
    customer_id: Option<Uuid>,
    destination: String,
    taxpayer: bool,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloseInput {
    counted_cash: String,
    reason: Option<String>,
}
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CancelInput {
    reason: String,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Filters {
    status: Option<String>,
    register: Option<String>,
    session_id: Option<Uuid>,
    search: Option<String>,
    destination: Option<String>,
    taxpayer: Option<bool>,
    start_date: Option<String>,
    end_date: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,

    sort_by: Option<String>,
    sort_order: Option<String>,
}

#[derive(Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MovementQuery {
    offset: Option<u32>,
    limit: Option<u32>,
    sort_by: Option<String>,
    sort_order: Option<String>,
}
#[derive(FromRow)]
struct Session {
    cash_account_id: Uuid,
    opening_cents: i64,
    status: String,
    revision: i64,
}
fn text(value: &str, max: usize) -> Result<String, DomainError> {
    let v = value.trim();
    if v.chars().count() < 3 || v.chars().count() > max || v.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Informe texto de 3 caracteres até o limite, sem controles",
        ));
    }
    Ok(v.into())
}
fn money(value: &str) -> Result<i64, DomainError> {
    let v = fixed(value, 2)?;
    if v > 99_999_999_999_999 {
        return Err(DomainError::Invalid("Valor fora do limite"));
    }
    Ok(v)
}
fn positive(value: &str) -> Result<i64, DomainError> {
    let v = money(value)?;
    if v == 0 {
        return Err(DomainError::Invalid("Valor deve ser positivo"));
    }
    Ok(v)
}
fn validate_destination(value: &str) -> Result<(), DomainError> {
    if ![
        "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB",
        "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
    ]
    .contains(&value)
    {
        return Err(DomainError::Invalid("UF de destino inválida"));
    }
    Ok(())
}
fn signed(value: i64) -> String {
    if value < 0 {
        format!("-{}", decimal(-value, 2))
    } else {
        decimal(value, 2)
    }
}
fn signed_money(value: &str) -> Result<i64, DomainError> {
    if let Some(v) = value.strip_prefix('-') {
        Ok(-money(v)?)
    } else {
        money(value)
    }
}
fn pagination(q: &Filters) -> Result<(u32, u32), DomainError> {
    sales::page(sales::OrderQuery {
        offset: q.offset,
        limit: q.limit,
        sort_by: None,
        sort_order: None,
    })
}
async fn account(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    cash: bool,
) -> Result<(), DomainError> {
    let kind:Option<String>=sqlx::query_scalar("SELECT account_type FROM financial_accounts WHERE tenant_id=$1 AND id=$2 AND status='active' FOR UPDATE").bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?;
    if !kind.as_deref().is_some_and(|k| {
        if cash {
            k == "cash"
        } else {
            ["bank", "internal"].contains(&k)
        }
    }) {
        return Err(DomainError::Conflict(
            "Selecione conta financeira ativa e compatível com o meio de pagamento",
        ));
    }
    Ok(())
}
async fn balance(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<i64, DomainError> {
    sqlx::query_scalar("SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint FROM financial_account_entries WHERE tenant_id=$1 AND account_id=$2").bind(tenant).bind(id).fetch_one(&mut **tx).await.map_err(db)
}
async fn lock(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    expected: i64,
) -> Result<Session, DomainError> {
    let s=sqlx::query_as::<_,Session>("SELECT cash_account_id,opening_cents,status,revision FROM pos_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if s.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if s.status != "open" {
        return Err(DomainError::Conflict("Caixa fechado não aceita alterações"));
    }
    Ok(s)
}
async fn bump(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<(), DomainError> {
    sqlx::query("UPDATE pos_sessions SET revision=revision+1 WHERE tenant_id=$1 AND id=$2")
        .bind(tenant)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    Ok(())
}
async fn totals(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    opening: i64,
) -> Result<Value, DomainError> {
    let rows:Vec<(String,i64,i64)>=sqlx::query_as("SELECT p.method,COALESCE(sum(p.amount_cents) FILTER(WHERE s.status='completed'),0)::bigint,COALESCE(sum(p.amount_cents) FILTER(WHERE s.status='cancelled'),0)::bigint FROM pos_payments p JOIN pos_sales s ON s.tenant_id=p.tenant_id AND s.id=p.sale_id WHERE s.tenant_id=$1 AND s.session_id=$2 GROUP BY p.method").bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?;
    let mut result = json!({"cash":"0.00","pix":"0.00","debit":"0.00","credit":"0.00"});
    let mut cash = 0;
    let mut refunds = 0;
    for (method, net, refunded) in rows {
        result[&method] = json!(decimal(net, 2));
        if method == "cash" {
            cash = net;
            refunds = refunded;
        }
    }
    let (supplies,withdrawals):(i64,i64)=sqlx::query_as("SELECT COALESCE(sum(amount_cents) FILTER(WHERE direction='supply'),0)::bigint,COALESCE(sum(amount_cents) FILTER(WHERE direction='withdrawal'),0)::bigint FROM pos_cash_movements WHERE tenant_id=$1 AND session_id=$2").bind(tenant).bind(id).fetch_one(&mut **tx).await.map_err(db)?;
    result["supplies"] = json!(decimal(supplies, 2));
    result["withdrawals"] = json!(decimal(withdrawals, 2));
    result["refunds"] = json!(decimal(refunds, 2));
    result["expectedCash"] = json!(signed(opening + cash + supplies - withdrawals));
    Ok(result)
}
async fn sale(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Value, DomainError> {
    sqlx::query_scalar("SELECT receipt || jsonb_build_object('id',id,'sessionId',session_id,'status',status,'revision',revision,'total',(total_cents::numeric/100)::numeric(16,2)::text,'createdAt',created_at,'cancelledAt',cancelled_at,'cancelReason',cancel_reason) FROM pos_sales WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}
async fn detail(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Value, DomainError> {
    // Hold the session while reading dependent tables: revision and totals must
    // describe the same state even under READ COMMITTED and concurrent checkout.
    let mut data:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'register',register,'cashAccountId',cash_account_id,'openingAmount',(opening_cents::numeric/100)::numeric(16,2)::text,'status',status,'revision',revision,'openedBy',opened_by,'openedAt',opened_at,'closedAt',closed_at,'countedCash',(counted_cents::numeric/100)::numeric(16,2)::text,'closeReason',close_reason) FROM pos_sessions WHERE tenant_id=$1 AND id=$2 FOR SHARE").bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let opening = money(data["openingAmount"].as_str().unwrap_or("0.00"))?;
    let mut t = totals(tx, tenant, id, opening).await?;
    t["countedCash"] = data["countedCash"].clone();
    t["difference"] = if let Some(v) = data["countedCash"].as_str() {
        json!(signed(
            money(v)? - signed_money(t["expectedCash"].as_str().unwrap_or("0.00"))?
        ))
    } else {
        Value::Null
    };
    data["totals"] = t;
    data["sales"]=json!(sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',id,'sessionId',session_id,'status',status,'total',(total_cents::numeric/100)::numeric(16,2)::text,'revision',revision,'createdAt',created_at) FROM pos_sales WHERE tenant_id=$1 AND session_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50").bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?);
    data["movements"]=json!(sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',id,'direction',direction,'amount',(amount_cents::numeric/100)::numeric(16,2)::text,'reason',reason,'createdAt',created_at) FROM pos_cash_movements WHERE tenant_id=$1 AND session_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50").bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?);
    data["salesTotal"] = json!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM pos_sales WHERE tenant_id=$1 AND session_id=$2"
        )
        .bind(tenant)
        .bind(id)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?
    );
    data["movementsTotal"] = json!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM pos_cash_movements WHERE tenant_id=$1 AND session_id=$2"
        )
        .bind(tenant)
        .bind(id)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?
    );
    data["recentLimit"] = json!(50);
    Ok(data)
}
struct CompletedCommand<'a> {
    key: Uuid,
    scope: &'static str,
    id: Uuid,
    request: &'a Value,
}

async fn finish(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    command: CompletedCommand<'_>,
    result: &Value,
) -> Result<(), DomainError> {
    let CompletedCommand {
        key,
        scope,
        id,
        request,
    } = command;
    record(
        tx,
        tenant,
        identity,
        headers,
        DomainChange {
            kind: "pos",
            id,
            event: scope,
            details: request.clone(),
        },
    )
    .await?;
    remember(tx, tenant, &identity.subject, key, scope, request, result).await
}
fn reply(status: StatusCode, value: Value) -> Response {
    let rev = value.get("session").unwrap_or(&value["data"])["revision"].as_i64();
    response(status, rev, value)
}

#[utoipa::path(operation_id="pos_open_session",post,path="/api/v1/pos/sessions",tag="Sales",params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),request_body=OpenInput,responses((status=201,body=Value)),security(("bearerAuth"=[])))]
pub async fn open(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<OpenInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let input = payload
        .map_err(|_| DomainError::Invalid("Abertura inválida"))?
        .0;
    let request = json!(input);
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(v) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "pos.open",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(reply(StatusCode::CREATED, v));
    }
    let register = input.register.trim().to_owned();
    if register.is_empty()
        || register.chars().count() > 80
        || register.chars().any(char::is_control)
    {
        return Err(DomainError::Invalid(
            "Informe identificação do caixa com 1 a 80 caracteres",
        ));
    }
    let amount = money(&input.opening_amount)?;
    account(&mut tx, tenant, input.cash_account_id, true).await?;
    if balance(&mut tx, tenant, input.cash_account_id).await? < amount {
        return Err(DomainError::Conflict(
            "Fundo de abertura excede saldo real da conta caixa; registre a transferência financeira antes de abrir",
        ));
    }
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pos_sessions WHERE tenant_id=$1 AND status='open' AND (lower(register)=lower($2) OR cash_account_id=$3))").bind(tenant).bind(&register).bind(input.cash_account_id).fetch_one(&mut *tx).await.map_err(db)?;
    if exists {
        return Err(DomainError::Conflict(
            "Registro ou conta já possui caixa aberto",
        ));
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO pos_sessions(tenant_id,id,register,cash_account_id,opening_cents,opened_by) VALUES($1,$2,$3,$4,$5,$6)").bind(tenant).bind(id).bind(register).bind(input.cash_account_id).bind(amount).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    let value = json!({"tenantId":tenant,"canEdit":true,"data":detail(&mut tx,tenant,id).await?});
    finish(
        &mut tx,
        tenant,
        &identity,
        &headers,
        CompletedCommand {
            key,
            scope: "pos.open",
            id,
            request: &request,
        },
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(reply(StatusCode::CREATED, value))
}

#[utoipa::path(operation_id="pos_list_sessions",get,path="/api/v1/pos/sessions",tag="Sales",params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value)),security(("bearerAuth"=[])))]
pub async fn sessions(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<Filters>, QueryRejection>,
) -> Result<Response, DomainError> {
    let q = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let ordering = crate::domains::list_sort::order_by(
        q.sort_by.as_deref(),
        q.sort_order.as_deref(),
        &[
            SortField::text("register", "register"),
            SortField::typed("openedAt", "opened_at"),
            SortField::text(
                "status",
                "CASE status WHEN 'closed' THEN 'Fechado' ELSE 'Aberto' END",
            ),
            SortField::typed("closedAt", "closed_at"),
        ],
        "opened_at DESC,id DESC",
        "id",
    )?;
    let (offset, limit) = pagination(&q)?;
    let start = q.start_date.as_deref().map(sales::date).transpose()?;
    let end = q.end_date.as_deref().map(sales::date).transpose()?;
    if start.zip(end).is_some_and(|(s, e)| s > e) {
        return Err(DomainError::Invalid("Intervalo de datas inválido"));
    }
    if q.status
        .as_deref()
        .is_some_and(|s| !["open", "closed"].contains(&s))
    {
        return Err(DomainError::Invalid("Status inválido"));
    }
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let data:Vec<Value>=sqlx::query_scalar(&format!("SELECT jsonb_build_object('id',id,'register',register,'cashAccountId',cash_account_id,'openingAmount',(opening_cents::numeric/100)::numeric(16,2)::text,'status',status,'revision',revision,'openedAt',opened_at,'closedAt',closed_at) FROM pos_sessions WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR register=$3) AND ($6::date IS NULL OR (opened_at AT TIME ZONE 'America/Sao_Paulo')::date >= $6) AND ($7::date IS NULL OR (opened_at AT TIME ZONE 'America/Sao_Paulo')::date <= $7) {ordering} LIMIT $4 OFFSET $5")).bind(tenant).bind(&q.status).bind(&q.register).bind(i64::from(limit)).bind(i64::from(offset)).bind(start).bind(end).fetch_all(&mut *tx).await.map_err(db)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM pos_sessions WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR register=$3) AND ($4::date IS NULL OR (opened_at AT TIME ZONE 'America/Sao_Paulo')::date >= $4) AND ($5::date IS NULL OR (opened_at AT TIME ZONE 'America/Sao_Paulo')::date <= $5)").bind(tenant).bind(&q.status).bind(&q.register).bind(start).bind(end).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":data,"total":total,"offset":offset,"limit":limit}),
    ))
}

#[utoipa::path(operation_id="pos_current_session",get,path="/api/v1/pos/sessions/current",tag="Sales",params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value)),security(("bearerAuth"=[])))]
pub async fn current(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<Filters>, QueryRejection>,
) -> Result<Response, DomainError> {
    let q = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let id:Option<Uuid>=sqlx::query_scalar("SELECT id FROM pos_sessions WHERE tenant_id=$1 AND status='open' AND ($2::text IS NULL OR register=$2) ORDER BY opened_at DESC LIMIT 1").bind(tenant).bind(q.register).fetch_optional(&mut *tx).await.map_err(db)?;
    let data = match id {
        Some(id) => detail(&mut tx, tenant, id).await?,
        None => Value::Null,
    };
    tx.commit().await.map_err(db)?;
    Ok(reply(
        StatusCode::OK,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":data}),
    ))
}
#[utoipa::path(operation_id="pos_get_session",get,path="/api/v1/pos/sessions/{id}",tag="Sales",params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value)),security(("bearerAuth"=[])))]
pub async fn get_session(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let data = detail(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(reply(
        StatusCode::OK,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":data}),
    ))
}

async fn entry(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    account: Uuid,
    amount: i64,
    direction: &str,
    reference: Uuid,
    transfer: Option<Uuid>,
) -> Result<Uuid, DomainError> {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO financial_account_entries(id,tenant_id,account_id,transfer_id,direction,amount_cents,occurred_on,description,reference) VALUES($1,$2,$3,$4,$5,$6,(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date,$7,$8)").bind(id).bind(tenant).bind(account).bind(transfer).bind(direction).bind(amount).bind(format!("PDV {reference}")).bind(reference.to_string()).execute(&mut **tx).await.map_err(db)?;
    Ok(id)
}
#[utoipa::path(operation_id="pos_list_movements",get,path="/api/v1/pos/sessions/{id}/movements",tag="Sales",params(MovementQuery,("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão"),(status=404,description="Caixa não encontrado"),(status=422,description="Filtros inválidos")),security(("bearerAuth"=[])))]
pub async fn movements(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    query: Result<Query<MovementQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let ordering = crate::domains::list_sort::order_by(
        query.sort_by.as_deref(),
        query.sort_order.as_deref(),
        &[
            SortField::typed("createdAt", "created_at"),
            SortField::text(
                "type",
                "concat(CASE direction WHEN 'supply' THEN 'Suprimento' ELSE 'Sangria' END,' · ',reason)",
            ),
            SortField::typed("amount", "amount_cents"),
        ],
        "created_at DESC,id DESC",
        "id",
    )?;
    let (offset, limit) = sales::page(sales::OrderQuery {
        offset: query.offset,
        limit: Some(query.limit.unwrap_or(50)),
        sort_by: None,
        sort_order: None,
    })?;
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pos_sessions WHERE tenant_id=$1 AND id=$2)",
    )
    .bind(tenant)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    if !exists {
        return Err(DomainError::NotFound);
    }
    let data: Vec<Value> = sqlx::query_scalar(&format!("SELECT jsonb_build_object('id',id,'direction',direction,'amount',(amount_cents::numeric/100)::numeric(16,2)::text,'reason',reason,'createdAt',created_at) FROM pos_cash_movements WHERE tenant_id=$1 AND session_id=$2 {ordering} LIMIT $3 OFFSET $4"))
        .bind(tenant).bind(id).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pos_cash_movements WHERE tenant_id=$1 AND session_id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":data,"total":total,"offset":offset,"limit":limit}),
    ))
}

#[utoipa::path(operation_id="pos_create_movement",post,path="/api/v1/pos/sessions/{id}/movements",tag="Sales",params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header),("If-Match"=String,Header)),request_body=MovementInput,responses((status=200,body=Value)),security(("bearerAuth"=[])))]
pub async fn movement(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<MovementInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let input = payload
        .map_err(|_| DomainError::Invalid("Movimentação inválida"))?
        .0;
    let request = json!({"id":id,"revision":expected,"input":input});
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(v) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "pos.movement",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(reply(StatusCode::OK, v));
    }
    let s = lock(&mut tx, tenant, id, expected).await?;
    let amount = positive(&input.amount)?;
    let reason = text(&input.reason, 200)?;
    let (source, target) = match input.direction.as_str() {
        "supply" if input.target_account_id.is_none() => (
            input
                .source_account_id
                .ok_or(DomainError::Invalid("Informe a conta de origem"))?,
            s.cash_account_id,
        ),
        "withdrawal" if input.source_account_id.is_none() => (
            s.cash_account_id,
            input
                .target_account_id
                .ok_or(DomainError::Invalid("Informe a conta de destino"))?,
        ),
        _ => {
            return Err(DomainError::Invalid(
                "Movimento deve ser supply ou withdrawal com a conta correspondente",
            ));
        }
    };
    if source == target {
        return Err(DomainError::Invalid(
            "Contas de origem e destino devem ser distintas",
        ));
    }
    let counterpart = if source == s.cash_account_id {
        target
    } else {
        source
    };
    let busy: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pos_sessions WHERE tenant_id=$1 AND cash_account_id=$2 AND status='open')")
        .bind(tenant).bind(counterpart).fetch_one(&mut *tx).await.map_err(db)?;
    if busy {
        return Err(DomainError::Conflict(
            "Conta de outro caixa aberto exige movimentação pela respectiva sessão; utilize uma conta de tesouraria",
        ));
    }
    for account_id in [source, target] {
        let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM financial_accounts WHERE tenant_id=$1 AND id=$2 AND status='active')").bind(tenant).bind(account_id).fetch_one(&mut *tx).await.map_err(db)?;
        if !active {
            return Err(DomainError::Conflict(
                "Contas devem estar ativas nesta empresa",
            ));
        }
    }
    if balance(&mut tx, tenant, source).await? < amount {
        return Err(DomainError::Conflict(
            "Saldo financeiro insuficiente na conta de origem",
        ));
    }
    if input.direction == "withdrawal"
        && signed_money(
            totals(&mut tx, tenant, id, s.opening_cents).await?["expectedCash"]
                .as_str()
                .unwrap_or("0.00"),
        )? < amount
    {
        return Err(DomainError::Conflict(
            "Sangria excede dinheiro esperado neste caixa",
        ));
    }
    let movement = Uuid::now_v7();
    let transfer = Uuid::now_v7();
    sqlx::query("INSERT INTO financial_account_transfers(id,tenant_id,source_account_id,target_account_id,amount_cents,occurred_on,description,reference) VALUES($1,$2,$3,$4,$5,(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date,$6,$7)").bind(transfer).bind(tenant).bind(source).bind(target).bind(amount).bind(&reason).bind(movement.to_string()).execute(&mut *tx).await.map_err(db)?;
    entry(
        &mut tx,
        tenant,
        source,
        amount,
        "debit",
        movement,
        Some(transfer),
    )
    .await?;
    entry(
        &mut tx,
        tenant,
        target,
        amount,
        "credit",
        movement,
        Some(transfer),
    )
    .await?;
    sqlx::query("INSERT INTO pos_cash_movements(tenant_id,id,session_id,direction,amount_cents,reason,transfer_id) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(tenant).bind(movement).bind(id).bind(input.direction).bind(amount).bind(reason).bind(transfer).execute(&mut *tx).await.map_err(db)?;
    bump(&mut tx, tenant, id).await?;
    let value = json!({"tenantId":tenant,"canEdit":true,"data":detail(&mut tx,tenant,id).await?});
    finish(
        &mut tx,
        tenant,
        &identity,
        &headers,
        CompletedCommand {
            key,
            scope: "pos.movement",
            id,
            request: &request,
        },
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(reply(StatusCode::OK, value))
}
fn payment_values(input: &PaymentInput) -> Result<(i64, i64), DomainError> {
    if !["cash", "pix", "debit", "credit"].contains(&input.method.as_str()) {
        return Err(DomainError::Invalid("Meio de pagamento inválido"));
    }
    let amount = positive(&input.amount)?;
    let tendered = input
        .tendered
        .as_deref()
        .map(money)
        .transpose()?
        .unwrap_or(amount);
    if tendered < amount || (input.method != "cash" && tendered != amount) {
        return Err(DomainError::Invalid(
            "Dinheiro recebido insuficiente ou troco em meio não monetário",
        ));
    }
    Ok((amount, tendered))
}
#[utoipa::path(operation_id="pos_checkout",post,path="/api/v1/pos/sessions/{id}/sales",tag="Sales",params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header),("If-Match"=String,Header)),request_body=CheckoutInput,responses((status=201,body=Value)),security(("bearerAuth"=[])))]
pub async fn checkout(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<CheckoutInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let input = payload
        .map_err(|_| DomainError::Invalid("Venda inválida"))?
        .0;
    let request = json!({"id":id,"revision":expected,"input":input});
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    if let Some(v) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "pos.checkout",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(reply(StatusCode::CREATED, v));
    }
    let s = lock(&mut tx, tenant, id, expected).await?;
    if input.items.is_empty()
        || input.items.len() > 100
        || input.payments.is_empty()
        || input.payments.len() > 20
    {
        return Err(DomainError::Invalid(
            "Venda exige 1 a 100 produtos e 1 a 20 pagamentos",
        ));
    }
    validate_destination(&input.destination)?;
    let customer: Value = if let Some(customer) = input.customer_id {
        sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',legal_name,'taxId',tax_id) FROM parties WHERE tenant_id=$1 AND id=$2 AND is_customer AND status='active'").bind(tenant).bind(customer).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::Conflict("Cliente deve estar ativo nesta empresa"))?
    } else {
        Value::Null
    };
    let mut items = Vec::new();
    let mut stock = Vec::new();
    let mut total = 0_i64;
    let mut seen = std::collections::HashSet::new();
    let mut product_ids: Vec<_> = input.items.iter().map(|item| item.product_id).collect();
    product_ids.sort_unstable();
    product_ids.dedup();
    // Acquire stock locks deterministically without changing the printed item order.
    for product in product_ids {
        sqlx::query(
            "SELECT product_id FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE",
        )
        .bind(tenant)
        .bind(product)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    }
    for item in &input.items {
        if !seen.insert(item.product_id) {
            return Err(DomainError::Invalid("Agrupe cada produto em um único item"));
        }
        let quantity = fixed(&item.quantity, 6)?;
        if quantity == 0 {
            return Err(DomainError::Invalid("Quantidade deve ser positiva"));
        }
        let (sku, name, unit): (String, String, String) = sqlx::query_as(
            "SELECT sku,name,unit FROM products WHERE tenant_id=$1 AND id=$2 AND status='active'",
        )
        .bind(tenant)
        .bind(item.product_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::Conflict(
            "Produto deve estar ativo nesta empresa",
        ))?;
        let (unit_price, amount, pricing) = sales::pos_price(
            &mut tx,
            tenant,
            item.product_id,
            quantity,
            &input.destination,
            input.taxpayer,
        )
        .await?;
        if amount <= 0 {
            return Err(DomainError::Invalid(
                "Produto precisa ter valor comercial positivo",
            ));
        }
        total = total
            .checked_add(amount)
            .filter(|v| *v <= 99_999_999_999_999)
            .ok_or(DomainError::Invalid("Total fora do limite"))?;
        let balance:i64=sqlx::query_scalar("SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE").bind(tenant).bind(item.product_id).fetch_optional(&mut *tx).await.map_err(db)?.unwrap_or(0);
        let reserved = sales::reserved(&mut tx, tenant, item.product_id).await?;
        if balance - reserved < quantity {
            return Err(DomainError::Conflict(
                "Estoque disponível insuficiente; reservas comerciais são preservadas",
            ));
        }
        items.push(json!({"productId":item.product_id,"sku":sku,"name":name,"unit":unit,"quantity":item.quantity,"unitPrice":decimal(unit_price,2),"amount":decimal(amount,2),"total":decimal(amount,2),"pricing":pricing}));
        stock.push((item.product_id, quantity, balance - quantity));
    }
    if money(&input.expected_total)? != total {
        return Err(DomainError::Conflict(
            "O preço mudou; atualize os itens e confirme o total novamente",
        ));
    }
    let mut paid = 0_i64;
    let mut payments = Vec::new();
    let mut prepared = Vec::new();
    let mut account_ids: Vec<_> = input.payments.iter().map(|p| p.account_id).collect();
    account_ids.sort_unstable();
    account_ids.dedup();
    for account_id in account_ids {
        sqlx::query("SELECT id FROM financial_accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
            .bind(tenant)
            .bind(account_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    for p in &input.payments {
        let (amount, tendered) = payment_values(p)?;
        if p.method == "cash" && p.account_id != s.cash_account_id {
            return Err(DomainError::Invalid(
                "Dinheiro deve entrar na conta caixa da sessão",
            ));
        }
        account(&mut tx, tenant, p.account_id, p.method == "cash").await?;
        paid = paid
            .checked_add(amount)
            .ok_or(DomainError::Invalid("Pagamentos fora do limite"))?;
        payments.push(json!({"method":p.method,"accountId":p.account_id,"amount":decimal(amount,2),"tendered":decimal(tendered,2),"change":decimal(tendered-amount,2)}));
        prepared.push((p, amount, tendered));
    }
    if paid != total {
        return Err(DomainError::Invalid(
            "A soma dos pagamentos deve ser igual ao total da venda",
        ));
    }
    let sale_id = Uuid::now_v7();
    let receipt = json!({"receiptType":"internal_non_fiscal","customer":customer,"destination":input.destination,"taxpayer":input.taxpayer,"items":items,"payments":payments});
    sqlx::query("INSERT INTO pos_sales(tenant_id,id,session_id,total_cents,receipt,created_by) VALUES($1,$2,$3,$4,$5,$6)").bind(tenant).bind(sale_id).bind(id).bind(total).bind(receipt).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    for (product, quantity, next) in stock {
        let movement = Uuid::now_v7();
        sqlx::query(
            "UPDATE stock_balances SET quantity_micros=$3 WHERE tenant_id=$1 AND product_id=$2",
        )
        .bind(tenant)
        .bind(product)
        .bind(next)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        sqlx::query("INSERT INTO stock_movements(tenant_id,id,product_id,direction,quantity_micros,balance_after_micros,reason,source_pos_sale_id) VALUES($1,$2,$3,'issue',$4,$5,$6,$7)").bind(tenant).bind(movement).bind(product).bind(quantity).bind(next).bind(format!("Venda PDV {sale_id}")).bind(sale_id).execute(&mut *tx).await.map_err(db)?;
        sqlx::query("INSERT INTO pos_sale_items(tenant_id,sale_id,product_id,quantity_micros,movement_id) VALUES($1,$2,$3,$4,$5)").bind(tenant).bind(sale_id).bind(product).bind(quantity).bind(movement).execute(&mut *tx).await.map_err(db)?;
    }
    for (p, amount, tendered) in prepared {
        let entry = entry(
            &mut tx,
            tenant,
            p.account_id,
            amount,
            "credit",
            sale_id,
            None,
        )
        .await?;
        sqlx::query("INSERT INTO pos_payments(tenant_id,id,sale_id,account_id,method,amount_cents,tendered_cents,entry_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(tenant).bind(Uuid::now_v7()).bind(sale_id).bind(p.account_id).bind(&p.method).bind(amount).bind(tendered).bind(entry).execute(&mut *tx).await.map_err(db)?;
    }
    bump(&mut tx, tenant, id).await?;
    let value = json!({"tenantId":tenant,"canEdit":true,"data":sale(&mut tx,tenant,sale_id).await?,"session":detail(&mut tx,tenant,id).await?});
    finish(
        &mut tx,
        tenant,
        &identity,
        &headers,
        CompletedCommand {
            key,
            scope: "pos.checkout",
            id: sale_id,
            request: &request,
        },
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(reply(StatusCode::CREATED, value))
}

#[utoipa::path(operation_id="pos_close_session",post,path="/api/v1/pos/sessions/{id}/close",tag="Sales",params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header),("If-Match"=String,Header)),request_body=CloseInput,responses((status=200,body=Value)),security(("bearerAuth"=[])))]
pub async fn close(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<CloseInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let input = payload
        .map_err(|_| DomainError::Invalid("Fechamento inválido"))?
        .0;
    let request = json!({"id":id,"revision":expected,"input":input});
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, READ, "sales.pos.close", true).await?;
    if let Some(v) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "pos.close",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(reply(StatusCode::OK, v));
    }
    let s = lock(&mut tx, tenant, id, expected).await?;
    let counted = money(&input.counted_cash)?;
    let expected_cash = signed_money(
        totals(&mut tx, tenant, id, s.opening_cents).await?["expectedCash"]
            .as_str()
            .unwrap_or("0.00"),
    )?;
    let reason = input.reason.as_deref().map(|s| text(s, 500)).transpose()?;
    if counted != expected_cash && reason.is_none() {
        return Err(DomainError::Invalid(
            "Justifique a diferença entre dinheiro contado e esperado",
        ));
    }
    sqlx::query("UPDATE pos_sessions SET status='closed',closed_at=clock_timestamp(),counted_cents=$3,close_reason=$4,revision=revision+1 WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(counted).bind(reason).execute(&mut *tx).await.map_err(db)?;
    let value = json!({"tenantId":tenant,"canEdit":false,"data":detail(&mut tx,tenant,id).await?});
    finish(
        &mut tx,
        tenant,
        &identity,
        &headers,
        CompletedCommand {
            key,
            scope: "pos.close",
            id,
            request: &request,
        },
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(reply(StatusCode::OK, value))
}
#[utoipa::path(operation_id="pos_cancel_sale",post,path="/api/v1/pos/sales/{id}/cancel",tag="Sales",params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header),("If-Match"=String,Header)),request_body=CancelInput,responses((status=200,body=Value)),security(("bearerAuth"=[])))]
pub async fn cancel(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<CancelInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let input = payload
        .map_err(|_| DomainError::Invalid("Cancelamento inválido"))?
        .0;
    let request = json!({"id":id,"revision":expected,"input":input});
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, READ, "sales.pos.cancel", true).await?;
    if let Some(v) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "pos.cancel",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(reply(StatusCode::OK, v));
    }
    let session_id: Uuid =
        sqlx::query_scalar("SELECT session_id FROM pos_sales WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?
            .ok_or(DomainError::NotFound)?;
    let s = lock(&mut tx, tenant, session_id, expected).await?;
    let status: String =
        sqlx::query_scalar("SELECT status FROM pos_sales WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
            .bind(tenant)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
    if status != "completed" {
        return Err(DomainError::Conflict(
            "Venda já cancelada; estorno é permitido uma única vez",
        ));
    }
    let reason = text(&input.reason, 500)?;
    let items:Vec<(Uuid,i64,Uuid)>=sqlx::query_as("SELECT product_id,quantity_micros,movement_id FROM pos_sale_items WHERE tenant_id=$1 AND sale_id=$2 ORDER BY product_id").bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    for (product, _, _) in &items {
        sqlx::query(
            "SELECT product_id FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE",
        )
        .bind(tenant)
        .bind(product)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    }
    let payments:Vec<(Uuid,String,i64)>=sqlx::query_as("SELECT account_id,method,amount_cents FROM pos_payments WHERE tenant_id=$1 AND sale_id=$2 ORDER BY account_id").bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    let cash_refund: i64 = payments
        .iter()
        .filter(|(_, m, _)| m == "cash")
        .map(|(_, _, a)| a)
        .sum();
    if signed_money(
        totals(&mut tx, tenant, session_id, s.opening_cents).await?["expectedCash"]
            .as_str()
            .unwrap_or("0.00"),
    )? < cash_refund
    {
        return Err(DomainError::Conflict(
            "Dinheiro disponível insuficiente para devolução",
        ));
    }
    let mut account_totals = std::collections::BTreeMap::<Uuid, i64>::new();
    for (account, _, amount) in &payments {
        *account_totals.entry(*account).or_default() += amount;
    }
    for (account_id, amount) in account_totals {
        sqlx::query("SELECT id FROM financial_accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
            .bind(tenant)
            .bind(account_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        if balance(&mut tx, tenant, account_id).await? < amount {
            return Err(DomainError::Conflict(
                "Conta de recebimento sem saldo para estorno; regularize o financeiro",
            ));
        }
    }
    for (product, quantity, reverses) in items {
        let previous:i64=sqlx::query_scalar("SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE").bind(tenant).bind(product).fetch_one(&mut *tx).await.map_err(db)?;
        let next = previous
            .checked_add(quantity)
            .filter(|v| *v <= 999_999_999_999_999_999)
            .ok_or(DomainError::Conflict("Estoque excede limite no estorno"))?;
        sqlx::query(
            "UPDATE stock_balances SET quantity_micros=$3 WHERE tenant_id=$1 AND product_id=$2",
        )
        .bind(tenant)
        .bind(product)
        .bind(next)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        sqlx::query("INSERT INTO stock_movements(tenant_id,id,product_id,direction,quantity_micros,balance_after_micros,reason,reverses_id,source_pos_sale_id) VALUES($1,$2,$3,'receipt',$4,$5,$6,$7,$8)").bind(tenant).bind(Uuid::now_v7()).bind(product).bind(quantity).bind(next).bind(format!("Estorno PDV {id}: {reason}").chars().take(500).collect::<String>()).bind(reverses).bind(id).execute(&mut *tx).await.map_err(db)?;
    }
    for (account, _, amount) in payments {
        entry(&mut tx, tenant, account, amount, "debit", id, None).await?;
    }
    sqlx::query("UPDATE pos_sales SET status='cancelled',cancelled_at=clock_timestamp(),cancel_reason=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(reason).execute(&mut *tx).await.map_err(db)?;
    bump(&mut tx, tenant, session_id).await?;
    let value = json!({"tenantId":tenant,"canEdit":true,"data":sale(&mut tx,tenant,id).await?,"session":detail(&mut tx,tenant,session_id).await?});
    finish(
        &mut tx,
        tenant,
        &identity,
        &headers,
        CompletedCommand {
            key,
            scope: "pos.cancel",
            id,
            request: &request,
        },
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(reply(StatusCode::OK, value))
}
#[utoipa::path(operation_id="pos_list_sales",get,path="/api/v1/pos/sales",tag="Sales",params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value)),security(("bearerAuth"=[])))]
pub async fn sales_list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<Filters>, QueryRejection>,
) -> Result<Response, DomainError> {
    let q = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let ordering = crate::domains::list_sort::order_by(
        q.sort_by.as_deref(),
        q.sort_order.as_deref(),
        &[
            SortField::typed("createdAt", "created_at"),
            SortField::text(
                "status",
                "CASE status WHEN 'cancelled' THEN 'Cancelada' ELSE 'Concluída' END",
            ),
            SortField::typed("total", "total_cents"),
        ],
        "created_at DESC,id DESC",
        "id",
    )?;
    let (offset, limit) = pagination(&q)?;
    if q.status
        .as_deref()
        .is_some_and(|s| !["completed", "cancelled"].contains(&s))
    {
        return Err(DomainError::Invalid("Status inválido"));
    }
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let data:Vec<Value>=sqlx::query_scalar(&format!("SELECT jsonb_build_object('id',id,'sessionId',session_id,'status',status,'total',(total_cents::numeric/100)::numeric(16,2)::text,'revision',revision,'createdAt',created_at,'cancelledAt',cancelled_at) FROM pos_sales WHERE tenant_id=$1 AND ($2::uuid IS NULL OR session_id=$2) AND ($3::text IS NULL OR status=$3) {ordering} LIMIT $4 OFFSET $5")).bind(tenant).bind(q.session_id).bind(&q.status).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM pos_sales WHERE tenant_id=$1 AND ($2::uuid IS NULL OR session_id=$2) AND ($3::text IS NULL OR status=$3)").bind(tenant).bind(q.session_id).bind(&q.status).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":data,"total":total,"offset":offset,"limit":limit}),
    ))
}

#[utoipa::path(operation_id="pos_get_sale",get,path="/api/v1/pos/sales/{id}",tag="Sales",params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value)),security(("bearerAuth"=[])))]
pub async fn get_sale(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let session_id: Uuid =
        sqlx::query_scalar("SELECT session_id FROM pos_sales WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?
            .ok_or(DomainError::NotFound)?;
    let session = detail(&mut tx, tenant, session_id).await?;
    let data = sale(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(reply(
        StatusCode::OK,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":data,"session":session}),
    ))
}

#[utoipa::path(operation_id="pos_list_products",get,path="/api/v1/pos/products",tag="Sales",params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value)),security(("bearerAuth"=[])))]
pub async fn products(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<Filters>, QueryRejection>,
) -> Result<Response, DomainError> {
    let q = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let ordering = crate::domains::list_sort::order_by(
        q.sort_by.as_deref(),
        q.sort_order.as_deref(),
        &[
            SortField::text("name", "p.name"),
            SortField::typed("price", "calculated.price_cents"),
        ],
        "p.name,p.id",
        "p.id",
    )?;
    let (offset, limit) = pagination(&q)?;
    let destination = q
        .destination
        .as_deref()
        .ok_or(DomainError::Invalid("Informe UF de destino"))?;
    validate_destination(destination)?;
    let taxpayer = q
        .taxpayer
        .ok_or(DomainError::Invalid("Informe condição de contribuinte"))?;
    let search = q.search.as_deref().unwrap_or("");
    if search.len() > 200 {
        return Err(DomainError::Invalid("Busca extensa demais"));
    }
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    // The commercial calculator is authoritative. Calculate the complete matching set
    // before SQL orders numeric cents and applies the requested page.
    let mut priced_quotes = std::collections::HashMap::new();
    let (priced_ids, priced_cents) = if q.sort_by.as_deref() == Some("price") {
        let ids: Vec<Uuid> = sqlx::query_scalar("SELECT p.id FROM products p WHERE p.tenant_id=$1 AND p.status='active' AND ($2='' OR p.name ILIKE '%'||$2||'%' OR p.sku ILIKE '%'||$2||'%')")
            .bind(tenant).bind(search).fetch_all(&mut *tx).await.map_err(db)?;
        let mut prices: Vec<Option<i64>> = Vec::with_capacity(ids.len());
        for id in &ids {
            let quote = sales::pos_price(&mut tx, tenant, *id, 1_000_000, destination, taxpayer)
                .await
                .map(|(price, _, _)| price);
            let price = match quote {
                Ok(price) => {
                    priced_quotes.insert(*id, Ok(price));
                    (price > 0).then_some(price)
                }
                Err(
                    error @ (DomainError::Conflict(_)
                    | DomainError::Invalid(_)
                    | DomainError::NotFound),
                ) => {
                    priced_quotes.insert(*id, Err(error));
                    None
                }
                Err(error) => return Err(error),
            };
            prices.push(price);
        }
        (ids, prices)
    } else {
        (Vec::new(), Vec::new())
    };
    let rows: Vec<(Uuid,String,String,String,i64)> = sqlx::query_as(&format!("SELECT p.id,p.sku,p.name,p.unit,COALESCE(b.quantity_micros,0) FROM products p LEFT JOIN stock_balances b ON b.tenant_id=p.tenant_id AND b.product_id=p.id LEFT JOIN unnest($5::uuid[],$6::bigint[]) AS calculated(product_id,price_cents) ON calculated.product_id=p.id WHERE p.tenant_id=$1 AND p.status='active' AND ($2='' OR p.name ILIKE '%'||$2||'%' OR p.sku ILIKE '%'||$2||'%') {ordering} LIMIT $3 OFFSET $4"))
        .bind(tenant).bind(search).bind(i64::from(limit)).bind(i64::from(offset)).bind(&priced_ids).bind(&priced_cents).fetch_all(&mut *tx).await.map_err(db)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM products WHERE tenant_id=$1 AND status='active' AND ($2='' OR name ILIKE '%'||$2||'%' OR sku ILIKE '%'||$2||'%')").bind(tenant).bind(search).fetch_one(&mut *tx).await.map_err(db)?;
    let mut data = Vec::new();
    for (id, sku, name, unit, balance) in rows {
        let reserved = sales::reserved(&mut tx, tenant, id).await?;
        let mut product = json!({"id":id,"sku":sku,"name":name,"unit":unit,"available":decimal(balance.saturating_sub(reserved).max(0),6)});
        let quote = match priced_quotes.remove(&id) {
            Some(quote) => quote,
            None => sales::pos_price(&mut tx, tenant, id, 1_000_000, destination, taxpayer)
                .await
                .map(|(price, _, _)| price),
        };
        match quote {
            Ok(price) => {
                product["unitPrice"] = json!(decimal(price, 2));
                product["pricingAvailable"] = json!(price > 0);
            }
            Err(DomainError::Conflict(message)) | Err(DomainError::Invalid(message)) => {
                product["unitPrice"] = Value::Null;
                product["pricingAvailable"] = json!(false);
                product["pricingError"] = json!(message);
            }
            Err(DomainError::NotFound) => {
                product["unitPrice"] = Value::Null;
                product["pricingAvailable"] = json!(false);
                product["pricingError"] =
                    json!("Publicação incompatível com produto atual; revise a tabela comercial");
            }
            Err(e) => return Err(e),
        };
        data.push(product);
    }
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":data,"total":total,"offset":offset,"limit":limit}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn payment(method: &str, amount: &str, tendered: Option<&str>) -> PaymentInput {
        PaymentInput {
            method: method.into(),
            amount: amount.into(),
            account_id: Uuid::nil(),
            tendered: tendered.map(str::to_owned),
        }
    }
    #[test]
    fn exact_cash_tender_and_change() {
        assert_eq!(
            payment_values(&payment("cash", "72.35", Some("100.00"))).unwrap(),
            (7235, 10000)
        );
        assert!(payment_values(&payment("cash", "72.35", Some("70.00"))).is_err());
        assert!(payment_values(&payment("pix", "72.35", Some("100.00"))).is_err());
        assert!(payment_values(&payment("credit", "0.00", None)).is_err());
        assert!(payment_values(&payment("voucher", "1.00", None)).is_err());
    }
    #[test]
    fn money_keeps_cent_precision_and_signed_differences() {
        assert_eq!(signed_money("-12.35").unwrap(), -1235);
        assert_eq!(signed(1000 - 1235), "-2.35");
        for value in ["1.001", "NaN", "-0.01", "1000000000000.00"] {
            assert!(money(value).is_err())
        }
    }
    #[test]
    fn split_payment_total_excludes_change() {
        let cash = payment_values(&payment("cash", "40.00", Some("50.00"))).unwrap();
        let pix = payment_values(&payment("pix", "32.35", None)).unwrap();
        assert_eq!(cash.0 + pix.0, 7235);
        assert_eq!(cash.1 - cash.0, 1000);
    }
}
