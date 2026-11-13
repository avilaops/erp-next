//! Request-scoped SMTP delivery with a durable, non-retriable delivery intent.
//! The attachment is a captured commercial snapshot; no browser HTML or URL is accepted.
use super::*;
use crate::platform::{access, mail::MailAttachment};
use serde_json::json;

const READ: &str = "sales.orders.read";
const MANAGE: &str = "sales.orders.manage";

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrderEmailInput {
    recipient: String,
    subject: String,
    message: String,
}

#[derive(Serialize, FromRow, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderEmailDelivery {
    id: Uuid,
    status: String,
    recipient: String,
    created_at: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderEmailStatus {
    tenant_id: Uuid,
    can_send: bool,
    email_ready: bool,
    recipient: Option<String>,
    deliveries: Vec<OrderEmailDelivery>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderEmailReceipt {
    tenant_id: Uuid,
    revision: i64,
    delivery: OrderEmailDelivery,
}

const DELIVERY: &str =
    "SELECT id,status,recipient,created_at::text AS created_at FROM sales_order_email_deliveries";

#[utoipa::path(get,path="/api/v1/orders/{id}/email",operation_id="get_order_email_status",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=OrderEmailStatus),(status=403,description="Sem permissão")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, manage) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let current = load(&mut tx, tenant, id, manage).await?;
    let recipient: Option<String> =
        sqlx::query_scalar("SELECT email FROM parties WHERE tenant_id=$1 AND id=$2")
            .bind(tenant)
            .bind(current.data.customer_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
    let deliveries = sqlx::query_as::<_, OrderEmailDelivery>(&format!(
        "{DELIVERY} WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50"
    ))
    .bind(tenant)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    let value = OrderEmailStatus {
        tenant_id: tenant,
        can_send: manage && current.data.status != "cancelled",
        email_ready: crate::platform::mail_settings::resolve_in(&state, &mut tx)
            .await?
            .is_some(),
        recipient,
        deliveries,
    };
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, value))
}

