use super::{
    DomainChange, DomainError, authorized, catalog, command_key, db, decimal, fixed, record,
    remember, replay, response, revision,
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
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

pub mod settings;

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OrderItemInput {
    product_id: Uuid,
    quantity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    structure_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    upholstery_color: Option<String>,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OrderInput {
    customer_id: Uuid,
    due_date: String,
    items: Vec<OrderItemInput>,
}

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderSummary {
    pub id: Uuid,
    pub customer_id: Uuid,
    pub customer_name: String,
    pub customer_tax_id: String,
    pub due_date: String,
    pub amount: String,
    pub status: String,
    pub revision: i64,
}
#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderLine {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    quantity: String,
    unit_price: String,
    amount: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    structure_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    upholstery_color: Option<String>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderSnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: OrderSummary,
    items: Vec<OrderLine>,
}
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct OrderQuery {
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderList {
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<OrderSummary>,
    total: i64,
    offset: u32,
    limit: u32,
}

pub(super) fn page(query: OrderQuery) -> Result<(u32, u32), DomainError> {
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(25);
    if offset > 100000 || !(1..=100).contains(&limit) {
        return Err(DomainError::Invalid("Paginação inválida"));
    }
    Ok((offset, limit))
}
pub(super) fn date(raw: &str) -> Result<time::Date, DomainError> {
    if raw.len() != 10
        || raw.as_bytes()[4] != b'-'
        || raw.as_bytes()[7] != b'-'
        || !raw
            .bytes()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return Err(DomainError::Invalid("Data deve usar AAAA-MM-DD"));
    }
    let year: i32 = raw[..4]
        .parse()
        .map_err(|_| DomainError::Invalid("Ano inválido"))?;
    let month: u8 = raw[5..7]
        .parse()
        .map_err(|_| DomainError::Invalid("Mês inválido"))?;
    let day: u8 = raw[8..]
        .parse()
        .map_err(|_| DomainError::Invalid("Dia inválido"))?;
    if !(1900..=2100).contains(&year) {
        return Err(DomainError::Invalid("Ano fora do intervalo permitido"));
    }
    time::Date::from_calendar_date(
        year,
        time::Month::try_from(month).map_err(|_| DomainError::Invalid("Mês inválido"))?,
        day,
    )
    .map_err(|_| DomainError::Invalid("Data inexistente"))
}

pub(super) async fn reserved(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    product: Uuid,
) -> Result<i64, DomainError> {
    sqlx::query_scalar("SELECT COALESCE(sum(l.quantity_micros),0)::bigint FROM sales_order_lines l JOIN sales_orders o ON o.tenant_id=l.tenant_id AND o.id=l.order_id WHERE l.tenant_id=$1 AND l.product_id=$2 AND o.status='confirmed'")
        .bind(tenant).bind(product).fetch_one(&mut **tx).await.map_err(db)
}

#[derive(FromRow)]
pub(super) struct ReceivableOrigin {
    pub order_id: Uuid,
    pub customer_name: String,
    pub due_date: time::Date,
    pub amount_cents: i64,
}

pub(super) async fn receivable_origin(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<ReceivableOrigin, DomainError> {
    sqlx::query_as::<_, ReceivableOrigin>("SELECT id AS order_id,customer_name,due_date,amount_cents FROM sales_orders WHERE tenant_id=$1 AND id=$2 AND status='confirmed'")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::Conflict("A origem do recebível exige um pedido confirmado desta empresa"))
}

pub(super) async fn reserved_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
    product: Uuid,
) -> Result<(i64, String), DomainError> {
    sqlx::query_as::<_, (i64, String)>("SELECT l.quantity_micros,l.unit FROM sales_order_lines l JOIN sales_orders o ON o.tenant_id=l.tenant_id AND o.id=l.order_id WHERE l.tenant_id=$1 AND l.order_id=$2 AND l.product_id=$3 AND o.status='confirmed'")
        .bind(tenant).bind(order).bind(product).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::Conflict("A saída exige uma reserva confirmada deste pedido e produto"))
}
async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    can_edit: bool,
) -> Result<OrderSnapshot, DomainError> {
    let data=sqlx::query_as::<_,OrderSummary>("SELECT id,customer_id,customer_name,customer_tax_id,due_date::text AS due_date,(amount_cents::numeric/100)::numeric(16,2)::text AS amount,status,revision FROM sales_orders WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let items=sqlx::query_as::<_,OrderLine>("SELECT product_id,sku,name,unit,(quantity_micros::numeric/1000000)::numeric(19,6)::text AS quantity,(price_cents::numeric/100)::numeric(16,2)::text AS unit_price,(amount_cents::numeric/100)::numeric(16,2)::text AS amount,structure_color,upholstery_color FROM sales_order_lines WHERE tenant_id=$1 AND order_id=$2 ORDER BY line_number")
        .bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?;
    Ok(OrderSnapshot {
        tenant_id: tenant,
        can_edit,
        data,
        items,
    })
}

#[utoipa::path(get,path="/api/v1/orders",tag="Sales",security(("bearerAuth"=[])),params(OrderQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=OrderList),(status=403,description="Sem permissão"),(status=422,description="Filtros inválidos")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<OrderQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let (offset, limit) = page(
        query
            .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
            .0,
    )?;
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "sales.orders.read",
        "sales.orders.manage",
        false,
    )
    .await?;
    let data=sqlx::query_as::<_,OrderSummary>("SELECT id,customer_id,customer_name,customer_tax_id,due_date::text AS due_date,(amount_cents::numeric/100)::numeric(16,2)::text AS amount,status,revision FROM sales_orders WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3")
        .bind(tenant).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total = sqlx::query_scalar("SELECT count(*) FROM sales_orders WHERE tenant_id=$1")
        .bind(tenant)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        OrderList {
            tenant_id: tenant,
            can_edit,
            data,
            total,
            offset,
            limit,
        },
    ))
}
#[utoipa::path(get,path="/api/v1/orders/{id}",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=OrderSnapshot),(status=403,description="Sem permissão"),(status=404,description="Pedido não encontrado")))]
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
        "sales.orders.read",
        "sales.orders.manage",
        false,
    )
    .await?;
    let value = load(&mut tx, tenant, id, can_edit).await?;
    let rev = value.data.revision;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(rev), value))
}

