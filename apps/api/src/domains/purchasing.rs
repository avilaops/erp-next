use super::{
    DomainChange, DomainError, authorized, catalog, command_key, db, decimal, fixed, record,
    remember, replay, response, revision, sales, settlements::reference,
};
use crate::platform::{
    access::{self, AccessError},
    auth::AuthenticatedIdentity,
    state::AppState,
};
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
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PurchaseItemInput {
    product_id: Uuid,
    quantity: String,
    unit_cost: String,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PurchaseInput {
    supplier_id: Uuid,
    due_date: String,
    items: Vec<PurchaseItemInput>,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReceiptItemInput {
    product_id: Uuid,
    quantity: String,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReceiptInput {
    reference: String,
    occurred_on: String,
    items: Vec<ReceiptItemInput>,
}
#[derive(Default, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CommandInput {
    reason: Option<String>,
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseSummary {
    id: Uuid,
    supplier_id: Uuid,
    supplier_name: String,
    supplier_tax_id: String,
    due_date: String,
    amount: String,
    status: String,
    revision: i64,
}
#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseLine {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    quantity: String,
    received_quantity: String,
    unit_cost: String,
    amount: String,
}
#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptSummary {
    id: Uuid,
    order_id: Uuid,
    reference: String,
    occurred_on: String,
    amount: String,
    payable_id: Option<Uuid>,
    reversal_id: Option<Uuid>,
    order_revision: i64,
}
#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptLine {
    product_id: Uuid,
    unit: String,
    quantity: String,
    amount: String,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseSnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: PurchaseSummary,
    items: Vec<PurchaseLine>,
    receipt_count: i64,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<PurchaseSummary>,
    total: i64,
    offset: u32,
    limit: u32,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptSnapshot {
    tenant_id: Uuid,
    data: ReceiptSummary,
    items: Vec<ReceiptLine>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptResult {
    order: PurchaseSnapshot,
    receipt: ReceiptSnapshot,
    payable_id: Option<Uuid>,
}

const SUMMARY: &str = "SELECT id,supplier_id,supplier_name,supplier_tax_id,due_date::text AS due_date,(amount_cents::numeric/100)::numeric(16,2)::text AS amount,status,revision FROM purchase_orders";
const RECEIPT_SUMMARY: &str = "SELECT r.id,r.order_id,r.reference,r.occurred_on::text AS occurred_on,(r.amount_cents::numeric/100)::numeric(16,2)::text AS amount,p.id AS payable_id,reversed.id AS reversal_id,o.revision AS order_revision FROM purchase_receipts r JOIN purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id LEFT JOIN payables p ON p.tenant_id=r.tenant_id AND p.receipt_id=r.id LEFT JOIN purchase_receipt_reversals reversed ON reversed.tenant_id=r.tenant_id AND reversed.receipt_id=r.id";

pub(super) async fn received_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    receipt: Uuid,
    product: Uuid,
) -> Result<(i64, String), DomainError> {
    sqlx::query_as("SELECT l.quantity_micros,l.unit FROM purchase_receipt_lines l JOIN purchase_receipts r ON r.tenant_id=l.tenant_id AND r.id=l.receipt_id JOIN purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id WHERE l.tenant_id=$1 AND l.receipt_id=$2 AND l.product_id=$3 AND o.status IN ('confirmed','partially_received')")
        .bind(tenant).bind(receipt).bind(product).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::Conflict("Entrada exige recebimento desta compra e produto"))
}

