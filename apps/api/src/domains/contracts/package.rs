use serde_json::{Value, json};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use super::model::Contract;
use crate::{
    domains::fiscal::danfe_client::{DanfeClient, RenderError},
    domains::{DomainError, db, fixed},
    platform::mail::MailAttachment,
};

pub struct CustomerPackage {
    pub recipients: Vec<String>,
    pub subject: String,
    pub body: String,
    pub attachments: Vec<MailAttachment>,
    pub manifest: Value,
}

fn rtf_text(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '\\' => "\\\\".to_owned(),
            '{' => "\\{".to_owned(),
            '}' => "\\}".to_owned(),
            '\n' => "\\par ".to_owned(),
            character if character.is_ascii() => character.to_string(),
            character => format!(r#"\\u{}?"#, character as i32),
        })
        .collect()
}

fn money(cents: i64) -> String {
    format!("R$ {},{:02}", cents / 100, cents.abs() % 100)
}

fn order_document(snapshot: &Value) -> Vec<u8> {
    let order = &snapshot["order"];
    let mut lines = vec![
        format!("PEDIDO {}", order["number"].as_str().unwrap_or("")),
        format!(
            "Empresa: {}",
            snapshot["company"]["legalName"].as_str().unwrap_or("")
        ),
        format!(
            "Cliente: {}",
            snapshot["customer"]["name"].as_str().unwrap_or("")
        ),
        String::new(),
        "Itens:".to_owned(),
    ];
    for item in snapshot["items"].as_array().into_iter().flatten() {
        lines.push(format!(
            "{} | {} {} | unitário {} | total {}",
            item["sku"].as_str().unwrap_or(""),
            item["quantity"].as_str().unwrap_or(""),
            item["unit"].as_str().unwrap_or(""),
            item["unitPrice"].as_str().unwrap_or(""),
            item["amount"].as_str().unwrap_or(""),
        ));
    }
    lines.push(String::new());
    lines.push(format!("Total: {}", order["amount"].as_str().unwrap_or("")));
    lines.push(format!(
        "Vencimento: {}",
        order["dueDate"].as_str().unwrap_or("")
    ));
    let terms = snapshot
        .get("commercialTerms")
        .filter(|value| value.is_object())
        .unwrap_or(&snapshot["proposal"]);
    for (field, label) in [
        ("paymentTerms", "Pagamento"),
        ("deliveryTerms", "Entrega"),
        ("notes", "Observações"),
    ] {
        if let Some(value) = terms[field]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            lines.push(format!("{label}: {value}"));
        }
    }
    let text = lines
        .iter()
        .map(|line| rtf_text(line))
        .collect::<Vec<_>>()
        .join("\\par ");
    format!(r#"{{\rtf1\ansi\deff0 {{\fonttbl {{\f0 Arial;}}}}\f0\fs22 {text}\par }}"#).into_bytes()
}

