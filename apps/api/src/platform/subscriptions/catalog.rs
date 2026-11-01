use serde::Serialize;
use utoipa::ToSchema;

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: &'static str,
    pub name: &'static str,
    pub monthly_cents: i64,
    pub data_megabytes: i64,
    pub users: Option<i64>,
    pub imported_orders: Option<i64>,
    pub custom_quote: bool,
}

// Initial commercial catalog explicitly approved by the product owner.
// Missing import quotas are not inferred from another tier.
pub fn plans() -> Vec<Plan> {
    [
        ("cobalto", "Cobalto", 6000, 60, Some(5), Some(200), false),
        (
            "titanio-1",
            "Titânio Faixa 1",
            12000,
            120,
            Some(50),
            None,
            false,
        ),
        (
            "titanio-2",
            "Titânio Faixa 2",
            20000,
            360,
            Some(50),
            None,
            false,
        ),
        (
            "titanio-3",
            "Titânio Faixa 3",
            45000,
            1200,
            Some(50),
            None,
            false,
        ),
        ("diamante", "Diamante", 65000, 1800, Some(100), None, false),
        ("elite", "Elite", 125000, 5000, None, None, true),
    ]
    .into_iter()
    .map(
        |(id, name, monthly_cents, data_megabytes, users, imported_orders, custom_quote)| Plan {
            id,
            name,
            monthly_cents,
            data_megabytes,
            users,
            imported_orders,
            custom_quote,
        },
    )
    .collect()
}

pub fn plan(id: &str) -> Option<Plan> {
    plans().into_iter().find(|plan| plan.id == id)
}