#[derive(FromRow)]
pub(super) struct PayableOrigin {
    pub receipt_id: Uuid,
    pub supplier_name: String,
    pub due_date: time::Date,
    pub amount_cents: i64,
}
pub(super) async fn payable_origin(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    receipt: Uuid,
) -> Result<PayableOrigin, DomainError> {
    sqlx::query_as("SELECT r.id AS receipt_id,o.supplier_name,o.due_date,r.amount_cents FROM purchase_receipts r JOIN purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id WHERE r.tenant_id=$1 AND r.id=$2 AND o.status IN ('confirmed','partially_received')")
        .bind(tenant).bind(receipt).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::Conflict("Obrigação exige recebimento da própria empresa"))
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    can_edit: bool,
) -> Result<PurchaseSnapshot, DomainError> {
    let data = sqlx::query_as::<_, PurchaseSummary>(&format!(
        "{SUMMARY} WHERE tenant_id=$1 AND id=$2 FOR SHARE"
    ))
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    let items=sqlx::query_as::<_,PurchaseLine>("SELECT product_id,sku,name,unit,(quantity_micros::numeric/1000000)::numeric(19,6)::text AS quantity,(received_micros::numeric/1000000)::numeric(19,6)::text AS received_quantity,(cost_cents::numeric/100)::numeric(16,2)::text AS unit_cost,(amount_cents::numeric/100)::numeric(16,2)::text AS amount FROM purchase_order_lines WHERE tenant_id=$1 AND order_id=$2 ORDER BY line_number").bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?;
    let receipt_count = sqlx::query_scalar(
        "SELECT count(*) FROM purchase_receipts WHERE tenant_id=$1 AND order_id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    Ok(PurchaseSnapshot {
        tenant_id: tenant,
        can_edit,
        data,
        items,
        receipt_count,
    })
}
async fn load_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<ReceiptSnapshot, DomainError> {
    let data = sqlx::query_as::<_, ReceiptSummary>(&format!(
        "{RECEIPT_SUMMARY} WHERE r.tenant_id=$1 AND r.id=$2"
    ))
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    let items=sqlx::query_as::<_,ReceiptLine>("SELECT product_id,unit,(quantity_micros::numeric/1000000)::numeric(19,6)::text AS quantity,(amount_cents::numeric/100)::numeric(16,2)::text AS amount FROM purchase_receipt_lines WHERE tenant_id=$1 AND receipt_id=$2 ORDER BY product_id").bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?;
    Ok(ReceiptSnapshot {
        tenant_id: tenant,
        data,
        items,
    })
}
fn value<T: Serialize>(input: T) -> Result<serde_json::Value, DomainError> {
    serde_json::to_value(input).map_err(|_| AccessError::Internal.into())
}
fn amount(quantity: i64, cost: i64) -> Result<i64, DomainError> {
    i64::try_from((i128::from(quantity) * i128::from(cost) + 500000) / 1000000)
        .ok()
        .filter(|v| *v <= 99999999999999)
        .ok_or(DomainError::Invalid("Valor fora do limite"))
}
struct PreparedLine {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    quantity: i64,
    cost: i64,
    amount: i64,
}
struct Prepared {
    supplier_name: String,
    supplier_tax_id: String,
    due: time::Date,
    total: i64,
    lines: Vec<PreparedLine>,
}
async fn prepare(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    input: &mut PurchaseInput,
    previous: Option<&PurchaseSnapshot>,
) -> Result<Prepared, DomainError> {
    let due = sales::date(&input.due_date)?;
    if input.items.is_empty() || input.items.len() > 100 {
        return Err(DomainError::Invalid(
            "Compra exige de 1 a 100 produtos distintos",
        ));
    }
    let supplier=sqlx::query_as::<_,(String,String)>("SELECT legal_name,tax_id FROM parties WHERE tenant_id=$1 AND id=$2 AND is_supplier AND status='active'").bind(tenant).bind(input.supplier_id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::Conflict("Selecione fornecedor ativo desta empresa"))?;
    let mut lines = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut total = 0_i64;
    for item in &mut input.items {
        if !seen.insert(item.product_id) {
            return Err(DomainError::Invalid("Agrupe a quantidade de cada produto"));
        }
        let quantity = fixed(&item.quantity, 6)?;
        let cost = fixed(&item.unit_cost, 2)?;
        if quantity <= 0 {
            return Err(DomainError::Invalid("Quantidade deve ser positiva"));
        }
        let product = catalog::load(tx, tenant, item.product_id).await?;
        if product.data.status != "active" {
            return Err(DomainError::Conflict("Produto precisa estar ativo"));
        }
        if previous.is_some_and(|p| {
            p.items
                .iter()
                .any(|l| l.product_id == item.product_id && l.unit != product.data.unit)
        }) {
            return Err(DomainError::Conflict(
                "Unidade mudou; remova o item antes de substituí-lo",
            ));
        }
        item.quantity = decimal(quantity, 6);
        item.unit_cost = decimal(cost, 2);
        let line_amount = amount(quantity, cost)?;
        total = total
            .checked_add(line_amount)
            .filter(|v| *v <= 99999999999999)
            .ok_or(DomainError::Invalid("Total fora do limite"))?;
        lines.push(PreparedLine {
            product_id: item.product_id,
            sku: product.data.sku,
            name: product.data.name,
            unit: product.data.unit,
            quantity,
            cost,
            amount: line_amount,
        });
    }
    if total <= 0 {
        return Err(DomainError::Invalid("Compra exige valor total positivo"));
    }
    Ok(Prepared {
        supplier_name: supplier.0,
        supplier_tax_id: supplier.1,
        due,
        total,
        lines,
    })
}
async fn save_lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    lines: Vec<PreparedLine>,
) -> Result<(), DomainError> {
    for (index, line) in lines.into_iter().enumerate() {
        sqlx::query("INSERT INTO purchase_order_lines(tenant_id,order_id,product_id,line_number,sku,name,unit,quantity_micros,cost_cents,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)").bind(tenant).bind(id).bind(line.product_id).bind((index+1) as i32).bind(line.sku).bind(line.name).bind(line.unit).bind(line.quantity).bind(line.cost).bind(line.amount).execute(&mut **tx).await.map_err(db)?;
    }
    Ok(())
}

