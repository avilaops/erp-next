//! Full commercial reversals. All effects share the tenant write lock and transaction.
use super::{
    DomainChange, DomainError, authorized, command_key, db, decimal, record, remember, replay,
    response, revision, sales,
};
use crate::platform::{
    access::{self, AccessError},
    auth::AuthenticatedIdentity,
    state::AppState,
};
use axum::{
    Extension, Json, Router,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReturnInput {
    reason: String,
    occurred_on: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReturnResult {
    tenant_id: Uuid,
    data: Value,
}

#[derive(Clone, Copy)]
enum Kind {
    Sale,
    Purchase,
}

impl Kind {
    fn names(self) -> (&'static str, &'static str, &'static str, &'static str) {
        match self {
            Self::Sale => (
                "sales_order_cancellations",
                "order_id",
                "sales_order",
                "sales.order.cancelled_completed",
            ),
            Self::Purchase => (
                "purchase_receipt_reversals",
                "receipt_id",
                "purchase_receipt",
                "purchase.receipt.reversed",
            ),
        }
    }
    fn permissions(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::Sale => (
                "sales.orders.read",
                "sales.orders.manage",
                "finance.receivables.manage",
            ),
            Self::Purchase => (
                "purchasing.orders.read",
                "purchasing.orders.manage",
                "finance.payables.manage",
            ),
        }
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/orders/{id}/cancel-completed",
            post(cancel_completed),
        )
        .route("/api/v1/orders/{id}/cancellations", get(sale_history))
        .route(
            "/api/v1/purchase-receipts/{id}/reverse",
            post(reverse_receipt),
        )
        .route(
            "/api/v1/purchase-receipts/{id}/reversals",
            get(purchase_history),
        )
}

fn validated(input: &ReturnInput) -> Result<time::Date, DomainError> {
    if !(15..=200).contains(&input.reason.trim().chars().count())
        || input.reason.chars().any(char::is_control)
    {
        return Err(DomainError::Invalid(
            "Motivo exige de 15 a 200 caracteres sem controles",
        ));
    }
    sales::date(&input.occurred_on)
}

#[derive(FromRow)]
struct OriginalMovement {
    id: Uuid,
    product_id: Uuid,
    quantity_micros: i64,
}

/// Only original delivery/receipt movements are selected. Compensations point to
/// them through reverses_id, preserving the original source and uniqueness rules.
async fn reverse_stock(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    source: Uuid,
    kind: Kind,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    reason: &str,
) -> Result<Vec<Uuid>, DomainError> {
    let (column, original_direction, inverse) = match kind {
        Kind::Sale => ("source_order_id", "issue", "receipt"),
        Kind::Purchase => ("source_purchase_receipt_id", "receipt", "issue"),
    };
    let originals=sqlx::query_as::<_, OriginalMovement>(&format!("SELECT m.id,m.product_id,m.quantity_micros FROM stock_movements m WHERE m.tenant_id=$1 AND m.{column}=$2 AND m.direction=$3 AND m.reverses_id IS NULL AND NOT EXISTS(SELECT 1 FROM stock_movements reversed WHERE reversed.tenant_id=m.tenant_id AND reversed.reverses_id=m.id) ORDER BY m.product_id,m.id"))
        .bind(tenant).bind(source).bind(original_direction).fetch_all(&mut **tx).await.map_err(db)?;
    let (lines, foreign) = match kind {
        Kind::Sale => ("sales_order_lines", "order_id"),
        Kind::Purchase => ("purchase_receipt_lines", "receipt_id"),
    };
    let expected=sqlx::query_as::<_, (Uuid,i64)>(&format!("SELECT product_id,quantity_micros FROM {lines} WHERE tenant_id=$1 AND {foreign}=$2 ORDER BY product_id"))
        .bind(tenant).bind(source).fetch_all(&mut **tx).await.map_err(db)?;
    if originals.is_empty()
        || originals.len() != expected.len()
        || originals
            .iter()
            .zip(&expected)
            .any(|(movement, (product, quantity))| {
                movement.product_id != *product || movement.quantity_micros != *quantity
            })
    {
        return Err(DomainError::Conflict(
            "Movimentos originais não conciliam com os itens; confira o histórico antes de devolver",
        ));
    }
    let mut ids = Vec::new();
    for original in originals {
        let balance: i64=sqlx::query_scalar("SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE")
            .bind(tenant).bind(original.product_id).fetch_one(&mut **tx).await.map_err(db)?;
        let next = match kind {
            Kind::Sale => balance.checked_add(original.quantity_micros),
            Kind::Purchase => balance.checked_sub(original.quantity_micros),
        }
        .filter(|value| (0..=999999999999999999).contains(value))
        .ok_or(DomainError::Conflict(
            "Saldo físico insuficiente ou limite de estoque excedido",
        ))?;
        if next < sales::reserved(tx, tenant, original.product_id).await? {
            return Err(DomainError::Conflict(
                "Saldo disponível insuficiente: há estoque reservado em vendas",
            ));
        }
        let id = Uuid::now_v7();
        sqlx::query(
            "UPDATE stock_balances SET quantity_micros=$3 WHERE tenant_id=$1 AND product_id=$2",
        )
        .bind(tenant)
        .bind(original.product_id)
        .bind(next)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
        sqlx::query("INSERT INTO stock_movements(id,tenant_id,product_id,direction,quantity_micros,balance_after_micros,reason,reverses_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(id).bind(tenant).bind(original.product_id).bind(inverse).bind(original.quantity_micros).bind(next).bind(reason).bind(original.id).execute(&mut **tx).await.map_err(db)?;
        record(tx,tenant,identity,headers,DomainChange{kind:"stock_movement",id,event:"stock.moved",details:json!({"sourceId":source,"productId":original.product_id,"direction":inverse,"quantity":decimal(original.quantity_micros,6),"balanceAfter":decimal(next,6),"reversesId":original.id,"reason":reason})}).await?;
        ids.push(id);
    }
    Ok(ids)
}

#[derive(FromRow)]
struct OriginalPayment {
    id: Uuid,
    amount_cents: i64,
    method: String,
    occurred_on: time::Date,
}

/// Reverse declared payments without claiming that a bank transfer was executed.
async fn cancel_title(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    source: Uuid,
    kind: Kind,
    actor: (&AuthenticatedIdentity, &HeaderMap),
    input: &ReturnInput,
    occurred: time::Date,
) -> Result<(Option<Uuid>, Vec<Uuid>), DomainError> {
    let (identity, headers) = actor;
    let (accounts, payments, foreign, source_column, positive, entity) = match kind {
        Kind::Sale => (
            "receivables",
            "receivable_payments",
            "receivable_id",
            "order_id",
            "receipt",
            "receivable",
        ),
        Kind::Purchase => (
            "payables",
            "payable_payments",
            "payable_id",
            "receipt_id",
            "payment",
            "payable",
        ),
    };
    let account=sqlx::query_as::<_, (Uuid,String,i64)>(&format!("SELECT id,status,revision FROM {accounts} WHERE tenant_id=$1 AND {source_column}=$2 FOR UPDATE"))
        .bind(tenant).bind(source).fetch_optional(&mut **tx).await.map_err(db)?;
    let Some((account, status, revision)) = account else {
        if matches!(kind, Kind::Sale) {
            return Err(DomainError::Conflict(
                "Pedido concluído sem título financeiro; concilie antes de cancelar",
            ));
        }
        let amount: i64 = sqlx::query_scalar(
            "SELECT amount_cents FROM purchase_receipts WHERE tenant_id=$1 AND id=$2",
        )
        .bind(tenant)
        .bind(source)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
        if amount != 0 {
            return Err(DomainError::Conflict(
                "Recebimento sem título financeiro; concilie antes de estornar",
            ));
        }
        return Ok((None, Vec::new()));
    };
    if status == "cancelled" {
        return Err(DomainError::Conflict("Título financeiro já cancelado"));
    }
    let originals=sqlx::query_as::<_,OriginalPayment>(&format!("SELECT p.id,p.amount_cents,p.method,p.occurred_on FROM {payments} p WHERE p.tenant_id=$1 AND p.{foreign}=$2 AND p.kind=$3 AND NOT EXISTS(SELECT 1 FROM {payments} reversed WHERE reversed.tenant_id=p.tenant_id AND reversed.reverses_id=p.id) ORDER BY p.created_at,p.id"))
        .bind(tenant).bind(account).bind(positive).fetch_all(&mut **tx).await.map_err(db)?;
    let mut ids = Vec::new();
    for original in originals {
        if occurred < original.occurred_on {
            return Err(DomainError::Invalid(
                "Estorno não pode anteceder um pagamento ou recebimento original",
            ));
        }
        let id = Uuid::now_v7();
        sqlx::query(&format!("INSERT INTO {payments}(id,tenant_id,{foreign},kind,amount_cents,method,reference,occurred_on,reverses_id) VALUES($1,$2,$3,'reversal',$4,$5,$6,$7,$8)"))
            .bind(id).bind(tenant).bind(account).bind(original.amount_cents).bind(&original.method).bind(input.reason.trim()).bind(occurred).bind(original.id).execute(&mut **tx).await.map_err(db)?;
        record(tx,tenant,identity,headers,DomainChange{kind:entity,id:account,event:match kind {Kind::Sale=>"receivable.payment_reversed",Kind::Purchase=>"payable.payment_reversed"},details:json!({"paymentId":id,"reversesId":original.id,"amount":decimal(original.amount_cents,2),"source":"commercial_return","bankTransferExecuted":false})}).await?;
        ids.push(id);
    }
    let next = revision.checked_add(1).ok_or(AccessError::Internal)?;
    sqlx::query(&format!("UPDATE {accounts} SET status='cancelled',payment_id=NULL,revision=$3 WHERE tenant_id=$1 AND id=$2"))
        .bind(tenant).bind(account).bind(next).execute(&mut **tx).await.map_err(db)?;
    record(tx,tenant,identity,headers,DomainChange{kind:entity,id:account,event:match kind {Kind::Sale=>"receivable.cancelled",Kind::Purchase=>"payable.cancelled"},details:json!({"sourceId":source,"reason":input.reason.trim(),"previousRevision":revision,"revision":next,"status":"cancelled","outstandingAmount":"0.00"})}).await?;
    Ok((Some(account), ids))
}

async fn apply_sale(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
    expected: i64,
    actor: (&AuthenticatedIdentity, &HeaderMap),
    input: &ReturnInput,
    occurred: time::Date,
) -> Result<Value, DomainError> {
    let (identity, headers) = actor;
    let (status, current) = sqlx::query_as::<_, (String, i64)>(
        "SELECT status,revision FROM sales_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(order)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    if status != "completed" {
        return Err(DomainError::Conflict(
            "Cancelamento integral exige venda concluída",
        ));
    }
    let fiscal_pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_nfe_documents WHERE tenant_id=$1 AND source_order_id=$2 AND (status IN ('preparing','prepared','unknown') OR lease_until>clock_timestamp()))")
        .bind(tenant).bind(order).fetch_one(&mut **tx).await.map_err(db)?;
    if fiscal_pending {
        return Err(DomainError::Conflict(
            "Concilie a emissão fiscal em andamento antes de cancelar a venda",
        ));
    }
    let fiscal_required: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_nfe_documents WHERE tenant_id=$1 AND source_order_id=$2 AND status='authorized')")
        .bind(tenant).bind(order).fetch_one(&mut **tx).await.map_err(db)?;
    let movements = reverse_stock(
        tx,
        tenant,
        order,
        Kind::Sale,
        identity,
        headers,
        input.reason.trim(),
    )
    .await?;
    let (account, payments) =
        cancel_title(tx, tenant, order, Kind::Sale, actor, input, occurred).await?;
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    let id = Uuid::now_v7();
    let summary = json!({"id":id,"kind":"sale_cancellation","sourceId":order,"orderId":order,"cancellationId":id,"revision":next,"reason":input.reason.trim(),"occurredOn":input.occurred_on,"receivableId":account,"stockMovementIds":movements,"paymentReversalIds":payments,"fiscalCancellation":{"requested":fiscal_required,"status":if fiscal_required {"pending"} else {"not_required"}},"reconciliation":{"commission":"domain_unavailable","production":"domain_unavailable"}});
    sqlx::query("INSERT INTO sales_order_cancellations(id,tenant_id,order_id,reason,occurred_on,order_revision,summary) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(id).bind(tenant).bind(order).bind(input.reason.trim()).bind(occurred).bind(next).bind(&summary).execute(&mut **tx).await.map_err(db)?;
    sqlx::query("UPDATE sales_orders SET status='cancelled',revision=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(order).bind(next).execute(&mut **tx).await.map_err(db)?;
    let contracts = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id,status FROM commercial_contracts WHERE tenant_id=$1 AND order_id=$2 ORDER BY id",
    )
    .bind(tenant)
    .bind(order)
    .fetch_all(&mut **tx)
    .await
    .map_err(db)?;
    for (contract, status) in contracts {
        if !["completed", "declined", "expired"].contains(&status.as_str()) {
            record(tx,tenant,identity,headers,DomainChange{kind:"commercial_contract",id:contract,event:"contract.withdrawal_requested",details:json!({"orderId":order,"cancellationId":id,"reason":input.reason.trim(),"status":"pending","filesPreserved":true})}).await?;
        }
    }
    record(tx,tenant,identity,headers,DomainChange{kind:"sales_order",id:order,event:"sales.order.reconciliation_requested",details:json!({"orderId":order,"cancellationId":id,"commission":{"status":"domain_unavailable","applied":false},"production":{"status":"domain_unavailable","applied":false}})}).await?;
    record(
        tx,
        tenant,
        identity,
        headers,
        DomainChange {
            kind: "sales_order",
            id: order,
            event: Kind::Sale.names().3,
            details: summary.clone(),
        },
    )
    .await?;
    Ok(summary)
}

async fn apply_purchase(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    receipt: Uuid,
    expected: i64,
    actor: (&AuthenticatedIdentity, &HeaderMap),
    input: &ReturnInput,
    occurred: time::Date,
) -> Result<Value, DomainError> {
    let (identity, headers) = actor;
    let (order,status,current,received_on)=sqlx::query_as::<_,(Uuid,String,i64,time::Date)>("SELECT o.id,o.status,o.revision,r.occurred_on FROM purchase_receipts r JOIN purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF o")
        .bind(tenant).bind(receipt).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if current != expected {
        return Err(DomainError::StaleRevision);
    }
    if !["received", "partially_received", "closed"].contains(&status.as_str()) {
        return Err(DomainError::Conflict(
            "Compra não possui recebimento ativo para estornar",
        ));
    }
    if occurred < received_on {
        return Err(DomainError::Invalid(
            "Estorno não pode anteceder o recebimento físico",
        ));
    }
    let already:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM purchase_receipt_reversals WHERE tenant_id=$1 AND receipt_id=$2)")
        .bind(tenant).bind(receipt).fetch_one(&mut **tx).await.map_err(db)?;
    if already {
        return Err(DomainError::Conflict("Recebimento já estornado"));
    }
    // Cumulative rounding makes some fractional receipts dependent on their
    // predecessors. Reject unsafe order instead of creating or losing cents.
    let rounding_safe:bool=sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM purchase_receipt_lines selected JOIN purchase_order_lines ordered ON ordered.tenant_id=selected.tenant_id AND ordered.order_id=$3 AND ordered.product_id=selected.product_id WHERE selected.tenant_id=$1 AND selected.receipt_id=$2 AND ((ordered.received_micros-selected.quantity_micros)<0 OR floor(((ordered.received_micros-selected.quantity_micros)::numeric*ordered.cost_cents+500000)/1000000) <> (SELECT COALESCE(sum(active.amount_cents),0) FROM purchase_receipt_lines active JOIN purchase_receipts r ON r.tenant_id=active.tenant_id AND r.id=active.receipt_id WHERE active.tenant_id=$1 AND r.order_id=$3 AND active.product_id=selected.product_id AND active.receipt_id<>$2 AND NOT EXISTS(SELECT 1 FROM purchase_receipt_reversals reversed WHERE reversed.tenant_id=active.tenant_id AND reversed.receipt_id=active.receipt_id))))")
        .bind(tenant).bind(receipt).bind(order).fetch_one(&mut **tx).await.map_err(db)?;
    if !rounding_safe {
        return Err(DomainError::Conflict(
            "Desfaça os recebimentos posteriores primeiro para preservar o arredondamento dos custos",
        ));
    }
    let movements = reverse_stock(
        tx,
        tenant,
        receipt,
        Kind::Purchase,
        identity,
        headers,
        input.reason.trim(),
    )
    .await?;
    let (account, payments) =
        cancel_title(tx, tenant, receipt, Kind::Purchase, actor, input, occurred).await?;
    sqlx::query("UPDATE purchase_order_lines ordered SET received_micros=ordered.received_micros-selected.quantity_micros FROM purchase_receipt_lines selected WHERE ordered.tenant_id=$1 AND ordered.order_id=$2 AND selected.tenant_id=ordered.tenant_id AND selected.receipt_id=$3 AND selected.product_id=ordered.product_id")
        .bind(tenant).bind(order).bind(receipt).execute(&mut **tx).await.map_err(db)?;
    let remaining:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM purchase_order_lines WHERE tenant_id=$1 AND order_id=$2 AND received_micros>0)")
        .bind(tenant).bind(order).fetch_one(&mut **tx).await.map_err(db)?;
    // A manually closed remainder stays closed. Otherwise permit normal receiving again.
    let target = if status == "closed" {
        "closed"
    } else if remaining {
        "partially_received"
    } else {
        "confirmed"
    };
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    let id = Uuid::now_v7();
    let summary = json!({"id":id,"kind":"purchase_receipt_reversal","sourceId":receipt,"receiptId":receipt,"orderId":order,"revision":next,"orderStatus":target,"reason":input.reason.trim(),"occurredOn":input.occurred_on,"payableId":account,"stockMovementIds":movements,"paymentReversalIds":payments});
    sqlx::query("INSERT INTO purchase_receipt_reversals(id,tenant_id,receipt_id,order_id,reason,occurred_on,order_revision,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(id).bind(tenant).bind(receipt).bind(order).bind(input.reason.trim()).bind(occurred).bind(next).bind(&summary).execute(&mut **tx).await.map_err(db)?;
    sqlx::query("UPDATE purchase_orders SET status=$3,revision=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(order).bind(target).bind(next).execute(&mut **tx).await.map_err(db)?;
    record(
        tx,
        tenant,
        identity,
        headers,
        DomainChange {
            kind: "purchase_order",
            id: order,
            event: "purchase.receipt_reverted",
            details: summary.clone(),
        },
    )
    .await?;
    record(
        tx,
        tenant,
        identity,
        headers,
        DomainChange {
            kind: "purchase_receipt",
            id: receipt,
            event: Kind::Purchase.names().3,
            details: summary.clone(),
        },
    )
    .await?;
    Ok(summary)
}

async fn command(
    kind: Kind,
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Uuid,
    payload: Result<Json<ReturnInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (read, manage, financial) = kind.permissions();
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, read, manage, true).await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, "inventory.stock.manage")?;
    access::require_permission(&rights, financial)?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let occurred = validated(&input)?;
    let body = serde_json::to_vec(&input).map_err(|_| AccessError::Internal)?;
    let digest = format!("{:x}", Sha256::digest(body));
    let request = json!({"id":id,"revision":expected,"bodySha256":digest,"input":input});
    let scope = kind.names().3;
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, scope, &request).await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, previous));
    }
    let data = match kind {
        Kind::Sale => {
            apply_sale(
                &mut tx,
                tenant,
                id,
                expected,
                (&identity, &headers),
                &input,
                occurred,
            )
            .await?
        }
        Kind::Purchase => {
            apply_purchase(
                &mut tx,
                tenant,
                id,
                expected,
                (&identity, &headers),
                &input,
                occurred,
            )
            .await?
        }
    };
    let rev = data["revision"].as_i64();
    let result = serde_json::to_value(ReturnResult {
        tenant_id: tenant,
        data,
    })
    .map_err(|_| AccessError::Internal)?;
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
    Ok(response(StatusCode::OK, rev, result))
}

