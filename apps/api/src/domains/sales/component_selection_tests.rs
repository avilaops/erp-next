use super::{select_color, select_optional_color, select_plate_holder_type};

#[test]
fn plate_holder_type_is_fixed_and_independent_of_catalog_options() {
    for (requested, expected) in [
        ("Standard", "Standard"),
        (" standard ", "Standard"),
        ("Olímpico", "Olímpico"),
        ("OLÍMPICO", "Olímpico"),
    ] {
        assert_eq!(
            select_plate_holder_type(Some(requested), None)
                .unwrap()
                .as_deref(),
            Some(expected)
        );
    }
    for requested in [None, Some(""), Some(" "), Some("Não se aplica")] {
        assert_eq!(
            select_plate_holder_type(requested, Some("Olímpico")).unwrap(),
            None
        );
    }
    assert!(select_plate_holder_type(Some("Cônico"), None).is_err());
    assert_eq!(
        select_plate_holder_type(Some("Redondo"), Some("Redondo"))
            .unwrap()
            .as_deref(),
        Some("Redondo")
    );
    assert!(select_plate_holder_type(Some("Redondo"), Some("Cônico")).is_err());
}

#[test]
fn legacy_plate_holder_color_is_optional_without_relaxing_other_colors() {
    let available = vec!["Preto".to_owned()];
    assert_eq!(select_optional_color(None, &available, None).unwrap(), None);
    assert_eq!(
        select_optional_color(None, &available, Some("Azul")).unwrap(),
        None
    );
    assert_eq!(
        select_optional_color(Some(" "), &available, None).unwrap(),
        None
    );
    assert_eq!(
        select_optional_color(Some("preto"), &available, None)
            .unwrap()
            .as_deref(),
        Some("Preto")
    );
    assert_eq!(
        select_optional_color(Some("Azul"), &available, Some("Azul"))
            .unwrap()
            .as_deref(),
        Some("Azul")
    );
    assert!(select_optional_color(Some("Azul"), &available, None).is_err());
    assert!(select_color(None, &available, None).is_err());
}
