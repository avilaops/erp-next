use axum::{
    Extension,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Serialize;
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{
    FiscalError,
    model::{DraftInput, Recipient, exact_decimal},
};
use crate::{
    domains::{DomainError, authorized, db, decimal, party_complements::PartyAddress, response},
    platform::{access, auth::AuthenticatedIdentity, state::AppState},
};

#[derive(FromRow)]
struct Order {
    id: Uuid,
    revision: i64,
    customer_id: Uuid,
    customer_name: String,
    customer_tax_id: String,
    status: String,
    amount_cents: i64,
}

#[derive(FromRow)]
struct Line {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    quantity_micros: i64,
    price_cents: i64,
    amount_cents: i64,
}

async fn order(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Order, DomainError> {
    let order = sqlx::query_as::<_, Order>("SELECT id,revision,customer_id,customer_name,customer_tax_id,status,amount_cents FROM sales_orders WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if !["confirmed", "completed"].contains(&order.status.as_str()) {
        return Err(DomainError::Conflict(
            "A preparação fiscal exige um pedido confirmado ou concluído desta empresa",
        ));
    }
    Ok(order)
}

async fn lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Vec<Line>, DomainError> {
    let lines = sqlx::query_as::<_, Line>("SELECT product_id,sku,name,unit,quantity_micros,price_cents,amount_cents FROM sales_order_lines WHERE tenant_id=$1 AND order_id=$2 ORDER BY line_number")
        .bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?;
    if lines.is_empty() || lines.len() > 990 {
        return Err(DomainError::Conflict(
            "O pedido deve conter de 1 a 990 itens para a preparação fiscal",
        ));
    }
    for line in &lines {
        if line.quantity_micros % 100 != 0 {
            return Err(DomainError::Conflict(
                "O pedido tem quantidades com mais de quatro casas decimais; revise a origem antes da preparação fiscal",
            ));
        }
        if line.sku.len() > 60 {
            return Err(DomainError::Conflict(
                "O SKU registrado no pedido excede 60 caracteres; a origem exige revisão antes da preparação fiscal",
            ));
        }
    }
    Ok(lines)
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreparationLine {
    product_id: Uuid,
    code: String,
    description: String,
    unit: String,
    ncm: Option<String>,
    quantity: String,
    unit_price: String,
    gross_total: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderPreparation {
    tenant_id: Uuid,
    order_id: Uuid,
    order_revision: i64,
    customer_id: Uuid,
    recipient: Recipient,
    items: Vec<PreparationLine>,
    products_total: String,
}

/// Read-only proposal. No draft, reservation, receivable, tax choice or transmission.
#[utoipa::path(get, path="/api/v1/fiscal/order-preparations/{id}", tag="Fiscal", security(("bearerAuth"=[])), params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)), responses((status=200,body=OrderPreparation),(status=403,description="Sem permissões de fiscal, pedidos, clientes ou catálogo"),(status=404,description="Origem não encontrada nesta empresa"),(status=409,description="Pedido ou cadastro incompatível com a preparação")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, FiscalError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.nfe.manage",
        false,
    )
    .await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    for permission in [
        "sales.orders.read",
        "catalog.parties.read",
        "catalog.products.read",
    ] {
        access::require_permission(&rights, permission)?;
    }
    let order = order(&mut tx, tenant, id).await?;
    let customer: Option<(String, serde_json::Value)> = sqlx::query_as("SELECT tax_id,addresses FROM parties WHERE tenant_id=$1 AND id=$2 AND is_customer AND status='active'")
        .bind(tenant).bind(order.customer_id).fetch_optional(&mut *tx).await.map_err(db)?;
    let (tax_id, addresses) = customer.ok_or(DomainError::Conflict(
        "O cliente do pedido precisa estar ativo nesta empresa",
    ))?;
    if tax_id != order.customer_tax_id {
        return Err(DomainError::Conflict(
            "O CPF/CNPJ atual do cliente diverge do registrado no pedido",
        )
        .into());
    }
    let addresses: Vec<PartyAddress> =
        serde_json::from_value(addresses).map_err(|_| access::AccessError::Internal)?;
    let address = addresses
        .iter()
        .find(|address| address.primary)
        .or_else(|| (addresses.len() == 1).then(|| &addresses[0]));
    let mut recipient = Recipient {
        tax_id,
        legal_name: order.customer_name,
        state: String::new(),
        municipality_code: String::new(),
        postal_code: String::new(),
        street: String::new(),
        number: String::new(),
        district: String::new(),
    };
    if let Some(address) = address {
        recipient.state.clone_from(&address.state);
        recipient.postal_code.clone_from(&address.postal_code);
        recipient.street.clone_from(&address.street);
        recipient.number.clone_from(&address.number);
        recipient.district.clone_from(&address.district);
    }
    let mut items = Vec::new();
    for line in lines(&mut tx, tenant, id).await? {
        let ncm: Option<Option<String>> =
            sqlx::query_scalar("SELECT ncm FROM products WHERE tenant_id=$1 AND id=$2")
                .bind(tenant)
                .bind(line.product_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db)?;
        items.push(PreparationLine {
            product_id: line.product_id,
            code: line.sku,
            description: line.name,
            unit: line.unit,
            ncm: ncm.flatten(),
            quantity: decimal(line.quantity_micros / 100, 4),
            unit_price: decimal(line.price_cents, 2),
            gross_total: decimal(line.amount_cents, 2),
        });
    }
    let result = OrderPreparation {
        tenant_id: tenant,
        order_id: order.id,
        order_revision: order.revision,
        customer_id: order.customer_id,
        recipient,
        items,
        products_total: decimal(order.amount_cents, 2),
    };
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}

/// A linked draft represents the full order. Keep its commercial snapshot intact.
pub(super) async fn validate(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    input: &DraftInput,
) -> Result<(), DomainError> {
    let Some(id) = input.source_order_id else {
        return Ok(());
    };
    let rights = access::load_access(tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, "sales.orders.read")?;
    access::require_permission(&rights, "catalog.parties.read")?;
    let order = order(tx, tenant, id).await?;
    let customer_valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM parties WHERE tenant_id=$1 AND id=$2 AND is_customer AND status='active' AND tax_id=$3)")
        .bind(tenant).bind(order.customer_id).bind(&order.customer_tax_id).fetch_one(&mut **tx).await.map_err(db)?;
    if !customer_valid {
        return Err(DomainError::Conflict(
            "O cliente do pedido precisa estar ativo e manter o CPF/CNPJ registrado na venda",
        ));
    }
    if input.recipient.tax_id != order.customer_tax_id
        || exact_decimal(&input.products_total, 13, 2)? != i128::from(order.amount_cents)
    {
        return Err(DomainError::Conflict(
            "Destinatário e total bruto precisam corresponder ao pedido de origem",
        ));
    }
    let mut expected = lines(tx, tenant, id)
        .await?
        .into_iter()
        .map(|line| {
            (
                line.sku,
                line.unit,
                i128::from(line.quantity_micros),
                i128::from(line.price_cents) * 100_000_000,
                i128::from(line.amount_cents),
            )
        })
        .collect::<Vec<_>>();
    let mut received = input
        .items
        .iter()
        .map(|item| {
            Ok((
                item.code.clone(),
                item.unit.clone(),
                exact_decimal(&item.quantity, 11, 4)? * 100,
                exact_decimal(&item.unit_price, 11, 10)?,
                exact_decimal(&item.gross_total, 13, 2)?,
            ))
        })
        .collect::<Result<Vec<_>, DomainError>>()?;
    expected.sort();
    received.sort();
    if expected != received {
        return Err(DomainError::Conflict(
            "Itens, unidades, quantidades e preços precisam corresponder integralmente ao pedido de origem",
        ));
    }
    Ok(())
}
