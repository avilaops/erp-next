//! Request-scoped SMTP delivery with a durable, non-retriable delivery intent.
//! The attachment is a captured commercial snapshot; no browser HTML or URL is accepted.
use super::*;
use crate::platform::{access, mail::MailAttachment};
use serde_json::json;

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposalEmailInput {
    recipient: String,
    subject: String,
    message: String,
}

#[derive(Serialize, FromRow, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposalEmailDelivery {
    id: Uuid,
    status: String,
    recipient: String,
    created_at: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposalEmailStatus {
    tenant_id: Uuid,
    can_send: bool,
    email_ready: bool,
    recipient: Option<String>,
    deliveries: Vec<ProposalEmailDelivery>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProposalEmailReceipt {
    tenant_id: Uuid,
    revision: i64,
    delivery: ProposalEmailDelivery,
}

const DELIVERY: &str = "SELECT id,status,recipient,created_at::text AS created_at FROM sales_proposal_email_deliveries";

#[utoipa::path(get,path="/api/v1/proposals/{id}/email",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ProposalEmailStatus),(status=403,description="Sem permissão")))]
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
    let deliveries = sqlx::query_as::<_, ProposalEmailDelivery>(&format!(
        "{DELIVERY} WHERE tenant_id=$1 AND proposal_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50"
    ))
    .bind(tenant)
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(db)?;
    let today: time::Date =
        sqlx::query_scalar("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date")
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
    let value = ProposalEmailStatus {
        tenant_id: tenant,
        can_send: manage
            && ["draft", "sent"].contains(&current.data.status.as_str())
            && current.data.order_id.is_none()
            && super::super::date(&current.data.valid_until)? >= today,
        email_ready: crate::platform::mail_settings::resolve_in(&state, &mut tx)
            .await?
            .is_some(),
        recipient,
        deliveries,
    };
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, value))
}

fn normalize(mut input: ProposalEmailInput) -> Result<ProposalEmailInput, DomainError> {
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

fn attachment(current: &ProposalSnapshot, company: &str, tax_id: &str) -> MailAttachment {
    let data = &current.data;
    let mut html = format!(
        "<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><title>Proposta {}</title><style>body{{font:14px Arial,sans-serif;margin:32px;color:#17202a}}table{{border-collapse:collapse;width:100%}}th,td{{padding:8px;border-bottom:1px solid #ddd;text-align:left}}.terms{{white-space:pre-wrap}}</style><body><h1>{}</h1><p>CNPJ/CPF: {}</p><h2>Proposta {} · versão {}</h2><p>Cliente: {} · CPF/CNPJ: {}</p><p>Validade: {}</p><table><thead><tr><th>Produto</th><th>Acabamento</th><th>Quantidade</th><th>Unitário (R$)</th><th>Total (R$)</th></tr></thead><tbody>",
        escape(&data.number),
        escape(company),
        escape(tax_id),
        escape(&data.number),
        data.version,
        escape(&data.customer_name),
        escape(&data.customer_tax_id),
        escape(&data.valid_until)
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
    html.push_str(&format!("</tbody></table><p><strong>Total: R$ {}</strong></p><h3>Pagamento</h3><p class=\"terms\">{}</p><h3>Entrega</h3><p class=\"terms\">{}</p><h3>Observações</h3><p class=\"terms\">{}</p></body></html>", escape(&data.amount), escape(&data.payment_terms), escape(&data.delivery_terms), escape(&data.notes)));
    MailAttachment {
        filename: format!("proposta-{}-v{}.html", data.number, data.version),
        content_type: "text/html; charset=utf-8".to_owned(),
        bytes: html.into_bytes(),
    }
}

async fn receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    delivery: Uuid,
) -> Result<ProposalEmailReceipt, DomainError> {
    let value = sqlx::query_as::<_, ProposalEmailDelivery>(&format!(
        "{DELIVERY} WHERE tenant_id=$1 AND id=$2"
    ))
    .bind(tenant)
    .bind(delivery)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    let revision = sqlx::query_scalar(
        "SELECT result_revision FROM sales_proposal_email_deliveries WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(delivery)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    Ok(ProposalEmailReceipt {
        tenant_id: tenant,
        revision,
        delivery: value,
    })
}

