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
            cost_revision: Some(1),
            price_cents: 1_256_323,
            purchase_cents: 530_606,
            credit_bps: 2780,
            packaging_cents: 0,
        }],
    )
}

#[test]
fn simulation_validates_fixed_holder_types_without_requiring_holder_color() {
    let (rules, mut input, sources) = fixture();
    for (requested, expected) in [
        ("Standard", Some("Standard")),
        ("olímpico", Some("Olímpico")),
        ("Não se aplica", None),
    ] {
        input.items[0].plate_holder_type = Some(requested.into());
        let (sale, _) = calculate(&example(), &rules, &input, &sources).unwrap();
        assert_eq!(sale.items[0].plate_holder_type.as_deref(), expected);
        assert!(sale.items[0].plate_holder_color.is_none());
    }
    input.items[0].plate_holder_type = Some("Cônico".into());
    assert!(calculate(&example(), &rules, &input, &sources).is_err());
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

#[test]
fn frozen_legacy_cost_does_not_require_a_current_cost_revision() {
    let (rules, input, mut sources) = fixture();
    let expected = calculate(&example(), &rules, &input, &sources).unwrap();
    sources[0].cost_revision = None;
    let actual = calculate(&example(), &rules, &input, &sources).unwrap();
    assert_eq!(
        serde_json::to_value(expected).unwrap(),
        serde_json::to_value(actual).unwrap()
    );
}

fn add_source(
    input: &mut SimulationInput,
    sources: &mut Vec<SourceItem>,
    price: i64,
    quantity: u32,
) {
    let id = uuid::Uuid::now_v7();
    let mut item = input.items[0].clone();
    item.product_id = id;
    item.quantity = quantity;
    input.items.push(item);
    let mut source = sources[0].clone();
    source.product_id = id;
    source.sku = format!("LD-{}", sources.len());
    source.price_cents = price;
    sources.push(source);
}

fn assert_item_totals(sale: &SaleQuote) {
    for item in &sale.items {
        let quantity = i64::from(item.quantity);
        assert!(item.unit_net_cents > 0);
        assert_eq!(item.net_cents, item.unit_net_cents * quantity);
        assert_eq!(item.total_cents, item.unit_total_cents * quantity);
        assert_eq!(item.net_cents + item.ipi_cents, item.total_cents);
    }
    assert_eq!(sale.net_sale_cents + sale.ipi_cents, sale.total_cents);
    assert_eq!(
        sale.items.iter().map(|i| i.net_cents).sum::<i64>(),
        sale.net_sale_cents
    );
    assert_eq!(
        sale.items.iter().map(|i| i.total_cents).sum::<i64>(),
        sale.total_cents
    );
}

#[test]
fn published_ipi_ceiling_is_preserved_for_mixed_items_and_quantities() {
    let (rules, mut input, mut sources) = fixture();
    sources[0].price_cents = 30_001;
    input.items[0].quantity = 3;
    add_source(&mut input, &mut sources, 50_003, 2);
    let (sale, _) = calculate(&example(), &rules, &input, &sources).unwrap();
    assert_eq!(sale.calculator_version, "ludus-order-v2-integer-cents");
    assert_eq!(sale.items[0].unit_total_cents, 33_902);
    assert_eq!(sale.items[1].unit_total_cents, 56_504);
    assert_eq!(sale.total_cents, 214_714);
    assert_item_totals(&sale);
}

#[test]
fn percentage_is_rounded_per_unit_before_quantity_is_applied() {
    let (rules, mut input, mut sources) = fixture();
    sources[0].price_cents = 3;
    input.items[0].quantity = 2;
    input.discount = Discount::Percent(2000);
    let (sale, director) = calculate(&example(), &rules, &input, &sources).unwrap();
    assert_eq!(sale.items[0].unit_net_cents, 2);
    assert_eq!(sale.net_sale_cents, 4);
    assert_eq!(director.band, "loss");
    assert!(director.requires_director);
    assert!(sale.approval_reasons.iter().any(|r| r == "fora-da-meta"));
    assert_item_totals(&sale);
}

#[test]
fn desired_total_never_exceeds_the_cap_after_unit_rounding() {
    let (rules, mut input, sources) = fixture();
    input.items[0].quantity = 3;
    input.discount = Discount::Total(4_258_934);
    let (sale, _) = calculate(&example(), &rules, &input, &sources).unwrap();
    assert_eq!(sale.total_cents, 4_258_932);
    assert!(sale.total_cents <= 4_258_934);
    assert_item_totals(&sale);
}

#[test]
fn mixed_item_total_caps_preserve_the_published_limit_and_positive_units() {
    let (rules, mut input, mut sources) = fixture();
    sources[0].price_cents = 30_001;
    input.items[0].quantity = 3;
    add_source(&mut input, &mut sources, 50_003, 2);
    for target in [214_714, 214_713, 214_710, 193_243, 171_772, 10] {
        input.discount = Discount::Total(target);
        let (sale, _) = calculate(&example(), &rules, &input, &sources).unwrap();
        assert!(sale.total_cents <= target as i64, "target {target}");
        assert_item_totals(&sale);
        if target == 214_714 {
            assert_eq!(sale.discount_cents, 0);
        }
    }
    for target in [0, 9, 214_715] {
        input.discount = Discount::Total(target);
        assert!(
            calculate(&example(), &rules, &input, &sources).is_err(),
            "target {target}"
        );
    }
}

#[test]
fn exact_free_discount_uses_the_same_unit_rounding_as_the_quote() {
    let (rules, mut input, mut sources) = fixture();
    for mixed in [false, true] {
        if mixed {
            input.items[0].quantity = 3;
            add_source(&mut input, &mut sources, 50_003, 2);
        }
        input.discount = Discount::Percent(2000);
        let (percent, _) = calculate(&example(), &rules, &input, &sources).unwrap();
        assert!(
            !percent
                .approval_reasons
                .iter()
                .any(|r| r == "desconto-acima-do-livre")
        );
        for discount in [
            Discount::Amount(percent.discount_cents as u64),
            Discount::Total(percent.total_cents as u64),
        ] {
            input.discount = discount;
            let (sale, _) = calculate(&example(), &rules, &input, &sources).unwrap();
            assert!(
                !sale
                    .approval_reasons
                    .iter()
                    .any(|r| r == "desconto-acima-do-livre")
            );
            assert_item_totals(&sale);
        }
        input.discount = Discount::Percent(2001);
        let (above, _) = calculate(&example(), &rules, &input, &sources).unwrap();
        assert!(
            above
                .approval_reasons
                .iter()
                .any(|r| r == "desconto-acima-do-livre")
        );
    }
    input.items.truncate(1);
    sources.truncate(1);
    input.items[0].quantity = 1;
    input.discount = Discount::Percent(2000);
    let (free, _) = calculate(&example(), &rules, &input, &sources).unwrap();
    input.discount = Discount::Amount(free.discount_cents as u64 + 1);
    let (above, _) = calculate(&example(), &rules, &input, &sources).unwrap();
    assert!(
        above
            .approval_reasons
            .iter()
            .any(|r| r == "desconto-acima-do-livre")
    );
}

#[test]
fn required_entry_and_its_percentage_round_up_to_cover_funding() {
    let (rules, mut input, mut sources) = fixture();
    sources[0].price_cents = 30_001;
    sources[0].purchase_cents = 1001;
    input.down_payment_cents = Some(0);
    let p = example();
    let (sale, director) = calculate(&p, &rules, &input, &sources).unwrap();
    assert_eq!(director.supplier_payment_cents, 1051);
    assert_eq!(director.target_profit_cents, 4500);
    assert_eq!(director.required_down_payment_cents, 5652);
    assert_eq!(director.required_down_payment_bps, 1668);
    let required = i128::from(director.required_down_payment_cents);
    let funding = i128::from(director.supplier_payment_cents + director.target_profit_cents)
        * i128::from(10_000 + p.ipi_bps);
    let denominator = i128::from(10_000 + p.ipi_bps - p.commission_bps);
    assert!(required * denominator >= funding);
    assert!((required - 1) * denominator < funding);
    assert!(
        i128::from(director.required_down_payment_bps) * i128::from(sale.total_cents)
            >= required * 10_000
    );
    assert_eq!(sale.down_payment_cents, 0);
    assert_eq!(sale.minimum_down_payment_cents, 23_731);
}

#[test]
fn free_discount_boundary_still_requires_approval_for_profit_below_target() {
    let (rules, mut input, mut sources) = fixture();
    sources[0].price_cents = 30_001;
    sources[0].purchase_cents = 15_000;
    input.discount = Discount::Percent(2000);
    let (sale, director) = calculate(&example(), &rules, &input, &sources).unwrap();
    assert_eq!(director.band, "belowTarget");
    assert!(sale.approval_reasons.iter().any(|r| r == "fora-da-meta"));
    assert!(
        !sale
            .approval_reasons
            .iter()
            .any(|r| r == "desconto-acima-do-livre")
    );
}

#[test]
fn single_item_prices_and_free_discount_match_the_published_calculator() {
    use super::pricing_model as published;
    let (rules, mut input, mut sources) = fixture();
    let p = example();
    for price in [3, 101, 30_001, 1_256_323] {
        sources[0].price_cents = price;
        for quantity in [1, 2, 3, 30] {
            input.items[0].quantity = quantity;
            let table_gross =
                ((price * i64::from(10_000 + p.ipi_bps) + 9999) / 10_000) * i64::from(quantity);
            for (discount, published_discount) in [
                (Discount::Percent(0), published::Discount::Percent(0)),
                (Discount::Percent(2000), published::Discount::Percent(2000)),
                (Discount::Amount(1), published::Discount::Amount(1)),
                (
                    Discount::Total(table_gross as u64),
                    published::Discount::Target(table_gross),
                ),
                (
                    Discount::Total(table_gross as u64 - 1),
                    published::Discount::Target(table_gross - 1),
                ),
            ] {
                input.discount = discount;
                let source = &sources[0];
                let reference = published::quote(
                    &published::QuoteInput {
                        version_id: input.version_id,
                        product_id: source.product_id,
                        quantity,
                        destination: input.destination_state.clone(),
                        taxpayer: input.taxpayer,
                        discount: published_discount,
                        freight_cents: input.freight_cents as i64,
                    },
                    price,
                    &published::PublishedCost {
                        purchase_cost_cents: source.purchase_cents,
                        tax_credit_bps: source.credit_bps as u32,
                        packaging_cents: source.packaging_cents,
                    },
                    &p,
                )
                .unwrap()
                .sale;
                let (sale, _) = calculate(&p, &rules, &input, &sources).unwrap();
                assert_eq!(
                    sale.items[0].unit_net_cents,
                    reference.unit_without_ipi_cents
                );
                assert_eq!(
                    sale.items[0].unit_total_cents,
                    reference.unit_with_ipi_cents
                );
                assert_eq!(sale.net_sale_cents, reference.net_sale_cents);
                assert_eq!(sale.total_cents, reference.invoice_total_cents);
                assert_eq!(sale.discount_bps, reference.discount_bps);
                assert_eq!(
                    sale.approval_reasons
                        .iter()
                        .any(|r| r == "desconto-acima-do-livre"),
                    reference.approval_reasons.contains(&"discount_above_free"),
                );
                assert_item_totals(&sale);
            }
        }
    }
}
