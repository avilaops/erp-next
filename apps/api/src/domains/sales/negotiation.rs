use super::negotiation_model::{
    self as model, ApprovalRules, DirectorQuote, SaleQuote, SimulationInput, SourceItem,
};
use crate::{
    domains::{
        DomainChange, DomainError, authorized, command_key, db, decimal, record, remember, replay,
        response, revision,
    },
    platform::{
        access, auth::AuthenticatedIdentity, commercial_settings_model::CommercialParameters,
        state::AppState,
    },
};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

const READ: &str = "sales.orders.read";
const MANAGE: &str = "sales.orders.manage";
const DIRECTOR: &str = "sales.approvals.director";
const APPROVE: &str = "sales.approvals.manage";
const POLICY: &str = "platform.company.manage";

async fn allowed(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    permission: &str,
) -> Result<bool, DomainError> {
    let rights = access::load_access(tx, tenant, &identity.subject).await?;
    Ok(access::require_permission(&rights, permission).is_ok())
}

pub(super) async fn require_catalog_pricing(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    product: Uuid,
) -> Result<(), DomainError> {
    let published: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM product_costs c JOIN commercial_settings s ON s.tenant_id=c.tenant_id AND s.product_line=c.product_line WHERE c.tenant_id=$1 AND c.product_id=$2 AND s.active_price_version_id IS NOT NULL)")
        .bind(tenant).bind(product).fetch_one(&mut **tx).await.map_err(db)?;
    if published {
        return Err(DomainError::Conflict(
            "Este produto usa tabela publicada. Simule a negociação antes de criar o pedido",
        ));
    }
    Ok(())
}

pub(super) async fn require_approval(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<(), DomainError> {
    let status: Option<String> = sqlx::query_scalar(
        "SELECT approval_status FROM commercial_order_quotes WHERE tenant_id=$1 AND order_id=$2",
    )
    .bind(tenant)
    .bind(order)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?;
    if status
        .as_ref()
        .is_some_and(|status| !matches!(status.as_str(), "approved" | "not_required"))
    {
        return Err(DomainError::Conflict(
            "Negociação precisa de aprovação antes de confirmar o pedido",
        ));
    }
    if status.is_none() {
        let bypass: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sales_orders o JOIN sales_order_lines l ON l.tenant_id=o.tenant_id AND l.order_id=o.id JOIN price_table_items i ON i.tenant_id=l.tenant_id AND i.product_id=l.product_id JOIN commercial_settings s ON s.tenant_id=i.tenant_id AND s.active_price_version_id=i.version_id JOIN price_table_versions v ON v.tenant_id=i.tenant_id AND v.id=i.version_id WHERE o.tenant_id=$1 AND o.id=$2 AND o.created_at>=v.published_at AND NOT EXISTS(SELECT 1 FROM sales_proposals sp WHERE sp.tenant_id=o.tenant_id AND sp.order_id=o.id AND sp.created_at<v.published_at))")
            .bind(tenant).bind(order).fetch_one(&mut **tx).await.map_err(db)?;
        if bypass {
            return Err(DomainError::Conflict(
                "Tabela publicada exige negociação calculada. Recrie este rascunho no simulador comercial",
            ));
        }
    }
    Ok(())
}

pub(super) async fn require_unquoted(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    order: Uuid,
) -> Result<(), DomainError> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM commercial_order_quotes WHERE tenant_id=$1 AND order_id=$2)",
    )
    .bind(tenant)
    .bind(order)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    if exists {
        return Err(DomainError::Conflict(
            "Pedido preserva uma negociação calculada. Cancele o rascunho e refaça a simulação para negociar outras condições",
        ));
    }
    Ok(())
}

async fn rules(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
) -> Result<(i64, ApprovalRules), DomainError> {
    let (revision, raw): (i64, Value) = sqlx::query_as(
        "SELECT revision,rules FROM commercial_approval_settings WHERE tenant_id=$1",
    )
    .bind(tenant)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::Conflict(
        "Salve as regras de aprovação da empresa antes de simular",
    ))?;
    Ok((
        revision,
        serde_json::from_value(raw).map_err(|_| access::AccessError::Internal)?,
    ))
}

struct Prepared {
    sale: SaleQuote,
    director: DirectorQuote,
    rules: ApprovalRules,
    policy: Value,
    sources: Vec<SourceItem>,
    digest: String,
    version: i64,
}

