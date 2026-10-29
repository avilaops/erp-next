use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use super::super::{DomainError, db};

#[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Recipient {
    pub role: String,
    pub name: String,
    pub email: String,
}

#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Generate {
    pub order_id: Uuid,
    pub order_revision: i64,
    pub template_id: i64,
    pub template_updated_at: String,
    pub recipients: Vec<Recipient>,
    pub fields: BTreeMap<String, String>,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contract {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub customer_id: Uuid,
    pub order_id: Uuid,
    pub template_id: i64,
    pub template_name: String,
    #[serde(skip)]
    pub template_snapshot: Value,
    pub snapshot: Value,
    pub recipients: Value,
    pub fields: Value,
    pub external_id: Option<i64>,
    pub status: String,
    pub revision: i64,
    pub problem: Option<String>,
    pub progress: Value,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<String>,
    pub send_requested_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
}

pub const COLUMNS: &str = "id,tenant_id,customer_id,order_id,template_id,template_name,template_snapshot,snapshot,recipients,fields,external_id,status,revision,problem,progress,reviewed_by,reviewed_at::text,send_requested_at::text,completed_at::text,created_at::text";

pub async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Contract, DomainError> {
    sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM commercial_contracts WHERE tenant_id=$1 AND id=$2 FOR UPDATE"
    ))
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn correlation(tenant: Uuid, id: Uuid, index: usize) -> String {
    format!("erp:{tenant}:{id}:{index}")
}

pub async fn snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<Value, DomainError> {
    sqlx::query_scalar("SELECT jsonb_build_object('order',jsonb_build_object('id',o.id,'revision',o.revision,'status',o.status,'dueDate',o.due_date::text,'amount',(o.amount_cents::numeric/100)::numeric(16,2)::text),'company',COALESCE(c.details,'{}'::jsonb)||jsonb_build_object('legalName',t.legal_name,'taxId',t.tax_id),'customer',jsonb_build_object('id',p.id,'name',p.legal_name,'taxId',p.tax_id,'email',p.email,'addresses',p.addresses),'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',l.name,'sku',l.sku,'unit',l.unit,'quantity',(l.quantity_micros::numeric/1000000)::numeric(24,6)::text,'unitPrice',(l.price_cents::numeric/100)::numeric(16,2)::text,'amount',(l.amount_cents::numeric/100)::numeric(16,2)::text) ORDER BY l.line_number) FROM sales_order_lines l WHERE l.tenant_id=o.tenant_id AND l.order_id=o.id),'[]'::jsonb)) FROM sales_orders o JOIN parties p ON p.tenant_id=o.tenant_id AND p.id=o.customer_id JOIN tenants t ON t.id=o.tenant_id LEFT JOIN company_profiles c ON c.tenant_id=o.tenant_id WHERE o.tenant_id=$1 AND o.id=$2")
        .bind(tenant).bind(order).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}

fn address(value: &Value) -> String {
    [
        "street",
        "number",
        "complement",
        "district",
        "city",
        "state",
        "postalCode",
    ]
    .iter()
    .filter_map(|key| value[*key].as_str())
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join(", ")
}

