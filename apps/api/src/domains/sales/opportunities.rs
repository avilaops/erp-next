use crate::domains::list_sort::SortField;
use crate::{
    domains::{
        DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
        revision,
    },
    platform::{auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Json,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use utoipa::IntoParams;
use uuid::Uuid;

const READ: &str = "sales.orders.read";
const MANAGE: &str = "sales.orders.manage";
const SELECT: &str = "SELECT o.data || jsonb_build_object('id',o.id,'revision',o.revision,'customerId',o.customer_id,'customerName',p.legal_name,'orderId',o.order_id,'proposalId',o.proposal_id,'createdAt',o.created_at,'updatedAt',o.updated_at) FROM sales_opportunities o LEFT JOIN parties p ON p.tenant_id=o.tenant_id AND p.id=o.customer_id";

#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpportunityInput {
    pub title: String,
    pub estimated_cents: u64,
    pub stage: String,
    pub customer_id: Option<Uuid>,
    pub company_name: String,
    pub company_tax_id: String,
    pub contact_name: String,
    pub phone: String,
    pub email: String,
    pub source: String,
    pub notes: String,
}
impl OpportunityInput {
    fn validate(&self) -> Result<(), DomainError> {
        if self.title.trim().is_empty()
            || self.title.chars().count() > 200
            || self.estimated_cents > 99_999_999_999_999
            || !["new", "contacted", "proposed", "negotiation", "won", "lost"]
                .contains(&self.stage.as_str())
            || (self.customer_id.is_none() && self.company_name.trim().is_empty())
        {
            return Err(DomainError::Invalid(
                "Informe a oportunidade, a empresa ou cliente, valor e etapa válidos",
            ));
        }
        for (value, max) in [
            (&self.title, 200),
            (&self.company_name, 200),
            (&self.company_tax_id, 18),
            (&self.contact_name, 200),
            (&self.phone, 40),
            (&self.email, 254),
            (&self.source, 200),
            (&self.notes, 5000),
        ] {
            if value.chars().count() > max || value.chars().any(|c| c.is_control() && c != '\n') {
                return Err(DomainError::Invalid(
                    "Texto da oportunidade inválido ou muito longo",
                ));
            }
        }
        if !self.email.is_empty()
            && (!self.email.contains('@') || self.email.chars().any(char::is_whitespace))
        {
            return Err(DomainError::Invalid("E-mail de contato inválido"));
        }
        if !self.company_tax_id.is_empty() {
            let raw: String = self
                .company_tax_id
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect();
            if !crate::platform::valid_document(&raw, "juridica") {
                return Err(DomainError::Invalid("CNPJ inválido"));
            }
        }
        Ok(())
    }
}
async fn customer(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Option<Uuid>,
) -> Result<(), DomainError> {
    if let Some(id) = id {
        let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM parties WHERE tenant_id=$1 AND id=$2 AND is_customer AND status='active')").bind(tenant).bind(id).fetch_one(&mut **tx).await.map_err(db)?;
        if !active {
            return Err(DomainError::Conflict(
                "Selecione um cliente ativo desta empresa",
            ));
        }
    }
    Ok(())
}
async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Value, DomainError> {
    sqlx::query_scalar(&format!("{SELECT} WHERE o.tenant_id=$1 AND o.id=$2"))
        .bind(tenant)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(db)?
        .ok_or(DomainError::NotFound)
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in=Query)]
#[serde(deny_unknown_fields)]
pub struct OpportunityQuery {
    q: Option<String>,
    stage: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,

    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
    #[serde(rename = "sortOrder")]
    sort_order: Option<String>,
}

#[utoipa::path(get,path="/api/v1/opportunities",operation_id="list_sales_opportunities",tag="Sales",params(OpportunityQuery,("X-Tenant-Id"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value)))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<OpportunityQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros do funil inválidos"))?
        .0;
    let ordering = crate::domains::list_sort::order_by(
        query.sort_by.as_deref(),
        query.sort_order.as_deref(),
        &[
            SortField::text("title", "o.data->>'title'"),
            SortField::text(
                "companyName",
                "COALESCE(p.legal_name,o.data->>'companyName')",
            ),
            SortField::text(
                "stage",
                "CASE o.data->>'stage' WHEN 'new' THEN 'Novo' WHEN 'contacted' THEN 'Contato feito' WHEN 'proposed' THEN 'Proposta enviada' WHEN 'negotiation' THEN 'Negociação' WHEN 'won' THEN 'Ganho' WHEN 'lost' THEN 'Perdido' ELSE o.data->>'stage' END",
            ),
            SortField::typed("estimatedCents", "(o.data->>'estimatedCents')::bigint"),
        ],
        "o.created_at DESC,o.id DESC",
        "o.id",
    )?;
    let q = query.q.unwrap_or_default();
    let stage = query.stage.unwrap_or_default();
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(100);
    if q.chars().count() > 160
        || q.chars().any(char::is_control)
        || offset > 100000
        || !(1..=100).contains(&limit)
        || ![
            "",
            "new",
            "contacted",
            "proposed",
            "negotiation",
            "won",
            "lost",
        ]
        .contains(&stage.as_str())
    {
        return Err(DomainError::Invalid(
            "Pesquisa, etapa ou paginação inválida",
        ));
    }
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let filter = "WHERE o.tenant_id=$1 AND ($2='' OR strpos(lower(concat(o.data->>'title',' ',o.data->>'companyName',' ',o.data->>'contactName',' ',p.legal_name)),lower($2))>0) AND ($3='' OR o.data->>'stage'=$3)";
    let data: Vec<Value> =
        sqlx::query_scalar(&format!("{SELECT} {filter} {ordering} LIMIT $4 OFFSET $5"))
            .bind(tenant)
            .bind(&q)
            .bind(&stage)
            .bind(i64::from(limit))
            .bind(i64::from(offset))
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
    let total:i64=sqlx::query_scalar(&format!("SELECT count(*) FROM sales_opportunities o LEFT JOIN parties p ON p.tenant_id=o.tenant_id AND p.id=o.customer_id {filter}")).bind(tenant).bind(&q).bind(&stage).fetch_one(&mut *tx).await.map_err(db)?;
    let totals:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('stage',data->>'stage','count',count(*),'estimatedCents',COALESCE(sum((data->>'estimatedCents')::bigint),0)) FROM sales_opportunities WHERE tenant_id=$1 GROUP BY data->>'stage'").bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":data,"total":total,"offset":offset,"limit":limit,"totals":totals}),
    ))
}