#[utoipa::path(get,path="/api/v1/purchase-orders",tag="Purchasing",security(("bearerAuth"=[])),params(sales::OrderQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=PurchaseList),(status=400,description="Empresa inválida"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=422,description="Filtros inválidos"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
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
        "purchasing.orders.read",
        "purchasing.orders.manage",
        false,
    )
    .await?;
    let data = sqlx::query_as::<_, PurchaseSummary>(&format!(
        "{SUMMARY} WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3"
    ))
    .bind(tenant)
    .bind(i64::from(limit))
    .bind(i64::from(offset))
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    let total = sqlx::query_scalar("SELECT count(*) FROM purchase_orders WHERE tenant_id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        PurchaseList {
            tenant_id: tenant,
            can_edit,
            data,
            total,
            offset,
            limit,
        },
    ))
}
#[utoipa::path(get,path="/api/v1/purchase-orders/{id}",tag="Purchasing",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=PurchaseSnapshot),(status=400,description="Empresa/ID inválido"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=404,description="Compra inexistente"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
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
        "purchasing.orders.read",
        "purchasing.orders.manage",
        false,
    )
    .await?;
    let current = load(&mut tx, tenant, id, can_edit).await?;
    let rev = current.data.revision;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(rev), current))
}
#[utoipa::path(post,path="/api/v1/purchase-orders",tag="Purchasing",request_body=PurchaseInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=PurchaseSnapshot),(status=400,description="Empresa inválida"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=404,description="Produto inexistente"),(status=409,description="Origem/chave em conflito"),(status=422,description="Entrada inválida"),(status=428,description="Chave obrigatória"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<PurchaseInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "purchasing.orders.read",
        "purchasing.orders.manage",
        true,
    )
    .await?;
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    // Normalize the request before matching a command, without requiring mutable catalog state on retries.
    normalize(&mut input)?;
    let request = value(&input)?;
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "purchase.create",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, rev, previous));
    }
    let prepared = prepare(&mut tx, tenant, &mut input, None).await?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO purchase_orders(id,tenant_id,supplier_id,supplier_name,supplier_tax_id,due_date,amount_cents,status) VALUES($1,$2,$3,$4,$5,$6,$7,'draft')").bind(id).bind(tenant).bind(input.supplier_id).bind(prepared.supplier_name).bind(prepared.supplier_tax_id).bind(prepared.due).bind(prepared.total).execute(&mut *tx).await.map_err(db)?;
    save_lines(&mut tx, tenant, id, prepared.lines).await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "purchase_order",
            id,
            event: "purchase.created",
            details: serde_json::json!({"revision":1,"amount":decimal(prepared.total,2)}),
        },
    )
    .await?;
    let result = value(load(&mut tx, tenant, id, true).await?)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "purchase.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}