fn normalize(mut input: OrderEmailInput) -> Result<OrderEmailInput, DomainError> {
    if input.recipient.chars().any(char::is_control) || input.subject.chars().any(char::is_control)
    {
        return Err(DomainError::Invalid(
            "Endereço e assunto não podem conter caracteres de controle",
        ));
    }
    input.recipient = input.recipient.trim().to_owned();
    input.subject = input.subject.trim().to_owned();
    input.message = input.message.trim().to_owned();
    // A single plain address only: no display names, recipient lists or header controls.
    if input.recipient.len() > 254
        || input
            .recipient
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
        || input.recipient.parse::<lettre::Address>().is_err()
    {
        return Err(DomainError::Invalid(
            "Informe um único endereço de e-mail válido",
        ));
    }
    if input.subject.is_empty()
        || input.subject.chars().count() > 200
        || input.subject.chars().any(char::is_control)
    {
        return Err(DomainError::Invalid(
            "Assunto obrigatório, sem quebras de linha e com até 200 caracteres",
        ));
    }
    if input.message.is_empty()
        || input.message.chars().count() > 10000
        || input
            .message
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err(DomainError::Invalid(
            "Mensagem obrigatória e com até 10000 caracteres",
        ));
    }
    Ok(input)
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn attachment(current: &OrderSnapshot, company: &str, tax_id: &str) -> MailAttachment {
    let data = &current.data;
    let customer_name = current
        .checkout
        .as_ref()
        .and_then(|checkout| checkout.customer["legalName"].as_str())
        .unwrap_or(&data.customer_name);
    let customer_tax_id = current
        .checkout
        .as_ref()
        .and_then(|checkout| checkout.customer["taxId"].as_str())
        .unwrap_or(&data.customer_tax_id);
    let mut html = format!(
        "<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><title>Pedido {}</title><style>body{{font:14px Arial,sans-serif;margin:32px;color:#17202a}}table{{border-collapse:collapse;width:100%}}th,td{{padding:8px;border-bottom:1px solid #ddd;text-align:left}}</style><body><h1>{}</h1><p>CNPJ/CPF: {}</p><h2>Pedido {} · revisão {}</h2><p>Cliente: {} · CPF/CNPJ: {}</p><p>Vencimento: {} · Situação: {}</p><table><thead><tr><th>Produto</th><th>Acabamento</th><th>Quantidade</th><th>Unitário (R$)</th><th>Total (R$)</th></tr></thead><tbody>",
        escape(&data.number),
        escape(company),
        escape(tax_id),
        escape(&data.number),
        data.revision,
        escape(customer_name),
        escape(customer_tax_id),
        escape(&data.due_date),
        match data.status.as_str() {
            "draft" => "Rascunho",
            "confirmed" => "Reservado",
            "completed" => "Concluído",
            _ => "Cancelado",
        }
    );
    for item in &current.items {
        let finishes = [
            item.structure_color
                .as_ref()
                .map(|v| format!("Estrutura: {v}")),
            item.swing_arm_color
                .as_ref()
                .map(|v| format!("Braços: {v}")),
            item.upholstery_color
                .as_ref()
                .map(|v| format!("Estofado: {v}")),
            item.plate_holder_type
                .as_ref()
                .map(|v| format!("Tipo: {v}")),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");
        html.push_str(&format!("<tr><td>{}<br><small>{}</small></td><td>{}</td><td>{} {}</td><td>{}</td><td>{}</td></tr>", escape(&item.name), escape(&item.sku), escape(&finishes), escape(&item.quantity), escape(&item.unit), escape(&item.unit_price), escape(&item.amount)));
    }
    html.push_str(&format!(
        "</tbody></table><p><strong>Total: R$ {}</strong></p>",
        escape(&data.amount)
    ));
    match equipment_weight::total(current.items.iter().map(|item| (item.quantity.as_str(), item.equipment_weight.as_deref()))) {
        Some(weight) => html.push_str(&format!("<p><strong>Peso bruto total: {weight} kg</strong></p>")),
        None => html.push_str("<p><strong>Peso bruto total: Incompleto</strong></p><p>Há equipamentos sem peso válido cadastrado.</p>"),
    }
    if let Some(checkout) = &current.checkout {
        let customer = &checkout.customer;
        let address = customer["addresses"].as_array().and_then(|addresses| {
            addresses
                .iter()
                .find(|value| value["primary"] == true)
                .or_else(|| addresses.first())
        });
        if let Some(address) = address {
            let address = [
                "street",
                "number",
                "complement",
                "district",
                "city",
                "state",
                "postalCode",
            ]
            .iter()
            .filter_map(|field| address[*field].as_str())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
            html.push_str(&format!("<p>Endereço do cliente: {}</p>", escape(&address)));
        }
        for (label, value) in [
            ("E-mail", customer["email"].as_str()),
            ("Telefone", customer["phone"].as_str()),
            ("Inscrição estadual", checkout.state_registration.as_deref()),
        ] {
            if let Some(value) = value.filter(|value| !value.is_empty()) {
                html.push_str(&format!("<p>{label}: {}</p>", escape(value)));
            }
        }
        let terms = super::checkout_document::terms(checkout);
        for (label, value) in [
            ("Pagamento", terms.payment_terms),
            ("Entrega", terms.delivery_terms),
            ("Observações", terms.notes),
        ] {
            if !value.is_empty() {
                html.push_str(&format!(
                    "<h2>{label}</h2><p>{}</p>",
                    escape(&value).replace('\n', "<br>")
                ));
            }
        }
    }
    html.push_str("</body></html>");
    MailAttachment {
        filename: format!("pedido-{}-r{}.html", data.number, data.revision),
        content_type: "text/html; charset=utf-8".to_owned(),
        bytes: html.into_bytes(),
    }
}

async fn receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    delivery: Uuid,
) -> Result<OrderEmailReceipt, DomainError> {
    let value = sqlx::query_as::<_, OrderEmailDelivery>(&format!(
        "{DELIVERY} WHERE tenant_id=$1 AND id=$2"
    ))
    .bind(tenant)
    .bind(delivery)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    let revision = sqlx::query_scalar(
        "SELECT result_revision FROM sales_order_email_deliveries WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(delivery)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    Ok(OrderEmailReceipt {
        tenant_id: tenant,
        revision,
        delivery: value,
    })
}