pub fn defaults(snapshot: &Value) -> BTreeMap<String, String> {
    let addresses = snapshot["customer"]["addresses"].as_array();
    let customer_address = addresses.and_then(|a| {
        a.iter()
            .find(|v| v["primary"] == true)
            .or_else(|| a.first())
    });
    let items = snapshot["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    format!(
                        "{} | {} {} | R$ {} | R$ {}",
                        item["name"].as_str().unwrap_or(""),
                        item["quantity"].as_str().unwrap_or(""),
                        item["unit"].as_str().unwrap_or(""),
                        item["unitPrice"].as_str().unwrap_or(""),
                        item["amount"].as_str().unwrap_or("")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    let mut result = BTreeMap::new();
    for (key, value) in [
        ("empresa_nome", &snapshot["company"]["legalName"]),
        ("empresa_documento", &snapshot["company"]["taxId"]),
        ("cliente_nome", &snapshot["customer"]["name"]),
        ("cliente_documento", &snapshot["customer"]["taxId"]),
        ("cliente_email", &snapshot["customer"]["email"]),
        ("pedido_numero", &snapshot["order"]["id"]),
        ("pedido_total", &snapshot["order"]["amount"]),
        ("vencimento", &snapshot["order"]["dueDate"]),
    ] {
        result.insert(key.into(), value.as_str().unwrap_or("").into());
    }
    result.insert("empresa_endereco".into(), address(&snapshot["company"]));
    result.insert(
        "cliente_endereco".into(),
        customer_address.map(address).unwrap_or_default(),
    );
    result.insert("itens".into(), items);
    result
}

pub fn editable_fields(template: &Value) -> Vec<Value> {
    template["fields"].as_array().into_iter().flatten()
        .filter(|field| field["type"] != "signature" && field["type"] != "initials")
        .map(|field| json!({"name":field["name"],"type":field["type"],"required":field["required"].as_bool().unwrap_or(true)})).collect()
}

pub fn validate(
    input: &mut Generate,
    template: &Value,
    snapshot: &Value,
) -> Result<(), DomainError> {
    if snapshot["order"]["status"] == "cancelled" {
        return Err(DomainError::Conflict(
            "Pedido cancelado não pode gerar contrato",
        ));
    }
    if snapshot["order"]["revision"].as_i64() != Some(input.order_revision) {
        return Err(DomainError::StaleRevision);
    }
    if template["updated_at"].as_str() != Some(&input.template_updated_at) {
        return Err(DomainError::Conflict(
            "O modelo mudou. Recarregue antes de gerar",
        ));
    }
    let roles = template["submitters"]
        .as_array()
        .ok_or(DomainError::Invalid("Modelo sem signatários"))?;
    let template_fields = template["fields"]
        .as_array()
        .ok_or(DomainError::Invalid("Modelo sem campos"))?;
    let mut names = HashSet::new();
    if template_fields.is_empty()
        || template_fields.iter().any(|f| {
            f["name"]
                .as_str()
                .is_none_or(|name| name.is_empty() || !names.insert(name))
                || !roles.iter().any(|r| r["uuid"] == f["submitter_uuid"])
        })
    {
        return Err(DomainError::Invalid(
            "O modelo precisa de nomes de campo únicos e papéis válidos",
        ));
    }
    if roles.is_empty() || roles.len() > 10 || input.recipients.len() != roles.len() {
        return Err(DomainError::Invalid(
            "Preencha todos os destinatários do modelo",
        ));
    }
    let mut seen = HashSet::new();
    for recipient in &mut input.recipients {
        recipient.name = recipient.name.trim().into();
        recipient.email = recipient.email.trim().to_ascii_lowercase();
        let parts: Vec<_> = recipient.email.split('@').collect();
        if recipient.name.is_empty()
            || recipient.name.len() > 200
            || recipient.name.chars().any(char::is_control)
            || recipient.email.len() > 254
            || !recipient.email.is_ascii()
            || recipient
                .email
                .chars()
                .any(|c| c.is_whitespace() || c.is_control())
            || parts.len() != 2
            || parts.iter().any(|part| part.is_empty())
            || !roles.iter().any(|role| role["name"] == recipient.role)
            || !seen.insert(&recipient.role)
        {
            return Err(DomainError::Invalid(
                "Destinatário inválido ou papel repetido",
            ));
        }
    }
    let fields = editable_fields(template);
    if input.fields.len() > 100
        || input
            .fields
            .iter()
            .any(|(key, value)| value.len() > 20000 || !fields.iter().any(|f| f["name"] == *key))
    {
        return Err(DomainError::Invalid(
            "Campo desconhecido ou acima do limite",
        ));
    }
    // Commercial values available in the ERP are authoritative. Missing values
    // and commercial terms can be filled explicitly and remain in the snapshot.
    for (key, value) in defaults(snapshot) {
        if !value.is_empty() && fields.iter().any(|f| f["name"] == key) {
            input.fields.insert(key, value);
        }
    }
    for field in fields {
        if !["text", "date", "number", "phone", "select", "radio"]
            .contains(&field["type"].as_str().unwrap_or(""))
        {
            return Err(DomainError::Invalid(
                "Modelo usa um tipo de campo ainda não suportado nesta integração",
            ));
        }
        if field["required"] == true
            && input
                .fields
                .get(field["name"].as_str().unwrap_or(""))
                .is_none_or(|value| value.trim().is_empty())
        {
            return Err(DomainError::Invalid(
                "Preencha os campos obrigatórios antes de gerar",
            ));
        }
    }
    Ok(())
}

pub fn submission_body(contract: &Contract) -> Value {
    let recipients: Vec<Recipient> =
        serde_json::from_value(contract.recipients.clone()).expect("validated recipients");
    let roles = contract.template_snapshot["submitters"]
        .as_array()
        .expect("validated roles");
    let fields = contract.template_snapshot["fields"]
        .as_array()
        .expect("validated fields");
    let submitters: Vec<_> = recipients.iter().enumerate().map(|(index, recipient)| {
        let role = roles.iter().find(|role| role["name"] == recipient.role).expect("validated role");
        let values: Vec<_> = fields.iter().filter(|field| field["submitter_uuid"] == role["uuid"])
            .filter_map(|field| contract.fields.get(field["name"].as_str()?).map(|value| json!({"name":field["name"],"default_value":value,"readonly":true}))).collect();
        json!({"name":recipient.name,"email":recipient.email,"role":recipient.role,"external_id":correlation(contract.tenant_id, contract.id, index),"send_email":false,"fields":values})
    }).collect();
    json!({"template_id":contract.template_id,"send_email":false,"submitters_order":"random","submitters":submitters})
}
