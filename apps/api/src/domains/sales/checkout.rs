//! Immutable negotiated conditions and the planned titles created on confirmation.
//! No payment, bank operation or production activation is performed here.
use crate::domains::{DomainChange, DomainError, db, decimal, record};
use crate::platform::auth::AuthenticatedIdentity;
use axum::http::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckoutEntryInput {
    pub payment_method_id: Option<Uuid>,
    pub due_on: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckoutInstallmentInput {
    pub payment_method_id: Uuid,
    pub due_on: String,
    pub amount_cents: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckoutInput {
    pub entry: CheckoutEntryInput,
    pub installments: Vec<CheckoutInstallmentInput>,
    pub manufacturing_days: Option<u16>,
    pub delivery_notes: String,
    pub payment_notes: String,
    pub notes: String,
    #[serde(default)]
    pub state_registration: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutPaymentMethod {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub modality: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutEntrySnapshot {
    pub amount_cents: i64,
    pub payment_method_id: Option<Uuid>,
    pub payment_method: Option<CheckoutPaymentMethod>,
    pub due_on: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutInstallmentSnapshot {
    pub id: Uuid,
    pub number: i32,
    pub payment_method_id: Uuid,
    pub payment_method: CheckoutPaymentMethod,
    pub due_on: String,
    pub amount_cents: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutSnapshot {
    pub confirmation_creates_receivables: bool,
    pub entry: CheckoutEntrySnapshot,
    pub installments: Vec<CheckoutInstallmentSnapshot>,
    pub manufacturing_days: Option<u16>,
    pub delivery_notes: String,
    pub payment_notes: String,
    pub notes: String,
    pub customer: Value,
    pub state_registration: Option<String>,
}

fn text(raw: &str, limit: usize) -> Result<String, DomainError> {
    let value = raw.trim();
    if value.chars().count() > limit
        || value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(DomainError::Invalid(
            "Observações excedem o limite ou contêm caracteres inválidos",
        ));
    }
    Ok(value.to_owned())
}

async fn method(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<CheckoutPaymentMethod, DomainError> {
    let value: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'code',code,'name',name,'modality',modality) FROM payment_methods WHERE tenant_id=$1 AND id=$2 AND status='active'")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?;
    serde_json::from_value(value.ok_or(DomainError::Invalid(
        "Selecione uma forma de pagamento ativa desta empresa",
    ))?)
    .map_err(|_| crate::platform::access::AccessError::Internal.into())
}

pub async fn save(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
    customer: Uuid,
    total_cents: i64,
    entry_cents: i64,
    input: &CheckoutInput,
) -> Result<(), DomainError> {
    if !(1..=99_999_999_999_999).contains(&total_cents)
        || entry_cents < 0
        || entry_cents > total_cents
        || input.installments.len() > 120
    {
        return Err(DomainError::Invalid(
            "Confira total, entrada e quantidade de parcelas",
        ));
    }
    if input.manufacturing_days.is_some_and(|days| days > 3650) {
        return Err(DomainError::Invalid(
            "Prazo de fabricação deve ter até 3650 dias",
        ));
    }
    let delivery_notes = text(&input.delivery_notes, 2000)?;
    let payment_notes = text(&input.payment_notes, 2000)?;
    let notes = text(&input.notes, 10000)?;
    let state_registration = input
        .state_registration
        .as_deref()
        .map(|value| text(value, 40))
        .transpose()?
        .filter(|value| !value.is_empty());
    if state_registration
        .as_deref()
        .is_some_and(|value| value.chars().any(char::is_control))
    {
        return Err(DomainError::Invalid(
            "Inscrição estadual contém caracteres inválidos",
        ));
    }
    let entry_due = input.entry.due_on.as_deref().map(super::date).transpose()?;
    let mut sum = i128::from(entry_cents);
    let mut prepared = Vec::with_capacity(input.installments.len() + 1);
    let entry_method = if let Some(id) = input.entry.payment_method_id {
        Some(method(tx, tenant, id).await?)
    } else {
        None
    };
    if entry_cents > 0 {
        let selected = entry_method.clone().ok_or(DomainError::Invalid(
            "Informe a forma de pagamento da entrada",
        ))?;
        prepared.push((0_i32, "entry", entry_due, entry_cents, selected));
    }
    for (index, item) in input.installments.iter().enumerate() {
        if !(1..=99_999_999_999_999).contains(&item.amount_cents) {
            return Err(DomainError::Invalid(
                "Toda parcela exige valor positivo em centavos",
            ));
        }
        sum += i128::from(item.amount_cents);
        prepared.push((
            (index + 1) as i32,
            "balance",
            Some(super::date(&item.due_on)?),
            item.amount_cents,
            method(tx, tenant, item.payment_method_id).await?,
        ));
    }
    if sum != i128::from(total_cents) {
        return Err(DomainError::Invalid(
            "Entrada e parcelas devem somar exatamente o total do pedido",
        ));
    }
    let matches: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sales_orders WHERE tenant_id=$1 AND id=$2 AND customer_id=$3 AND status='draft' AND amount_cents=$4)")
        .bind(tenant).bind(order).bind(customer).bind(total_cents).fetch_one(&mut **tx).await.map_err(db)?;
    if !matches {
        return Err(DomainError::Conflict(
            "Condições exigem o rascunho e total atuais deste cliente",
        ));
    }
    let customer_snapshot: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'revision',revision,'personType',person_type,'legalName',legal_name,'tradeName',trade_name,'taxId',tax_id,'email',email,'phone',phone,'addresses',addresses,'contacts',contacts) FROM parties WHERE tenant_id=$1 AND id=$2 AND status='active' AND is_customer")
        .bind(tenant).bind(customer).fetch_optional(&mut **tx).await.map_err(db)?;
    let mut customer_snapshot = customer_snapshot.ok_or(DomainError::Conflict(
        "Selecione um cliente ativo desta empresa",
    ))?;
    customer_snapshot["stateRegistration"] = json!(state_registration);
    sqlx::query("INSERT INTO sales_order_checkouts(tenant_id,order_id,customer_snapshot,entry_amount_cents,entry_payment_method_id,entry_payment_method,entry_due_on,manufacturing_days,delivery_notes,payment_notes,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(tenant).bind(order).bind(customer_snapshot).bind(entry_cents).bind(input.entry.payment_method_id).bind(entry_method.as_ref().map(|v|json!(v))).bind(entry_due).bind(input.manufacturing_days.map(i32::from)).bind(delivery_notes).bind(payment_notes).bind(notes).execute(&mut **tx).await.map_err(db)?;
    for (number, kind, due, amount, selected) in prepared {
        sqlx::query("INSERT INTO sales_order_installments(id,tenant_id,order_id,number,kind,payment_method_id,payment_method,due_on,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(Uuid::now_v7()).bind(tenant).bind(order).bind(number).bind(kind).bind(selected.id).bind(json!(selected)).bind(due).bind(amount).execute(&mut **tx).await.map_err(db)?;
    }
    Ok(())
}

#[derive(FromRow)]
struct Saved {
    customer_snapshot: Value,
    entry_amount_cents: i64,
    entry_payment_method_id: Option<Uuid>,
    entry_payment_method: Option<Value>,
    entry_due_on: Option<String>,
    manufacturing_days: Option<i32>,
    delivery_notes: String,
    payment_notes: String,
    notes: String,
}
#[derive(FromRow)]
struct Installment {
    id: Uuid,
    number: i32,
    payment_method_id: Uuid,
    payment_method: Value,
    due_on: Option<String>,
    amount_cents: i64,
}

pub async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<Option<CheckoutSnapshot>, DomainError> {
    let saved: Option<Saved> = sqlx::query_as("SELECT customer_snapshot,entry_amount_cents,entry_payment_method_id,entry_payment_method,entry_due_on::text,manufacturing_days,delivery_notes,payment_notes,notes FROM sales_order_checkouts WHERE tenant_id=$1 AND order_id=$2")
        .bind(tenant).bind(order).fetch_optional(&mut **tx).await.map_err(db)?;
    let Some(saved) = saved else { return Ok(None) };
    let rows: Vec<Installment> = sqlx::query_as("SELECT id,number,payment_method_id,payment_method,due_on::text,amount_cents FROM sales_order_installments WHERE tenant_id=$1 AND order_id=$2 ORDER BY number")
        .bind(tenant).bind(order).fetch_all(&mut **tx).await.map_err(db)?;
    let mut due = saved.entry_due_on;
    let mut installments = Vec::new();
    for row in rows {
        if row.number == 0 {
            due = row.due_on;
            continue;
        }
        installments.push(CheckoutInstallmentSnapshot {
            id: row.id,
            number: row.number,
            payment_method_id: row.payment_method_id,
            payment_method: serde_json::from_value(row.payment_method)
                .map_err(|_| crate::platform::access::AccessError::Internal)?,
            due_on: row
                .due_on
                .ok_or(crate::platform::access::AccessError::Internal)?,
            amount_cents: row.amount_cents,
        });
    }
    let state_registration = saved.customer_snapshot["stateRegistration"]
        .as_str()
        .map(str::to_owned);
    Ok(Some(CheckoutSnapshot {
        confirmation_creates_receivables: true,
        entry: CheckoutEntrySnapshot {
            amount_cents: saved.entry_amount_cents,
            payment_method_id: saved.entry_payment_method_id,
            payment_method: saved
                .entry_payment_method
                .map(serde_json::from_value)
                .transpose()
                .map_err(|_| crate::platform::access::AccessError::Internal)?,
            due_on: due,
        },
        installments,
        manufacturing_days: saved.manufacturing_days.map(|v| v as u16),
        delivery_notes: saved.delivery_notes,
        payment_notes: saved.payment_notes,
        notes: saved.notes,
        customer: saved.customer_snapshot,
        state_registration,
    }))
}

pub(crate) async fn exists(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<bool, DomainError> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sales_order_checkouts WHERE tenant_id=$1 AND order_id=$2)",
    )
    .bind(tenant)
    .bind(order)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)
}

/// The authorized sales orchestrator owns this transaction and the order revision.
pub(super) async fn confirm(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
) -> Result<(), DomainError> {
    if !exists(tx, tenant, order).await? {
        return Ok(());
    }
    let existing: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM receivables WHERE tenant_id=$1 AND order_id=$2)",
    )
    .bind(tenant)
    .bind(order)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    if existing {
        return Err(DomainError::Conflict(
            "Pedido já possui títulos; concilie antes de confirmar",
        ));
    }
    sqlx::query("UPDATE sales_order_installments SET due_on=(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date WHERE tenant_id=$1 AND order_id=$2 AND kind='entry' AND due_on IS NULL")
        .bind(tenant).bind(order).execute(&mut **tx).await.map_err(db)?;
    let rows:Vec<(Uuid,time::Date,i64,String)>=sqlx::query_as("SELECT i.id,i.due_on,i.amount_cents,c.customer_snapshot->>'legalName' FROM sales_order_installments i JOIN sales_order_checkouts c ON c.tenant_id=i.tenant_id AND c.order_id=i.order_id WHERE i.tenant_id=$1 AND i.order_id=$2 ORDER BY i.number")
        .bind(tenant).bind(order).fetch_all(&mut **tx).await.map_err(db)?;
    for (installment, due, amount, customer) in rows {
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO receivables(id,tenant_id,order_id,order_installment_id,customer_name,due_date,amount_cents,status) VALUES($1,$2,$3,$4,$5,$6,$7,'open')")
            .bind(id).bind(tenant).bind(order).bind(installment).bind(customer).bind(due).bind(amount).execute(&mut **tx).await.map_err(db)?;
        record(tx,tenant,identity,headers,DomainChange {kind:"receivable",id,event:"receivable.created",details:json!({"orderId":order,"orderInstallmentId":installment,"amount":decimal(amount,2),"revision":1,"source":"confirmed_order_schedule"})}).await?;
    }
    verify_receivables(tx, tenant, order).await
}