#[utoipa::path(post,path="/api/v1/orders/{id}/email",operation_id="send_order_email",tag="Sales",request_body=OrderEmailInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=OrderEmailReceipt),(status=503,description="E-mail não configurado"),(status=412,description="Versão divergente")))]
pub async fn send(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<OrderEmailInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let input = normalize(input)?;
    let request = json!({"id":id,"revision":expected,"input":input});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.email",
        &request,
    )
    .await?
    {
        let delivery = previous["deliveryId"]
            .as_str()
            .and_then(|v| Uuid::parse_str(v).ok())
            .ok_or(AccessError::Internal)?;
        let value = receipt(&mut tx, tenant, delivery).await?;
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, Some(value.revision), value));
    }
    let current = load(&mut tx, tenant, id, true).await?;
    if current.data.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if current.data.status == "cancelled" {
        return Err(DomainError::Conflict(
            "Pedidos cancelados não podem ser enviados por e-mail",
        ));
    }
    let pending: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sales_order_email_deliveries WHERE tenant_id=$1 AND order_id=$2 AND status='uncertain')")
        .bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    if pending {
        return Err(DomainError::Conflict(
            "Existe um envio sem confirmação definitiva. Confira o resultado com o provedor antes de reenviar",
        ));
    }
    let Some(mailer) = crate::platform::mail_settings::resolve_in(&state, &mut tx).await? else {
        // Nothing is persisted or published when SMTP is unavailable.
        return Ok(response(
            StatusCode::SERVICE_UNAVAILABLE,
            None,
            json!({"title":"O envio de e-mail não está configurado. Nenhuma mensagem foi enviada.","status":503}),
        ));
    };
    let (company, tax_id): (String, String) =
        sqlx::query_as("SELECT legal_name,tax_id FROM tenants WHERE id=$1")
            .bind(tenant)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
    let captured_html = attachment(&current, &company, &tax_id);
    let file = super::order_document::attachment(&mut tx, tenant, &current).await?;
    let delivery = Uuid::now_v7();
    // Persist uncertainty before crossing the SMTP boundary. A crash can never cause a replay to resend.
    sqlx::query("INSERT INTO sales_order_email_deliveries(id,tenant_id,order_id,order_revision,result_revision,subject_id,command_key,recipient,snapshot_html,status) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,'uncertain')")
        .bind(delivery).bind(tenant).bind(id).bind(expected).bind(&identity.subject).bind(key).bind(&input.recipient).bind(std::str::from_utf8(&captured_html.bytes).map_err(|_| AccessError::Internal)?).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "sales_order",
            id,
            event: "order.email_requested",
            details: json!({"deliveryId":delivery,"revision":expected,"recipient":input.recipient}),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "order.email",
        &request,
        &json!({"deliveryId":delivery}),
    )
    .await?;
    tx.commit().await.map_err(db)?;

    let result = mailer
        .send_with_attachments(
            std::slice::from_ref(&input.recipient),
            &input.subject,
            &input.message,
            &[file],
        )
        .await;
    let mut tx = access::tenant_transaction(&state, tenant).await?;
    // Same tenant lock order as all commercial commands. Delivery does not alter order state.
    sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let status = delivery_status(&result);
    sqlx::query("UPDATE sales_order_email_deliveries SET status=$3,sent_at=CASE WHEN $3='sent' THEN now() ELSE NULL END,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(delivery).bind(status).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "sales_order",
            id,
            event: match status {
                "sent" => "order.email_sent",
                "failed" => "order.email_failed",
                _ => "order.email_uncertain",
            },
            details: json!({"deliveryId":delivery,"recipient":input.recipient}),
        },
    )
    .await?;
    // SMTP errors are intentionally not exposed: provider messages may contain credentials or personal data.
    let value = receipt(&mut tx, tenant, delivery).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(value.revision), value))
}