async fn prepare(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    input: &SimulationInput,
) -> Result<Prepared, DomainError> {
    if !matches!(input.line.as_str(), "imported" | "national") {
        return Err(DomainError::Invalid("Linha comercial inválida"));
    }
    let (version, saved_revision, current_revision, policy): (i64, i64, i64, Value) = sqlx::query_as("SELECT v.version,v.settings_revision,s.revision,v.policy_snapshot FROM commercial_settings s JOIN price_table_versions v ON v.tenant_id=s.tenant_id AND v.id=s.active_price_version_id WHERE s.tenant_id=$1 AND s.product_line=$2 AND v.id=$3")
        .bind(tenant).bind(&input.line).bind(input.version_id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::StaleRevision)?;
    if saved_revision != current_revision {
        return Err(DomainError::Conflict(
            "Parâmetros alterados após a publicação. Publique a tabela atualizada antes de simular",
        ));
    }
    let parameters: CommercialParameters =
        serde_json::from_value(policy.clone()).map_err(|_| access::AccessError::Internal)?;
    let (rules_revision, rules) = rules(tx, tenant).await?;
    if input.items.is_empty() || input.items.len() > 100 {
        return Err(DomainError::Invalid(
            "Simulação exige de 1 a 100 equipamentos",
        ));
    }
    let mut sources = Vec::with_capacity(input.items.len());
    for item in &input.items {
        let source: SourceItem = sqlx::query_as("SELECT i.product_id,i.product_snapshot->>'sku' AS sku,i.product_snapshot->>'name' AS name,i.product_snapshot->>'unit' AS unit,p.revision AS product_revision,c.revision AS cost_revision,i.price_without_ipi_cents AS price_cents,(i.cost_snapshot->>'purchaseCostCents')::bigint AS purchase_cents,(i.cost_snapshot->>'taxCreditBps')::integer AS credit_bps,(i.cost_snapshot->>'packagingCents')::bigint AS packaging_cents FROM price_table_items i JOIN products p ON p.tenant_id=i.tenant_id AND p.id=i.product_id JOIN product_costs c ON c.tenant_id=i.tenant_id AND c.product_id=i.product_id WHERE i.tenant_id=$1 AND i.version_id=$2 AND i.product_id=$3 AND p.status='active' AND c.product_line=$4 AND c.revision=i.cost_revision AND p.revision=(i.product_snapshot->>'revision')::bigint")
            .bind(tenant).bind(input.version_id).bind(item.product_id).bind(&input.line).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::Conflict("Produto ou custo alterado, indisponível ou fora da tabela. Atualize e publique a tabela"))?;
        sources.push(source);
    }
    let (sale, director) = model::calculate(&parameters, &rules, input, &sources)?;
    let raw = json!({"tenantId":tenant,"input":input,"rulesRevision":rules_revision,"rules":rules,"policy":policy,"sources":sources,"sale":sale,"director":director});
    let digest = format!("{:x}", Sha256::digest(raw.to_string().as_bytes()));
    Ok(Prepared {
        sale,
        director,
        rules,
        policy,
        sources,
        digest,
        version,
    })
}

#[utoipa::path(get,path="/api/v1/commercial/tables/{line}",operation_id="get_commercial_tables_line",tag="Sales",params(("line"=String,Path),("X-Tenant-Id"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value),(status=403,description="Sem acesso comercial")))]
pub async fn table(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(line): Path<String>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    if !matches!(line.as_str(), "imported" | "national") {
        return Err(DomainError::Invalid("Linha comercial inválida"));
    }
    // Deliberate allowlist: no cost snapshots or margin targets in the sales response.
    let data: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',v.id,'version',v.version,'publishedAt',v.published_at,'originState',v.policy_snapshot->>'originState','freeDiscountBps',v.policy_snapshot->'freeDiscountBps','minimumDownPaymentBps',v.policy_snapshot->'minimumDownPaymentBps','items',(SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',i.product_id,'sku',i.product_snapshot->>'sku','name',i.product_snapshot->>'name','unit',i.product_snapshot->>'unit','priceWithoutIpiCents',i.price_without_ipi_cents,'ipiBps',i.ipi_bps,'priceWithIpiCents',i.price_with_ipi_cents) ORDER BY i.product_snapshot->>'sku'),'[]'::jsonb) FROM price_table_items i JOIN products p ON p.tenant_id=i.tenant_id AND p.id=i.product_id WHERE i.tenant_id=v.tenant_id AND i.version_id=v.id AND p.status='active')) FROM commercial_settings s JOIN price_table_versions v ON v.tenant_id=s.tenant_id AND v.id=s.active_price_version_id WHERE s.tenant_id=$1 AND s.product_line=$2")
        .bind(tenant).bind(&line).fetch_optional(&mut *tx).await.map_err(db)?;
    let can_manage = allowed(&mut tx, tenant, &identity, POLICY).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"line":line,"data":data,"canManage":can_manage}),
    ))
}