pub(crate) async fn verify_receivables(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<(), DomainError> {
    let valid:bool=sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM sales_order_installments i LEFT JOIN receivables r ON r.tenant_id=i.tenant_id AND r.order_id=i.order_id AND r.order_installment_id=i.id WHERE i.tenant_id=$1 AND i.order_id=$2 AND (r.id IS NULL OR r.status='cancelled' OR r.amount_cents<>i.amount_cents OR r.due_date<>i.due_on)) AND NOT EXISTS(SELECT 1 FROM receivables WHERE tenant_id=$1 AND order_id=$2 AND order_installment_id IS NULL) AND (SELECT sum(amount_cents) FROM sales_order_installments WHERE tenant_id=$1 AND order_id=$2)=(SELECT amount_cents FROM sales_orders WHERE tenant_id=$1 AND id=$2)")
        .bind(tenant).bind(order).fetch_one(&mut **tx).await.map_err(db)?;
    if !valid {
        return Err(DomainError::Conflict(
            "Concilie os títulos das parcelas antes de concluir o pedido",
        ));
    }
    Ok(())
}

pub(super) async fn cancel_unpaid(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
) -> Result<(), DomainError> {
    if !exists(tx, tenant, order).await? {
        return Ok(());
    }
    let has_receipts:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM receivables r JOIN receivable_payments p ON p.tenant_id=r.tenant_id AND p.receivable_id=r.id WHERE r.tenant_id=$1 AND r.order_id=$2 AND p.kind='receipt' AND NOT EXISTS(SELECT 1 FROM receivable_payments reversed WHERE reversed.tenant_id=p.tenant_id AND reversed.reverses_id=p.id))")
        .bind(tenant).bind(order).fetch_one(&mut **tx).await.map_err(db)?;
    if has_receipts {
        return Err(DomainError::Conflict(
            "Há recebimentos nas parcelas. Registre os estornos explicitamente antes de cancelar",
        ));
    }
    let rows:Vec<(Uuid,i64)>=sqlx::query_as("SELECT id,revision FROM receivables WHERE tenant_id=$1 AND order_id=$2 AND status<>'cancelled' ORDER BY id FOR UPDATE")
        .bind(tenant).bind(order).fetch_all(&mut **tx).await.map_err(db)?;
    for (id, revision) in rows {
        sqlx::query("UPDATE receivables SET status='cancelled',payment_id=NULL,revision=revision+1 WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).execute(&mut **tx).await.map_err(db)?;
        record(tx,tenant,identity,headers,DomainChange {kind:"receivable",id,event:"receivable.cancelled",details:json!({"orderId":order,"previousRevision":revision,"revision":revision+1,"source":"unshipped_order_cancellation","outstandingAmount":"0.00"})}).await?;
    }
    Ok(())
}