/// Create only the purchasing draft inside the caller's transaction. The caller
/// owns command deduplication, authorization, origin linkage and audit/outbox.
pub(crate) async fn create_fiscal_draft(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    supplier_id: Uuid,
    due_date: String,
    items: Vec<(Uuid, String, String)>,
) -> Result<PurchaseSnapshot, DomainError> {
    let mut input = PurchaseInput {
        supplier_id,
        due_date,
        items: items
            .into_iter()
            .map(|(product_id, quantity, unit_cost)| PurchaseItemInput {
                product_id,
                quantity,
                unit_cost,
            })
            .collect(),
    };
    normalize(&mut input)?;
    let prepared = prepare(tx, tenant, &mut input, None).await?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO purchase_orders(id,tenant_id,supplier_id,supplier_name,supplier_tax_id,due_date,amount_cents,status) VALUES($1,$2,$3,$4,$5,$6,$7,'draft')")
        .bind(id).bind(tenant).bind(input.supplier_id).bind(prepared.supplier_name).bind(prepared.supplier_tax_id).bind(prepared.due).bind(prepared.total).execute(&mut **tx).await.map_err(db)?;
    save_lines(tx, tenant, id, prepared.lines).await?;
    load(tx, tenant, id, true).await
}

fn normalize(input: &mut PurchaseInput) -> Result<(), DomainError> {
    sales::date(&input.due_date)?;
    for item in &mut input.items {
        item.quantity = decimal(fixed(&item.quantity, 6)?, 6);
        item.unit_cost = decimal(fixed(&item.unit_cost, 2)?, 2);
    }
    Ok(())
}
#[utoipa::path(put,path="/api/v1/purchase-orders/{id}",tag="Purchasing",request_body=PurchaseInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=PurchaseSnapshot),(status=400,description="Revisão/empresa inválida"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=404,description="Compra/produto inexistente"),(status=409,description="Compra não editável"),(status=412,description="Revisão antiga"),(status=422,description="Entrada inválida"),(status=428,description="Revisão obrigatória"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<PurchaseInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "purchasing.orders.read",
        "purchasing.orders.manage",
        true,
    )
    .await?;
    let previous = load(&mut tx, tenant, id, true).await?;
    if previous.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if previous.data.status != "draft" {
        return Err(DomainError::Conflict("Somente rascunho pode ser editado"));
    }
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let prepared = prepare(&mut tx, tenant, &mut input, Some(&previous)).await?;
    // A fiscal origin is immutable evidence. A due-date edit may rebuild the
    // unchanged rows, but supplier, quantities and landed costs must still match.
    let fiscal_origin:Option<(Uuid,String)>=sqlx::query_as("SELECT l.supplier_id,n.issuer_document FROM fiscal_received_purchase_links l JOIN fiscal_received_nfes n ON n.tenant_id=l.tenant_id AND n.id=l.received_nfe_id WHERE l.tenant_id=$1 AND l.purchase_order_id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
    if let Some((supplier, issuer)) = fiscal_origin {
        let source:Vec<(Uuid,String,i64,i64,i64)>=sqlx::query_as("SELECT product_id,unit,quantity_micros,unit_cost_cents,landed_cents FROM fiscal_received_item_costs WHERE tenant_id=$1 AND purchase_order_id=$2")
            .bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
        if supplier != input.supplier_id
            || issuer != prepared.supplier_tax_id
            || source.len() != prepared.lines.len()
            || prepared.lines.iter().any(|line| {
                !source
                    .iter()
                    .any(|(product, unit, quantity, cost, amount)| {
                        *product == line.product_id
                            && *unit == line.unit
                            && *quantity == line.quantity
                            && *cost == line.cost
                            && *amount == line.amount
                    })
            })
        {
            return Err(DomainError::Conflict(
                "Compra vinculada ao XML: preserve fornecedor, produtos, unidades, quantidades e custos fiscais; somente o vencimento pode ser alterado",
            ));
        }
    }
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    sqlx::query("DELETE FROM purchase_order_lines WHERE tenant_id=$1 AND order_id=$2")
        .bind(tenant)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("UPDATE purchase_orders SET supplier_id=$3,supplier_name=$4,supplier_tax_id=$5,due_date=$6,amount_cents=$7,revision=$8,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(input.supplier_id).bind(prepared.supplier_name).bind(prepared.supplier_tax_id).bind(prepared.due).bind(prepared.total).bind(next).execute(&mut *tx).await.map_err(db)?;
    save_lines(&mut tx, tenant, id, prepared.lines).await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "purchase_order",
            id,
            event: "purchase.updated",
            details: serde_json::json!({"previousRevision":expected,"revision":next}),
        },
    )
    .await?;
    let result = load(&mut tx, tenant, id, true).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), result))
}

