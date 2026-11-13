//! Authenticated canonical commercial PDF, shared by download and SMTP.
use super::*;
use crate::platform::mail::MailAttachment;
use axum::{
    http::{HeaderValue, header},
    response::IntoResponse,
};
use serde_json::Value;

#[path = "order_document_pdf.rs"]
mod pdf;

#[utoipa::path(get, path="/api/v1/orders/{id}/document", operation_id="download_order_document", tag="Sales", security(("bearerAuth"=[])), params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)), responses((status=200,description="PDF A4 do pedido na revisão informada",content_type="application/pdf",body=Vec<u8>),(status=403,description="Sem permissão"),(status=412,description="Revisão divergente"),(status=428,description="Revisão obrigatória")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let (tenant, mut tx, manage) = authorized(
        &state,
        &headers,
        &identity,
        "sales.orders.read",
        "sales.orders.manage",
        false,
    )
    .await?;
    // Writers update this parent row before replacing its lines. Keep revision,
    // item prices, and checkout agreement together through the document read.
    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM sales_orders WHERE tenant_id=$1 AND id=$2 FOR SHARE",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    let current = load(&mut tx, tenant, id, manage).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    let file = attachment(&mut tx, tenant, &current).await?;
    tx.commit().await.map_err(db)?;
    let mut response = file.bytes.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/pdf"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{}\"", file.filename))
            .map_err(|_| AccessError::Internal)?,
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(&format!("\"{expected}\"")).map_err(|_| AccessError::Internal)?,
    );
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}

