//! Pure commercial invariants shared by proposal commands.
use crate::domains::{DomainError, fixed};

pub(super) const MAX_AMOUNT: i64 = 99_999_999_999_999;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Action {
    Send,
    Accept,
    Reject,
    Cancel,
    Revise,
    Convert,
    ApproveConvert,
}

/// Expiration uses the business date supplied by the caller, never a browser clock.
pub(super) fn transition(
    status: &str,
    action: Action,
    valid_until: time::Date,
    today: time::Date,
    converted: bool,
) -> Result<&'static str, DomainError> {
    if converted {
        return Err(DomainError::Conflict("Proposta já convertida em pedido"));
    }
    match (status, action) {
        ("draft", Action::Send) if valid_until >= today => Ok("sent"),
        ("sent", Action::Accept) if valid_until >= today => Ok("accepted"),
        ("sent", Action::Reject) => Ok("rejected"),
        ("draft" | "sent" | "accepted", Action::Cancel) => Ok("cancelled"),
        ("sent" | "rejected" | "accepted", Action::Revise) => Ok("superseded"),
        ("accepted", Action::Convert) => Ok("accepted"),
        ("draft" | "sent" | "accepted", Action::ApproveConvert) if valid_until >= today => {
            Ok("accepted")
        }
        ("draft" | "sent" | "accepted", Action::ApproveConvert) => Err(DomainError::Conflict(
            "A validade expirou; revise a proposta antes de aprovar",
        )),
        ("draft", Action::Send) | ("sent", Action::Accept) => Err(DomainError::Conflict(
            "A validade expirou; revise a proposta antes de enviar ou aceitar",
        )),
        _ => Err(DomainError::Conflict(
            "Ação incompatível com a situação da proposta",
        )),
    }
}

pub(super) fn line_amount(quantity: &str, price: &str) -> Result<(i64, i64, i64), DomainError> {
    let quantity = fixed(quantity, 6)?;
    let price = fixed(price, 2)?;
    if quantity == 0 || price > MAX_AMOUNT {
        return Err(DomainError::Invalid("Quantidade ou preço fora do limite"));
    }
    let amount = (i128::from(quantity) * i128::from(price) + 500_000) / 1_000_000;
    if amount > i128::from(MAX_AMOUNT) {
        return Err(DomainError::Invalid("Valor do item fora do limite"));
    }
    Ok((quantity, price, amount as i64))
}

pub(super) fn total(amounts: impl IntoIterator<Item = i64>) -> Result<i64, DomainError> {
    let mut count = 0;
    let mut total = 0_i64;
    for amount in amounts {
        count += 1;
        total = total
            .checked_add(amount)
            .filter(|value| amount >= 0 && *value <= MAX_AMOUNT)
            .ok_or(DomainError::Invalid("Total da proposta fora do limite"))?;
    }
    if !(1..=100).contains(&count) || total == 0 {
        return Err(DomainError::Invalid(
            "Proposta exige de 1 a 100 itens e valor positivo",
        ));
    }
    Ok(total)
}

pub(super) fn text(raw: &str, maximum: usize, required: bool) -> Result<String, DomainError> {
    let value = raw.trim();
    if (required && value.is_empty()) || value.chars().count() > maximum || value.contains('\0') {
        return Err(DomainError::Invalid(
            "Texto obrigatório ausente ou fora do limite",
        ));
    }
    Ok(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(value: &str) -> time::Date {
        super::super::date(value).unwrap()
    }

    #[test]
    fn acceptance_honors_inclusive_validity_and_cannot_skip_sending() {
        let today = day("2026-11-03");
        assert_eq!(
            transition("sent", Action::Accept, today, today, false).unwrap(),
            "accepted"
        );
        assert!(transition("sent", Action::Accept, day("2026-11-02"), today, false).is_err());
        assert!(transition("draft", Action::Accept, today, today, false).is_err());
        assert!(transition("rejected", Action::Accept, today, today, false).is_err());
        assert!(transition("cancelled", Action::Send, today, today, false).is_err());
    }

    #[test]
    fn converted_proposals_cannot_be_changed_or_converted_twice() {
        let today = day("2026-11-03");
        for action in [
            Action::Send,
            Action::Accept,
            Action::Reject,
            Action::Cancel,
            Action::Revise,
            Action::Convert,
            Action::ApproveConvert,
        ] {
            assert!(transition("accepted", action, today, today, true).is_err());
        }
        assert_eq!(
            transition("accepted", Action::Convert, today, today, false).unwrap(),
            "accepted"
        );
        assert!(transition("sent", Action::Convert, today, today, false).is_err());
    }

    #[test]
    fn expired_versions_can_be_revised_or_rejected_but_not_sent() {
        let today = day("2026-11-03");
        let expired = day("2026-11-02");
        assert!(transition("draft", Action::Send, expired, today, false).is_err());
        assert_eq!(
            transition("sent", Action::Revise, expired, today, false).unwrap(),
            "superseded"
        );
        assert_eq!(
            transition("sent", Action::Reject, expired, today, false).unwrap(),
            "rejected"
        );
        assert!(transition("superseded", Action::Revise, expired, today, false).is_err());
    }

    #[test]
    fn approve_and_convert_accepts_only_current_valid_commercial_states() {
        let today = day("2026-11-08");
        for status in ["draft", "sent", "accepted"] {
            assert_eq!(
                transition(status, Action::ApproveConvert, today, today, false).unwrap(),
                "accepted"
            );
            assert!(
                transition(
                    status,
                    Action::ApproveConvert,
                    day("2026-11-07"),
                    today,
                    false
                )
                .is_err()
            );
            assert!(transition(status, Action::ApproveConvert, today, today, true).is_err());
        }
        for status in ["cancelled", "rejected", "superseded"] {
            assert!(transition(status, Action::ApproveConvert, today, today, false).is_err());
        }
    }

    #[test]
    fn money_rounds_half_up_per_line_without_floating_point() {
        assert_eq!(line_amount("0.500000", "0.01").unwrap(), (500_000, 1, 1));
        assert_eq!(line_amount("0.499999", "0.01").unwrap().2, 0);
        assert_eq!(line_amount("3.000000", "19.99").unwrap().2, 5997);
        assert_eq!(total([5997, 1]).unwrap(), 5998);
        for (quantity, price) in [
            ("0.000000", "1.00"),
            ("-1.000000", "1.00"),
            ("1.0", "1.00"),
            ("1.000000", "NaN"),
            ("999999999999.999999", "999999999999.99"),
        ] {
            assert!(line_amount(quantity, price).is_err());
        }
        assert!(total([MAX_AMOUNT, 1]).is_err());
        assert!(total([0]).is_err());
        assert!(total([]).is_err());
        assert!(total(std::iter::repeat_n(1, 101)).is_err());
        assert!(total([-1, 2]).is_err());
    }

    #[test]
    fn conditions_must_be_explicit_and_text_limits_count_characters() {
        assert!(text("  ", 2000, true).is_err());
        assert_eq!(text(" à vista ", 7, true).unwrap(), "à vista");
        assert!(text("à vista", 6, true).is_err());
        assert!(text("invalid\0text", 2000, true).is_err());
        assert_eq!(text("", 10000, false).unwrap(), "");
    }
}