#[derive(Clone, Copy)]
enum Action {
    Confirm,
    Cancel,
    Close,
}
async fn command(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Uuid,
    input: CommandInput,
    action: Action,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "purchasing.orders.read",
        "purchasing.orders.manage",
        true,
    )
    .await?;
    let reason = match action {
        Action::Confirm => None,
        _ => Some(reference(input.reason.as_deref().unwrap_or(""))?),
    };
    let (scope, target, event) = match action {
        Action::Confirm => ("purchase.confirm", "confirmed", "purchase.confirmed"),
        Action::Cancel => ("purchase.cancel", "cancelled", "purchase.cancelled"),
        Action::Close => ("purchase.close", "closed", "purchase.closed"),
    };
    let request = serde_json::json!({"id":id,"revision":expected,"reason":reason});
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, scope, &request).await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, previous));
    }
    let current = load(&mut tx, tenant, id, true).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    let allowed = match action {
        Action::Confirm => current.data.status == "draft",
        Action::Cancel => {
            ["draft", "confirmed"].contains(&current.data.status.as_str())
                && current.receipt_count == 0
        }
        Action::Close => current.data.status == "partially_received",
    };
    if !allowed {
        return Err(DomainError::Conflict(
            "Transição não permitida na situação atual da compra",
        ));
    }
    if matches!(action, Action::Confirm) {
        let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM parties WHERE tenant_id=$1 AND id=$2 AND status='active' AND is_supplier)").bind(tenant).bind(current.data.supplier_id).fetch_one(&mut *tx).await.map_err(db)?;
        if !active {
            return Err(DomainError::Conflict(
                "Fornecedor precisa estar ativo para confirmar",
            ));
        }
        for line in &current.items {
            let product = catalog::load(&mut tx, tenant, line.product_id).await?;
            if product.data.status != "active" || product.data.unit != line.unit {
                return Err(DomainError::Conflict(
                    "Produto deve estar ativo e conservar unidade da compra",
                ));
            }
        }
    }
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    sqlx::query("UPDATE purchase_orders SET status=$3,revision=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(target).bind(next).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"purchase_order",id,event,details:serde_json::json!({"previousRevision":expected,"revision":next,"previousStatus":current.data.status,"status":target,"reason":reason})}).await?;
    let result = value(load(&mut tx, tenant, id, true).await?)?;
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

macro_rules! purchase_command {
    ($handler:ident,$path:literal,$action:expr) => {
        #[utoipa::path(post,path=$path,tag="Purchasing",request_body=CommandInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=PurchaseSnapshot),(status=400,description="Revisão/empresa inválida"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=404,description="Compra inexistente"),(status=409,description="Estado/chave em conflito"),(status=412,description="Revisão antiga"),(status=422,description="Entrada inválida"),(status=428,description="Precondição obrigatória"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
        pub async fn $handler(State(state):State<AppState>,Extension(identity):Extension<AuthenticatedIdentity>,headers:HeaderMap,Path(id):Path<Uuid>,payload:Result<Json<CommandInput>,JsonRejection>)->Result<Response,DomainError>{
            let Json(input)=payload.map_err(|_|DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
            command(state,identity,headers,id,input,$action).await
        }
    }
}
purchase_command!(
    confirm,
    "/api/v1/purchase-orders/{id}/confirm",
    Action::Confirm
);
purchase_command!(
    cancel,
    "/api/v1/purchase-orders/{id}/cancel",
    Action::Cancel
);
purchase_command!(close, "/api/v1/purchase-orders/{id}/close", Action::Close);

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptList {
    tenant_id: Uuid,
    data: Vec<ReceiptSummary>,
    total: i64,
    offset: u32,
    limit: u32,
}

#[utoipa::path(get,path="/api/v1/purchase-orders/{id}/receipts",tag="Purchasing",security(("bearerAuth"=[])),params(sales::OrderQuery,("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ReceiptList),(status=400,description="Entreprise/ID inválido"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=404,description="Compra inexistente"),(status=422,description="Filtros inválidos"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
pub async fn receipts(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    query: Result<Query<sales::OrderQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let (offset, limit) = sales::page(
        query
            .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
            .0,
    )?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "purchasing.orders.read",
        "purchasing.orders.manage",
        false,
    )
    .await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM purchase_orders WHERE tenant_id=$1 AND id=$2)",
    )
    .bind(tenant)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    if !exists {
        return Err(DomainError::NotFound);
    }
    let data=sqlx::query_as::<_,ReceiptSummary>(&format!("{RECEIPT_SUMMARY} WHERE r.tenant_id=$1 AND r.order_id=$2 ORDER BY r.created_at,r.id LIMIT $3 OFFSET $4")).bind(tenant).bind(id).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total = sqlx::query_scalar(
        "SELECT count(*) FROM purchase_receipts WHERE tenant_id=$1 AND order_id=$2",
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
        ReceiptList {
            tenant_id: tenant,
            data,
            total,
            offset,
            limit,
        },
    ))
}
#[utoipa::path(get,path="/api/v1/purchase-receipts/{id}",tag="Purchasing",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ReceiptSnapshot),(status=400,description="Empresa/ID inválido"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso"),(status=404,description="Recebimento inexistente"),(status=500,description="Falha interna"),(status=503,description="Auth indisponível")))]
pub async fn get_receipt(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "purchasing.orders.read",
        "purchasing.orders.manage",
        false,
    )
    .await?;
    let result = load_receipt(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}

