use crate::domains::{DomainChange, DomainError, db, decimal, fixed, record, response, revision};
use crate::platform::{access, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SalesSettingsInput {
    minimum_order_amount: String,
    maximum_payment_term_days: u16,
    require_customer_contact: bool,
}

impl SalesSettingsInput {
    fn validate(&self) -> Result<i64, DomainError> {
        let amount = fixed(&self.minimum_order_amount, 2)?;
        if amount > 99_999_999_999_999 || self.maximum_payment_term_days > 3650 {
            return Err(DomainError::Invalid(
                "Valor mínimo ou prazo fora do limite permitido",
            ));
        }
        Ok(amount)
    }
}

#[derive(FromRow)]
struct SettingsRow {
    revision: i64,
    minimum_order_amount_cents: i64,
    maximum_payment_term_days: i32,
    require_customer_contact: bool,
}

impl SettingsRow {
    fn data(&self) -> SalesSettingsInput {
        SalesSettingsInput {
            minimum_order_amount: decimal(self.minimum_order_amount_cents, 2),
            maximum_payment_term_days: self.maximum_payment_term_days as u16,
            require_customer_contact: self.require_customer_contact,
        }
    }
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SalesSettingsSnapshot {
    tenant_id: Uuid,
    revision: i64,
    can_edit: bool,
    data: Option<SalesSettingsInput>,
}

async fn transaction<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
    identity: &AuthenticatedIdentity,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>, bool), DomainError> {
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
    let can_edit = access::require_permission(&member, "platform.company.manage").is_ok();
    if write {
        access::require_permission(&member, "platform.company.manage")?;
    } else if !can_edit
        && !["platform.company.read", "sales.orders.read"]
            .iter()
            .any(|permission| access::require_permission(&member, permission).is_ok())
    {
        return Err(access::AccessError::Forbidden.into());
    }
    Ok((tenant, tx, can_edit))
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<Option<SettingsRow>, DomainError> {
    sqlx::query_as("SELECT revision,minimum_order_amount_cents,maximum_payment_term_days,require_customer_contact FROM sales_settings WHERE tenant_id=$1")
        .bind(tenant).fetch_optional(&mut **tx).await.map_err(db)
}

#[utoipa::path(get,path="/api/v1/sales-settings",operation_id="get_sales_settings",tag="Sales",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=SalesSettingsSnapshot),(status=403,description="Sem acesso à configuração")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = transaction(&state, &headers, &identity, false).await?;
    let row = load(&mut tx, tenant).await?;
    let current = row.as_ref().map_or(1, |row| row.revision);
    let data = row.as_ref().map(SettingsRow::data);
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(current),
        SalesSettingsSnapshot {
            tenant_id: tenant,
            revision: current,
            can_edit,
            data,
        },
    ))
}

#[utoipa::path(put,path="/api/v1/sales-settings",operation_id="put_sales_settings",tag="Sales",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),request_body=SalesSettingsInput,responses((status=200,body=SalesSettingsSnapshot),(status=403,description="Exige gestão da empresa"),(status=412,description="Revisão alterada"),(status=422,description="Configuração inválida"),(status=428,description="Revisão obrigatória")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<SalesSettingsInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let Json(input) = payload.map_err(|_| {
        DomainError::Invalid("Preencha os três parâmetros, sem campos desconhecidos")
    })?;
    let amount = input.validate()?;
    let (tenant, mut tx, can_edit) = transaction(&state, &headers, &identity, true).await?;
    let previous = load(&mut tx, tenant).await?;
    let current = previous.as_ref().map_or(1, |row| row.revision);
    if expected != current {
        return Err(DomainError::StaleRevision);
    }
    let next = current
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    sqlx::query("INSERT INTO sales_settings(tenant_id,minimum_order_amount_cents,maximum_payment_term_days,require_customer_contact,revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id) DO UPDATE SET minimum_order_amount_cents=$2,maximum_payment_term_days=$3,require_customer_contact=$4,revision=$5,updated_at=now()")
        .bind(tenant).bind(amount).bind(i32::from(input.maximum_payment_term_days)).bind(input.require_customer_contact).bind(next).execute(&mut *tx).await.map_err(db)?;
    let data = SalesSettingsInput {
        minimum_order_amount: decimal(amount, 2),
        ..input
    };
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "sales_settings", id: tenant, event: "sales.settings.updated", details: serde_json::json!({"previousRevision":current,"revision":next,"previous":previous.as_ref().map(SettingsRow::data),"data":data}) }).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        SalesSettingsSnapshot {
            tenant_id: tenant,
            revision: next,
            can_edit,
            data: Some(data),
        },
    ))
}

pub(super) async fn validate_confirmation(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: &super::OrderSnapshot,
) -> Result<(), DomainError> {
    let Some(settings) = load(tx, tenant).await? else {
        return Ok(());
    };
    if fixed(&order.data.amount, 2)? < settings.minimum_order_amount_cents {
        return Err(DomainError::Conflict(
            "Pedido abaixo do valor mínimo configurado em Preferências / Vendas",
        ));
    }
    let due = super::date(&order.data.due_date)?;
    let within_term: bool = sqlx::query_scalar("SELECT $1::date <= (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date + $2::integer")
        .bind(due).bind(settings.maximum_payment_term_days).fetch_one(&mut **tx).await.map_err(db)?;
    if !within_term {
        return Err(DomainError::Conflict(
            "Vencimento excede o prazo máximo configurado em Preferências / Vendas",
        ));
    }
    if settings.require_customer_contact {
        let contact: bool = sqlx::query_scalar("SELECT NULLIF(btrim(email),'') IS NOT NULL OR NULLIF(btrim(phone),'') IS NOT NULL FROM parties WHERE tenant_id=$1 AND id=$2")
            .bind(tenant).bind(order.data.customer_id).fetch_one(&mut **tx).await.map_err(db)?;
        if !contact {
            return Err(DomainError::Conflict(
                "Preencha e-mail ou telefone no cadastro do cliente antes de confirmar o pedido",
            ));
        }
    }
    Ok(())
}
