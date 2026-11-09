//! Legacy managerial formula, adapted to integer cents and explicit rounding.
//! The published version supplies prices, costs and policy; the client supplies no totals.
use crate::{domains::DomainError, platform::commercial_settings_model::CommercialParameters};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const CALCULATOR: &str = "ludus-order-v1-integer-cents";
const LIMIT: i128 = 99_999_999_999_999;

#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimulationItem {
    pub product_id: Uuid,
    pub quantity: u32,
    pub structure_color: Option<String>,
    pub plate_holder_color: Option<String>,
    pub plate_holder_type: Option<String>,
    pub upholstery_color: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum Discount {
    Percent(u32),
    Amount(u64),
    Total(u64),
}

#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimulationInput {
    pub line: String,
    pub version_id: Uuid,
    pub destination_state: String,
    pub taxpayer: bool,
    pub discount: Discount,
    pub freight_cents: u64,
    /// None means the commercial minimum; Some(0) explicitly negotiates no entry.
    pub down_payment_cents: Option<u64>,
    pub items: Vec<SimulationItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalRules {
    pub below_target: bool,
    pub freight: bool,
    pub director_auto_approval: bool,
    pub manager_limit: ManagerLimit,
}

#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ManagerLimit {
    Profit,
    Target,
}

#[derive(Clone, Debug, sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceItem {
    pub product_id: Uuid,
    pub sku: String,
    pub name: String,
    pub unit: String,
    pub product_revision: i64,
    pub cost_revision: i64,
    pub price_cents: i64,
    pub purchase_cents: i64,
    pub credit_bps: i32,
    pub packaging_cents: i64,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct QuotedLine {
    pub product_id: Uuid,
    pub sku: String,
    pub name: String,
    pub unit: String,
    pub quantity: u32,
    pub table_unit_cents: i64,
    pub unit_net_cents: i64,
    pub unit_total_cents: i64,
    pub net_cents: i64,
    pub ipi_cents: i64,
    pub total_cents: i64,
    pub structure_color: Option<String>,
    pub plate_holder_color: Option<String>,
    pub plate_holder_type: Option<String>,
    pub upholstery_color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaleQuote {
    pub calculator_version: String,
    pub items: Vec<QuotedLine>,
    pub table_total_cents: i64,
    pub discount_cents: i64,
    pub discount_bps: u32,
    pub net_sale_cents: i64,
    pub ipi_bps: u32,
    pub ipi_cents: i64,
    pub total_cents: i64,
    pub free_discount_bps: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_at_target_discount_bps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_down_payment_cents: Option<i64>,
    pub minimum_down_payment_bps: u32,
    pub minimum_down_payment_cents: i64,
    pub down_payment_cents: i64,
    pub freight_cents: i64,
    pub approval_reasons: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DirectorQuote {
    pub band: String,
    pub target_bps: u32,
    pub tax_bps: u32,
    pub taxes_cents: i64,
    pub difal_bps: u32,
    pub difal_cents: i64,
    pub equipment_cost_cents: i64,
    pub fixed_fee_cents: i64,
    pub profit_before_income_tax_cents: i64,
    pub income_tax_cents: i64,
    pub net_profit_cents: i64,
    pub net_profit_bps: i64,
    pub supplier_payment_cents: i64,
    pub target_profit_cents: i64,
    pub down_payment_commission_cents: i64,
    pub required_down_payment_cents: i64,
    pub required_down_payment_bps: u32,
    pub minimum_at_target_cents: i64,
    pub maximum_at_target_discount_bps: u32,
    pub maximum_no_loss_discount_bps: u32,
    pub requires_director: bool,
}

fn cents(value: i128) -> Result<i64, DomainError> {
    if !(-LIMIT..=LIMIT).contains(&value) {
        return Err(DomainError::Invalid("Valor comercial fora do limite"));
    }
    Ok(value as i64)
}

/// Half up for nonnegative rationals, avoiding floating point altogether.
fn rounded(numerator: i128, denominator: i128) -> i128 {
    (numerator + denominator / 2) / denominator
}

pub fn calculate(
    p: &CommercialParameters,
    rules: &ApprovalRules,
    input: &SimulationInput,
    sources: &[SourceItem],
) -> Result<(SaleQuote, DirectorQuote), DomainError> {
    p.simulate()?;
    if input.items.is_empty()
        || input.items.len() > 100
        || sources.len() != input.items.len()
        || input.freight_cents > 1_000_000_000_000
    {
        return Err(DomainError::Invalid(
            "Informe de 1 a 100 equipamentos e um frete válido",
        ));
    }
    let row = p
        .state_rates
        .iter()
        .find(|r| r.state == input.destination_state)
        .ok_or(DomainError::Invalid("UF de destino inválida"))?;
    let (icms, difal) = if input.destination_state == p.origin_state {
        (p.domestic_icms_bps, 0)
    } else {
        let outgoing = row.outgoing_bps.unwrap_or(p.interstate_bps);
        (
            outgoing,
            if input.taxpayer {
                0
            } else {
                row.internal_bps.saturating_sub(outgoing) + row.fcp_bps
            },
        )
    };
    let tax = icms
        + p.pis_cofins_bps
        + p.commission_bps
        + p.ads_bps
        + p.gateway_bps
        + p.other_fees_bps
        + p.loss_bps
        + p.warranty_bps
        + p.bad_debt_bps;
    let mut seen = std::collections::HashSet::new();
    let mut table = 0_i128;
    let mut cost_scaled = 0_i128;
    let mut supplier_scaled = 0_i128;
    for (item, source) in input.items.iter().zip(sources) {
        if item.product_id != source.product_id
            || !seen.insert(item.product_id)
            || !(1..=1_000_000).contains(&item.quantity)
            || source.price_cents <= 0
            || source.purchase_cents < 0
            || source.packaging_cents < 0
            || !(0..=10_000).contains(&source.credit_bps)
        {
            return Err(DomainError::Invalid(
                "Equipamento, custo ou quantidade inválidos",
            ));
        }
        let quantity = i128::from(item.quantity);
        table += i128::from(source.price_cents) * quantity;
        cost_scaled += (i128::from(source.purchase_cents)
            * i128::from(10_000 - source.credit_bps)
            * i128::from(10_000 + p.cost_safety_bps)
            + i128::from(source.packaging_cents) * 100_000_000)
            * quantity;
        supplier_scaled +=
            i128::from(source.purchase_cents) * i128::from(10_000 + p.cost_safety_bps) * quantity;
    }
    cents(table)?;
    let net = match input.discount {
        Discount::Percent(bps) if bps < 10_000 => rounded(table * i128::from(10_000 - bps), 10_000),
        Discount::Amount(value) if i128::from(value) < table => table - i128::from(value),
        Discount::Total(value) if value > 0 => {
            rounded(i128::from(value) * 10_000, i128::from(10_000 + p.ipi_bps))
        }
        _ => {
            return Err(DomainError::Invalid(
                "Desconto deve preservar uma venda positiva",
            ));
        }
    };
    if net <= 0 || net > table {
        return Err(DomainError::Invalid(
            "Total desejado deve ser positivo e não superar a tabela",
        ));
    }
    let mut items = Vec::with_capacity(sources.len());
    let mut accumulated = 0_i128;
    let mut allocated = 0_i128;
    let mut total_ipi = 0_i128;
    for (item, source) in input.items.iter().zip(sources) {
        accumulated += i128::from(source.price_cents) * i128::from(item.quantity);
        let cumulative_net = rounded(net * accumulated, table);
        let requested_line_net = cumulative_net - allocated;
        allocated = cumulative_net;
        // Sales order lines use integer unit cents. Normalize the requested total
        // to that precision before calculating any margin or approval decision.
        let unit_net = rounded(requested_line_net, i128::from(item.quantity));
        if unit_net == 0 {
            return Err(DomainError::Invalid(
                "Desconto deixa um equipamento sem valor comercial",
            ));
        }
        let unit_total = rounded(unit_net * i128::from(10_000 + p.ipi_bps), 10_000);
        let line_net = unit_net * i128::from(item.quantity);
        let ipi = (unit_total - unit_net) * i128::from(item.quantity);
        total_ipi += ipi;
        items.push(QuotedLine {
            product_id: item.product_id,
            sku: source.sku.clone(),
            name: source.name.clone(),
            unit: source.unit.clone(),
            quantity: item.quantity,
            table_unit_cents: source.price_cents,
            unit_net_cents: cents(unit_net)?,
            unit_total_cents: cents(unit_total)?,
            net_cents: cents(line_net)?,
            ipi_cents: cents(ipi)?,
            total_cents: cents(line_net + ipi)?,
            structure_color: item.structure_color.clone(),
            plate_holder_color: item.plate_holder_color.clone(),
            plate_holder_type: item.plate_holder_type.clone(),
            upholstery_color: item.upholstery_color.clone(),
        });
    }
    let net = items
        .iter()
        .map(|item| i128::from(item.net_cents))
        .sum::<i128>();
    let total = net + total_ipi;
    let taxes = rounded(net * i128::from(tax), 10_000);
    let difal_amount = rounded(net * i128::from(difal), 10_000);
    let cost = rounded(cost_scaled, 100_000_000);
    let fixed = i128::from(input.freight_cents) + i128::from(p.fixed_order_fee_cents);
    let before_ir = net - taxes - difal_amount - cost - fixed;
    let ir = rounded(before_ir.max(0) * i128::from(p.income_tax_bps), 10_000);
    let profit = before_ir - ir;
    let target = rounded(net * i128::from(p.net_margin_bps), 10_000);
    let band = if profit < 0 {
        "loss"
    } else if profit < target {
        "belowTarget"
    } else {
        "atTarget"
    };
    let supplier = rounded(supplier_scaled, 10_000);
    let entry_denominator = i128::from(10_000 + p.ipi_bps - p.commission_bps);
    if entry_denominator <= 0 {
        return Err(DomainError::Invalid(
            "Comissão inviabiliza o cálculo da entrada",
        ));
    }
    let required_entry = rounded(
        (supplier + target) * i128::from(10_000 + p.ipi_bps),
        entry_denominator,
    );
    let minimum_entry = rounded(total * i128::from(p.minimum_down_payment_bps), 10_000);
    let entry = input
        .down_payment_cents
        .map(i128::from)
        .unwrap_or(minimum_entry);
    if entry > total {
        return Err(DomainError::Invalid(
            "Entrada não pode superar o total da venda",
        ));
    }
    let discount = table - net;
    let mut reasons = Vec::new();
    if discount * 10_000 > table * i128::from(p.free_discount_bps) {
        reasons.push("desconto-acima-do-livre".into());
    }
    if profit < 0 || (rules.below_target && band != "atTarget") {
        reasons.push("fora-da-meta".into());
    }
    if rules.freight && input.freight_cents > 0 {
        reasons.push("frete-por-nossa-conta".into());
    }
    if entry < minimum_entry {
        reasons.push("entrada-abaixo-da-politica".into());
    }
    let retained = i128::from(10_000 - p.income_tax_bps);
    let available = (10_000 - i128::from(tax + difal)) * retained;
    let minimum = |margin: u32| -> Option<i128> {
        let denominator = available - i128::from(margin) * 10_000;
        (denominator > 0)
            .then(|| ((cost + fixed) * 10_000 * retained + denominator - 1) / denominator)
    };
    let minimum_target = minimum(p.net_margin_bps)
        .ok_or(DomainError::Invalid("Destino sem margem comercial viável"))?;
    let discount_limit = |margin| -> u32 {
        minimum(margin)
            .map(|min| ((table - min).max(0) * 10_000 / table).min(10_000) as u32)
            .unwrap_or(0)
    };
    let maximum_at_target_discount_bps = discount_limit(p.net_margin_bps);
    let required_down_payment_cents = cents(required_entry)?;
    Ok((
        SaleQuote {
            calculator_version: CALCULATOR.into(),
            items,
            table_total_cents: cents(table)?,
            discount_cents: cents(discount)?,
            discount_bps: (discount * 10_000 / table) as u32,
            net_sale_cents: cents(net)?,
            ipi_bps: p.ipi_bps,
            ipi_cents: cents(total_ipi)?,
            total_cents: cents(total)?,
            free_discount_bps: p.free_discount_bps,
            maximum_at_target_discount_bps: Some(maximum_at_target_discount_bps),
            required_down_payment_cents: Some(required_down_payment_cents),
            minimum_down_payment_bps: p.minimum_down_payment_bps,
            minimum_down_payment_cents: cents(minimum_entry)?,
            down_payment_cents: cents(entry)?,
            freight_cents: input.freight_cents as i64,
            approval_reasons: reasons,
        },
        DirectorQuote {
            band: band.into(),
            target_bps: p.net_margin_bps,
            tax_bps: tax,
            taxes_cents: cents(taxes)?,
            difal_bps: difal,
            difal_cents: cents(difal_amount)?,
            equipment_cost_cents: cents(cost)?,
            fixed_fee_cents: p.fixed_order_fee_cents as i64,
            profit_before_income_tax_cents: cents(before_ir)?,
            income_tax_cents: cents(ir)?,
            net_profit_cents: cents(profit)?,
            net_profit_bps: (profit * 10_000 / net) as i64,
            supplier_payment_cents: cents(supplier)?,
            target_profit_cents: cents(target)?,
            down_payment_commission_cents: cents(required_entry - supplier - target)?,
            required_down_payment_cents,
            required_down_payment_bps: (required_entry * 10_000 / total)
                .try_into()
                .map_err(|_| DomainError::Invalid("Entrada necessária fora do limite"))?,
            minimum_at_target_cents: cents(rounded(
                minimum_target * i128::from(10_000 + p.ipi_bps),
                10_000,
            ))?,
            maximum_at_target_discount_bps,
            maximum_no_loss_discount_bps: discount_limit(0),
            requires_director: profit < 0
                || (matches!(rules.manager_limit, ManagerLimit::Target) && band != "atTarget"),
        },
    ))
}
