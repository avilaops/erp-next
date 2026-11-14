//! Append-only manual entries for bank, cash and internal financial accounts.
//! Receivable/payable declarations remain separate until an explicit settlement
//! integration assigns them to an account.
use super::{
    DomainChange, DomainError, authorized, command_key, db, decimal, fixed, record, remember,
    replay, response, sales,
};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{
        Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

/// Generic financial commands must not change an open register behind its cash
/// reconciliation. Call only inside authorized(write=true): its tenant mutex
/// serializes this check with POS opening, closing and register movements.
pub(super) async fn require_unmanaged_cash_account(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    account: Uuid,
) -> Result<(), DomainError> {
    let managed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pos_sessions WHERE tenant_id=$1 AND cash_account_id=$2 AND status='open')",
    ).bind(tenant).bind(account).fetch_one(&mut **tx).await.map_err(db)?;
    if managed {
        return Err(DomainError::Conflict(
            "Conta vinculada a caixa PDV aberto; registre suprimento ou sangria pela sessão do PDV, ou feche o caixa antes de outro lançamento",
        ));
    }
    Ok(())
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EntryInput {
    pub account_id: Uuid,
    pub category_id: Option<Uuid>,
    pub direction: String,
    pub amount: String,
    pub occurred_on: String,
    pub description: String,
    pub reference: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TransferInput {
    pub source_account_id: Uuid,
    pub target_account_id: Uuid,
    pub amount: String,
    pub occurred_on: String,
    pub description: String,
    pub reference: Option<String>,
}

#[derive(Clone, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct EntryQuery {
    pub account_id: Uuid,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: Uuid,
    account_id: Uuid,
    transfer_id: Option<Uuid>,
    category_id: Option<Uuid>,
    category_name: Option<String>,
    direction: String,
    amount: String,
    occurred_on: String,
    description: String,
    reference: Option<String>,
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct LedgerAccount {
    id: Uuid,
    code: String,
    name: String,
    status: String,
    account_type: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct AccountLedger {
    account: LedgerAccount,
    credit: String,
    debit: String,
    balance: String,
    entries: Vec<Entry>,
    total: i64,
    offset: u32,
    limit: u32,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct EntrySnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: Entry,
}

fn text(value: &str, min: usize, max: usize) -> Result<String, DomainError> {
    let value = value.trim();
    if !(min..=max).contains(&value.chars().count()) || value.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Texto vazio, com controles ou fora do limite",
        ));
    }
    Ok(value.to_owned())
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    account_id: Uuid,
    offset: u32,
    limit: u32,
) -> Result<AccountLedger, DomainError> {
    let account = sqlx::query_as::<_, LedgerAccount>("SELECT id,code,name,status,account_type FROM financial_accounts WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(account_id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let (credit, debit): (i64, i64) = sqlx::query_as("SELECT COALESCE(SUM(amount_cents) FILTER (WHERE direction='credit'),0)::bigint, COALESCE(SUM(amount_cents) FILTER (WHERE direction='debit'),0)::bigint FROM financial_account_entries WHERE tenant_id=$1 AND account_id=$2")
        .bind(tenant).bind(account_id).fetch_one(&mut **tx).await.map_err(db)?;
    let entries = sqlx::query_as::<_, Entry>("SELECT e.id,e.account_id,e.transfer_id,e.category_id,c.name AS category_name,e.direction,(e.amount_cents::numeric/100)::numeric(16,2)::text AS amount,e.occurred_on::text,e.description,e.reference FROM financial_account_entries e LEFT JOIN financial_categories c ON c.tenant_id=e.tenant_id AND c.id=e.category_id WHERE e.tenant_id=$1 AND e.account_id=$2 ORDER BY e.occurred_on DESC,e.id DESC LIMIT $3 OFFSET $4")
        .bind(tenant).bind(account_id).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut **tx).await.map_err(db)?;
    let total = sqlx::query_scalar(
        "SELECT count(*) FROM financial_account_entries WHERE tenant_id=$1 AND account_id=$2",
    )
    .bind(tenant)
    .bind(account_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    Ok(AccountLedger {
        account,
        credit: decimal(credit, 2),
        debit: decimal(debit, 2),
        balance: decimal(
            credit
                .checked_sub(debit)
                .ok_or(DomainError::Invalid("Saldo fora do limite"))?,
            2,
        ),
        entries,
        total,
        offset,
        limit,
    })
}

#[utoipa::path(get, path="/api/v1/financial-account-entries", tag="Finance", security(("bearerAuth"=[])), params(("accountId"=Uuid,Query), ("offset"=u32,Query), ("limit"=u32,Query), ("X-Tenant-Id"=Uuid,Header)), responses((status=200,body=AccountLedger),(status=403,description="Sem permissão"),(status=404,description="Conta inexistente")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<EntryQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let (offset, limit) = sales::page(sales::OrderQuery {
        offset: query.offset,
        limit: query.limit,
        sort_by: None,
        sort_order: None,
    })?;
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "finance.account_entries.read",
        "finance.account_entries.manage",
        false,
    )
    .await?;
    let value = load(&mut tx, tenant, query.account_id, offset, limit).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":value}),
    ))
}

