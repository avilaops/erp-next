pub mod catalog;
pub mod provider;

use crate::{
    domains::{DomainError, authorized, db, response},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Json, Router,
    extract::{Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(FromRow, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    id: Uuid,
    plan_id: String,
    status: String,
    #[serde(skip)]
    provider_id: Option<String>,
    details: Value,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    tenant_id: Uuid,
    can_edit: bool,
    provider_configured: bool,
    plans: Vec<catalog::Plan>,
    subscriptions: Vec<Subscription>,
    active_users: i64,
    product_photo_bytes: i64,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Checkout {
    plan_id: String,
    payer_email: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SubscriptionCommand {
    subscription_id: Uuid,
    plan_id: Option<String>,
    confirmation: Option<String>,
}

#[derive(Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InvoiceQuery {
    subscription_id: Uuid,
    #[serde(default)]
    offset: u32,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/company-account", get(account))
        .route("/api/v1/company-account/checkout", post(checkout))
        .route("/api/v1/company-account/refresh", post(refresh))
        .route("/api/v1/company-account/change-plan", post(change_plan))
        .route("/api/v1/company-account/cancel", post(cancel))
        .route("/api/v1/company-account/invoices", get(invoices))
}

async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Subscription, DomainError> {
    sqlx::query_as("SELECT id,plan_id,status,provider_id,details FROM company_subscriptions WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}

fn provider(state: &AppState) -> Result<&provider::MercadoPago, DomainError> {
    state.subscriptions.as_ref().ok_or(DomainError::Conflict(
        "O Mercado Pago ainda não está configurado para cobrar assinaturas do ERP.",
    ))
}

fn input<T>(payload: Result<Json<T>, JsonRejection>) -> Result<T, DomainError> {
    payload
        .map(|Json(value)| value)
        .map_err(|_| DomainError::Invalid("Confira os dados da solicitação"))
}

// Only a small, non-sensitive projection of the provider response is persisted.
// Each read is checked against the server-owned reference and price catalog.
fn verified(row: &Subscription, value: &Value) -> Result<(String, String, Value), DomainError> {
    let id = value["id"]
        .as_str()
        .filter(|id| provider::valid_id(id))
        .ok_or_else(provider::provider_error)?;
    if row
        .provider_id
        .as_deref()
        .is_some_and(|expected| expected != id)
        || value["external_reference"].as_str() != Some(row.id.to_string().as_str())
    {
        return Err(provider::provider_error());
    }
    let recurring = &value["auto_recurring"];
    let amount = recurring["transaction_amount"]
        .as_f64()
        .or_else(|| {
            recurring["transaction_amount"]
                .as_str()?
                .parse::<f64>()
                .ok()
        })
        .ok_or_else(provider::provider_error)?;
    let plan = catalog::plans()
        .into_iter()
        .find(|plan| {
            !plan.custom_quote && (amount * 100.0 - plan.monthly_cents as f64).abs() < 0.001
        })
        .ok_or_else(provider::provider_error)?;
    if recurring["currency_id"] != "BRL"
        || recurring["frequency"] != 1
        || recurring["frequency_type"] != "months"
    {
        return Err(provider::provider_error());
    }
    let status = value["status"]
        .as_str()
        .filter(|status| ["pending", "authorized", "paused", "cancelled"].contains(status))
        .ok_or_else(provider::provider_error)?;
    let details = json!({"checkoutUrl":provider::checkout_url(value), "paymentMethod":value["payment_method_id"].as_str(), "nextPaymentDate":value["next_payment_date"].as_str(), "startedAt":value["date_created"].as_str(), "checkedAt":time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).ok()});
    Ok((
        plan.id.into(),
        status.into(),
        json!({"id":id,"details":details}),
    ))
}

async fn persist(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    row: &Subscription,
    value: &Value,
) -> Result<(), DomainError> {
    let (plan, status, projection) = verified(row, value)?;
    sqlx::query("UPDATE company_subscriptions SET provider_id=$3,plan_id=$4,status=$5,details=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(row.id).bind(projection["id"].as_str()).bind(plan).bind(status).bind(&projection["details"])
        .execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    id: Uuid,
    action: &str,
) -> Result<(), DomainError> {
    sqlx::query("INSERT INTO audit_log (tenant_id,identity_id,action,entity_type,entity_id,details) SELECT $1,id,$3,'subscription',$4,'{}'::jsonb FROM identities WHERE auth_subject=$2")
        .bind(tenant).bind(&identity.subject).bind(action).bind(id.to_string()).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}

#[utoipa::path(get, path="/api/v1/company-account", operation_id="get_company_account", tag="Platform", security(("bearerAuth"=[])), params(("X-Tenant-Id"=Uuid,Header)), responses((status=200,body=Account),(status=403,description="Sem permissão")))]
pub async fn account(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "platform.company.read",
        "platform.company.manage",
        false,
    )
    .await?;
    let subscriptions = sqlx::query_as("SELECT id,plan_id,status,provider_id,details FROM company_subscriptions WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50").bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    let active_users = sqlx::query_scalar(
        "SELECT count(*) FROM tenant_memberships WHERE tenant_id=$1 AND status='active'",
    )
    .bind(tenant)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    let product_photo_bytes = sqlx::query_scalar("SELECT COALESCE(sum(octet_length(photo_data_url)),0)::bigint FROM products WHERE tenant_id=$1").bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        Account {
            tenant_id: tenant,
            can_edit,
            provider_configured: state.subscriptions.is_some(),
            plans: catalog::plans(),
            subscriptions,
            active_users,
            product_photo_bytes,
        },
    ))
}

#[utoipa::path(post,path="/api/v1/company-account/checkout",operation_id="checkout_company_subscription",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),request_body=Checkout,responses((status=200,body=Subscription),(status=409,description="Assinatura já existente ou confirmação pendente")))]
pub async fn checkout(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<Checkout>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "platform.company.read",
        "platform.company.manage",
        true,
    )
    .await?;
    let provider = provider(&state)?;
    let data = input(payload)?;
    let plan = catalog::plan(&data.plan_id)
        .filter(|plan| !plan.custom_quote)
        .ok_or(DomainError::Invalid(
            "Plano inválido ou sujeito a proposta comercial",
        ))?;
    let email = data.payer_email.trim();
    if email.len() > 254
        || email.contains(char::is_whitespace)
        || !email
            .split_once('@')
            .is_some_and(|(a, b)| !a.is_empty() && b.contains('.') && !b.contains('@'))
    {
        return Err(DomainError::Invalid(
            "Informe um e-mail válido para o pagador",
        ));
    }
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM company_subscriptions WHERE tenant_id=$1 AND status NOT IN ('cancelled','rejected'))").bind(tenant).fetch_one(&mut *tx).await.map_err(db)?;
    if exists {
        return Err(DomainError::Conflict(
            "Já existe uma assinatura ou contratação pendente. Atualize a assinatura para continuar.",
        ));
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO company_subscriptions(id,tenant_id,plan_id) VALUES($1,$2,$3)")
        .bind(id)
        .bind(tenant)
        .bind(plan.id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    audit(
        &mut tx,
        tenant,
        &identity,
        id,
        "subscription.checkout_requested",
    )
    .await?;
    tx.commit().await.map_err(db)?;
    // Deliberately no automatic POST retry: an HTTP failure may have created the subscription.
    let result = match provider.create(&id.to_string(), &plan, email).await {
        Ok(result) => result,
        Err(error @ DomainError::Invalid(_)) => {
            let mut tx = crate::platform::access::tenant_transaction(&state, tenant).await?;
            sqlx::query("UPDATE company_subscriptions SET status='rejected',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='creating' AND provider_id IS NULL")
                .bind(tenant).bind(id).execute(&mut *tx).await.map_err(db)?;
            audit(
                &mut tx,
                tenant,
                &identity,
                id,
                "subscription.checkout_rejected",
            )
            .await?;
            tx.commit().await.map_err(db)?;
            return Err(error);
        }
        Err(error) => return Err(error),
    };
    let mut tx = crate::platform::access::tenant_transaction(&state, tenant).await?;
    let row = load(&mut tx, tenant, id).await?;
    if verified(&row, &result)?.0 != plan.id {
        return Err(provider::provider_error());
    }
    persist(&mut tx, tenant, &row, &result).await?;
    let row = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, row))
}

