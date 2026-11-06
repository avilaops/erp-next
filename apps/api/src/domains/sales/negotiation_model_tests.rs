use super::negotiation_model::*;
use crate::platform::commercial_settings_model::tests::example;

fn fixture() -> (ApprovalRules, SimulationInput, Vec<SourceItem>) {
    let id = uuid::Uuid::now_v7();
    (
        ApprovalRules {
            below_target: true,
            freight: false,
            director_auto_approval: false,
            manager_limit: ManagerLimit::Profit,
        },
        SimulationInput {
            line: "imported".into(),
            version_id: uuid::Uuid::now_v7(),
            destination_state: "SP".into(),
            taxpayer: false,
            discount: Discount::Percent(0),
            freight_cents: 0,
            down_payment_cents: None,
            items: vec![SimulationItem {
                product_id: id,
                quantity: 1,
                structure_color: None,
                plate_holder_color: None,
                plate_holder_type: None,
                upholstery_color: None,
            }],
        },
        vec![SourceItem {
            product_id: id,
            sku: "LD-A001".into(),
            name: "Equipamento".into(),
            unit: "UN".into(),
            product_revision: 1,
            cost_revision: 1,
            price_cents: 1_256_323,
            purchase_cents: 530_606,
            credit_bps: 2780,
            packaging_cents: 0,
        }],
    )
}

#[test]
fn imported_sale_composition_and_commercial_entry_match_reference() {
    let (rules, input, sources) = fixture();
    let (sale, director) = calculate(&example(), &rules, &input, &sources).unwrap();
    assert_eq!(
        (sale.net_sale_cents, sale.ipi_cents, sale.total_cents),
        (1_256_323, 163_322, 1_419_645)
    );
    assert_eq!(sale.minimum_down_payment_cents, 993_752);
    assert_ne!(
        director.required_down_payment_cents,
        sale.minimum_down_payment_cents
    );
    assert_eq!(
        director.required_down_payment_cents,
        director.supplier_payment_cents
            + director.target_profit_cents
            + director.down_payment_commission_cents
    );
    assert_eq!(
        sale.items.iter().map(|i| i.total_cents).sum::<i64>(),
        sale.total_cents
    );
}

#[test]
fn discount_modes_agree_and_fixed_fee_is_charged_once() {
    let (rules, mut input, sources) = fixture();
    let mut p = example();
    input.discount = Discount::Percent(2000);
    let (percent, _) = calculate(&p, &rules, &input, &sources).unwrap();
    input.discount = Discount::Amount(percent.discount_cents as u64);
    assert_eq!(
        calculate(&p, &rules, &input, &sources)
            .unwrap()
            .0
            .total_cents,
        percent.total_cents
    );
    input.discount = Discount::Total(percent.total_cents as u64);
    assert_eq!(
        calculate(&p, &rules, &input, &sources)
            .unwrap()
            .0
            .total_cents,
        percent.total_cents
    );
    input.items[0].quantity = 3;
    input.discount = Discount::Percent(0);
    let (_, before) = calculate(&p, &rules, &input, &sources).unwrap();
    p.fixed_order_fee_cents = 12345;
    input.freight_cents = 6789;
    let (_, after) = calculate(&p, &rules, &input, &sources).unwrap();
    assert_eq!(
        before.profit_before_income_tax_cents - after.profit_before_income_tax_cents,
        19134
    );
}

#[test]
fn zero_outgoing_is_preserved_and_taxpayer_changes_destination_costs() {
    let (rules, mut input, sources) = fixture();
    let mut p = example();
    input.destination_state = "MG".into();
    input.taxpayer = true;
    p.state_rates
        .iter_mut()
        .find(|r| r.state == "MG")
        .unwrap()
        .outgoing_bps = Some(0);
    let (_, zero) = calculate(&p, &rules, &input, &sources).unwrap();
    p.state_rates
        .iter_mut()
        .find(|r| r.state == "MG")
        .unwrap()
        .outgoing_bps = None;
    let (_, fallback) = calculate(&p, &rules, &input, &sources).unwrap();
    assert_eq!(fallback.tax_bps - zero.tax_bps, p.interstate_bps);
    input.taxpayer = false;
    assert!(
        calculate(&p, &rules, &input, &sources).unwrap().1.tax_bps
            + calculate(&p, &rules, &input, &sources).unwrap().1.difal_bps
            > fallback.tax_bps
    );
}

#[test]
fn exceptions_and_loss_cannot_escape_approval_and_invalid_inputs_fail() {
    let (mut rules, mut input, sources) = fixture();
    let p = example();
    input.discount = Discount::Percent(9900);
    input.down_payment_cents = Some(0);
    rules.below_target = false;
    rules.freight = false;
    let (sale, director) = calculate(&p, &rules, &input, &sources).unwrap();
    assert!(director.requires_director);
    assert_eq!(director.income_tax_cents, 0);
    assert!(sale.approval_reasons.contains(&"fora-da-meta".into()));
    assert!(
        sale.approval_reasons
            .contains(&"desconto-acima-do-livre".into())
    );
    assert!(
        sale.approval_reasons
            .contains(&"entrada-abaixo-da-politica".into())
    );
    input.items[0].quantity = 0;
    assert!(calculate(&p, &rules, &input, &sources).is_err());
    input.items[0].quantity = 1;
    input.discount = Discount::Percent(10000);
    assert!(calculate(&p, &rules, &input, &sources).is_err());
    input.discount = Discount::Total(u64::MAX);
    assert!(calculate(&p, &rules, &input, &sources).is_err());
}