#[utoipa::path(post,path="/api/v1/commercial/simulate",operation_id="post_commercial_simulate",tag="Sales",request_body=SimulationInput,params(("X-Tenant-Id"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value),(status=409,description="Configuração ou tabela desatualizada"),(status=422,description="Entradas inválidas")))]
pub async fn simulate(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<SimulationInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR SHARE")
        .bind(tenant)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("Simulação inválida ou campos desconhecidos"))?;
    let prepared = prepare(&mut tx, tenant, &input).await?;
    let director = if allowed(&mut tx, tenant, &identity, POLICY).await? {
        Some(prepared.director)
    } else {
        None
    };
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"version":prepared.version,"digest":prepared.digest,"sale":prepared.sale,"director":director}),
    ))
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConvertInput {
    simulation: SimulationInput,
    digest: String,
    customer_id: Uuid,
    due_date: String,
    opportunity_id: Option<Uuid>,
    opportunity_revision: Option<i64>,
}

#[utoipa::path(post,path="/api/v1/commercial/orders",operation_id="post_commercial_orders",tag="Sales",request_body=ConvertInput,params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=201,body=Value),(status=412,description="Simulação desatualizada")))]
pub async fn convert(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<ConvertInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let key = command_key(&headers)?;
    let Json(input) =
        payload.map_err(|_| DomainError::Invalid("Conversão inválida ou campos desconhecidos"))?;
    let request = json!({"simulation":input.simulation,"digest":input.digest,"customerId":input.customer_id,"dueDate":input.due_date,"opportunityId":input.opportunity_id,"opportunityRevision":input.opportunity_revision});
    if input.opportunity_id.is_some() != input.opportunity_revision.is_some() {
        return Err(DomainError::Invalid("Oportunidade exige sua revisão atual"));
    }
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "negotiation.convert",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, Some(1), previous));
    }
    let prepared = prepare(&mut tx, tenant, &input.simulation).await?;
    if prepared.digest != input.digest {
        return Err(DomainError::StaleRevision);
    }
    let due = super::date(&input.due_date)?;
    let customer: (String,String) = sqlx::query_as("SELECT legal_name,tax_id FROM parties WHERE tenant_id=$1 AND id=$2 AND is_customer AND status='active'")
        .bind(tenant).bind(input.customer_id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::Conflict("Selecione um cliente ativo desta empresa"))?;
    let mut lines = Vec::with_capacity(prepared.sale.items.len());
    for item in &prepared.sale.items {
        let product = crate::domains::catalog::load(&mut tx, tenant, item.product_id).await?;
        let structure_color = super::select_color(
            item.structure_color.as_deref(),
            product.data.structure_colors.as_deref().unwrap_or_default(),
            None,
        )?;
        let plate_holder_color = super::select_color(
            item.plate_holder_color.as_deref(),
            product
                .data
                .plate_holder_colors
                .as_deref()
                .unwrap_or_default(),
            None,
        )?;
        let plate_holder_type = super::select_color(
            item.plate_holder_type.as_deref(),
            product
                .data
                .plate_holder_types
                .as_deref()
                .unwrap_or_default(),
            None,
        )?;
        let upholstery_color = super::select_color(
            item.upholstery_color.as_deref(),
            product
                .data
                .upholstery_colors
                .as_deref()
                .unwrap_or_default(),
            None,
        )?;
        lines.push(super::PreparedLine {
            product_id: item.product_id,
            sku: item.sku.clone(),
            name: item.name.clone(),
            unit: item.unit.clone(),
            quantity: i64::from(item.quantity) * 1_000_000,
            price: item.unit_total_cents,
            amount: item.total_cents,
            structure_color,
            plate_holder_color,
            plate_holder_type,
            upholstery_color,
        });
    }
    let order = Uuid::now_v7();
    sqlx::query("INSERT INTO sales_orders(id,tenant_id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES($1,$2,$3,$4,$5,$6,$7,'draft')")
        .bind(order).bind(tenant).bind(input.customer_id).bind(customer.0).bind(customer.1).bind(due).bind(prepared.sale.total_cents).execute(&mut *tx).await.map_err(db)?;
    super::store_lines(&mut tx, tenant, order, &lines).await?;
    if let (Some(id), Some(expected)) = (input.opportunity_id, input.opportunity_revision) {
        super::opportunities::link_order(&mut tx, tenant, id, expected, input.customer_id, order)
            .await?;
        record(
            &mut tx,
            tenant,
            &identity,
            &headers,
            DomainChange {
                kind: "sales_opportunity",
                id,
                event: "opportunity.order_linked",
                details: json!({"orderId":order,"revision":expected+1}),
            },
        )
        .await?;
    }
    let auto = prepared.rules.director_auto_approval
        && allowed(&mut tx, tenant, &identity, DIRECTOR).await?;
    let status = if prepared.sale.approval_reasons.is_empty() {
        "not_required"
    } else if auto {
        "approved"
    } else {
        "pending"
    };
    let public = json!({"input":input.simulation,"sale":prepared.sale,"version":prepared.version,"digest":prepared.digest});
    let private =
        json!({"director":prepared.director,"policy":prepared.policy,"sources":prepared.sources});
    sqlx::query("INSERT INTO commercial_order_quotes(tenant_id,order_id,price_version_id,public_snapshot,private_snapshot,approval_rules,approval_status,requires_director,created_by) SELECT $1,$2,$3,$4,$5,$6,$7,$8,id FROM identities WHERE auth_subject=$9")
        .bind(tenant).bind(order).bind(input.simulation.version_id).bind(public).bind(private).bind(json!(prepared.rules)).bind(status).bind(prepared.director.requires_director).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    if auto && status == "approved" {
        sqlx::query("INSERT INTO commercial_approval_decisions(id,tenant_id,order_id,order_revision,decision,reason,decided_by) SELECT $1,$2,$3,1,'approved','Autoaprovação da diretoria conforme política salva',id FROM identities WHERE auth_subject=$4").bind(Uuid::now_v7()).bind(tenant).bind(order).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    }
    record(&mut tx,tenant,&identity,&headers,DomainChange {kind:"sales_order",id:order,event:"order.created",details:json!({"revision":1,"priceVersionId":input.simulation.version_id,"approvalStatus":status,"amount":decimal(prepared.sale.total_cents,2)})}).await?;
    let value = json!({"tenantId":tenant,"id":order,"revision":1,"approvalStatus":status});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "negotiation.convert",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), value))
}

