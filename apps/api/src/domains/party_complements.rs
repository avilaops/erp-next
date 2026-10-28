use super::DomainError;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PartyAddress {
    pub label: String,
    pub postal_code: String,
    pub state: String,
    pub city: String,
    pub street: String,
    pub number: String,
    pub district: String,
    pub complement: Option<String>,
    #[serde(default)]
    pub primary: bool,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PartyContact {
    pub name: String,
    pub role: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    #[serde(default)]
    pub primary: bool,
}

fn text(value: &mut String, max: usize) -> Result<(), DomainError> {
    *value = value.trim().to_owned();
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Endereço ou contato contém texto obrigatório vazio, inválido ou acima do limite",
        ));
    }
    Ok(())
}

fn optional(value: &mut Option<String>, max: usize) -> Result<(), DomainError> {
    *value = value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned);
    if let Some(value) = value {
        text(value, max)?;
    }
    Ok(())
}

pub fn validate(
    addresses: &mut Option<Vec<PartyAddress>>,
    contacts: &mut Option<Vec<PartyContact>>,
) -> Result<(), DomainError> {
    if let Some(items) = addresses {
        if items.len() > 10 || items.iter().filter(|item| item.primary).count() > 1 {
            return Err(DomainError::Invalid(
                "Máximo de dez endereços e um endereço principal",
            ));
        }
        for item in items {
            text(&mut item.label, 80)?;
            text(&mut item.city, 200)?;
            text(&mut item.street, 200)?;
            text(&mut item.number, 40)?;
            text(&mut item.district, 200)?;
            optional(&mut item.complement, 200)?;
            if !item
                .postal_code
                .chars()
                .all(|c| c.is_ascii_digit() || ".- ".contains(c))
            {
                return Err(DomainError::Invalid("CEP deve conter oito dígitos"));
            }
            item.postal_code.retain(|c| c.is_ascii_digit());
            item.state = item.state.trim().to_ascii_uppercase();
            if item.postal_code.len() != 8
                || ![
                    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
                    "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE",
                    "TO",
                ]
                .contains(&item.state.as_str())
            {
                return Err(DomainError::Invalid("Informe CEP e UF válidos"));
            }
        }
    }
    if let Some(items) = contacts {
        if items.len() > 10 || items.iter().filter(|item| item.primary).count() > 1 {
            return Err(DomainError::Invalid(
                "Máximo de dez contatos e um contato principal",
            ));
        }
        for item in items {
            text(&mut item.name, 200)?;
            optional(&mut item.role, 80)?;
            optional(&mut item.email, 254)?;
            optional(&mut item.phone, 40)?;
            if item.email.is_none() && item.phone.is_none() {
                return Err(DomainError::Invalid(
                    "Contato precisa de e-mail ou telefone",
                ));
            }
            if item.email.as_ref().is_some_and(|email| {
                !email.is_ascii()
                    || email.chars().any(char::is_whitespace)
                    || !email.split_once('@').is_some_and(|(local, domain)| {
                        !local.is_empty() && domain.contains('.') && !domain.contains('@')
                    })
            }) {
                return Err(DomainError::Invalid("E-mail do contato inválido"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn address() -> Value {
        json!({"label":" Entrega ","postalCode":"01001-000","state":"sp","city":"São Paulo","street":"Praça","number":"1","district":"Centro","primary":true})
    }
    fn contact() -> Value {
        json!({"name":" Maria ","email":"maria@example.test","primary":true})
    }
    fn checked(addresses: Value, contacts: Value) -> Result<(), DomainError> {
        let mut addresses = Some(serde_json::from_value::<Vec<PartyAddress>>(addresses).unwrap());
        let mut contacts = Some(serde_json::from_value::<Vec<PartyContact>>(contacts).unwrap());
        validate(&mut addresses, &mut contacts)
    }
    #[test]
    fn limits_and_primary_contacts_are_checked() {
        assert!(checked(json!([address()]), json!([contact()])).is_ok());
        assert!(checked(json!([address(), address()]), json!([])).is_err());
        assert!(checked(json!([]), json!([contact(), contact()])).is_err());
        let mut item = address();
        item["primary"] = json!(false);
        assert!(checked(json!(vec![item.clone(); 10]), json!([])).is_ok());
        assert!(checked(json!(vec![item; 11]), json!([])).is_err());
        let mut item = contact();
        item["primary"] = json!(false);
        assert!(checked(json!([]), json!(vec![item.clone(); 10])).is_ok());
        assert!(checked(json!([]), json!(vec![item; 11])).is_err());
    }
    #[test]
    fn invalid_addresses_and_contact_channels_are_rejected() {
        for (field, value) in [
            ("label", ""),
            ("postalCode", "abc01001000"),
            ("postalCode", "123"),
            ("state", "XX"),
            ("city", ""),
            ("street", ""),
            ("number", ""),
            ("district", ""),
            ("complement", "bad\u{0001}"),
        ] {
            let mut item = address();
            item[field] = json!(value);
            assert!(checked(json!([item]), json!([])).is_err(), "{field}");
        }
        for (field, value) in [
            ("name", ""),
            ("email", "bad@@example.test"),
            ("email", "bad example@test.test"),
            ("email", "bad@test"),
            ("phone", "bad\u{0001}"),
        ] {
            let mut item = contact();
            item[field] = json!(value);
            assert!(checked(json!([]), json!([item])).is_err(), "{field}");
        }
        let mut item = contact();
        item["email"] = Value::Null;
        assert!(checked(json!([]), json!([item.clone()])).is_err());
        item["phone"] = json!("+55 11 99999-9999");
        assert!(checked(json!([]), json!([item])).is_ok());
        let mut item = address();
        item["tenantId"] = json!("foreign");
        assert!(serde_json::from_value::<PartyAddress>(item).is_err());
    }
}