struct PreparedLine {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    quantity: i64,
    price: i64,
    amount: i64,
    structure_color: Option<String>,
    upholstery_color: Option<String>,
}

fn select_color(
    requested: Option<&str>,
    available: &[String],
    previous: Option<&str>,
) -> Result<Option<String>, DomainError> {
    let selected = requested
        .or(previous)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(selected) = selected else {
        return if available.is_empty() {
            Ok(None)
        } else {
            Err(DomainError::Invalid(
                "Escolha as cores disponíveis da estrutura e do estofado antes de salvar",
            ))
        };
    };
    if previous == Some(selected) {
        return Ok(Some(selected.to_owned()));
    }
    available
        .iter()
        .find(|color| color.to_lowercase() == selected.to_lowercase())
        .cloned()
        .map(Some)
        .ok_or(DomainError::Invalid(
            "A cor escolhida não está disponível neste produto; atualize as opções antes de salvar",
        ))
}

struct PreparedOrder {
    customer_name: String,
    customer_tax_id: String,
    due: time::Date,
    total: i64,
    lines: Vec<PreparedLine>,
}

async fn prepare_order(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    input: &OrderInput,
    previous: Option<&OrderSnapshot>,
) -> Result<PreparedOrder, DomainError> {
    let due = date(&input.due_date)?;
    if input.items.is_empty() || input.items.len() > 100 {
        return Err(DomainError::Invalid("Pedido exige de 1 a 100 itens"));
    }
    let customer = sqlx::query_as::<_, (String, String)>(
        "SELECT legal_name,tax_id FROM parties WHERE tenant_id=$1 AND id=$2 AND is_customer AND status='active'",
    ).bind(tenant).bind(input.customer_id).fetch_optional(&mut **tx).await.map_err(db)?
        .ok_or(DomainError::Conflict("Selecione um cliente ativo desta empresa"))?;
    let (customer_name, customer_tax_id) = match previous {
        Some(order) if order.data.customer_id == input.customer_id => (
            order.data.customer_name.clone(),
            order.data.customer_tax_id.clone(),
        ),
        _ => customer,
    };
    let mut lines = Vec::with_capacity(input.items.len());
    let mut seen = std::collections::HashSet::new();
    let mut total = 0_i64;
    for item in &input.items {
        if !seen.insert(item.product_id) {
            return Err(DomainError::Invalid(
                "Agrupe a quantidade de cada produto em um único item",
            ));
        }
        let quantity = fixed(&item.quantity, 6)?;
        if quantity == 0 {
            return Err(DomainError::Invalid("Quantidade deve ser positiva"));
        }
        let product = catalog::load(tx, tenant, item.product_id).await?;
        if product.data.status != "active" {
            return Err(DomainError::Conflict(
                "Produto arquivado não pode compor um rascunho",
            ));
        }
        let saved = previous.and_then(|order| {
            order
                .items
                .iter()
                .find(|line| line.product_id == item.product_id)
        });
        if saved.is_some_and(|line| line.unit != product.data.unit) {
            return Err(DomainError::Conflict(
                "Unidade do produto mudou no catálogo. Substitua o item ou crie outro pedido",
            ));
        }
        let structure_color = select_color(
            item.structure_color.as_deref(),
            product.data.structure_colors.as_deref().unwrap_or_default(),
            saved.and_then(|line| line.structure_color.as_deref()),
        )?;
        let upholstery_color = select_color(
            item.upholstery_color.as_deref(),
            product
                .data
                .upholstery_colors
                .as_deref()
                .unwrap_or_default(),
            saved.and_then(|line| line.upholstery_color.as_deref()),
        )?;
        let (sku, name, unit, price) = match saved {
            Some(line) => (
                line.sku.clone(),
                line.name.clone(),
                line.unit.clone(),
                fixed(&line.unit_price, 2)?,
            ),
            None => (
                product.data.sku,
                product.data.name,
                product.data.unit,
                fixed(&product.data.base_price, 2)?,
            ),
        };
        // Existing lines retain their agreed price; only new lines use the catalog.
        let amount = i64::try_from((i128::from(price) * i128::from(quantity) + 500000) / 1000000)
            .map_err(|_| DomainError::Invalid("Valor do item fora do limite"))?;
        total = total
            .checked_add(amount)
            .filter(|value| *value <= 99999999999999)
            .ok_or(DomainError::Invalid("Total fora do limite"))?;
        lines.push(PreparedLine {
            product_id: item.product_id,
            sku,
            name,
            unit,
            quantity,
            price,
            amount,
            structure_color,
            upholstery_color,
        });
    }
    if total == 0 {
        return Err(DomainError::Invalid(
            "Pedido precisa ter valor comercial positivo",
        ));
    }
    Ok(PreparedOrder {
        customer_name,
        customer_tax_id,
        due,
        total,
        lines,
    })
}