#[utoipa::path(post,path="/api/v1/company-account/refresh",operation_id="refresh_company_subscription",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),request_body=SubscriptionCommand,responses((status=200,body=Subscription)))]
pub async fn refresh(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<SubscriptionCommand>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "platform.company.read",
        "platform.company.manage",
        true,
    )
    .await?;
    let data = input(payload)?;
    let row = load(&mut tx, tenant, data.subscription_id).await?;
    let provider = provider(&state)?;
    let value = if let Some(id) = &row.provider_id {
        provider
            .request(
                reqwest::Method::GET,
                &format!("/preapproval/{id}"),
                &[],
                None,
            )
            .await?
    } else {
        let result = provider
            .request(
                reqwest::Method::GET,
                "/preapproval/search",
                &[("q", row.id.to_string()), ("limit", "100".into())],
                None,
            )
            .await?;
        let matches: Vec<_> = result["results"]
            .as_array()
            .ok_or_else(provider::provider_error)?
            .iter()
            .filter(|item| item["external_reference"].as_str() == Some(row.id.to_string().as_str()))
            .collect();
        if matches.len() != 1 {
            return Err(DomainError::Conflict(
                "Contratação ainda sem confirmação única no Mercado Pago. A reserva foi mantida para impedir cobranças duplicadas; solicite a conferência pelo administrador.",
            ));
        }
        matches[0].clone()
    };
    persist(&mut tx, tenant, &row, &value).await?;
    let row = load(&mut tx, tenant, row.id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, row))
}

