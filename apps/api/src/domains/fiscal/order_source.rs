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
    domains::{
        DomainError, authorized, db, decimal, party_complements::PartyAddress, response,
        sales::negotiation_model::SaleQuote,
    },
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
    structure_color: Option<String>,
    swing_arm_color: Option<String>,
    plate_holder_color: Option<String>,
    plate_holder_type: Option<String>,
    upholstery_color: Option<String>,
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    quantity_micros: i64,
    price_cents: i64,
    amount_cents: i64,
}

impl Line {
    fn finish_information(&self) -> Option<String> {
        self.describe_finish(false)
    }

    // Previously generated linked drafts may retain the old description.
    fn recorded_finish_information(&self) -> Option<String> {
        self.describe_finish(true)
    }

    fn describe_finish(&self, include_legacy_holder_color: bool) -> Option<String> {
        let values = [
            ("Estrutura", &self.structure_color, true),
            ("Braços", &self.swing_arm_color, true),
            (
                "Anilheiros",
                &self.plate_holder_color,
                include_legacy_holder_color,
            ),
            ("Tipo de anilheiro", &self.plate_holder_type, true),
            ("Estofado", &self.upholstery_color, true),
        ]
        .into_iter()
        .filter(|(_, _, include)| *include)
        .filter_map(|(label, value, _)| {
            value
                .as_deref()
                .filter(|s| !s.is_empty())
                .map(|s| format!("{label}: {s}"))
        })
        .collect::<Vec<_>>();
        (!values.is_empty()).then(|| values.join("; "))
    }
}