#[utoipa::path(get,path="/api/v1/opportunities/{id}",operation_id="get_sales_opportunity",tag="Sales",params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value)))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let data = load(&mut tx, tenant, id).await?;
    let rev = data["revision"].as_i64();
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        rev,
        json!({"tenantId":tenant,"canEdit":can_edit,"data":data}),
    ))
}

#[utoipa::path(post,path="/api/v1/opportunities",operation_id="create_sales_opportunity",tag="Sales",request_body=OpportunityInput,params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=201,body=Value)))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<OpportunityInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    write(state, identity, headers, None, payload).await
}

#[utoipa::path(put,path="/api/v1/opportunities/{id}",operation_id="update_sales_opportunity",tag="Sales",request_body=OpportunityInput,params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),security(("bearerAuth"=[])),responses((status=200,body=Value)))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    payload: Result<Json<OpportunityInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    write(state, identity, headers, Some(id), payload).await
}

async fn write(
    state: AppState,
    identity: AuthenticatedIdentity,
    headers: HeaderMap,
    id: Option<Uuid>,
    payload: Result<Json<OpportunityInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let key = command_key(&headers)?;
    let Json(input) = payload
        .map_err(|_| DomainError::Invalid("Oportunidade inválida ou campos desconhecidos"))?;
    input.validate()?;
    let expected = if id.is_some() {
        Some(revision(&headers)?)
    } else {
        None
    };
    let request = json!({"id":id,"revision":expected,"input":input});
    let scope = if id.is_some() {
        "opportunity.update"
    } else {
        "opportunity.create"
    };
    let status = if id.is_some() {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    if let Some(previous) = replay(&mut tx, tenant, &identity.subject, key, scope, &request).await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(status, rev, previous));
    }
    customer(&mut tx, tenant, input.customer_id).await?;
    let record_id = id.unwrap_or_else(Uuid::now_v7);
    if let Some(expected) = expected {
        let current = load(&mut tx, tenant, record_id).await?;
        if current["revision"].as_i64() != Some(expected) {
            return Err(DomainError::StaleRevision);
        }
        if !current["orderId"].is_null() && current["customerId"] != json!(input.customer_id) {
            return Err(DomainError::Conflict(
                "O cliente da oportunidade vinculada ao pedido deve ser preservado",
            ));
        }
        sqlx::query("UPDATE sales_opportunities SET customer_id=$3,data=$4,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(record_id).bind(input.customer_id).bind(json!(input)).execute(&mut *tx).await.map_err(db)?;
    } else {
        sqlx::query("INSERT INTO sales_opportunities(id,tenant_id,customer_id,data,created_by) SELECT $1,$2,$3,$4,id FROM identities WHERE auth_subject=$5").bind(record_id).bind(tenant).bind(input.customer_id).bind(json!(input)).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    }
    let data = load(&mut tx, tenant, record_id).await?;
    let rev = data["revision"].as_i64();
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "sales_opportunity",
            id: record_id,
            event: if id.is_some() {
                "opportunity.updated"
            } else {
                "opportunity.created"
            },
            details: json!({"revision":rev,"stage":input.stage}),
        },
    )
    .await?;
    let value = json!({"tenantId":tenant,"canEdit":true,"data":data});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        scope,
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(status, rev, value))
}

pub(super) async fn link_order(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    expected: i64,
    customer: Uuid,
    order: Uuid,
) -> Result<(), DomainError> {
    let current = load(tx, tenant, id).await?;
    if current["revision"].as_i64() != Some(expected) {
        return Err(DomainError::StaleRevision);
    }
    if !current["orderId"].is_null()
        || (!current["customerId"].is_null() && current["customerId"] != json!(customer))
    {
        return Err(DomainError::Conflict(
            "Oportunidade já vinculada ou com cliente diferente",
        ));
    }
    sqlx::query("UPDATE sales_opportunities SET customer_id=$3,order_id=$4,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(customer).bind(order).execute(&mut **tx).await.map_err(db)?;
    Ok(())
}