pub async fn attachment(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    current: &OrderSnapshot,
) -> Result<MailAttachment, DomainError> {
    if current.tenant_id != tenant {
        return Err(AccessError::Forbidden.into());
    }
    let (legal_name, tax_id, details): (String, String, Value) = sqlx::query_as("SELECT t.legal_name,t.tax_id,COALESCE(p.details,'{}'::jsonb) FROM tenants t LEFT JOIN company_profiles p ON p.tenant_id=t.id WHERE t.id=$1")
        .bind(tenant).fetch_one(&mut **tx).await.map_err(db)?;
    // Checkout contains the agreed customer snapshot. Never replace it with the live party.
    let customer = if let Some(checkout) = &current.checkout {
        checkout.customer.clone()
    } else {
        sqlx::query_scalar::<_, Value>("SELECT jsonb_build_object('email',email,'phone',phone,'addresses',addresses,'contacts',contacts) FROM parties WHERE tenant_id=$1 AND id=$2")
            .bind(tenant).bind(current.data.customer_id).fetch_one(&mut **tx).await.map_err(db)?
    };
    let document = commercial(current, legal_name, tax_id, &details, &customer);
    Ok(MailAttachment {
        filename: format!("pedido-{}-r{}.pdf", document.number, current.data.revision),
        content_type: "application/pdf".into(),
        bytes: pdf::render(&document).map_err(|_| AccessError::Internal)?,
    })
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default().trim()
}
fn joined(value: &Value, fields: &[&str]) -> String {
    fields
        .iter()
        .map(|key| text(value, key))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" · ")
}
fn primary<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value[key].as_array().and_then(|items| {
        items
            .iter()
            .find(|item| item["primary"] == true)
            .or_else(|| items.first())
    })
}
fn date(value: &str) -> String {
    let parts = value.split('-').collect::<Vec<_>>();
    if let [year, month, day] = parts.as_slice() {
        format!("{day}/{month}/{year}")
    } else {
        value.into()
    }
}
fn decimal_br(value: &str, money: bool) -> String {
    // Format recorded decimal strings; never calculate prices or invent tax components.
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    let mut grouped = String::new();
    for (index, c) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(c);
    }
    let fraction = if money {
        fraction.to_owned()
    } else {
        fraction.trim_end_matches('0').to_owned()
    };
    let amount = if fraction.is_empty() {
        grouped
    } else {
        format!("{grouped},{fraction}")
    };
    if money {
        format!("R$ {amount}")
    } else {
        amount
    }
}
fn commercial(
    current: &OrderSnapshot,
    legal_name: String,
    tax_id: String,
    details: &Value,
    customer: &Value,
) -> pdf::Document {
    let number = current
        .data
        .number
        .strip_prefix("PV-")
        .unwrap_or(&current.data.number);
    let number = number
        .parse::<u64>()
        .map(|n| format!("PV-{n:06}"))
        .unwrap_or_else(|_| "PV".into());
    let mut issuer = vec![format!("CPF/CNPJ: {tax_id}")];
    for value in [
        joined(
            details,
            &[
                "street",
                "number",
                "complement",
                "district",
                "city",
                "state",
                "postalCode",
            ],
        ),
        joined(details, &["phone", "email", "website"]),
    ] {
        if !value.is_empty() {
            issuer.push(value);
        }
    }
    let mut customer_lines = vec![
        if text(customer, "legalName").is_empty() {
            current.data.customer_name.clone()
        } else {
            text(customer, "legalName").into()
        },
        format!(
            "CPF/CNPJ: {}",
            if text(customer, "taxId").is_empty() {
                &current.data.customer_tax_id
            } else {
                text(customer, "taxId")
            }
        ),
    ];
    if let Some(address) = primary(customer, "addresses") {
        customer_lines.push(joined(
            address,
            &[
                "street",
                "number",
                "complement",
                "district",
                "city",
                "state",
                "postalCode",
            ],
        ));
    }
    for (label, key) in [("E-mail", "email"), ("Telefone", "phone")] {
        if !text(customer, key).is_empty() {
            customer_lines.push(format!("{label}: {}", text(customer, key)));
        }
    }
    if let Some(contact) = primary(customer, "contacts") {
        let value = joined(contact, &["name", "phone", "email"]);
        if !value.is_empty() {
            customer_lines.push(format!("Contato: {value}"));
        }
    }
    let mut sections = Vec::new();
    if let Some(checkout) = &current.checkout {
        if let Some(registration) = &checkout.state_registration {
            customer_lines.push(format!("Inscrição estadual: {registration}"));
        }
        let terms = checkout_document::terms(checkout);
        for (label, value) in [
            ("Pagamento previsto", terms.payment_terms),
            ("Entrega", terms.delivery_terms),
            ("Observações", terms.notes),
        ] {
            if !value.is_empty() {
                sections.push((label.into(), value));
            }
        }
    } else {
        sections.push((
            "Pagamento previsto".into(),
            "Condições de pagamento não registradas. Este documento não comprova recebimento."
                .into(),
        ));
    }
    pdf::Document {
        issuer_name: legal_name,
        issuer_lines: issuer,
        logo_data_url: text(details, "logoDataUrl").to_owned(),
        number,
        revision: current.data.revision,
        status: match current.data.status.as_str() {
            "draft" => "Rascunho",
            "confirmed" => "Confirmado",
            "completed" => "Concluído",
            "cancelled" => "Cancelado",
            _ => "Não informado",
        }
        .into(),
        due: date(&current.data.due_date),
        customer_lines,
        items: current
            .items
            .iter()
            .map(|item| {
                let mut description = vec![item.name.clone(), format!("Código: {}", item.sku)];
                for (label, value) in [
                    ("Estrutura", &item.structure_color),
                    ("Braços", &item.swing_arm_color),
                    ("Estofado", &item.upholstery_color),
                    ("Tipo de anilheiro", &item.plate_holder_type),
                ] {
                    if let Some(value) = value.as_ref().filter(|v| !v.trim().is_empty()) {
                        description.push(format!("{label}: {value}"));
                    }
                }
                pdf::Item {
                    description,
                    quantity: format!("{} {}", decimal_br(&item.quantity, false), item.unit),
                    unit_price: decimal_br(&item.unit_price, true),
                    amount: decimal_br(&item.amount, true),
                }
            })
            .collect(),
        total: decimal_br(&current.data.amount, true),
        weight: equipment_weight::total(
            current
                .items
                .iter()
                .map(|item| (item.quantity.as_str(), item.equipment_weight.as_deref())),
        )
        .map(|w| format!("{w} kg"))
        .unwrap_or_else(|| "Incompleto — há equipamento sem peso válido cadastrado".into()),
        sections,
    }
}

#[cfg(test)]
#[path = "order_document_tests.rs"]
mod tests;
