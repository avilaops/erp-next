use super::DomainError;

/// SQL expressions are defined by each endpoint, never supplied by the caller.
pub struct SortField {
    name: &'static str,
    expression: &'static str,
    text: bool,
}

impl SortField {
    pub const fn text(name: &'static str, expression: &'static str) -> Self {
        Self {
            name,
            expression,
            text: true,
        }
    }

    pub const fn typed(name: &'static str, expression: &'static str) -> Self {
        Self {
            name,
            expression,
            text: false,
        }
    }
}

pub fn order_by(
    sort_by: Option<&str>,
    sort_order: Option<&str>,
    fields: &[SortField],
    default: &str,
    unique: &str,
) -> Result<String, DomainError> {
    let Some(name) = sort_by else {
        return if sort_order.is_none() {
            Ok(format!("ORDER BY {default}"))
        } else {
            Err(DomainError::Invalid("Informe o campo da ordenação"))
        };
    };
    let direction = match sort_order.unwrap_or("asc") {
        "asc" => "ASC",
        "desc" => "DESC",
        _ => return Err(DomainError::Invalid("Direção de ordenação inválida")),
    };
    let field = fields
        .iter()
        .find(|field| field.name == name)
        .ok_or(DomainError::Invalid("Campo de ordenação inválido"))?;
    let expression = if field.text {
        format!("({}) COLLATE public.erp_pt_br_natural", field.expression)
    } else {
        field.expression.to_owned()
    };
    Ok(format!(
        "ORDER BY {expression} {direction} NULLS LAST, {unique} ASC"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIELDS: &[SortField] = &[
        SortField::text("name", "p.name"),
        SortField::typed("price", "p.price_cents"),
    ];

    #[test]
    fn absent_sort_preserves_the_existing_default() {
        assert_eq!(
            order_by(None, None, FIELDS, "p.name,p.id", "p.id").unwrap(),
            "ORDER BY p.name,p.id"
        );
    }

    #[test]
    fn explicit_text_uses_natural_collation_nulls_last_and_unique_tie() {
        assert_eq!(
            order_by(Some("name"), None, FIELDS, "p.name,p.id", "p.id").unwrap(),
            "ORDER BY (p.name) COLLATE public.erp_pt_br_natural ASC NULLS LAST, p.id ASC"
        );
        assert_eq!(
            order_by(Some("name"), Some("desc"), FIELDS, "p.name,p.id", "p.id").unwrap(),
            "ORDER BY (p.name) COLLATE public.erp_pt_br_natural DESC NULLS LAST, p.id ASC"
        );
    }

    #[test]
    fn numeric_sort_keeps_the_native_expression() {
        assert_eq!(
            order_by(Some("price"), Some("asc"), FIELDS, "p.name,p.id", "p.id").unwrap(),
            "ORDER BY p.price_cents ASC NULLS LAST, p.id ASC"
        );
    }

    #[test]
    fn invalid_or_injected_parameters_are_rejected() {
        for (by, direction) in [
            (None, Some("asc")),
            (Some(""), None),
            (Some("name; DROP TABLE products"), Some("asc")),
            (Some("price"), Some("ASC")),
            (Some("price"), Some("desc NULLS FIRST")),
            (Some("price"), Some("")),
        ] {
            assert!(
                order_by(by, direction, FIELDS, "p.name,p.id", "p.id").is_err(),
                "accepted {by:?} {direction:?}"
            );
        }
    }
}