async fn store_lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
    lines: &[PreparedLine],
) -> Result<(), DomainError> {
    for (index, line) in lines.iter().enumerate() {
        sqlx::query("INSERT INTO sales_order_lines(tenant_id,order_id,line_number,product_id,sku,name,unit,quantity_micros,price_cents,amount_cents,structure_color,upholstery_color) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(tenant).bind(order).bind((index+1) as i32).bind(line.product_id).bind(&line.sku).bind(&line.name).bind(&line.unit).bind(line.quantity).bind(line.price).bind(line.amount).bind(&line.structure_color).bind(&line.upholstery_color).execute(&mut **tx).await.map_err(db)?;
    }
    Ok(())
}

#[utoipa::path(post,path="/api/v1/orders",tag="Sales",request_body=OrderInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=OrderSnapshot),(status=403,description="Sem permissão"),(status=409,description="Cadastros ou comando em conflito"),(status=422,description="Pedido inválido"),(status=428,description="Chave obrigatória")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<OrderInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "sales.orders.read",
        "sales.orders.manage",
        true,
    )
    .await?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let request = serde_json::to_value(&input).map_err(|_| AccessError::Internal)?;
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.create",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, rev, previous));
    }
    let prepared = prepare_order(&mut tx, tenant, &input, None).await?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES($1,$2,$3,$4,$5,$6,$7,'draft')")
        .bind(id).bind(tenant).bind(input.customer_id).bind(&prepared.customer_name).bind(&prepared.customer_tax_id).bind(prepared.due).bind(prepared.total).execute(&mut *tx).await.map_err(db)?;
    store_lines(&mut tx, tenant, id, &prepared.lines).await?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"sales_order",id,event:"order.created",details:serde_json::json!({"revision":1,"amount":decimal(prepared.total,2),"items":prepared.lines.len()})}).await?;
    let value = serde_json::to_value(load(&mut tx, tenant, id, true).await?)
        .map_err(|_| AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.create",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), value))
}

