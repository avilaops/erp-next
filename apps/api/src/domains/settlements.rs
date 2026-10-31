//! Shared payment/reversal rules. SQL identifiers come only from the closed ledger kind.
use super::{
    DomainChange, DomainError, authorized, command_key, db, decimal,
    finance::{Payment, PaymentInput, ReversalInput},
    fixed, record, remember, replay, response, revision, sales,
};
use crate::platform::{access::AccessError, auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Json,
    extract::rejection::JsonRejection,
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(Clone, Copy)]
pub(super) enum Kind {
    Receivable,
    Payable,
}
impl Kind {
    fn permissions(self) -> (&'static str, &'static str) {
        match self {
            Self::Receivable => ("finance.receivables.read", "finance.receivables.manage"),
            Self::Payable => ("finance.payables.read", "finance.payables.manage"),
        }
    }
    fn names(self) -> (&'static str, &'static str, &'static str, &'static str) {
        match self {
            Self::Receivable => (
                "receivables",
                "receivable_payments",
                "receivable_id",
                "receipt",
            ),
            Self::Payable => ("payables", "payable_payments", "payable_id", "payment"),
        }
    }
    fn scope(self, reversing: bool) -> &'static str {
        match (self, reversing) {
            (Self::Receivable, false) => "receivable.pay",
            (Self::Receivable, true) => "receivable.reverse",
            (Self::Payable, false) => "payable.pay",
            (Self::Payable, true) => "payable.reverse",
        }
    }
    fn entity(self) -> &'static str {
        match self {
            Self::Receivable => "receivable",
            Self::Payable => "payable",
        }
    }
    fn event(self, paid: bool, reversing: bool) -> &'static str {
        match (self, paid, reversing) {
            (Self::Receivable, _, true) => "receivable.payment_reversed",
            (Self::Receivable, true, false) => "receivable.paid",
            (Self::Receivable, false, false) => "receivable.payment_recorded",
            (Self::Payable, _, true) => "payable.payment_reversed",
            (Self::Payable, true, false) => "payable.paid",
            (Self::Payable, false, false) => "payable.payment_recorded",
        }
    }
    async fn load(
        self,
        tx: &mut Transaction<'_, Postgres>,
        tenant: Uuid,
        id: Uuid,
    ) -> Result<Snapshot, DomainError> {
        match self {
            Self::Receivable => super::finance::settlement_snapshot(tx, tenant, id).await,
            Self::Payable => super::payables::settlement_snapshot(tx, tenant, id).await,
        }
    }
}

pub(super) struct Snapshot {
    pub value: Value,
    pub revision: i64,
    pub status: String,
    pub outstanding: i64,
    pub settled: i64,
    pub payments: Vec<Payment>,
}

pub(super) fn reference(raw: &str) -> Result<String, DomainError> {
    let value = raw.trim();
    if !(3..=200).contains(&value.chars().count()) || value.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Referência ou motivo exige de 3 a 200 caracteres sem controles",
        ));
    }
    Ok(value.to_owned())
}