#[utoipa::path(post, path="/api/v1/financial-account-entries", tag="Finance", security(("bearerAuth"=[])), request_body=EntryInput, params(("X-Tenant-Id"=Uuid,Header), ("Idempotency-Key"=Uuid,Header)), responses((status=201,body=EntrySnapshot),(status=403,description="Sem permissão"),(status=428,description="Chave obrigatória")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<EntryInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "finance.account_entries.read",
        "finance.account_entries.manage",
        true,
    )
    .await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("Lançamento inválido ou campos desconhecidos"))?;
    if !["credit", "debit"].contains(&input.direction.as_str()) {
        return Err(DomainError::Invalid("Direção deve ser credit ou debit"));
    }
    let amount = fixed(&input.amount, 2)?;
    if amount <= 0 {
        return Err(DomainError::Invalid("Lançamento exige valor positivo"));
    }
    let occurred_on = sales::date(&input.occurred_on)?;
    input.description = text(&input.description, 3, 200)?;
    input.reference = input
        .reference
        .as_deref()
        .map(|v| text(v, 1, 200))
        .transpose()?;
    let request = json!({"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "financial_account_entry.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, None, previous));
    }
    let active: Option<String> =
        sqlx::query_scalar("SELECT status FROM financial_accounts WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(input.account_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?;
    if active.is_none() {
        return Err(DomainError::NotFound);
    }
    if active.as_deref() != Some("active") {
        return Err(DomainError::Conflict("A conta financeira está arquivada"));
    }
    require_unmanaged_cash_account(&mut tx, tenant, input.account_id).await?;
    if let Some(category_id) = input.category_id {
        let expected = if input.direction == "credit" {
            "income"
        } else {
            "expense"
        };
        let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM financial_categories WHERE tenant_id=$1 AND id=$2 AND status='active' AND direction=$3)").bind(tenant).bind(category_id).bind(expected).fetch_one(&mut *tx).await.map_err(db)?;
        if !valid {
            return Err(DomainError::Conflict(
                "Categoria incompatível com a direção do lançamento",
            ));
        }
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO financial_account_entries(id,tenant_id,account_id,category_id,direction,amount_cents,occurred_on,description,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(id).bind(tenant).bind(input.account_id).bind(input.category_id).bind(&input.direction).bind(amount).bind(occurred_on).bind(&input.description).bind(&input.reference).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "financial_account_entry", id, event: "financial_account_entry.created", details: json!({"accountId":input.account_id,"direction":input.direction,"amount":decimal(amount,2)}) }).await?;
    let entry = sqlx::query_as::<_, Entry>("SELECT e.id,e.account_id,e.transfer_id,e.category_id,c.name AS category_name,e.direction,(e.amount_cents::numeric/100)::numeric(16,2)::text AS amount,e.occurred_on::text,e.description,e.reference FROM financial_account_entries e LEFT JOIN financial_categories c ON c.tenant_id=e.tenant_id AND c.id=e.category_id WHERE e.tenant_id=$1 AND e.id=$2").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    let value = json!({"tenantId":tenant,"canEdit":true,"data":entry});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "financial_account_entry.create",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, None, value))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct TransferSnapshot {
    tenant_id: Uuid,
    transfer_id: Uuid,
    source_entry_id: Uuid,
    target_entry_id: Uuid,
    amount: String,
}

