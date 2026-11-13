//! Customer-facing terms derived only from the immutable negotiated agreement.
use super::checkout::CheckoutSnapshot;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutDocument {
    pub payment_terms: String,
    pub delivery_terms: String,
    pub notes: String,
}

fn money(cents: i64) -> String {
    format!("R$ {},{:02}", cents / 100, cents % 100)
}

fn date(raw: &str) -> String {
    let parts = raw.split('-').collect::<Vec<_>>();
    if let [year, month, day] = parts.as_slice() {
        format!("{day}/{month}/{year}")
    } else {
        raw.to_owned()
    }
}

pub fn terms(checkout: &CheckoutSnapshot) -> CheckoutDocument {
    let mut payment = vec![if checkout.entry.amount_cents > 0 {
        format!(
            "Entrada prevista: {} · {} · {}",
            money(checkout.entry.amount_cents),
            checkout
                .entry
                .payment_method
                .as_ref()
                .map_or("Forma não informada", |method| method.name.as_str()),
            checkout
                .entry
                .due_on
                .as_deref()
                .map(date)
                .unwrap_or_else(|| "Na geração das parcelas".into())
        )
    } else {
        "Sem entrada negociada".into()
    }];
    payment.extend(checkout.installments.iter().map(|item| {
        format!(
            "Parcela {}: {} · {} · {}",
            item.number,
            money(item.amount_cents),
            item.payment_method.name,
            date(&item.due_on)
        )
    }));
    if !checkout.payment_notes.is_empty() {
        payment.push(checkout.payment_notes.clone());
    }
    payment.push("Condições previstas; não comprovam recebimento.".into());
    let mut delivery = Vec::new();
    if let Some(days) = checkout.manufacturing_days {
        delivery.push(if checkout.entry.amount_cents > 0 {
            format!("Prazo de fabricação: {days} dias após o recebimento da entrada.")
        } else {
            format!("Prazo de fabricação: {days} dias (sem entrada negociada).")
        });
    }
    if !checkout.delivery_notes.is_empty() {
        delivery.push(checkout.delivery_notes.clone());
    }
    CheckoutDocument {
        payment_terms: payment.join("\n"),
        delivery_terms: delivery.join("\n"),
        notes: checkout.notes.clone(),
    }
}

#[cfg(test)]
pub(crate) fn fixture() -> CheckoutSnapshot {
    use super::checkout::{
        CheckoutEntrySnapshot, CheckoutInstallmentSnapshot, CheckoutPaymentMethod,
    };
    let method = CheckoutPaymentMethod {
        id: uuid::Uuid::nil(),
        code: "PIX".into(),
        name: "Pix & combinado".into(),
        modality: "pix".into(),
    };
    CheckoutSnapshot {
        confirmation_creates_receivables: true,
        entry: CheckoutEntrySnapshot {
            amount_cents: 7001,
            payment_method_id: Some(method.id),
            payment_method: Some(method.clone()),
            due_on: None,
        },
        installments: [1500, 1499]
            .into_iter()
            .enumerate()
            .map(|(index, amount)| CheckoutInstallmentSnapshot {
                id: uuid::Uuid::nil(),
                number: index as i32 + 1,
                payment_method_id: method.id,
                payment_method: method.clone(),
                due_on: format!("2027-0{}-01", index + 1),
                amount_cents: amount,
            })
            .collect(),
        manufacturing_days: Some(45),
        delivery_notes: "Entrega <combinada>".into(),
        payment_notes: "Saldo preservado".into(),
        notes: "Observação <script> & conferência".into(),
        customer: serde_json::json!({"id":uuid::Uuid::nil(),"legalName":"Cliente preservado <b>","taxId":"52998224725","email":"preservado@example.test","phone":"11999999999","addresses":[{"street":"Rua preservada & segura","number":"10","city":"São Paulo","state":"SP","primary":true}]}),
        state_registration: Some("ISENTO".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkout_document_contains_each_planned_payment_without_claiming_receipt() {
        let checkout = fixture();
        let document = terms(&checkout);
        for expected in [
            "R$ 70,01",
            "Na geração das parcelas",
            "Parcela 1: R$ 15,00",
            "Parcela 2: R$ 14,99",
            "01/01/2027",
            "01/02/2027",
            "Pix & combinado",
            "Saldo preservado",
            "não comprovam recebimento",
        ] {
            assert!(
                document.payment_terms.contains(expected),
                "missing {expected}"
            );
        }
        assert!(
            document
                .delivery_terms
                .contains("45 dias após o recebimento da entrada")
        );
        assert!(document.delivery_terms.contains("Entrega <combinada>"));
        assert_eq!(document.notes, checkout.notes);
    }
}
