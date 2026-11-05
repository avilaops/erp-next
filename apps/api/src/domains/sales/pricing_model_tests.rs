use super::*;
use crate::platform::commercial_settings_model::tests::example;

fn input() -> QuoteInput {
    QuoteInput {
        version_id: Uuid::nil(),
        product_id: Uuid::nil(),
        quantity: 2,
        destination: "SP".into(),
        taxpayer: false,
        discount: Discount::Percent(0),
        freight_cents: 0,
    }
}
fn cost() -> PublishedCost {
    PublishedCost {
        purchase_cost_cents: 10000,
        tax_credit_bps: 1000,
        packaging_cents: 100,
    }
}
#[test]
fn quote_reproduces_cost_credit_safety_ipi_income_tax_and_funding() {
    let value = quote(&input(), 20000, &cost(), &example()).unwrap();
    assert_eq!(value.sale.net_sale_cents, 40000);
    assert_eq!(value.sale.invoice_total_cents, 45200);
    assert_eq!(value.sale.minimum_down_payment_cents, 31640);
    assert_eq!(value.director.equipment_cost_cents, 19100);
    assert_eq!(value.director.profit_before_income_tax_cents, 8000);
    assert_eq!(value.director.income_tax_cents, 2720);
    assert_eq!(value.director.net_profit_cents, 5280);
    assert_eq!(value.director.net_profit_bps, 1320);
    assert_eq!(value.director.supplier_payment_cents, 21000);
    assert_eq!(value.director.target_profit_cents, 6000);
    assert_eq!(value.director.required_down_payment_cents, 27487);
    assert_eq!(value.sale.band, "below_target");
    assert_eq!(value.director.at_target_bps, None);
}
#[test]
fn quote_fixed_fee_is_once_freight_affects_profit_and_loss_has_no_income_tax() {
    let mut p = example();
    p.fixed_order_fee_cents = 333;
    let mut i = input();
    i.freight_cents = 100000;
    let value = quote(&i, 20000, &cost(), &p).unwrap();
    assert_eq!(value.sale.band, "loss");
    assert_eq!(value.director.fixed_fee_cents, 333);
    assert_eq!(value.director.profit_before_income_tax_cents, -92333);
    assert_eq!(value.director.income_tax_cents, 0);
    assert_eq!(value.director.net_profit_cents, -92333);
    assert_eq!(value.director.no_loss_bps, None);
    assert!(value.sale.needs_approval);
}
#[test]
fn quote_discount_modes_round_to_consistent_units_without_exceeding_target() {
    let mut i = input();
    i.quantity = 3;
    i.discount = Discount::Percent(1000);
    let percent = quote(&i, 20000, &cost(), &example()).unwrap();
    i.discount = Discount::Amount(6000);
    let amount = quote(&i, 20000, &cost(), &example()).unwrap();
    assert_eq!(
        percent.sale.invoice_total_cents,
        amount.sale.invoice_total_cents
    );
    i.discount = Discount::Target(61001);
    let target = quote(&i, 20000, &cost(), &example()).unwrap();
    assert!(target.sale.invoice_total_cents <= 61001);
    assert_eq!(
        target.sale.invoice_total_cents,
        target.sale.unit_with_ipi_cents * 3
    );
    assert_eq!(
        target.sale.net_sale_cents + target.sale.ipi_cents,
        target.sale.invoice_total_cents
    );
}
#[test]
fn quote_limits_are_exact_for_destination_quantity_and_freight() {
    for destination in ["SP", "MA", "SC"] {
        for taxpayer in [true, false] {
            for quantity in [1, 3, 30] {
                let mut i = input();
                i.destination = destination.into();
                i.taxpayer = taxpayer;
                i.quantity = quantity;
                i.freight_cents = 317;
                let initial = quote(&i, 30000, &cost(), &example()).unwrap();
                let at_target = initial.director.at_target_bps.unwrap();
                i.discount = Discount::Percent(at_target);
                assert_eq!(
                    quote(&i, 30000, &cost(), &example()).unwrap().sale.band,
                    "at_target"
                );
                i.discount = Discount::Percent(at_target + 1);
                assert_ne!(
                    quote(&i, 30000, &cost(), &example()).unwrap().sale.band,
                    "at_target"
                );
                let no_loss = initial.director.no_loss_bps.unwrap();
                i.discount = Discount::Percent(no_loss);
                assert_ne!(
                    quote(&i, 30000, &cost(), &example()).unwrap().sale.band,
                    "loss"
                );
                i.discount = Discount::Percent(no_loss + 1);
                assert_eq!(
                    quote(&i, 30000, &cost(), &example()).unwrap().sale.band,
                    "loss"
                );
            }
        }
    }
}
#[test]
fn quote_rejects_invalid_inputs_and_overflow_without_panicking() {
    let p = example();
    for discount in [
        Discount::Percent(10000),
        Discount::Amount(-1),
        Discount::Amount(40000),
        Discount::Target(0),
        Discount::Target(45201),
    ] {
        let mut i = input();
        i.discount = discount;
        assert!(quote(&i, 20000, &cost(), &p).is_err());
    }
    let mut i = input();
    i.quantity = 0;
    assert!(quote(&i, 20000, &cost(), &p).is_err());
    i.quantity = 1000001;
    assert!(quote(&i, 20000, &cost(), &p).is_err());
    i.quantity = 1000000;
    assert!(quote(&i, 1000000000000, &cost(), &p).is_err());
    i.quantity = 1;
    i.freight_cents = -1;
    assert!(quote(&i, 20000, &cost(), &p).is_err());
    i.freight_cents = 0;
    i.destination = "XX".into();
    assert!(quote(&i, 20000, &cost(), &p).is_err());
}
#[test]
fn quote_one_cent_rounding_and_composition_remain_consistent() {
    let mut i = input();
    i.quantity = 1;
    for price in [1, 2, 3, 7, 101, 12345, 20001] {
        let value = quote(&i, price, &cost(), &example()).unwrap();
        let d = value.director;
        let s = value.sale;
        assert_eq!(
            s.net_sale_cents
                - d.icms_cents
                - d.pis_cofins_cents
                - d.channel_cents
                - d.provisions_cents
                - d.equipment_cost_cents
                - d.fixed_fee_cents
                - s.freight_cents
                - d.rounding_cents,
            d.profit_before_income_tax_cents
        );
        assert_eq!(
            d.profit_before_income_tax_cents - d.income_tax_cents,
            d.net_profit_cents
        );
    }
}