async fn commercial_quote(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Option<SaleQuote>, DomainError> {
    let sale: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT public_snapshot->'sale' FROM commercial_order_quotes WHERE tenant_id=$1 AND order_id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?;
    sale.map(|sale| {
        serde_json::from_value(sale)
            .map_err(|_| DomainError::Conflict("A composição da negociação preservada é inválida"))
    })
    .transpose()
}

async fn order(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Order, DomainError> {
    let mut order = sqlx::query_as::<_, Order>("SELECT id,revision,customer_id,customer_name,customer_tax_id,status,amount_cents FROM sales_orders WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if !["confirmed", "completed"].contains(&order.status.as_str()) {
        return Err(DomainError::Conflict(
            "A preparação fiscal exige um pedido confirmado ou concluído desta empresa",
        ));
    }
    // A simulated commercial total already includes IPI. Fiscal preparation
    // starts from the preserved net sale and still requires explicit tax declarations.
    if let Some(sale) = commercial_quote(tx, tenant, id).await? {
        let net = sale
            .items
            .iter()
            .try_fold(0_i64, |total, item| total.checked_add(item.net_cents));
        if order.amount_cents != sale.total_cents
            || sale.net_sale_cents <= 0
            || net != Some(sale.net_sale_cents)
        {
            return Err(DomainError::Conflict(
                "A composição do pedido diverge da negociação preservada",
            ));
        }
        order.amount_cents = sale.net_sale_cents;
    } else {
        let net: Option<i64> = sqlx::query_scalar("SELECT (snapshot#>>'{sale,netSaleCents}')::bigint FROM order_pricing_snapshots WHERE tenant_id=$1 AND order_id=$2")
            .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?;
        if let Some(net) = net {
            order.amount_cents = net;
        }
    }
    Ok(order)
}

async fn lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Vec<Line>, DomainError> {
    let mut lines = sqlx::query_as::<_, Line>("SELECT product_id,sku,name,unit,quantity_micros,price_cents,amount_cents,structure_color,swing_arm_color,plate_holder_color,plate_holder_type,upholstery_color FROM sales_order_lines WHERE tenant_id=$1 AND order_id=$2 ORDER BY line_number")
        .bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?;
    if lines.is_empty() || lines.len() > 990 {
        return Err(DomainError::Conflict(
            "O pedido deve conter de 1 a 990 itens para a preparação fiscal",
        ));
    }
    if let Some(sale) = commercial_quote(tx, tenant, id).await? {
        if lines.len() != sale.items.len()
            || lines.iter().zip(&sale.items).any(|(line, item)| {
                line.product_id != item.product_id
                    || line.sku != item.sku
                    || line.unit != item.unit
                    || line.quantity_micros != i64::from(item.quantity) * 1_000_000
                    || line.price_cents != item.unit_total_cents
                    || line.amount_cents != item.total_cents
                    || item.unit_net_cents <= 0
                    || item.unit_net_cents.checked_mul(i64::from(item.quantity))
                        != Some(item.net_cents)
            })
        {
            return Err(DomainError::Conflict(
                "A composição do pedido diverge da negociação preservada",
            ));
        }
        for (line, item) in lines.iter_mut().zip(sale.items) {
            line.price_cents = item.unit_net_cents;
            line.amount_cents = item.net_cents;
        }
    } else {
        let simulated: Option<(i64,i64)> = sqlx::query_as("SELECT (snapshot#>>'{sale,unitWithoutIpiCents}')::bigint,(snapshot#>>'{sale,netSaleCents}')::bigint FROM order_pricing_snapshots WHERE tenant_id=$1 AND order_id=$2")
            .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?;
        if let Some((unit, net)) = simulated {
            if lines.len() != 1 {
                return Err(DomainError::Conflict(
                    "A composição do pedido diverge da simulação preservada",
                ));
            }
            lines[0].price_cents = unit;
            lines[0].amount_cents = net;
        }
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
    additional_info: Option<String>,
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
        foreign_id: None,
        country_code: None,
        country_name: None,
        tax_id,
        legal_name: order.customer_name,
        state: String::new(),
        municipality_code: String::new(),
        postal_code: String::new(),
        street: String::new(),
        number: String::new(),
        district: String::new(),
        complement: None,
        phone: None,
        email: None,
        city_name: None,
    };
    if let Some(address) = address {
        recipient.state.clone_from(&address.state);
        recipient.municipality_code = address.municipality_code.clone().unwrap_or_default();
        recipient.postal_code.clone_from(&address.postal_code);
        recipient.street.clone_from(&address.street);
        recipient.number.clone_from(&address.number);
        recipient.district.clone_from(&address.district);
        recipient.complement.clone_from(&address.complement);
        recipient.city_name = Some(address.city.clone());
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
            additional_info: line.finish_information(),
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
            let additional_info = line.finish_information();
            let recorded_info = line.recorded_finish_information();
            (
                (
                    line.sku,
                    line.unit,
                    i128::from(line.quantity_micros),
                    i128::from(line.price_cents) * 100_000_000,
                    i128::from(line.amount_cents),
                ),
                additional_info,
                recorded_info,
            )
        })
        .collect::<Vec<_>>();
    let mut received = input
        .items
        .iter()
        .map(|item| {
            Ok((
                (
                    item.code.clone(),
                    item.unit.clone(),
                    exact_decimal(&item.quantity, 11, 4)? * 100,
                    exact_decimal(&item.unit_price, 11, 10)?,
                    exact_decimal(&item.gross_total, 13, 2)?,
                ),
                item.additional_info.clone(),
            ))
        })
        .collect::<Result<Vec<_>, DomainError>>()?;
    expected.sort_by(|left, right| left.0.cmp(&right.0));
    received.sort_by(|left, right| left.0.cmp(&right.0));
    if expected.len() != received.len()
        || expected.iter().zip(&received).any(|(expected, received)| {
            expected.0 != received.0 || (expected.1 != received.1 && expected.2 != received.1)
        })
    {
        return Err(DomainError::Conflict(
            "Itens, unidades, quantidades e preços precisam corresponder integralmente ao pedido de origem",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fiscal_finish_information_contains_structure_upholstery_and_holder_type() {
        let line = Line {
            structure_color: Some("Preto".into()),
            swing_arm_color: Some("Apple Green".into()),
            plate_holder_color: Some("Azul legado".into()),
            plate_holder_type: Some("Olímpico".into()),
            upholstery_color: Some("Vermelho".into()),
            product_id: Uuid::nil(),
            sku: "TEST".into(),
            name: "Equipamento".into(),
            unit: "UN".into(),
            quantity_micros: 1_000_000,
            price_cents: 100,
            amount_cents: 100,
        };
        assert_eq!(
            line.finish_information().as_deref(),
            Some(
                "Estrutura: Preto; Braços: Apple Green; Tipo de anilheiro: Olímpico; Estofado: Vermelho"
            )
        );
        assert_eq!(
            line.recorded_finish_information().as_deref(),
            Some(
                "Estrutura: Preto; Braços: Apple Green; Anilheiros: Azul legado; Tipo de anilheiro: Olímpico; Estofado: Vermelho"
            )
        );
    }
}
