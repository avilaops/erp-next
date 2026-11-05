//! Deterministic managerial quote. Integer cents, one final rounding per unit.
use crate::domains::DomainError;
use crate::platform::commercial_settings_model::CommercialParameters;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
#[path = "pricing_model_tests.rs"]
mod tests;

const BPS: i128 = 10_000;
const MAX_MONEY: i64 = 99_999_999_999_999;

#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuoteInput {
    pub version_id: Uuid,
    pub product_id: Uuid,
    pub quantity: u32,
    pub destination: String,
    pub taxpayer: bool,
    pub discount: Discount,
    pub freight_cents: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Discount {
    Percent(u32),
    Amount(i64),
    Target(i64),
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedCost {
    pub purchase_cost_cents: i64,
    pub tax_credit_bps: u32,
    pub packaging_cents: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleQuote {
    pub quantity: u32,
    pub table_unit_cents: i64,
    pub table_total_cents: i64,
    pub discount_cents: i64,
    pub discount_bps: u32,
    pub unit_without_ipi_cents: i64,
    pub unit_with_ipi_cents: i64,
    pub net_sale_cents: i64,
    pub ipi_cents: i64,
    pub ipi_bps: u32,
    pub invoice_total_cents: i64,
    pub minimum_down_payment_bps: u32,
    pub minimum_down_payment_cents: i64,
    pub free_discount_bps: u32,
    pub freight_cents: i64,
    pub band: &'static str,
    pub needs_approval: bool,
    pub approval_reasons: Vec<&'static str>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorQuote {
    pub icms_cents: i64,
    pub pis_cofins_cents: i64,
    pub channel_cents: i64,
    pub provisions_cents: i64,
    pub rounding_cents: i64,
    pub equipment_cost_cents: i64,
    pub fixed_fee_cents: i64,
    pub profit_before_income_tax_cents: i64,
    pub income_tax_cents: i64,
    pub net_profit_cents: i64,
    pub net_profit_bps: i64,
    pub target_margin_bps: u32,
    pub at_target_bps: Option<u32>,
    pub no_loss_bps: Option<u32>,
    pub minimum_target_unit_with_ipi_cents: i64,
    pub supplier_payment_cents: i64,
    pub target_profit_cents: i64,
    pub down_payment_commission_cents: i64,
    pub required_down_payment_cents: i64,
    pub required_down_payment_bps: i64,
}
pub struct Quote {
    pub sale: SaleQuote,
    pub director: DirectorQuote,
}

fn cents(value: i128) -> Result<i64, DomainError> {
    i64::try_from(value)
        .ok()
        .filter(|amount| amount.abs() <= MAX_MONEY)
        .ok_or(DomainError::Invalid("Valor da simulação fora do limite"))
}
fn rounded(numerator: i128, denominator: i128) -> i128 {
    if numerator < 0 {
        -rounded(-numerator, denominator)
    } else {
        (numerator + denominator / 2) / denominator
    }
}
fn up(numerator: i128, denominator: i128) -> i128 {
    (numerator + denominator - 1) / denominator
}

pub fn quote(
    input: &QuoteInput,
    price: i64,
    cost: &PublishedCost,
    p: &CommercialParameters,
) -> Result<Quote, DomainError> {
    p.simulate()?;
    if !(1..=1_000_000).contains(&input.quantity)
        || !(1..=1_000_000_000_000).contains(&price)
        || !(0..=MAX_MONEY).contains(&input.freight_cents)
        || !(0..=1_000_000_000_000).contains(&cost.purchase_cost_cents)
        || !(0..=1_000_000_000_000).contains(&cost.packaging_cents)
        || cost.tax_credit_bps > 10_000
    {
        return Err(DomainError::Invalid("Quantidade, custo ou frete inválido"));
    }
    let row = p
        .state_rates
        .iter()
        .find(|row| row.state == input.destination)
        .ok_or(DomainError::Invalid("UF de destino inválida"))?;
    let outgoing = row.outgoing_bps.unwrap_or(p.interstate_bps);
    let icms = if input.destination == p.origin_state {
        p.domestic_icms_bps
    } else if input.taxpayer {
        outgoing
    } else {
        outgoing.max(row.internal_bps) + row.fcp_bps
    };
    let channel = p.commission_bps + p.ads_bps + p.gateway_bps + p.other_fees_bps;
    let provisions = p.loss_bps + p.warranty_bps + p.bad_debt_bps;
    let q = i128::from(input.quantity);
    let table_total = i128::from(price) * q;
    cents(table_total)?;
    let factor = BPS + i128::from(p.ipi_bps);
    // Published tables round the final unit with IPI upwards; preserve that price at zero discount.
    let gross = |unit: i128| up(unit * factor, BPS);
    let unit = match input.discount {
        Discount::Percent(value) if value < 10_000 => {
            rounded(i128::from(price) * (BPS - i128::from(value)), BPS)
        }
        Discount::Amount(value) if value >= 0 && i128::from(value) < table_total => {
            rounded(table_total - i128::from(value), q)
        }
        Discount::Target(value)
            if value > 0 && i128::from(value) <= gross(i128::from(price)) * q =>
        {
            let cap = i128::from(value) / q;
            let (mut low, mut high) = (0, i128::from(price));
            while low < high {
                let mid = (low + high + 1) / 2;
                if gross(mid) <= cap {
                    low = mid;
                } else {
                    high = mid - 1;
                }
            }
            low
        }
        _ => return Err(DomainError::Invalid("Desconto ou total desejado inválido")),
    };
    if unit <= 0 || unit > i128::from(price) {
        return Err(DomainError::Invalid(
            "O desconto precisa preservar um preço positivo",
        ));
    }
    let adjusted_unit = i128::from(cost.purchase_cost_cents)
        * (BPS - i128::from(cost.tax_credit_bps))
        * (BPS + i128::from(p.cost_safety_bps))
        + i128::from(cost.packaging_cents) * BPS * BPS;
    let equipment = rounded(adjusted_unit * q, BPS * BPS);
    let fixed_fee = i128::from(p.fixed_order_fee_cents);
    // Keep cost credits, safety, taxes and income tax as exact rationals.
    // This also makes the boundary searches monotonic even for one-cent prices.
    let scale = BPS * BPS;
    let finance = |unit: i128| {
        let sale = unit * q;
        let pretax =
            sale * (BPS - i128::from(icms + p.pis_cofins_bps + channel + provisions)) * BPS
                - adjusted_unit * q
                - (i128::from(input.freight_cents) + fixed_fee) * scale;
        let income = pretax.max(0) * i128::from(p.income_tax_bps);
        (pretax, income, pretax * BPS - income)
    };
    let meets = |unit: i128, target: bool| {
        let profit = finance(unit).2;
        if target {
            profit >= unit * q * i128::from(p.net_margin_bps) * scale
        } else {
            profit >= 0
        }
    };
    let max_discount = |target: bool| -> Option<u32> {
        if !meets(i128::from(price), target) {
            return None;
        }
        let (mut low, mut high) = (0_u32, 9999_u32);
        while low < high {
            let mid = (low + high).div_ceil(2);
            let candidate = rounded(i128::from(price) * (BPS - i128::from(mid)), BPS);
            if candidate > 0 && meets(candidate, target) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        Some(low)
    };
    let mut low = 1_i128;
    let mut high = 1_000_000_000_000_i128;
    if !meets(high, true) {
        return Err(DomainError::Invalid(
            "Não existe preço viável dentro do limite",
        ));
    }
    while low < high {
        let mid = (low + high) / 2;
        if meets(mid, true) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    let net = unit * q;
    let invoice = gross(unit) * q;
    let (pretax_raw, income_raw, profit_raw) = finance(unit);
    let pretax = rounded(pretax_raw, scale);
    let income = rounded(income_raw, scale * BPS);
    let profit = pretax - income;
    let band = if meets(unit, true) {
        "at_target"
    } else if profit_raw >= 0 {
        "below_target"
    } else {
        "loss"
    };
    let mut reasons = Vec::new();
    // The free boundary uses the same unit-cent rounding as a percentage entry.
    // Otherwise an exact 20% could demand approval because of a fraction of a cent.
    let free_unit = rounded(
        i128::from(price) * (BPS - i128::from(p.free_discount_bps)),
        BPS,
    );
    if unit < free_unit {
        reasons.push("discount_above_free");
    }
    if band != "at_target" {
        reasons.push("below_target");
    }
    let supplier = rounded(
        i128::from(cost.purchase_cost_cents) * (BPS + i128::from(p.cost_safety_bps)) * q,
        BPS,
    );
    let target_profit = rounded(net * i128::from(p.net_margin_bps), BPS);
    // Commission applies to the entrance without IPI; round up to cover funding.
    let required = up(
        (supplier + target_profit) * factor,
        factor - i128::from(p.commission_bps),
    );
    let sale = SaleQuote {
        quantity: input.quantity,
        table_unit_cents: price,
        table_total_cents: cents(table_total)?,
        discount_cents: cents(table_total - net)?,
        discount_bps: rounded((table_total - net) * BPS, table_total) as u32,
        unit_without_ipi_cents: cents(unit)?,
        unit_with_ipi_cents: cents(gross(unit))?,
        net_sale_cents: cents(net)?,
        ipi_cents: cents(invoice - net)?,
        ipi_bps: p.ipi_bps,
        invoice_total_cents: cents(invoice)?,
        minimum_down_payment_bps: p.minimum_down_payment_bps,
        minimum_down_payment_cents: cents(rounded(
            invoice * i128::from(p.minimum_down_payment_bps),
            BPS,
        ))?,
        free_discount_bps: p.free_discount_bps,
        freight_cents: input.freight_cents,
        band,
        needs_approval: !reasons.is_empty(),
        approval_reasons: reasons,
    };
    let director = DirectorQuote {
        icms_cents: cents(rounded(net * i128::from(icms), BPS))?,
        pis_cofins_cents: cents(rounded(net * i128::from(p.pis_cofins_bps), BPS))?,
        channel_cents: cents(rounded(net * i128::from(channel), BPS))?,
        provisions_cents: cents(rounded(net * i128::from(provisions), BPS))?,
        rounding_cents: cents(
            net - equipment
                - i128::from(input.freight_cents)
                - fixed_fee
                - pretax
                - [icms, p.pis_cofins_bps, channel, provisions]
                    .iter()
                    .map(|r| rounded(net * i128::from(*r), BPS))
                    .sum::<i128>(),
        )?,
        equipment_cost_cents: cents(equipment)?,
        fixed_fee_cents: cents(fixed_fee)?,
        profit_before_income_tax_cents: cents(pretax)?,
        income_tax_cents: cents(income)?,
        net_profit_cents: cents(profit)?,
        net_profit_bps: (profit_raw / (scale * net)) as i64,
        target_margin_bps: p.net_margin_bps,
        at_target_bps: max_discount(true),
        no_loss_bps: max_discount(false),
        minimum_target_unit_with_ipi_cents: cents(gross(low))?,
        supplier_payment_cents: cents(supplier)?,
        target_profit_cents: cents(target_profit)?,
        down_payment_commission_cents: cents(required - supplier - target_profit)?,
        required_down_payment_cents: cents(required)?,
        required_down_payment_bps: i64::try_from(up(required * BPS, invoice))
            .map_err(|_| DomainError::Invalid("Entrada fora do limite"))?,
    };
    Ok(Quote { sale, director })
}