#[utoipa::path(get,path="/api/v1/commercial/approval-settings",operation_id="get_commercial_approval_settings",tag="Sales",params(("X-Tenant-Id"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value)))]
pub async fn get_rules(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) =
        authorized(&state, &headers, &identity, POLICY, POLICY, false).await?;
    let row: Option<(i64, Value)> = sqlx::query_as(
        "SELECT revision,rules FROM commercial_approval_settings WHERE tenant_id=$1",
    )
    .bind(tenant)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?;
    let (revision, data) = row.map(|(r, v)| (r, Some(v))).unwrap_or((1, None));
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        json!({"tenantId":tenant,"revision":revision,"data":data}),
    ))
}

#[utoipa::path(put,path="/api/v1/commercial/approval-settings",operation_id="put_commercial_approval_settings",tag="Sales",request_body=ApprovalRules,params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value),(status=412,description="Revisão divergente")))]
pub async fn put_rules(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<ApprovalRules>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, POLICY, POLICY, true).await?;
    let expected = revision(&headers)?;
    let Json(rules) = payload.map_err(|_| DomainError::Invalid("Regras de aprovação inválidas"))?;
    let current: Option<i64> =
        sqlx::query_scalar("SELECT revision FROM commercial_approval_settings WHERE tenant_id=$1")
            .bind(tenant)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?;
    if current.unwrap_or(1) != expected {
        return Err(DomainError::StaleRevision);
    }
    let next = expected
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    sqlx::query("INSERT INTO commercial_approval_settings(tenant_id,revision,rules) VALUES($1,$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET revision=$2,rules=$3,updated_at=now()")
        .bind(tenant).bind(next).bind(json!(rules)).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "commercial_approval_settings",
            id: tenant,
            event: "commercial_approval_settings.updated",
            details: json!({"revision":next}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        json!({"tenantId":tenant,"revision":next,"data":rules}),
    ))
}