#[utoipa::path(post,path="/api/v1/purchase-orders/{id}/receipts",tag="Purchasing",request_body=ReceiptInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=ReceiptResult),(status=400,description="Revisão/empresa inválida"),(status=401,description="Sem credencial"),(status=403,description="Sem acesso a um efeito da cadeia"),(status=404,description="Compra/produto inexistente"),(status=409,description="Quantidade, referência ou estado em conflito"),(status=412,description="Revisão antiga"),(status=422,description="Entrada inválida"),(status=428,description="Precondição obrigatória"),(status=500,description="Falha interna sem efeitos parciais"),(status=503,description="Auth indisponível")))]
pub async fn receive(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ReceiptInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "purchasing.orders.read",
        "purchasing.receipts.create",
        true,
    )
    .await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, "inventory.stock.manage")?;
    access::require_permission(&rights, "finance.payables.originate")?;
    let can_edit = access::require_permission(&rights, "purchasing.orders.manage").is_ok();
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    input.reference = reference(&input.reference)?;
    let occurred = sales::date(&input.occurred_on)?;
    if input.items.is_empty() || input.items.len() > 100 {
        return Err(DomainError::Invalid(
            "Recebimento exige de 1 a 100 produtos distintos",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for line in &mut input.items {
        let quantity = fixed(&line.quantity, 6)?;
        if quantity <= 0 || !seen.insert(line.product_id) {
            return Err(DomainError::Invalid(
                "Quantidades positivas e produtos sem repetição são obrigatórios",
            ));
        }
        line.quantity = decimal(quantity, 6);
    }
    let request = serde_json::json!({"id":id,"revision":expected,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "purchase.receive",
        &request,
    )
    .await?
    {
        let rev = previous["order"]["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, rev, previous));
    }
    let current = load(&mut tx, tenant, id, true).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if !["confirmed", "partially_received"].contains(&current.data.status.as_str()) {
        return Err(DomainError::Conflict(
            "Recebimento exige compra confirmada e saldo pendente",
        ));
    }
    let duplicate:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM purchase_receipts WHERE tenant_id=$1 AND order_id=$2 AND reference=$3)").bind(tenant).bind(id).bind(&input.reference).fetch_one(&mut *tx).await.map_err(db)?;
    if duplicate {
        return Err(DomainError::Conflict("Referência já recebida neste pedido"));
    }
    let mut prepared = Vec::new();
    let mut total = 0_i64;
    for line in &input.items {
        let saved = current
            .items
            .iter()
            .find(|saved| saved.product_id == line.product_id)
            .ok_or(DomainError::Conflict("Produto não pertence à compra"))?;
        let quantity = fixed(&line.quantity, 6)?;
        let received = fixed(&saved.received_quantity, 6)?;
        let ordered = fixed(&saved.quantity, 6)?;
        let cumulative = received
            .checked_add(quantity)
            .filter(|v| *v <= ordered)
            .ok_or(DomainError::Conflict("Quantidade excede o saldo pendente"))?;
        let cost = fixed(&saved.unit_cost, 2)?;
        let delta = amount(cumulative, cost)?
            .checked_sub(amount(received, cost)?)
            .ok_or(AccessError::Internal)?;
        total = total
            .checked_add(delta)
            .filter(|v| *v <= 99999999999999)
            .ok_or(DomainError::Invalid("Recebimento fora do limite"))?;
        prepared.push((
            line.product_id,
            saved.unit.clone(),
            quantity,
            cumulative,
            delta,
        ));
    }
    let receipt_id = Uuid::now_v7();
    sqlx::query("INSERT INTO purchase_receipts(id,tenant_id,order_id,reference,occurred_on,amount_cents) VALUES($1,$2,$3,$4,$5,$6)").bind(receipt_id).bind(tenant).bind(id).bind(&input.reference).bind(occurred).bind(total).execute(&mut *tx).await.map_err(db)?;
    for (product, unit, quantity, cumulative, delta) in prepared {
        sqlx::query("INSERT INTO purchase_receipt_lines(tenant_id,receipt_id,product_id,unit,quantity_micros,amount_cents) VALUES($1,$2,$3,$4,$5,$6)").bind(tenant).bind(receipt_id).bind(product).bind(unit).bind(quantity).bind(delta).execute(&mut *tx).await.map_err(db)?;
        super::inventory::receive_purchase_item(
            &mut tx, tenant, &identity, &headers, receipt_id, product,
        )
        .await?;
        sqlx::query("UPDATE purchase_order_lines SET received_micros=$4 WHERE tenant_id=$1 AND order_id=$2 AND product_id=$3").bind(tenant).bind(id).bind(product).bind(cumulative).execute(&mut *tx).await.map_err(db)?;
    }
    let payable_id = super::payables::originate_purchase_receipt(
        &mut tx, tenant, &identity, &headers, receipt_id,
    )
    .await?;
    let complete:bool=sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM purchase_order_lines WHERE tenant_id=$1 AND order_id=$2 AND received_micros<quantity_micros)").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    let status = if complete {
        "received"
    } else {
        "partially_received"
    };
    sqlx::query("UPDATE purchase_orders SET status=$3,revision=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(status).bind(next).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"purchase_receipt",id:receipt_id,event:"purchase.received",details:serde_json::json!({"orderId":id,"payableId":payable_id,"amount":decimal(total,2),"orderRevision":next})}).await?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"purchase_order",id,event:"purchase.receipt_applied",details:serde_json::json!({"receiptId":receipt_id,"previousRevision":expected,"revision":next,"status":status})}).await?;
    let result = value(ReceiptResult {
        order: load(&mut tx, tenant, id, can_edit).await?,
        receipt: load_receipt(&mut tx, tenant, receipt_id).await?,
        payable_id,
    })?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "purchase.receive",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(next), result))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accumulated_rounding_has_no_partial_receipt_drift() {
        let cost = 1;
        let first = amount(333333, cost).unwrap();
        let second = amount(666666, cost).unwrap() - first;
        let last = amount(1000000, cost).unwrap() - amount(666666, cost).unwrap();
        assert_eq!(first + second + last, 1);
        assert_eq!(first, 0);
        assert!(amount(i64::MAX, i64::MAX).is_err());
    }
}