#[utoipa::path(put,path="/api/v1/orders/{id}",tag="Sales",request_body=OrderInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=OrderSnapshot),(status=403,description="Sem permissão"),(status=404,description="Pedido ou produto não encontrado"),(status=409,description="Somente rascunho e cadastros compatíveis"),(status=412,description="Revisão divergente"),(status=422,description="Pedido inválido"),(status=428,description="Revisão e chave obrigatórias")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<OrderInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "sales.orders.read",
        "sales.orders.manage",
        true,
    )
    .await?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let request = serde_json::json!({"id":id,"revision":expected,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.update",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        let mut reply = response(StatusCode::OK, rev, previous);
        reply.headers_mut().insert(
            "idempotency-replayed",
            axum::http::HeaderValue::from_static("true"),
        );
        return Ok(reply);
    }
    let current = load(&mut tx, tenant, id, true).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if current.data.status != "draft" {
        return Err(DomainError::Conflict(
            "Somente pedidos em rascunho podem ser editados",
        ));
    }
    let prepared = prepare_order(&mut tx, tenant, &input, Some(&current)).await?;
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    let updated = sqlx::query("UPDATE sales_orders SET customer_id=$3,customer_name=$4,customer_tax_id=$5,due_date=$6,amount_cents=$7,revision=$8,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='draft' AND revision=$9")
        .bind(tenant).bind(id).bind(input.customer_id).bind(&prepared.customer_name).bind(&prepared.customer_tax_id).bind(prepared.due).bind(prepared.total).bind(next).bind(expected).execute(&mut *tx).await.map_err(db)?;
    if updated.rows_affected() != 1 {
        return Err(DomainError::StaleRevision);
    }
    sqlx::query("DELETE FROM sales_order_lines WHERE tenant_id=$1 AND order_id=$2")
        .bind(tenant)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    store_lines(&mut tx, tenant, id, &prepared.lines).await?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"sales_order",id,event:"order.updated",details:serde_json::json!({"previousRevision":expected,"revision":next,"previousAmount":current.data.amount,"amount":decimal(prepared.total,2),"items":prepared.lines.len()})}).await?;
    let value = serde_json::to_value(load(&mut tx, tenant, id, true).await?)
        .map_err(|_| AccessError::Internal)?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.update",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), value))
}