#[utoipa::path(post,path="/api/v1/company-account/change-plan",operation_id="change_company_subscription_plan",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),request_body=SubscriptionCommand,responses((status=200,body=Subscription)))]
pub async fn change_plan(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<SubscriptionCommand>, JsonRejection>,
) -> Result<Response, DomainError> {
    mutate(state, identity, headers, input(payload)?, false).await
}

#[utoipa::path(post,path="/api/v1/company-account/cancel",operation_id="cancel_company_subscription",tag="Platform",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),request_body=SubscriptionCommand,responses((status=200,body=Subscription)))]
pub async fn cancel(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<SubscriptionCommand>, JsonRejection>,
) -> Result<Response, DomainError> {
    mutate(state, identity, headers, input(payload)?, true).await
}

async fn mutate(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    data: SubscriptionCommand,
    cancelling: bool,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "platform.company.read",
        "platform.company.manage",
        true,
    )
    .await?;
    let provider = provider(&state)?;
    let row = load(&mut tx, tenant, data.subscription_id).await?;
    let id = row.provider_id.as_deref().ok_or(DomainError::Conflict(
        "Atualize a contratação pendente antes de alterar a assinatura",
    ))?;
    let remote = provider
        .request(
            reqwest::Method::GET,
            &format!("/preapproval/{id}"),
            &[],
            None,
        )
        .await?;
    let (_, status, _) = verified(&row, &remote)?;
    let body = if cancelling {
        if data.confirmation.as_deref() != Some("CANCELAR") {
            return Err(DomainError::Invalid(
                "Confirme o cancelamento da assinatura",
            ));
        }
        json!({"status":"cancelled"})
    } else {
        if status != "authorized" {
            return Err(DomainError::Conflict(
                "Somente uma assinatura autorizada pode mudar de plano",
            ));
        }
        let plan = data
            .plan_id
            .as_deref()
            .and_then(catalog::plan)
            .filter(|plan| !plan.custom_quote)
            .ok_or(DomainError::Invalid("Selecione um plano válido"))?;
        json!({"reason":format!("Ávila ERP — {}",plan.name),"auto_recurring":{"transaction_amount":plan.monthly_cents/100,"currency_id":"BRL"}})
    };
    // PUT sets a state/price and can be reconciled by GET after an uncertain response.
    let value = if cancelling && status == "cancelled" {
        remote
    } else {
        provider
            .request(
                reqwest::Method::PUT,
                &format!("/preapproval/{id}"),
                &[],
                Some(body),
            )
            .await?
    };
    let (confirmed_plan, confirmed_status, _) = verified(&row, &value)?;
    if cancelling && confirmed_status != "cancelled"
        || !cancelling && data.plan_id.as_deref() != Some(confirmed_plan.as_str())
    {
        return Err(provider::provider_error());
    }
    persist(&mut tx, tenant, &row, &value).await?;
    audit(
        &mut tx,
        tenant,
        &identity,
        row.id,
        if cancelling {
            "subscription.cancelled"
        } else {
            "subscription.plan_changed"
        },
    )
    .await?;
    let row = load(&mut tx, tenant, row.id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, row))
}

