use super::{
    auth::AuthenticatedIdentity, commercial_settings_model::CommercialParameters, state::AppState,
};
use crate::domains::{
    DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
    revision,
};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

const CALCULATOR: &str = "legacy-managerial-v1-ceil-cents";
const MANAGE: &str = "platform.company.manage";

#[cfg(test)]
mod tests {
    use super::*;

    fn cost(purchase: i64, credit: i32, packaging: i64) -> CostRow {
        CostRow {
            product_id: Uuid::nil(),
            sku: "TEST".into(),
            name: "Teste".into(),
            unit: "UN".into(),
            product_revision: 1,
            cost_revision: 1,
            purchase_cost_cents: purchase,
            tax_credit_bps: credit,
            packaging_cents: packaging,
        }
    }

    #[test]
    fn pricing_publication_rounds_final_cents_and_does_not_apply_safety_to_packaging() {
        let mut p = super::super::commercial_settings_model::tests::example();
        p.net_margin_bps = 0;
        p.free_discount_bps = 0;
        p.domestic_icms_bps = 0;
        p.interstate_bps = 0;
        p.pis_cofins_bps = 0;
        p.commission_bps = 0;
        p.ads_bps = 0;
        p.loss_bps = 0;
        p.warranty_bps = 0;
        for rate in &mut p.state_rates {
            rate.internal_bps = 0;
        }
        p.cost_safety_bps = 500;
        p.ipi_bps = 1300;
        assert_eq!(p.simulate().unwrap().variable_costs_bps, 0);
        assert_eq!(
            calculate(&p, 0, &cost(10000, 1000, 100)).unwrap(),
            (9550, 10792)
        );
        assert_eq!(calculate(&p, 0, &cost(1, 0, 0)).unwrap(), (2, 3));
        assert!(calculate(&p, 0, &cost(100, 10000, 0)).is_err());
        assert!(calculate(&p, 0, &cost(1_000_000_000_000, 0, 1_000_000_000_000)).is_err());
    }
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishInput {
    digest: String,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct CostRow {
    product_id: Uuid,
    sku: String,
    name: String,
    unit: String,
    product_revision: i64,
    cost_revision: i64,
    purchase_cost_cents: i64,
    tax_credit_bps: i32,
    packaging_cents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PricedItem {
    #[serde(flatten)]
    source: CostRow,
    price_without_ipi_cents: i64,
    ipi_bps: u32,
    price_with_ipi_cents: i64,
}

struct Candidate {
    settings_revision: i64,
    policy: Value,
    digest: String,
    items: Vec<PricedItem>,
}

// Keep the full rational until the final cent. Round upwards to preserve the
// managerial margin at the configured free discount; never use f64 for money.
fn calculate(
    p: &CommercialParameters,
    costs_bps: u32,
    cost: &CostRow,
) -> Result<(i64, i64), DomainError> {
    let retained = i128::from(10_000 - p.income_tax_bps);
    let share = (10_000 - i128::from(costs_bps)) * retained - i128::from(p.net_margin_bps) * 10_000;
    let adjusted = i128::from(cost.purchase_cost_cents)
        * i128::from(10_000 - cost.tax_credit_bps)
        * i128::from(10_000 + p.cost_safety_bps)
        + i128::from(cost.packaging_cents) * 100_000_000;
    let denominator = share * i128::from(10_000 - p.free_discount_bps);
    if denominator <= 0 || adjusted <= 0 {
        return Err(DomainError::Invalid(
            "O custo ajustado e a margem disponível devem ser positivos para publicar",
        ));
    }
    let base = (adjusted * retained + denominator - 1) / denominator;
    let total = (base * i128::from(10_000 + p.ipi_bps) + 9_999) / 10_000;
    if total > 1_000_000_000_000 || base > 1_000_000_000_000 {
        return Err(DomainError::Invalid(
            "Preço calculado ultrapassa o limite de R$ 10 bilhões",
        ));
    }
    Ok((base as i64, total as i64))
}

async fn candidate(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    line: &str,
) -> Result<Candidate, DomainError> {
    let (settings_revision, mut policy): (i64, Value) = sqlx::query_as(
        "SELECT revision,parameters FROM commercial_settings WHERE tenant_id=$1 AND product_line=$2",
    )
    .bind(tenant)
    .bind(line)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::Conflict(
        "Salve os parâmetros da linha antes de preparar a publicação",
    ))?;
    policy["monthlyExpensesCents"] =
        json!(crate::domains::fixed_expenses::monthly_total(tx, tenant).await?);
    let parameters: CommercialParameters = serde_json::from_value(policy.clone())
        .map_err(|_| DomainError::Invalid("Parâmetros salvos inválidos"))?;
    let simulation = parameters.simulate()?;
    let sources: Vec<CostRow> = sqlx::query_as("SELECT p.id AS product_id,p.sku,p.name,p.unit,p.revision AS product_revision,c.revision AS cost_revision,c.purchase_cost_cents,c.tax_credit_bps,c.packaging_cents FROM product_costs c JOIN products p ON p.tenant_id=c.tenant_id AND p.id=c.product_id WHERE c.tenant_id=$1 AND c.product_line=$2 AND p.status='active' ORDER BY p.id LIMIT 5001")
        .bind(tenant).bind(line).fetch_all(&mut **tx).await.map_err(db)?;
    if sources.is_empty() {
        return Err(DomainError::Conflict(
            "Cadastre custos de pelo menos um produto ativo nesta linha",
        ));
    }
    if sources.len() > 5000 {
        return Err(DomainError::Invalid(
            "Publicação limitada a 5000 produtos por linha",
        ));
    }
    let mut items = Vec::with_capacity(sources.len());
    for source in sources {
        let (base, total) = calculate(&parameters, simulation.variable_costs_bps, &source)?;
        items.push(PricedItem {
            source,
            price_without_ipi_cents: base,
            ipi_bps: parameters.ipi_bps,
            price_with_ipi_cents: total,
        });
    }
    let raw = json!({"tenantId":tenant,"line":line,"revision":settings_revision,"policy":policy,"calculator":CALCULATOR,"items":items});
    let digest = format!("{:x}", Sha256::digest(raw.to_string().as_bytes()));
    Ok(Candidate {
        settings_revision,
        policy,
        digest,
        items,
    })
}

#[utoipa::path(get,path="/api/v1/price-tables/{line}/preview",operation_id="preview_price_table",tag="Sales",security(("bearerAuth"=[])),params(("line"=String,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=409,description="Parâmetros ou custos ausentes")))]
pub async fn preview(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(code): Path<String>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, MANAGE, MANAGE, false).await?;
    // One stable input snapshot across the two reads, without persisting a preview.
    sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR SHARE")
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    if !matches!(code.as_str(), "imported" | "national") {
        return Err(DomainError::Invalid("Linha comercial inválida"));
    }
    let result = candidate(&mut tx, tenant, &code).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(result.settings_revision),
        json!({"tenantId":tenant,"line":code,"revision":result.settings_revision,"digest":result.digest,"calculatorVersion":CALCULATOR,"items":result.items}),
    ))
}