fn delivery_status(result: &anyhow::Result<()>) -> &'static str {
    match result {
        Ok(()) => "sent",
        // Explicit 4xx/5xx SMTP responses confirm rejection. Transport loss and timeouts
        // may occur after the server accepted DATA, so they must remain uncertain.
        Err(error)
            if error
                .downcast_ref::<lettre::transport::smtp::Error>()
                .is_some_and(|smtp| smtp.is_transient() || smtp.is_permanent()) =>
        {
            "failed"
        }
        Err(_) => "uncertain",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_header_injection_and_recipient_lists() {
        for address in [
            "invalid",
            "A <a@example.test>",
            "a@example.test,b@example.test",
            "a@example.test\r\nBcc:b@example.test",
        ] {
            assert!(
                normalize(OrderEmailInput {
                    recipient: address.into(),
                    subject: "Pedido".into(),
                    message: "Olá".into()
                })
                .is_err()
            );
        }
        assert!(
            normalize(OrderEmailInput {
                recipient: "a@example.test".into(),
                subject: "Pedido\r\nBcc:b@example.test".into(),
                message: "Olá".into()
            })
            .is_err()
        );
    }

    #[test]
    fn accepted_order_email_snapshot_identifies_the_encomenda_without_claiming_cancellation() {
        let mut order = sample_order();
        order.data.status = "accepted".into();
        let html = String::from_utf8(attachment(&order, "Empresa", "123").bytes).unwrap();
        assert!(html.contains("Situação: Encomenda aceita"), "{html}");
        for forbidden in [
            "Situação: Cancelado",
            "Situação: Reservado",
            "Situação: Concluído",
        ] {
            assert!(!html.contains(forbidden), "unexpected {forbidden}: {html}");
        }
    }

    #[test]
    fn attachment_preserves_recorded_prices_and_escapes_customer_content() {
        let order = sample_order();
        let file = attachment(&order, "Empresa & Filhos", "04252011000110");
        assert_eq!(file.filename, "pedido-42-r3.html");
        let html = String::from_utf8(file.bytes).unwrap();
        for expected in [
            "Cliente &lt;script&gt;",
            "Empresa &amp; Filhos",
            "Produto &lt;b&gt;",
            "17.99",
            "44.98",
            "Azul &amp; preto",
            "Braços: Apple Green &amp; dourado",
            "Tipo: Redondo",
            "Reservado",
        ] {
            assert!(html.contains(expected), "missing {expected}");
        }
        assert!(!html.contains("<script>"));
        assert!(!html.contains("<b>"));
        assert!(!html.contains("Anilheiros:"));
        assert!(!html.contains("Branco"));
    }

    #[test]
    fn attachment_uses_frozen_checkout_customer_and_all_planned_terms() {
        let mut order = sample_order();
        order.data.customer_name = "Nome divergente".into();
        order.checkout = Some(super::super::checkout_document::fixture());
        let html = String::from_utf8(attachment(&order, "Empresa", "123").bytes).unwrap();
        for expected in [
            "Cliente preservado &lt;b&gt;",
            "Rua preservada &amp; segura",
            "preservado@example.test",
            "ISENTO",
            "Parcela 1: R$ 15,00",
            "Parcela 2: R$ 14,99",
            "Pix &amp; combinado",
            "45 dias após o recebimento da entrada",
            "Entrega &lt;combinada&gt;",
            "Observação &lt;script&gt; &amp; conferência",
            "não comprovam recebimento",
        ] {
            assert!(html.contains(expected), "missing {expected}");
        }
        assert!(!html.contains("Nome divergente"));
        assert!(!html.contains("<script>"));
        assert!(!html.contains("<b>"));
    }

    #[test]
    fn attachment_marks_missing_equipment_weight_instead_of_claiming_zero() {
        let order = sample_order();
        let html = String::from_utf8(attachment(&order, "Empresa", "123").bytes).unwrap();
        assert!(html.contains("Peso bruto total"));
        assert!(html.contains("Incompleto"));
        assert!(!html.contains("Peso bruto total: 0 kg"));
    }

    #[test]
    fn attachment_totals_equipment_weight_using_each_recorded_quantity() {
        let mut order = sample_order();
        order.items[0].quantity = "6.000000".into();
        order.items[0].equipment_weight = Some("180,5 kg".into());
        let mut second = sample_order().items.remove(0);
        second.quantity = "2.000000".into();
        second.equipment_weight = Some("90.25 KG".into());
        order.items.push(second);
        let html = String::from_utf8(attachment(&order, "Empresa", "123").bytes).unwrap();
        assert!(html.contains("Peso bruto total: 1.263,5 kg"));
        assert!(!html.contains("Incompleto"));
    }

    fn sample_order() -> OrderSnapshot {
        OrderSnapshot {
            tenant_id: Uuid::nil(),
            can_edit: true,
            pricing_origin: true,
            checkout: None,
            data: OrderSummary {
                id: Uuid::nil(),
                number: "42".into(),
                customer_id: Uuid::nil(),
                customer_name: "Cliente <script>".into(),
                customer_tax_id: "52998224725".into(),
                due_date: "2026-12-01".into(),
                amount: "44.98".into(),
                status: "confirmed".into(),
                revision: 3,
            },
            items: vec![OrderLine {
                product_id: Uuid::nil(),
                sku: "SKU-1".into(),
                name: "Produto <b>".into(),
                unit: "UN".into(),
                quantity: "2.500000".into(),
                unit_price: "17.99".into(),
                amount: "44.98".into(),
                equipment_weight: None,
                structure_color: Some("Azul & preto".into()),
                swing_arm_color: Some("Apple Green & dourado".into()),
                upholstery_color: None,
                plate_holder_color: Some("Branco".into()),
                plate_holder_type: Some("Redondo".into()),
            }],
        }
    }

    #[test]
    fn transport_failure_never_claims_delivery_or_rejection() {
        assert_eq!(delivery_status(&Ok(())), "sent");
        assert_eq!(
            delivery_status(&Err(anyhow::anyhow!("connection lost"))),
            "uncertain"
        );
    }
}
