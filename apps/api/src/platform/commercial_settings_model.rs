//! Manager-only draft pricing parameters. Rates are integer basis points;
//! monetary inputs are cents. This is a managerial simulation, not tax assessment.
use crate::domains::DomainError;
use serde::{Deserialize, Serialize};

pub const STATES: [&str; 27] = [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE",
    "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StateRate {
    pub state: String,
    pub internal_bps: u32,
    pub fcp_bps: u32,
    pub outgoing_bps: Option<u32>,
}
#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommercialParameters {
    pub origin_state: String,
    pub net_margin_bps: u32,
    pub free_discount_bps: u32,
    pub cost_safety_bps: u32,
    pub minimum_down_payment_bps: u32,
    pub proposal_validity_days: u32,
    pub domestic_icms_bps: u32,
    pub pis_cofins_bps: u32,
    pub ipi_bps: u32,
    pub income_tax_bps: u32,
    pub commission_bps: u32,
    pub ads_bps: u32,
    pub gateway_bps: u32,
    pub other_fees_bps: u32,
    pub interstate_bps: u32,
    pub loss_bps: u32,
    pub warranty_bps: u32,
    pub bad_debt_bps: u32,
    pub fixed_order_fee_cents: u64,
    pub monthly_expenses_cents: u64,
    pub state_rates: Vec<StateRate>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PricingSimulation {
    pub worst_state: String,
    pub worst_non_contributor: bool,
    pub worst_icms_bps: u32,
    pub variable_costs_bps: u32,
    pub required_pretax_margin_percent: f64,
    pub discounted_cost_multiplier: f64,
    pub table_cost_multiplier: f64,
    pub markup_percent: f64,
    pub raw_cost_multiplier_with_safety: f64,
    pub monthly_expenses_cents: u64,
    /// Indicative revenue in reais, without IPI. None when a positive fixed
    /// expense cannot be covered by a zero target margin.
    pub break_even_revenue: Option<f64>,
    pub destination_limits: Vec<DestinationLimit>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DestinationLimit {
    pub state: String,
    pub taxpayer: bool,
    pub variable_costs_bps: u32,
    /// Rounded down to whole basis points so the displayed limit is safe.
    pub at_target_bps: u32,
    pub no_loss_bps: u32,
}

impl CommercialParameters {
    pub fn simulate(&self) -> Result<PricingSimulation, DomainError> {
        let rates = [
            self.net_margin_bps,
            self.free_discount_bps,
            self.cost_safety_bps,
            self.minimum_down_payment_bps,
            self.domestic_icms_bps,
            self.pis_cofins_bps,
            self.ipi_bps,
            self.income_tax_bps,
            self.commission_bps,
            self.ads_bps,
            self.gateway_bps,
            self.other_fees_bps,
            self.interstate_bps,
            self.loss_bps,
            self.warranty_bps,
            self.bad_debt_bps,
        ];
        if rates.iter().any(|rate| *rate > 10_000)
            || self.free_discount_bps == 10_000
            || self.income_tax_bps == 10_000
        {
            return Err(DomainError::Invalid(
                "Percentuais devem estar entre 0 e 100; desconto e IR devem ser menores que 100",
            ));
        }
        if !(1..=3650).contains(&self.proposal_validity_days)
            || self.fixed_order_fee_cents > 1_000_000_000_000
            || self.monthly_expenses_cents > 1_000_000_000_000
        {
            return Err(DomainError::Invalid(
                "Validade ou valores monetários fora do limite",
            ));
        }
        if !STATES.contains(&self.origin_state.as_str()) || self.state_rates.len() != STATES.len() {
            return Err(DomainError::Invalid(
                "Informe a UF de origem e uma alíquota para cada uma das 27 UFs",
            ));
        }
        let mut seen = std::collections::HashSet::new();
        let mut worst = (self.origin_state.clone(), false, self.domestic_icms_bps);
        for row in &self.state_rates {
            if !STATES.contains(&row.state.as_str())
                || !seen.insert(&row.state)
                || row.internal_bps > 10_000
                || row.fcp_bps > 10_000
                || row.outgoing_bps.is_some_and(|rate| rate > 10_000)
            {
                return Err(DomainError::Invalid(
                    "UF repetida, desconhecida ou alíquota inválida",
                ));
            }
            if row.state == self.origin_state {
                continue;
            }
            let outgoing = row.outgoing_bps.unwrap_or(self.interstate_bps);
            // Simplified legacy managerial scenario: outbound ICMS plus positive
            // difference to destination internal rate plus FCP for non-contributors.
            // No fiscal document, tax base or monetary rounding is generated here.
            let non_contributor = outgoing.max(row.internal_bps) + row.fcp_bps;
            if non_contributor > worst.2 || (non_contributor == worst.2 && row.state < worst.0) {
                worst = (row.state.clone(), true, non_contributor);
            }
        }
        let costs = worst.2
            + self.pis_cofins_bps
            + self.commission_bps
            + self.ads_bps
            + self.gateway_bps
            + self.other_fees_bps
            + self.loss_bps
            + self.warranty_bps
            + self.bad_debt_bps;
        let retained_income = i64::from(10_000 - self.income_tax_bps);
        let numerator =
            (10_000 - i64::from(costs)) * retained_income - i64::from(self.net_margin_bps) * 10_000;
        if numerator <= 0 {
            return Err(DomainError::Invalid(
                "Margem, impostos e taxas consomem 100% da venda; não existe preço viável para estes parâmetros",
            ));
        }
        let pretax = f64::from(self.net_margin_bps) / retained_income as f64;
        // Validate the rational denominator in integer arithmetic before division.
        let discounted = (10_000 * retained_income) as f64 / numerator as f64;
        let table = discounted / (1.0 - self.free_discount_bps as f64 / 10_000.0);
        let channel = costs - worst.2;
        let mut destination_limits = Vec::with_capacity(53);
        // Canonical order, independent of the order in which rows were saved.
        for state in STATES {
            let row = self
                .state_rates
                .iter()
                .find(|row| row.state == state)
                .unwrap();
            for taxpayer in [false, true] {
                if state == self.origin_state && taxpayer {
                    continue;
                }
                let outgoing = row.outgoing_bps.unwrap_or(self.interstate_bps);
                let icms = if state == self.origin_state {
                    self.domestic_icms_bps
                } else if taxpayer {
                    outgoing
                } else {
                    outgoing.max(row.internal_bps) + row.fcp_bps
                };
                let destination_costs = channel + icms;
                let available = (10_000 - i64::from(destination_costs)) * retained_income;
                // 1 - 1 / (table multiplier * destination cost share), expressed
                // as an exact rational in bps. Worst-case validation guarantees
                // positive denominators for every destination.
                let discount = |share: i64| -> u32 {
                    let used = i128::from(numerator) * i128::from(10_000 - self.free_discount_bps);
                    let remaining = i128::from(share) * 10_000 - used;
                    (remaining.max(0) / i128::from(share)) as u32
                };
                destination_limits.push(DestinationLimit {
                    state: state.into(),
                    taxpayer,
                    variable_costs_bps: destination_costs,
                    at_target_bps: discount(available - i64::from(self.net_margin_bps) * 10_000),
                    no_loss_bps: discount(available),
                });
            }
        }
        let break_even_revenue = if self.monthly_expenses_cents == 0 {
            Some(0.0)
        } else if self.net_margin_bps == 0 {
            None
        } else {
            let cents = (u128::from(self.monthly_expenses_cents) * retained_income as u128)
                .div_ceil(u128::from(self.net_margin_bps));
            Some(cents as f64 / 100.0)
        };
        Ok(PricingSimulation {
            worst_state: worst.0,
            worst_non_contributor: worst.1,
            worst_icms_bps: worst.2,
            variable_costs_bps: costs,
            required_pretax_margin_percent: pretax * 100.0,
            discounted_cost_multiplier: discounted,
            table_cost_multiplier: table,
            markup_percent: (table - 1.0) * 100.0,
            raw_cost_multiplier_with_safety: table * (1.0 + self.cost_safety_bps as f64 / 10_000.0),
            monthly_expenses_cents: self.monthly_expenses_cents,
            break_even_revenue,
            destination_limits,
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn example() -> CommercialParameters {
        CommercialParameters {
            origin_state: "SP".into(),
            net_margin_bps: 1500,
            free_discount_bps: 2000,
            cost_safety_bps: 500,
            minimum_down_payment_bps: 7000,
            proposal_validity_days: 7,
            domestic_icms_bps: 1800,
            pis_cofins_bps: 925,
            ipi_bps: 1300,
            income_tax_bps: 3400,
            commission_bps: 200,
            ads_bps: 50,
            gateway_bps: 0,
            other_fees_bps: 0,
            interstate_bps: 400,
            loss_bps: 100,
            warranty_bps: 150,
            bad_debt_bps: 0,
            fixed_order_fee_cents: 0,
            monthly_expenses_cents: 0,
            state_rates: STATES
                .iter()
                .map(|state| StateRate {
                    state: (*state).into(),
                    internal_bps: if *state == "MA" { 2300 } else { 1800 },
                    fcp_bps: 0,
                    outgoing_bps: None,
                })
                .collect(),
        }
    }

    #[test]
    fn commercial_pricing_reproduces_unrounded_examples() {
        let mut parameters = example();
        let imported = parameters.simulate().unwrap();
        assert_eq!(imported.worst_state, "MA");
        assert_eq!(imported.variable_costs_bps, 3725);
        assert_eq!(
            format!("{:.3}", imported.discounted_cost_multiplier),
            "2.499"
        );
        assert_eq!(format!("{:.3}", imported.table_cost_multiplier), "3.123");
        assert_eq!(format!("{:.1}", imported.markup_percent), "212.3");
        parameters.free_discount_bps = 3000;
        parameters.cost_safety_bps = 0;
        parameters.ipi_bps = 0;
        let national = parameters.simulate().unwrap();
        assert_eq!(format!("{:.3}", national.table_cost_multiplier), "3.569");
        assert_eq!(format!("{:.1}", national.markup_percent), "256.9");
    }

    #[test]
    fn commercial_pricing_rejects_invalid_domains_and_impossible_margins() {
        let original = example();
        for mutate in [
            |p: &mut CommercialParameters| p.income_tax_bps = 10_000,
            |p: &mut CommercialParameters| p.free_discount_bps = 10_000,
            |p: &mut CommercialParameters| p.net_margin_bps = 9000,
            |p: &mut CommercialParameters| p.proposal_validity_days = 0,
            |p: &mut CommercialParameters| {
                p.state_rates.pop();
            },
            |p: &mut CommercialParameters| p.state_rates[0].state = "SP".into(),
            |p: &mut CommercialParameters| p.state_rates[0].outgoing_bps = Some(10001),
            |p: &mut CommercialParameters| p.origin_state = "XX".into(),
        ] {
            let mut parameters = original.clone();
            mutate(&mut parameters);
            assert!(parameters.simulate().is_err());
        }
    }

    #[test]
    fn commercial_pricing_applies_fcp_outgoing_override_and_domestic_origin() {
        let mut parameters = example();
        parameters.interstate_bps = 1000;
        parameters.state_rates[0].internal_bps = 500;
        parameters.state_rates[0].outgoing_bps = Some(2400);
        parameters.state_rates[0].fcp_bps = 100;
        assert_eq!(parameters.simulate().unwrap().worst_icms_bps, 2500);
        parameters.state_rates[0].outgoing_bps = None;
        assert_eq!(parameters.simulate().unwrap().worst_state, "MA");
        parameters.domestic_icms_bps = 2600;
        let result = parameters.simulate().unwrap();
        assert_eq!(result.worst_state, "SP");
        assert!(!result.worst_non_contributor);
    }

    #[test]
    fn commercial_pricing_break_even_handles_zero_margin_and_rounds_up() {
        let mut p = example();
        p.monthly_expenses_cents = 1_000_000;
        assert_eq!(p.simulate().unwrap().break_even_revenue, Some(44_000.0));
        p.monthly_expenses_cents = 1;
        assert_eq!(p.simulate().unwrap().break_even_revenue, Some(0.05));
        p.net_margin_bps = 0;
        assert_eq!(p.simulate().unwrap().break_even_revenue, None);
        p.monthly_expenses_cents = 0;
        assert_eq!(p.simulate().unwrap().break_even_revenue, Some(0.0));
    }

    #[test]
    fn commercial_pricing_destination_limits_preserve_margin_and_no_loss() {
        let mut p = example();
        p.state_rates[0].outgoing_bps = Some(0);
        p.state_rates[0].fcp_bps = 200;
        let result = p.simulate().unwrap();
        assert_eq!(result.destination_limits.len(), 53);
        let worst = result
            .destination_limits
            .iter()
            .find(|row| row.state == "MA" && !row.taxpayer)
            .unwrap();
        assert_eq!(worst.at_target_bps, 2000);
        let ac = result
            .destination_limits
            .iter()
            .find(|row| row.state == "AC" && row.taxpayer)
            .unwrap();
        assert_eq!(ac.variable_costs_bps, 1425);
        for row in &result.destination_limits {
            let net = |discount| {
                let sale = result.table_cost_multiplier * (1.0 - f64::from(discount) / 10_000.0);
                (sale * (1.0 - f64::from(row.variable_costs_bps) / 10_000.0) - 1.0) / sale * 0.66
            };
            assert!(net(row.at_target_bps) >= 0.15 - 1e-12);
            assert!(net(row.at_target_bps + 1) < 0.15);
            assert!(net(row.no_loss_bps) >= -1e-12);
            assert!(net(row.no_loss_bps + 1) < 0.0);
        }
        p.state_rates.reverse();
        assert_eq!(
            serde_json::to_value(&result.destination_limits).unwrap(),
            serde_json::to_value(p.simulate().unwrap().destination_limits).unwrap()
        );
    }
}
