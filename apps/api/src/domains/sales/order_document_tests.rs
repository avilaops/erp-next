use super::*;
use serde_json::json;

fn order() -> OrderSnapshot {
    OrderSnapshot {
        tenant_id: Uuid::nil(),
        can_edit: true,
        pricing_origin: true,
        data: OrderSummary {
            id: Uuid::nil(),
            number: "4".into(),
            customer_id: Uuid::nil(),
            customer_name: "Nome do pedido divergente".into(),
            customer_tax_id: "00000000000".into(),
            due_date: "2026-12-01".into(),
            amount: "44.98".into(),
            status: "draft".into(),
            revision: 7,
        },
        items: vec![OrderLine {
            product_id: Uuid::nil(),
            sku: "SKU-1".into(),
            name: "Estação São José".into(),
            unit: "UN".into(),
            quantity: "2.500000".into(),
            unit_price: "17.99".into(),
            amount: "44.98".into(),
            equipment_weight: Some("180,5 kg".into()),
            structure_color: Some("Azul petróleo".into()),
            swing_arm_color: Some("Grafite acetinado".into()),
            upholstery_color: Some("Café".into()),
            plate_holder_color: Some("Legado oculto".into()),
            plate_holder_type: Some("Redondo".into()),
        }],
        checkout: Some(checkout_document::fixture()),
    }
}
fn document_text(current: &OrderSnapshot) -> String {
    let checkout = current
        .checkout
        .as_ref()
        .map(|c| c.customer.clone())
        .unwrap_or(json!({}));
    let document = commercial(
        current,
        "Emitente Ávila".into(),
        "123".into(),
        &json!({"street":"Rua Industrial","number":"100","city":"São Paulo","email":"comercial@example.test","directorCost":"SEGREDO_CUSTO","margin":"SEGREDO_MARGEM"}),
        &checkout,
    );
    let bytes = pdf::render(&document).unwrap();
    let parsed = lopdf::Document::load_mem(&bytes).unwrap();
    parsed
        .extract_text(&parsed.get_pages().keys().copied().collect::<Vec<_>>())
        .unwrap()
}
#[test]
fn document_uses_frozen_customer_and_recorded_prices_without_repricing() {
    let text = document_text(&order());
    for expected in [
        "Emitente Ávila",
        "Rua Industrial",
        "comercial@example.test",
        "PV-000004",
        "Revisão 7",
        "Cliente preservado <b>",
        "Rua preservada & segura",
        "preservado@example.test",
        "ISENTO",
        "R$ 17,99",
        "R$ 44,98",
        "2,5 UN",
        "Azul petróleo",
        "Braços: Grafite acetinado",
        "Café",
        "Redondo",
        "451,25 kg",
    ] {
        assert!(text.contains(expected), "missing {expected}: {text}");
    }
    for forbidden in [
        "Nome do pedido divergente",
        "SEGREDO_CUSTO",
        "SEGREDO_MARGEM",
        "Legado oculto",
        "IPI 13",
        "Comissão",
        "Margem",
        "Alçada",
    ] {
        assert!(!text.contains(forbidden), "unexpected {forbidden}");
    }
}
#[test]
fn accepted_order_document_identifies_the_encomenda_without_claiming_reservation() {
    let mut current = order();
    current.data.status = "accepted".into();
    let text = document_text(&current);
    assert!(text.contains("Encomenda aceita"), "{text}");
    for forbidden in ["Não informado", "Cancelado", "Reservado", "Quitado"] {
        assert!(!text.contains(forbidden), "unexpected {forbidden}: {text}");
    }
}
#[test]
fn planned_entry_and_installments_never_claim_payment_or_reservation() {
    let text = document_text(&order());
    for expected in [
        "Rascunho",
        "Entrada prevista: R$ 70,01",
        "Parcela 1: R$ 15,00",
        "Parcela 2: R$ 14,99",
        "01/01/2027",
        "01/02/2027",
        "não comprovam recebimento",
        "45 dias após o recebimento da entrada",
        "Observação <script> & conferência",
    ] {
        assert!(text.contains(expected), "missing {expected}");
    }
    for forbidden in [
        "Reservado",
        "Quitado",
        "Pagamento recebido",
        "Entrada recebida",
    ] {
        assert!(!text.contains(forbidden));
    }
}
#[test]
fn missing_weight_and_checkout_do_not_become_zero_or_paid() {
    let mut current = order();
    current.items[0].equipment_weight = None;
    current.checkout = None;
    let text = document_text(&current);
    assert!(text.contains("Nome do pedido divergente"));
    assert!(text.contains("Incompleto"));
    assert!(text.contains("Condições de pagamento não registradas"));
    assert!(text.contains("não comprova recebimento"));
    assert!(!text.contains("Peso bruto total: 0"));
}
#[test]
fn fixed_decimal_formatting_keeps_registered_cents_and_quantity() {
    assert_eq!(decimal_br("1234567.01", true), "R$ 1.234.567,01");
    assert_eq!(decimal_br("0.000001", false), "0,000001");
    assert_eq!(decimal_br("2.500000", false), "2,5");
}