enum Action {
    Confirm,
    Cancel,
    Complete,
}
async fn transition(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Uuid,
    action: Action,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "sales.orders.read",
        "sales.orders.manage",
        true,
    )
    .await?;
    let (scope, event, target) = match action {
        Action::Confirm => ("order.confirm", "order.confirmed", "confirmed"),
        Action::Cancel => ("order.cancel", "order.cancelled", "cancelled"),
        Action::Complete => ("order.complete", "order.completed", "completed"),
    };
    let request = serde_json::json!({"id":id,"revision":expected});
    if matches!(action, Action::Cancel) {
        super::production::require_cancellation_permissions(&mut tx, tenant, &identity, id).await?;
    }
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
        Action::Cancel => ["draft", "confirmed"].contains(&current.data.status.as_str()),
        Action::Complete => current.data.status == "confirmed",
    };
    if !allowed {
        return Err(DomainError::Conflict(
            "Transição não permitida para a situação atual do pedido",
        ));
    }
    if matches!(action, Action::Confirm | Action::Complete) {
        let active=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM parties WHERE tenant_id=$1 AND id=$2 AND is_customer AND status='active')").bind(tenant).bind(current.data.customer_id).fetch_one(&mut *tx).await.map_err(db)?;
        if !active {
            return Err(DomainError::Conflict(
                "O cliente precisa estar ativo para esta operação",
            ));
        }
        if matches!(action, Action::Confirm) {
            settings::validate_confirmation(&mut tx, tenant, &current).await?;
        }
        for item in &current.items {
            if matches!(action, Action::Complete) {
                super::inventory::issue_reserved_order(
                    &mut tx,
                    tenant,
                    &identity,
                    &headers,
                    super::inventory::OrderIssue {
                        order_id: id,
                        product_id: item.product_id,
                    },
                )
                .await?;
                continue;
            }
            let product = catalog::load(&mut tx, tenant, item.product_id).await?;
            if product.data.unit != item.unit {
                return Err(DomainError::Conflict(
                    "Unidade do produto mudou desde o rascunho. Cancele e recrie o pedido",
                ));
            }
            if product.data.status != "active" {
                return Err(DomainError::Conflict(
                    "O produto precisa estar ativo para esta operação",
                ));
            }
            let balance=sqlx::query_scalar::<_,i64>("SELECT COALESCE((SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2),0)").bind(tenant).bind(item.product_id).fetch_one(&mut *tx).await.map_err(db)?;
            let quantity = fixed(&item.quantity, 6)?;
            let held = reserved(&mut tx, tenant, item.product_id).await?;
            if (matches!(action, Action::Confirm) && balance - held < quantity) || balance < held {
                return Err(DomainError::Conflict(
                    "Saldo disponível insuficiente para reservar ou concluir o pedido",
                ));
            }
        }
    }
    if matches!(action, Action::Complete) {
        super::finance::originate_order_receivable(&mut tx, tenant, &identity, &headers, id)
            .await?;
    }
    let next = expected.checked_add(1).ok_or(AccessError::Internal)?;
    if matches!(action, Action::Cancel) {
        super::returns::reconcile_unshipped(&mut tx, tenant, &identity, &headers, id, next).await?;
    }
    sqlx::query("UPDATE sales_orders SET status=$3,revision=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(target).bind(next).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"sales_order",id,event,details:serde_json::json!({"previousRevision":expected,"revision":next,"previousStatus":current.data.status,"status":target})}).await?;
    let value = serde_json::to_value(load(&mut tx, tenant, id, true).await?)
        .map_err(|_| AccessError::Internal)?;
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
    Ok(response(StatusCode::OK, Some(next), value))
}
#[utoipa::path(post,path="/api/v1/orders/{id}/confirm",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=OrderSnapshot),(status=403,description="Sem permissão"),(status=409,description="Saldo ou estado em conflito"),(status=412,description="Revisão divergente"),(status=428,description="Precondições obrigatórias")))]
pub async fn confirm(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    transition(state, identity, headers, id, Action::Confirm).await
}
#[utoipa::path(post,path="/api/v1/orders/{id}/cancel",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=OrderSnapshot),(status=403,description="Sem permissão"),(status=409,description="Estado em conflito"),(status=412,description="Revisão divergente"),(status=428,description="Precondições obrigatórias")))]
pub async fn cancel(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    transition(state, identity, headers, id, Action::Cancel).await
}
#[utoipa::path(post,path="/api/v1/orders/{id}/complete",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=OrderSnapshot),(status=403,description="Sem permissão"),(status=409,description="Estado ou cadastros em conflito"),(status=412,description="Revisão divergente"),(status=428,description="Precondições obrigatórias")))]
pub async fn complete(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    transition(state, identity, headers, id, Action::Complete).await
}