#[utoipa::path(post,path="/api/v1/proposals/{id}/email",tag="Sales",request_body=ProposalEmailInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=ProposalEmailReceipt),(status=503,description="E-mail não configurado"),(status=412,description="Versão divergente")))]
pub async fn send(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ProposalEmailInput>, JsonRejection>,
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
        "proposal.email",
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
    let today: time::Date =
        sqlx::query_scalar("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date")
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
    if !["draft", "sent"].contains(&current.data.status.as_str())
        || current.data.order_id.is_some()
        || super::super::date(&current.data.valid_until)? < today
    {
        return Err(DomainError::Conflict(
            "Somente a versão atual e válida de uma proposta em rascunho ou enviada pode ser enviada por e-mail",
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
    let file = attachment(&current, &company, &tax_id);
    let delivery = Uuid::now_v7();
    // Persist uncertainty before crossing the SMTP boundary. A crash can never cause a replay to resend.
    sqlx::query("INSERT INTO sales_proposal_email_deliveries(id,tenant_id,proposal_id,version,proposal_revision,result_revision,subject_id,command_key,recipient,snapshot_html,status) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'uncertain')")
        .bind(delivery).bind(tenant).bind(id).bind(current.data.version).bind(expected).bind(&identity.subject).bind(key).bind(&input.recipient).bind(std::str::from_utf8(&file.bytes).map_err(|_| AccessError::Internal)?).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "sales_proposal", id, event: "proposal.email_requested", details: json!({"deliveryId":delivery,"version":current.data.version,"revision":expected,"recipient":input.recipient}) }).await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "proposal.email",
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
    // Same tenant lock order as all commercial commands. Mark only the captured revision as sent.
    sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let status = delivery_status(&result);
    if result.is_ok() {
        let changed: Option<i64> = sqlx::query_scalar("UPDATE sales_proposals SET revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$3 AND current_version=$4 AND order_id IS NULL AND EXISTS(SELECT 1 FROM sales_proposal_versions v WHERE v.tenant_id=$1 AND v.proposal_id=$2 AND v.version=$4 AND v.status IN ('draft','sent')) RETURNING revision")
            .bind(tenant).bind(id).bind(expected).bind(current.data.version).fetch_optional(&mut *tx).await.map_err(db)?;
        if changed.is_some() {
            sqlx::query("UPDATE sales_proposal_versions SET status='sent',sent_at=COALESCE(sent_at,now()) WHERE tenant_id=$1 AND proposal_id=$2 AND version=$3")
                .bind(tenant).bind(id).bind(current.data.version).execute(&mut *tx).await.map_err(db)?;
            sqlx::query("UPDATE sales_proposal_email_deliveries SET result_revision=$3 WHERE tenant_id=$1 AND id=$2")
                .bind(tenant).bind(delivery).bind(expected+1).execute(&mut *tx).await.map_err(db)?;
        }
    }
    sqlx::query("UPDATE sales_proposal_email_deliveries SET status=$3,sent_at=CASE WHEN $3='sent' THEN now() ELSE NULL END,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(delivery).bind(status).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "sales_proposal", id, event: match status { "sent" => "proposal.email_sent", "failed" => "proposal.email_failed", _ => "proposal.email_uncertain" }, details: json!({"deliveryId":delivery,"version":current.data.version,"recipient":input.recipient}) }).await?;
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
    fn email_headers_and_address_reject_injection() {
        for recipient in [
            "a@example.test\r\nBcc:x@example.test",
            "A <a@example.test>",
            "a@example.test,b@example.test",
            "invalid",
            "a@example.test\r\n",
        ] {
            assert!(
                normalize(ProposalEmailInput {
                    recipient: recipient.into(),
                    subject: "Proposta".into(),
                    message: "Olá".into()
                })
                .is_err()
            );
        }
        assert!(
            normalize(ProposalEmailInput {
                recipient: "a@example.test".into(),
                subject: "Proposta\nBcc: x".into(),
                message: "Olá".into()
            })
            .is_err()
        );
        assert_eq!(escape("<script>\"&'"), "&lt;script&gt;&quot;&amp;&#39;");
    }
    #[test]
    fn attachment_uses_escaped_agreed_snapshot_instead_of_catalog_price() {
        let current = ProposalSnapshot {
            tenant_id: Uuid::nil(),
            can_edit: true,
            versions: vec![],
            data: ProposalSummary {
                id: Uuid::nil(),
                number: "17".into(),
                version: 2,
                revision: 3,
                customer_id: Uuid::nil(),
                customer_name: "Cliente <script>".into(),
                customer_tax_id: "52998224725".into(),
                valid_until: "2100-01-01".into(),
                payment_terms: "À vista & combinado".into(),
                delivery_terms: "Retirada".into(),
                notes: "<img src=x onerror=alert(1)>".into(),
                amount: "44.98".into(),
                status: "draft".into(),
                expired: false,
                order_id: None,
                is_current: true,
                created_at: "2026-11-08".into(),
                sent_at: None,
                decided_at: None,
                decided_by: None,
                decision_reason: None,
            },
            items: vec![ProposalLine {
                product_id: Uuid::nil(),
                sku: "PROD-1".into(),
                name: "Produto <b>".into(),
                unit: "UN".into(),
                quantity: "2.500000".into(),
                unit_price: "17.99".into(),
                catalog_price: "19.99".into(),
                amount: "44.98".into(),
                structure_color: Some("Preto & azul".into()),
                upholstery_color: None,
                swing_arm_color: Some("Apple Green <swing>".into()),
                plate_holder_color: Some("Azul legado".into()),
                plate_holder_type: Some("Olímpico".into()),
            }],
        };
        let file = attachment(&current, "Empresa & Filhos", "04252011000110");
        assert_eq!(file.filename, "proposta-17-v2.html");
        let html = String::from_utf8(file.bytes).unwrap();
        for expected in [
            "Empresa &amp; Filhos",
            "04252011000110",
            "Cliente &lt;script&gt;",
            "17.99",
            "44.98",
            "À vista &amp; combinado",
            "Preto &amp; azul",
            "Braços: Apple Green &lt;swing&gt;",
            "&lt;img src=x onerror=alert(1)&gt;",
        ] {
            assert!(html.contains(expected), "missing {expected}");
        }
        assert!(!html.contains("19.99"));
        assert!(!html.contains("<script>"));
        assert!(!html.contains("<img"));
        assert!(html.contains("Tipo: Olímpico"));
        assert!(!html.contains("Anilheiros:"));
        assert!(!html.contains("Azul legado"));
    }

    #[test]
    fn network_failures_never_claim_non_delivery_or_success() {
        assert_eq!(delivery_status(&Ok(())), "sent");
        assert_eq!(
            delivery_status(&Err(anyhow::anyhow!("connection lost"))),
            "uncertain"
        );
    }
}