#[utoipa::path(post,path="/api/v1/orders/{id}/cancel-completed",tag="Sales",request_body=ReturnInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=ReturnResult),(status=403,description="Sem permissão de venda, estoque ou financeiro"),(status=404,description="Pedido inexistente"),(status=409,description="Estado ou chave em conflito"),(status=412,description="Revisão antiga"),(status=422,description="Motivo/data inválidos"),(status=428,description="Precondições obrigatórias")))]
pub async fn cancel_completed(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ReturnInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    command(Kind::Sale, state, identity, headers, id, payload).await
}

#[utoipa::path(post,path="/api/v1/purchase-receipts/{id}/reverse",tag="Purchasing",request_body=ReturnInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header,description="Revisão atual do pedido de compra"),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=ReturnResult),(status=403,description="Sem permissão de compra, estoque ou financeiro"),(status=404,description="Recebimento inexistente"),(status=409,description="Saldo, arredondamento ou estado em conflito"),(status=412,description="Revisão antiga da compra"),(status=422,description="Motivo/data inválidos"),(status=428,description="Precondições obrigatórias")))]
pub async fn reverse_receipt(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ReturnInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    command(Kind::Purchase, state, identity, headers, id, payload).await
}

async fn history(
    kind: Kind,
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Uuid,
) -> Result<Response, DomainError> {
    let (read, manage, _) = kind.permissions();
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, read, manage, false).await?;
    let source = match kind {
        Kind::Sale => "sales_orders",
        Kind::Purchase => "purchase_receipts",
    };
    let exists: bool = sqlx::query_scalar(&format!(
        "SELECT EXISTS(SELECT 1 FROM {source} WHERE tenant_id=$1 AND id=$2)"
    ))
    .bind(tenant)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    if !exists {
        return Err(DomainError::NotFound);
    }
    let (table, foreign, _, _) = kind.names();
    let data: Vec<Value> = sqlx::query_scalar(&format!(
        "SELECT summary FROM {table} WHERE tenant_id=$1 AND {foreign}=$2 ORDER BY created_at,id"
    ))
    .bind(tenant)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data}),
    ))
}

#[utoipa::path(get,path="/api/v1/orders/{id}/cancellations",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão"),(status=404,description="Pedido inexistente")))]
pub async fn sale_history(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    history(Kind::Sale, state, identity, headers, id).await
}

#[utoipa::path(get,path="/api/v1/purchase-receipts/{id}/reversals",tag="Purchasing",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão"),(status=404,description="Recebimento inexistente")))]
pub async fn purchase_history(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    history(Kind::Purchase, state, identity, headers, id).await
}