#[utoipa::path(post,path="/api/v1/price-tables/{line}/publish",operation_id="publish_price_table",tag="Sales",security(("bearerAuth"=[])),params(("line"=String,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),request_body=PublishInput,responses((status=200,body=Value),(status=412,description="Prévia desatualizada")))]
pub async fn publish(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(code): Path<String>,
    headers: HeaderMap,
    payload: Result<Json<PublishInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, MANAGE, MANAGE, true).await?;
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("Confirmação de publicação inválida"))?;
    if input.digest.len() != 64
        || !input
            .digest
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(DomainError::Invalid("Prepare a prévia antes de publicar"));
    }
    let request = json!({"line":code,"revision":expected,"digest":input.digest});
    if let Some(result) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "price_table.publish",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, Some(expected), result));
    }
    if !matches!(code.as_str(), "imported" | "national") {
        return Err(DomainError::Invalid("Linha comercial inválida"));
    }
    let prepared = candidate(&mut tx, tenant, &code).await?;
    if prepared.settings_revision != expected || prepared.digest != input.digest {
        return Err(DomainError::StaleRevision);
    }
    let existing: Option<(Uuid,i64)> = sqlx::query_as("SELECT id,version FROM price_table_versions WHERE tenant_id=$1 AND product_line=$2 AND digest=$3")
        .bind(tenant).bind(&code).bind(&prepared.digest).fetch_optional(&mut *tx).await.map_err(db)?;
    let (id, version) = if let Some(existing) = existing {
        existing
    } else {
        let id = Uuid::now_v7();
        let version: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(version),0)+1 FROM price_table_versions WHERE tenant_id=$1 AND product_line=$2")
            .bind(tenant).bind(&code).fetch_one(&mut *tx).await.map_err(db)?;
        sqlx::query("INSERT INTO price_table_versions(id,tenant_id,product_line,version,settings_revision,policy_snapshot,calculator_version,digest,published_by) SELECT $1,$2,$3,$4,$5,$6,$7,$8,id FROM identities WHERE auth_subject=$9")
            .bind(id).bind(tenant).bind(&code).bind(version).bind(expected).bind(&prepared.policy).bind(CALCULATOR).bind(&prepared.digest).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
        for item in &prepared.items {
            let c = &item.source;
            sqlx::query("INSERT INTO price_table_items(tenant_id,version_id,product_id,product_snapshot,cost_revision,cost_snapshot,price_without_ipi_cents,ipi_bps,price_with_ipi_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
                .bind(tenant).bind(id).bind(c.product_id).bind(json!({"sku":c.sku,"name":c.name,"unit":c.unit,"revision":c.product_revision}))
                .bind(c.cost_revision).bind(json!({"purchaseCostCents":c.purchase_cost_cents,"taxCreditBps":c.tax_credit_bps,"packagingCents":c.packaging_cents}))
                .bind(item.price_without_ipi_cents).bind(item.ipi_bps as i32).bind(item.price_with_ipi_cents).execute(&mut *tx).await.map_err(db)?;
        }
        record(
            &mut tx,
            tenant,
            &identity,
            &headers,
            DomainChange {
                kind: "price_table",
                id,
                event: "price_table.published",
                details: json!({"line":code,"version":version,"itemCount":prepared.items.len()}),
            },
        )
        .await?;
        (id, version)
    };
    sqlx::query("UPDATE commercial_settings SET active_price_version_id=$3 WHERE tenant_id=$1 AND product_line=$2")
        .bind(tenant).bind(&code).bind(id).execute(&mut *tx).await.map_err(db)?;
    let result = json!({"tenantId":tenant,"line":code,"id":id,"version":version,"revision":expected,"itemCount":prepared.items.len(),"status":"published"});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "price_table.publish",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(expected), result))
}