fn payment_document(
    snapshot: &Value,
    amount_cents: i64,
    method: &str,
    reference: &str,
    occurred_on: &str,
) -> Vec<u8> {
    let lines = [
        "COMPROVANTE DE RECEBIMENTO".to_owned(),
        format!(
            "Pedido: {}",
            snapshot["order"]["number"].as_str().unwrap_or("")
        ),
        format!(
            "Cliente: {}",
            snapshot["customer"]["name"].as_str().unwrap_or("")
        ),
        format!("Valor recebido: {}", money(amount_cents)),
        format!("Forma de pagamento: {method}"),
        format!("Referência: {reference}"),
        format!("Data do recebimento: {occurred_on}"),
    ];
    let text = lines
        .iter()
        .map(|line| rtf_text(line))
        .collect::<Vec<_>>()
        .join("\\par ");
    format!(r#"{{\rtf1\ansi\deff0 {{\fonttbl {{\f0 Arial;}}}}\f0\fs22 {text}\par }}"#).into_bytes()
}

#[derive(FromRow)]
struct PaymentTitle {
    status: String,
    amount_cents: i64,
    received_cents: i64,
}

fn fully_settled(titles: &[PaymentTitle], order_amount: i64) -> bool {
    !titles.is_empty()
        && titles
            .iter()
            .all(|title| title.status == "paid" && title.received_cents == title.amount_cents)
        && titles
            .iter()
            .map(|title| i128::from(title.amount_cents))
            .sum::<i128>()
            == i128::from(order_amount)
}

pub async fn build(
    tx: &mut Transaction<'_, Postgres>,
    contract: &Contract,
    danfe: Option<&DanfeClient>,
) -> Result<CustomerPackage, DomainError> {
    let recipients: Vec<super::model::Recipient> =
        serde_json::from_value(contract.recipients.clone())
            .map_err(|_| DomainError::Invalid("Destinatários do contrato inválidos"))?;
    let recipients = recipients
        .into_iter()
        .map(|recipient| recipient.email.trim().to_ascii_lowercase())
        .filter(|email| !email.is_empty())
        .collect::<Vec<_>>();
    if recipients.is_empty() {
        return Err(DomainError::Conflict(
            "O cliente não possui destinatário de e-mail válido",
        ));
    }

    let contract_file: Option<(Vec<u8>, String)> = sqlx::query_as(
        "SELECT content,kind FROM commercial_contract_files WHERE tenant_id=$1 AND contract_id=$2 AND kind IN ('signed','preview') ORDER BY CASE kind WHEN 'signed' THEN 0 ELSE 1 END,position LIMIT 1",
    )
    .bind(contract.tenant_id)
    .bind(contract.id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?;
    let Some((contract_bytes, contract_kind)) = contract_file else {
        return Err(DomainError::Conflict(
            "O contrato ainda não possui PDF preservado",
        ));
    };

    let nfe: Option<(String, i64, i32, String)> = sqlx::query_as(
        "SELECT authorized_xml,number,series,access_key FROM fiscal_nfe_documents WHERE tenant_id=$1 AND source_order_id=$2 AND status='authorized' AND authorized_xml IS NOT NULL ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(contract.tenant_id)
    .bind(contract.order_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?;
    let Some((nfe_xml, nfe_number, nfe_series, nfe_key)) = nfe else {
        return Err(DomainError::Conflict(
            "O pedido ainda não possui NF-e autorizada",
        ));
    };

    let titles: Vec<PaymentTitle> = sqlx::query_as(
        "SELECT r.status,r.amount_cents,COALESCE((SELECT sum(CASE p.kind WHEN 'receipt' THEN p.amount_cents ELSE -p.amount_cents END) FROM receivable_payments p WHERE p.tenant_id=r.tenant_id AND p.receivable_id=r.id),0)::bigint AS received_cents FROM receivables r WHERE r.tenant_id=$1 AND r.order_id=$2 ORDER BY r.due_date,r.id",
    )
    .bind(contract.tenant_id)
    .bind(contract.order_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(db)?;
    let order_amount = fixed(
        contract.snapshot["order"]["amount"]
            .as_str()
            .ok_or(DomainError::Conflict(
                "O pedido preservado não possui valor válido",
            ))?,
        2,
    )?;
    let payment_lines: Vec<(Uuid, i64, String, String, String)> = if fully_settled(
        &titles,
        order_amount,
    ) {
        sqlx::query_as("SELECT p.id,p.amount_cents,p.method,p.reference,p.occurred_on::text FROM receivable_payments p JOIN receivables r ON r.tenant_id=p.tenant_id AND r.id=p.receivable_id WHERE r.tenant_id=$1 AND r.order_id=$2 AND p.kind='receipt' AND NOT EXISTS(SELECT 1 FROM receivable_payments reversed WHERE reversed.tenant_id=p.tenant_id AND reversed.reverses_id=p.id) ORDER BY p.occurred_on,p.id")
            .bind(contract.tenant_id).bind(contract.order_id).fetch_all(&mut **tx).await.map_err(db)?
    } else {
        Vec::new()
    };

    let nfe_xml_bytes = nfe_xml.into_bytes();
    let mut attachments = vec![
        MailAttachment {
            filename: format!("contrato-{}.pdf", contract_kind),
            content_type: "application/pdf".into(),
            bytes: contract_bytes,
        },
        MailAttachment {
            filename: format!(
                "pedido-{}.doc",
                contract.snapshot["order"]["number"]
                    .as_str()
                    .unwrap_or("pedido")
            ),
            content_type: "application/msword".into(),
            bytes: order_document(&contract.snapshot),
        },
        MailAttachment {
            filename: format!("nfe-{}-serie-{}.xml", nfe_number, nfe_series),
            content_type: "application/xml".into(),
            bytes: nfe_xml_bytes.clone(),
        },
    ];
    let mut manifest = vec![
        json!({"kind":"contract","filename":attachments[0].filename,"contentType":attachments[0].content_type,"sha256":super::model::digest(&attachments[0].bytes)}),
        json!({"kind":"order","filename":attachments[1].filename,"contentType":attachments[1].content_type,"sha256":super::model::digest(&attachments[1].bytes)}),
        json!({"kind":"nfe","filename":attachments[2].filename,"contentType":attachments[2].content_type,"accessKey":nfe_key,"sha256":super::model::digest(&attachments[2].bytes)}),
    ];
    if let Some(danfe) = danfe {
        let pdf = danfe
            .render(
                std::str::from_utf8(&nfe_xml_bytes)
                    .map_err(|_| DomainError::Conflict("A NF-e autorizada não está em UTF-8"))?,
                &nfe_key,
                55,
            )
            .await
            .map_err(|error| match error {
                RenderError::Invalid => {
                    DomainError::Conflict("O DANFE da NF-e foi recusado na validação")
                }
                RenderError::Gateway => {
                    DomainError::Conflict("O serviço de DANFE está indisponível")
                }
            })?;
        let filename = format!("danfe-nfe-{}-serie-{}.pdf", nfe_number, nfe_series);
        manifest.push(json!({"kind":"danfe","filename":filename,"contentType":"application/pdf","accessKey":nfe_key,"sha256":super::model::digest(&pdf)}));
        attachments.push(MailAttachment {
            filename,
            content_type: "application/pdf".into(),
            bytes: pdf,
        });
    }
    for (payment_id, amount, method, reference, occurred_on) in payment_lines {
        let bytes = payment_document(
            &contract.snapshot,
            amount,
            &method,
            &reference,
            &occurred_on,
        );
        let filename = format!("comprovante-pagamento-{}.doc", payment_id);
        manifest.push(json!({"kind":"payment","filename":filename,"contentType":"application/msword","paymentId":payment_id,"amountCents":amount,"settlementTotalCents":order_amount,"titleCount":titles.len(),"sha256":super::model::digest(&bytes)}));
        attachments.push(MailAttachment {
            filename,
            content_type: "application/msword".into(),
            bytes,
        });
    }

    let subject = format!(
        "Pedido {} — documentos da sua compra",
        contract.snapshot["order"]["number"].as_str().unwrap_or("")
    );
    let body = format!(
        "Olá, {}.\n\nSegue o pedido, o contrato, a NF-e autorizada e, quando quitado, o comprovante de pagamento.\n\nAtenciosamente,\n{}",
        contract.snapshot["customer"]["name"].as_str().unwrap_or(""),
        contract.snapshot["company"]["legalName"]
            .as_str()
            .unwrap_or("")
    );
    Ok(CustomerPackage {
        recipients,
        subject,
        body,
        attachments,
        manifest: Value::Array(manifest),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payment_package_requires_all_installments_settled_and_exact_order_total() {
        let title = |status: &str, amount, received| PaymentTitle {
            status: status.into(),
            amount_cents: amount,
            received_cents: received,
        };
        assert!(fully_settled(
            &[
                title("paid", 140, 140),
                title("paid", 30, 30),
                title("paid", 30, 30)
            ],
            200
        ));
        assert!(!fully_settled(
            &[title("paid", 140, 140), title("open", 60, 10)],
            200
        ));
        assert!(!fully_settled(
            &[title("paid", 140, 140), title("cancelled", 60, 0)],
            200
        ));
        assert!(!fully_settled(&[title("paid", 140, 140)], 200));
        assert!(!fully_settled(&[title("paid", 200, 50)], 200));
        assert!(!fully_settled(&[], 200));
        assert!(fully_settled(&[title("paid", 200, 200)], 200));
    }

    #[test]
    fn rtf_escapes_controls_and_keeps_unicode() {
        let value = rtf_text(r#"Cliente {Ávila} \ contrato"#);
        assert!(value.contains(r#"\{"#));
        assert!(value.contains(r#"\}"#));
        assert!(value.contains(r#"\u193?"#));
        assert!(value.contains(r#"\\"#));
    }

    #[test]
    fn order_document_preserves_checkout_terms_without_claiming_settlement() {
        let checkout = crate::domains::sales::checkout_document::fixture();
        let snapshot = json!({"order":{"number":"42","amount":"100.00","dueDate":"2027-01-01"},"company":{"legalName":"Empresa"},"customer":{"name":"Cliente"},"items":[],"commercialTerms":crate::domains::sales::checkout_document::terms(&checkout)});
        let text = String::from_utf8(order_document(&snapshot)).unwrap();
        assert!(text.contains("Parcela 2: R$ 14,99"));
        assert!(text.contains("01/02/2027"));
        assert!(text.contains("45 dias ap"));
        assert!(text.contains("recebimento da entrada"));
        assert!(text.contains("Entrega <combinada>"));
    }

    #[test]
    fn order_document_contains_only_customer_facing_snapshot_data() {
        let bytes = order_document(&json!({
            "order": {"number":"PV-000042","amount":"123.45","dueDate":"2026-12-01"},
            "company": {"legalName":"Ávila Equipamentos"},
            "customer": {"name":"Cliente de teste"},
            "items": [{"sku":"SKU-1","quantity":"2.000000","unit":"UN","unitPrice":"61.72","amount":"123.45"}],
            "internalCost":"DO_NOT_SEND"
        }));
        let document = String::from_utf8(bytes).unwrap();
        assert!(document.contains("PV-000042"));
        assert!(document.contains("SKU-1"));
        assert!(!document.contains("DO_NOT_SEND"));
    }

    #[test]
    fn payment_document_has_receipt_identity_and_amount() {
        let bytes = payment_document(
            &json!({"order":{"number":"PV-000042"},"customer":{"name":"Cliente"}}),
            12345,
            "bank_transfer",
            "TED-42",
            "2026-11-06",
        );
        let document = String::from_utf8(bytes).unwrap();
        assert!(document.contains("COMPROVANTE DE RECEBIMENTO"));
        assert!(document.contains("PV-000042"));
        assert!(document.contains("R$ 123,45"));
        assert!(document.contains("TED-42"));
    }
}
