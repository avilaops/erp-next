use super::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    revision, sales,
};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

const MANAGE: &str = "platform.company.manage";

#[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FixedExpenseInput {
    description: String,
    category_id: Uuid,
    amount_cents: i64,
    starts_on: String,
    ends_on: Option<String>,
    status: String,
}

impl FixedExpenseInput {
    fn validate(&self) -> Result<(time::Date, Option<time::Date>), DomainError> {
        if !(3..=200).contains(&self.description.trim().chars().count())
            || !(0..=1_000_000_000_000).contains(&self.amount_cents)
            || !matches!(self.status.as_str(), "active" | "archived")
        {
            return Err(DomainError::Invalid(
                "Descrição, valor ou situação inválidos",
            ));
        }
        let start = sales::date(&self.starts_on)?;
        let end = self
            .ends_on
            .as_ref()
            .map(|value| sales::date(value))
            .transpose()?;
        if end.is_some_and(|date| date < start) {
            return Err(DomainError::Invalid("A data final antecede a inicial"));
        }
        Ok((start, end))
    }
}

pub(crate) async fn monthly_total(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<i64, DomainError> {
    sqlx::query_scalar("SELECT COALESCE(SUM(amount_cents),0)::bigint FROM fixed_expenses WHERE tenant_id=$1 AND status='active' AND starts_on <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date AND (ends_on IS NULL OR ends_on >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)")
        .bind(tenant).fetch_one(&mut **tx).await.map_err(db)
}

async fn detail(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Value, DomainError> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',e.id,'description',e.description,'categoryId',e.category_id,'categoryName',c.name,'amountCents',e.amount_cents,'startsOn',e.starts_on,'endsOn',e.ends_on,'status',e.status,'revision',e.revision) FROM fixed_expenses e JOIN financial_categories c ON c.tenant_id=e.tenant_id AND c.id=e.category_id WHERE e.tenant_id=$1 AND e.id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}

#[utoipa::path(get,path="/api/v1/fixed-expenses",operation_id="list_fixed_expenses",tag="Finance",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value)))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, MANAGE, MANAGE, false).await?;
    let data: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',e.id,'description',e.description,'categoryId',e.category_id,'categoryName',c.name,'amountCents',e.amount_cents,'startsOn',e.starts_on,'endsOn',e.ends_on,'status',e.status,'revision',e.revision) FROM fixed_expenses e JOIN financial_categories c ON c.tenant_id=e.tenant_id AND c.id=e.category_id WHERE e.tenant_id=$1 ORDER BY e.description,e.id LIMIT 1001")
        .bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    if data.len() > 1000 {
        return Err(DomainError::Invalid("Limite de 1000 despesas por empresa"));
    }
    let monthly = monthly_total(&mut tx, tenant).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data,"monthlyExpensesCents":monthly}),
    ))
}

async fn save(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Option<Uuid>,
    payload: Result<Json<FixedExpenseInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, MANAGE, MANAGE, true).await?;
    let key = command_key(&headers)?;
    let expected = id.map(|_| revision(&headers)).transpose()?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("Despesa inválida ou campos desconhecidos"))?;
    input.description = input.description.trim().to_owned();
    let (start, end) = input.validate()?;
    let scope = if id.is_some() {
        "fixed_expense.update"
    } else {
        "fixed_expense.create"
    };
    let request = json!({"id":id,"revision":expected,"input":input});
    if let Some(value) = replay(&mut tx, tenant, &identity.subject, key, scope, &request).await? {
        tx.commit().await.map_err(db)?;
        return Ok(response(
            if id.is_some() {
                StatusCode::OK
            } else {
                StatusCode::CREATED
            },
            value["data"]["revision"].as_i64(),
            value,
        ));
    }
    let category: Option<String> = sqlx::query_scalar("SELECT name FROM financial_categories WHERE tenant_id=$1 AND id=$2 AND direction='expense' AND status='active'")
        .bind(tenant).bind(input.category_id).fetch_optional(&mut *tx).await.map_err(db)?;
    if category.is_none() {
        return Err(DomainError::Conflict(
            "Selecione uma categoria de despesa ativa",
        ));
    }
    let expense_id = id.unwrap_or_else(Uuid::now_v7);
    let next = if id.is_some() {
        let current: i64 =
            sqlx::query_scalar("SELECT revision FROM fixed_expenses WHERE tenant_id=$1 AND id=$2")
                .bind(tenant)
                .bind(expense_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db)?
                .ok_or(DomainError::NotFound)?;
        if Some(current) != expected {
            return Err(DomainError::StaleRevision);
        }
        current
            .checked_add(1)
            .ok_or(DomainError::Invalid("Revisão fora do limite"))?
    } else {
        1
    };
    if id.is_some() {
        sqlx::query("UPDATE fixed_expenses SET description=$3,category_id=$4,amount_cents=$5,starts_on=$6,ends_on=$7,status=$8,revision=$9,updated_at=now() WHERE tenant_id=$1 AND id=$2")
            .bind(tenant).bind(expense_id).bind(&input.description).bind(input.category_id).bind(input.amount_cents).bind(start).bind(end).bind(&input.status).bind(next).execute(&mut *tx).await.map_err(db)?;
    } else {
        sqlx::query("INSERT INTO fixed_expenses(id,tenant_id,description,category_id,amount_cents,starts_on,ends_on,status,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)")
            .bind(expense_id).bind(tenant).bind(&input.description).bind(input.category_id).bind(input.amount_cents).bind(start).bind(end).bind(&input.status).execute(&mut *tx).await.map_err(db)?;
    }
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "fixed_expense",
            id: expense_id,
            event: if id.is_some() {
                "fixed_expense.updated"
            } else {
                "fixed_expense.created"
            },
            details: json!({"revision":next,"status":input.status}),
        },
    )
    .await?;
    let value = json!({"tenantId":tenant,"data":detail(&mut tx,tenant,expense_id).await?});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        scope,
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        if id.is_some() {
            StatusCode::OK
        } else {
            StatusCode::CREATED
        },
        Some(next),
        value,
    ))
}

#[utoipa::path(post,path="/api/v1/fixed-expenses",operation_id="create_fixed_expense",tag="Finance",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),request_body=FixedExpenseInput,responses((status=201,body=Value)))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<FixedExpenseInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    save(state, identity, headers, None, payload).await
}

#[utoipa::path(put,path="/api/v1/fixed-expenses/{id}",operation_id="update_fixed_expense",tag="Finance",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),request_body=FixedExpenseInput,responses((status=200,body=Value)))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    payload: Result<Json<FixedExpenseInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    save(state, identity, headers, Some(id), payload).await
}