#[utoipa::path(get,path="/api/v1/price-tables/{line}",operation_id="get_price_table",tag="Sales",security(("bearerAuth"=[])),params(("line"=String,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value)))]
pub async fn current(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(code): Path<String>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, MANAGE, MANAGE, false).await?;
    if !matches!(code.as_str(), "imported" | "national") {
        return Err(DomainError::Invalid("Linha comercial inválida"));
    }
    let current: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',v.id,'version',v.version,'settingsRevision',v.settings_revision,'publishedAt',v.published_at,'calculatorVersion',v.calculator_version,'items',(SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',i.product_id,'sku',i.product_snapshot->>'sku','name',i.product_snapshot->>'name','priceWithoutIpiCents',i.price_without_ipi_cents,'ipiBps',i.ipi_bps,'priceWithIpiCents',i.price_with_ipi_cents) ORDER BY i.product_id),'[]'::jsonb) FROM price_table_items i WHERE i.tenant_id=v.tenant_id AND i.version_id=v.id)) FROM commercial_settings s JOIN price_table_versions v ON v.tenant_id=s.tenant_id AND v.id=s.active_price_version_id WHERE s.tenant_id=$1 AND s.product_line=$2")
        .bind(tenant).bind(&code).fetch_optional(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"line":code,"data":current}),
    ))
}