#[utoipa::path(get,path="/api/v1/commercial/orders/{id}",operation_id="get_commercial_orders_id",tag="Sales",params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value)))]
pub async fn quote(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let row: Option<(Value,Value,String,bool,i64)> = sqlx::query_as("SELECT q.public_snapshot,q.private_snapshot,q.approval_status,q.requires_director,o.revision FROM commercial_order_quotes q JOIN sales_orders o ON o.tenant_id=q.tenant_id AND o.id=q.order_id WHERE q.tenant_id=$1 AND q.order_id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
    let Some((public, private, status, director, revision)) = row else {
        tx.commit().await.map_err(db)?;
        return Ok(response(
            StatusCode::OK,
            None,
            json!({"tenantId":tenant,"data":null}),
        ));
    };
    let can_approve = allowed(&mut tx, tenant, &identity, DIRECTOR).await?
        || (!director && allowed(&mut tx, tenant, &identity, APPROVE).await?);
    let details = if allowed(&mut tx, tenant, &identity, POLICY).await? {
        Some(private["director"].clone())
    } else {
        None
    };
    let decisions: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('decision',d.decision,'reason',d.reason,'createdAt',d.created_at,'decidedBy',i.display_name) FROM commercial_approval_decisions d JOIN identities i ON i.id=d.decided_by WHERE d.tenant_id=$1 AND d.order_id=$2 ORDER BY d.created_at,d.id")
        .bind(tenant).bind(id).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        json!({"tenantId":tenant,"revision":revision,"data":public,"director":details,"approvalStatus":status,"canApprove":can_approve,"decisions":decisions}),
    ))
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionInput {
    approved: bool,
    reason: String,
}

#[utoipa::path(post,path="/api/v1/commercial/orders/{id}/decision",operation_id="post_commercial_orders_id_decision",tag="Sales",request_body=DecisionInput,params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value),(status=403,description="Fora da alçada")))]
pub async fn decision(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    payload: Result<Json<DecisionInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, READ, true).await?;
    let expected = revision(&headers)?;
    let key = command_key(&headers)?;
    let Json(input) = payload.map_err(|_| DomainError::Invalid("Decisão inválida"))?;
    let reason = input.reason.trim();
    if reason.is_empty()
        || reason.chars().count() > 1000
        || reason.chars().any(|c| c.is_control() && c != '\n')
    {
        return Err(DomainError::Invalid(
            "Informe o motivo da decisão, até 1000 caracteres",
        ));
    }
    let (needs_director,status,order_revision,order_status): (bool,String,i64,String) = sqlx::query_as("SELECT q.requires_director,q.approval_status,o.revision,o.status FROM commercial_order_quotes q JOIN sales_orders o ON o.tenant_id=q.tenant_id AND o.id=q.order_id WHERE q.tenant_id=$1 AND q.order_id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if !allowed(&mut tx, tenant, &identity, DIRECTOR).await?
        && (needs_director || !allowed(&mut tx, tenant, &identity, APPROVE).await?)
    {
        return Err(access::AccessError::Forbidden.into());
    }
    let request = json!({"id":id,"revision":expected,"approved":input.approved,"reason":reason});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "negotiation.decision",
        &request,
    )
    .await?
    {
        let rev = previous["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, rev, previous));
    }
    if order_revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if status != "pending" || order_status != "draft" {
        return Err(DomainError::Conflict(
            "Somente negociações pendentes em rascunho podem receber decisão",
        ));
    }
    let next = expected
        .checked_add(1)
        .ok_or(access::AccessError::Internal)?;
    let status = if input.approved {
        "approved"
    } else {
        "rejected"
    };
    sqlx::query(
        "UPDATE commercial_order_quotes SET approval_status=$3 WHERE tenant_id=$1 AND order_id=$2",
    )
    .bind(tenant)
    .bind(id)
    .bind(status)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query(
        "UPDATE sales_orders SET revision=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(id)
    .bind(next)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query("INSERT INTO commercial_approval_decisions(id,tenant_id,order_id,order_revision,decision,reason,decided_by) SELECT $1,$2,$3,$4,$5,$6,id FROM identities WHERE auth_subject=$7")
        .bind(Uuid::now_v7()).bind(tenant).bind(id).bind(next).bind(status).bind(reason).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "sales_order",
            id,
            event: "negotiation.decided",
            details: json!({"revision":next,"decision":status}),
        },
    )
    .await?;
    let value = json!({"tenantId":tenant,"id":id,"revision":next,"approvalStatus":status});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "negotiation.decision",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(next), value))
}
