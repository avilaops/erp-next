use crate::domains::fixed;

fn kilogram_micros(raw: &str) -> Option<i64> {
    let value = raw.trim().to_ascii_lowercase();
    let value = value.strip_suffix("kg").unwrap_or(&value).trim();
    let value = value.replace(',', ".");
    let (whole, fraction) = value.split_once('.').unwrap_or((&value, ""));
    if fraction.len() > 6 || (fraction.is_empty() && value.contains('.')) {
        return None;
    }
    fixed(&format!("{whole}.{fraction:0<6}"), 6)
        .ok()
        .filter(|value| *value > 0)
}

/// Current catalog equipment weights multiplied by the recorded quantities.
/// Missing weights never become a zero-weight line or a partial total.
pub(super) fn total<'a>(
    items: impl IntoIterator<Item = (&'a str, Option<&'a str>)>,
) -> Option<String> {
    let mut total = 0_i128;
    for (quantity, weight) in items {
        let quantity = fixed(quantity, 6).ok().filter(|value| *value > 0)?;
        let weight = kilogram_micros(weight?)?;
        total = total.checked_add(i128::from(quantity).checked_mul(i128::from(weight))?)?;
    }
    let scale = 1_000_000_000_000_i128;
    let digits = (total / scale).to_string();
    let mut grouped = String::new();
    for (index, character) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(character);
    }
    let fraction = format!("{:012}", total % scale);
    let fraction = fraction.trim_end_matches('0');
    Some(if fraction.is_empty() {
        grouped
    } else {
        format!("{grouped},{fraction}")
    })
}

#[cfg(test)]
mod tests {
    use super::total;

    #[test]
    fn totals_each_equipment_quantity_with_exact_decimal_precision() {
        assert_eq!(
            total([
                ("6.000000", Some("180,5 kg")),
                ("2.000000", Some("90.25 KG"))
            ]),
            Some("1.263,5".into())
        );
        assert_eq!(
            total([("0.125000", Some("0.001 kg"))]),
            Some("0,000125".into())
        );
        assert_eq!(
            total([("999999999999.999999", Some("0.000001"))]),
            Some("999.999,999999999999".into())
        );
    }

    #[test]
    fn missing_or_invalid_weight_does_not_publish_a_partial_total() {
        for weight in [
            None,
            Some(""),
            Some("0 kg"),
            Some("-1 kg"),
            Some("10 lb"),
            Some("aprox. 200 kg"),
            Some("10-20 kg"),
            Some("1e3"),
            Some("NaN"),
            Some("1."),
            Some("1,"),
        ] {
            assert_eq!(
                total([("2.000000", Some("100 kg")), ("1.000000", weight)]),
                None
            );
        }
    }
}