#[utoipa::path(post, path="/api/v1/financial-account-transfers", tag="Finance", security(("bearerAuth"=[])), request_body=TransferInput, params(("X-Tenant-Id"=Uuid,Header), ("Idempotency-Key"=Uuid,Header)), responses((status=201,body=TransferSnapshot),(status=403,description="Sem permissão"),(status=428,description="Chave obrigatória")))]
pub async fn transfer(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<TransferInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "finance.account_transfers.read",
        "finance.account_transfers.manage",
        true,
    )
    .await?;
    let Json(mut input) = payload
        .map_err(|_| DomainError::Invalid("Transferência inválida ou campos desconhecidos"))?;
    if input.source_account_id == input.target_account_id {
        return Err(DomainError::Invalid(
            "A conta de origem e destino devem ser diferentes",
        ));
    }
    let amount = fixed(&input.amount, 2)?;
    if amount <= 0 {
        return Err(DomainError::Invalid("Transferência exige valor positivo"));
    }
    let occurred_on = sales::date(&input.occurred_on)?;
    input.description = text(&input.description, 3, 200)?;
    input.reference = input
        .reference
        .as_deref()
        .map(|v| text(v, 1, 200))
        .transpose()?;
    let request = json!({"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "financial_account_transfer.create",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, None, previous));
    }
    let statuses: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id,status FROM financial_accounts WHERE tenant_id=$1 AND id=ANY($2)",
    )
    .bind(tenant)
    .bind(vec![input.source_account_id, input.target_account_id])
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    if statuses.len() != 2 {
        return Err(DomainError::NotFound);
    }
    if statuses.iter().any(|(_, status)| status != "active") {
        return Err(DomainError::Conflict(
            "As duas contas da transferência devem estar ativas",
        ));
    }
    require_unmanaged_cash_account(&mut tx, tenant, input.source_account_id).await?;
    require_unmanaged_cash_account(&mut tx, tenant, input.target_account_id).await?;
    let transfer_id = Uuid::now_v7();
    let source_entry_id = Uuid::now_v7();
    let target_entry_id = Uuid::now_v7();
    sqlx::query("INSERT INTO financial_account_transfers(id,tenant_id,source_account_id,target_account_id,amount_cents,occurred_on,description,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(transfer_id).bind(tenant).bind(input.source_account_id).bind(input.target_account_id).bind(amount).bind(occurred_on).bind(&input.description).bind(&input.reference).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO financial_account_entries(id,tenant_id,account_id,transfer_id,direction,amount_cents,occurred_on,description,reference) VALUES($1,$2,$3,$4,'debit',$5,$6,$7,$8),($9,$2,$10,$4,'credit',$5,$6,$7,$8)")
        .bind(source_entry_id).bind(tenant).bind(input.source_account_id).bind(transfer_id).bind(amount).bind(occurred_on).bind(&input.description).bind(&input.reference)
        .bind(target_entry_id).bind(input.target_account_id).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "financial_account_transfer", id: transfer_id, event: "financial_account_transfer.created", details: json!({"sourceAccountId":input.source_account_id,"targetAccountId":input.target_account_id,"amount":decimal(amount,2),"sourceEntryId":source_entry_id,"targetEntryId":target_entry_id}) }).await?;
    let value = json!(TransferSnapshot {
        tenant_id: tenant,
        transfer_id,
        source_entry_id,
        target_entry_id,
        amount: decimal(amount, 2)
    });
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "financial_account_transfer.create",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, None, value))
}