#[utoipa::path(get,path="/api/v1/company-account/invoices",operation_id="list_company_subscription_invoices",tag="Platform",security(("bearerAuth"=[])),params(InvoiceQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value)))]
pub async fn invoices(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(query): Query<InvoiceQuery>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "platform.company.read",
        "platform.company.manage",
        false,
    )
    .await?;
    let row = load(&mut tx, tenant, query.subscription_id).await?;
    tx.commit().await.map_err(db)?;
    let id = row
        .provider_id
        .ok_or(DomainError::Conflict("Assinatura ainda não confirmada"))?;
    if query.offset > 100000 {
        return Err(DomainError::Invalid("Página inválida"));
    }
    let value = provider(&state)?
        .request(
            reqwest::Method::GET,
            "/authorized_payments/search",
            &[
                ("preapproval_id", id.clone()),
                ("offset", query.offset.to_string()),
                ("limit", "10".into()),
            ],
            None,
        )
        .await?;
    let items = value["results"]
        .as_array()
        .ok_or_else(provider::provider_error)?;
    if items
        .iter()
        .any(|item| item["preapproval_id"].as_str() != Some(&id))
    {
        return Err(provider::provider_error());
    }
    let data: Vec<Value> = items.iter().map(|item| json!({"id":item["id"],"description":item["reason"],"amount":item["transaction_amount"],"currency":item["currency_id"],"dueDate":item["debit_date"],"status":item["status"],"paymentStatus":item["payment"]["status"]})).collect();
    Ok(response(
        StatusCode::OK,
        None,
        json!({"data":data,"total":value["paging"]["total"],"offset":query.offset}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_confirmation_requires_owned_reference_known_price_and_monthly_brl() {
        let id = Uuid::now_v7();
        let row = Subscription {
            id,
            plan_id: "cobalto".into(),
            status: "pending".into(),
            provider_id: Some("provider-id".into()),
            details: json!({}),
        };
        let valid = json!({"id":"provider-id", "external_reference":id.to_string(), "status":"authorized", "auto_recurring":{"currency_id":"BRL","frequency":1,"frequency_type":"months","transaction_amount":60}});
        assert_eq!(verified(&row, &valid).unwrap().0, "cobalto");
        for changed in [
            json!({"id":"other-provider"}),
            json!({"external_reference":Uuid::now_v7().to_string()}),
            json!({"status":"approved"}),
            json!({"auto_recurring":{"currency_id":"USD","frequency":1,"frequency_type":"months","transaction_amount":60}}),
            json!({"auto_recurring":{"currency_id":"BRL","frequency":1,"frequency_type":"months","transaction_amount":1}}),
        ] {
            let mut invalid = valid.clone();
            invalid
                .as_object_mut()
                .unwrap()
                .extend(changed.as_object().unwrap().clone());
            assert!(verified(&row, &invalid).is_err());
        }
    }
}