pub(super) async fn pay(
    kind: Kind,
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Uuid,
    payload: Result<Json<PaymentInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (read, manage) = kind.permissions();
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, read, manage, true).await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let amount = fixed(&input.amount, 2)?;
    if amount <= 0 {
        return Err(DomainError::Invalid(
            "Pagamento ou recebimento exige valor positivo",
        ));
    }
    let occurred = sales::date(&input.occurred_on)?;
    input.reference = reference(&input.reference)?;
    if !["cash", "bank_transfer", "card", "other"].contains(&input.method.as_str()) {
        return Err(DomainError::Invalid(
            "Meio de pagamento ou recebimento inválido",
        ));
    }
    let request = json!({"id":id,"revision":expected,"input":input});
    let scope = kind.scope(false);
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, scope, &request).await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, previous));
    }
    let current = kind.load(&mut tx, tenant, id).await?;
    if current.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if current.status != "open" || amount > current.outstanding {
        return Err(DomainError::Conflict(
            "Valor não pode ultrapassar o saldo de uma conta em aberto",
        ));
    }
    let remaining = current
        .outstanding
        .checked_sub(amount)
        .ok_or(AccessError::Internal)?;
    let paid = remaining == 0;
    let payment = Uuid::now_v7();
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    let (accounts, entries, foreign, positive) = kind.names();
    sqlx::query(&format!("INSERT INTO {entries}(id,tenant_id,{foreign},kind,amount_cents,method,reference,occurred_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8)"))
        .bind(payment).bind(tenant).bind(id).bind(positive).bind(amount).bind(&input.method).bind(&input.reference).bind(occurred).execute(&mut *tx).await.map_err(db)?;
    sqlx::query(&format!(
        "UPDATE {accounts} SET status=$3,payment_id=$4,revision=$5 WHERE tenant_id=$1 AND id=$2"
    ))
    .bind(tenant)
    .bind(id)
    .bind(if paid { "paid" } else { "open" })
    .bind(paid.then_some(payment))
    .bind(next)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:kind.entity(),id,event:kind.event(paid,false),details:json!({"paymentId":payment,"amount":decimal(amount,2),"outstandingAmount":decimal(remaining,2),"previousRevision":expected,"revision":next,"source":"manual_declaration"})}).await?;
    let result = kind.load(&mut tx, tenant, id).await?.value;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        scope,
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}

pub(super) async fn reverse(
    kind: Kind,
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Uuid,
    payload: Result<Json<ReversalInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (read, manage) = kind.permissions();
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, read, manage, true).await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    input.reason = reference(&input.reason)?;
    let occurred = sales::date(&input.occurred_on)?;
    let request = json!({"id":id,"revision":expected,"input":input});
    let scope = kind.scope(true);
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, scope, &request).await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, previous));
    }
    let current = kind.load(&mut tx, tenant, id).await?;
    if current.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if current.status == "cancelled" {
        return Err(DomainError::Conflict(
            "Título cancelado não admite novos estornos",
        ));
    }
    if current
        .payments
        .iter()
        .any(|p| p.reverses_id == Some(input.payment_id))
    {
        return Err(DomainError::Conflict(
            "Este pagamento ou recebimento já foi estornado",
        ));
    }
    let (_, _, _, positive) = kind.names();
    let original = current
        .payments
        .iter()
        .find(|p| p.id == input.payment_id && p.kind == positive)
        .ok_or(DomainError::Conflict(
            "Selecione um lançamento ativo desta conta para estornar",
        ))?;
    let amount = fixed(&original.amount, 2)?;
    if amount > current.settled {
        return Err(AccessError::Internal.into());
    }
    if occurred < sales::date(&original.occurred_on)? {
        return Err(DomainError::Invalid(
            "Estorno não pode anteceder o lançamento original",
        ));
    }
    let payment = Uuid::now_v7();
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    let (accounts, entries, foreign, _) = kind.names();
    sqlx::query(&format!("INSERT INTO {entries}(id,tenant_id,{foreign},kind,amount_cents,method,reference,occurred_on,reverses_id) VALUES($1,$2,$3,'reversal',$4,$5,$6,$7,$8)"))
        .bind(payment).bind(tenant).bind(id).bind(amount).bind(&original.method).bind(&input.reason).bind(occurred).bind(input.payment_id).execute(&mut *tx).await.map_err(db)?;
    sqlx::query(&format!("UPDATE {accounts} SET status='open',payment_id=NULL,revision=$3 WHERE tenant_id=$1 AND id=$2")).bind(tenant).bind(id).bind(next).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:kind.entity(),id,event:kind.event(false,true),details:json!({"paymentId":payment,"reversesId":input.payment_id,"previousRevision":expected,"revision":next})}).await?;
    let result = kind.load(&mut tx, tenant, id).await?.value;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        scope,
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}
