//! Employee payroll proposals, approval and liabilities. All money remains a manual declaration.
use super::{
    DomainChange, DomainError, authorized, command_key, db, fixed, record, remember, replay,
    response, revision, sales,
};
use crate::platform::{access, auth::AuthenticatedIdentity, state::AppState};
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
use time::{Date, Weekday};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

const READ: &str = "finance.staff.read";
const MANAGE: &str = "finance.staff.manage";
const APPROVE: &str = "finance.staff.approve";

#[derive(Clone, Default, Deserialize, Serialize, ToSchema)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct PayrollSettings {
    pub salary: String,
    pub pix_type: String,
    pub pix_key: String,
    pub recurring: bool,
    pub business_day: u8,
    pub starts_on: String,
    pub excluded_dates: Vec<String>,
    pub bank: String,
    pub branch: String,
    pub account: String,
}
impl PayrollSettings {
    fn validate(&self) -> Result<(), DomainError> {
        if fixed(&self.salary, 2)? <= 0 {
            return Err(DomainError::Invalid("Informe um salário positivo"));
        }
        if ![1, 5].contains(&self.business_day) {
            return Err(DomainError::Invalid(
                "Escolha o primeiro ou quinto dia útil",
            ));
        }
        sales::date(&self.starts_on)?;
        if self.excluded_dates.len() > 366 {
            return Err(DomainError::Invalid("Calendário muito grande"));
        }
        for d in &self.excluded_dates {
            sales::date(d)?;
        }
        for s in [&self.pix_key, &self.bank, &self.branch, &self.account] {
            if s.chars().count() > 200 || s.chars().any(char::is_control) {
                return Err(DomainError::Invalid("Dados de pagamento inválidos"));
            }
        }
        if !["cpf", "cnpj", "email", "phone", "random", ""].contains(&self.pix_type.as_str())
            || self.pix_type.is_empty() != self.pix_key.is_empty()
        {
            return Err(DomainError::Invalid("Confira o tipo e a chave Pix"));
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OneOff {
    pub amount: String,
    pub due_date: String,
    pub category: String,
    #[serde(default)]
    pub note: String,
}
impl OneOff {
    fn validate(&self) -> Result<(), DomainError> {
        if fixed(&self.amount, 2)? <= 0 {
            return Err(DomainError::Invalid("Informe um valor positivo"));
        }
        sales::date(&self.due_date)?;
        if self.category.trim().is_empty()
            || self.category.chars().count() > 120
            || self.note.chars().count() > 500
            || self
                .category
                .chars()
                .chain(self.note.chars())
                .any(char::is_control)
        {
            return Err(DomainError::Invalid("Categoria ou observação inválida"));
        }
        Ok(())
    }
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Proposal {
    Settings {
        settings: PayrollSettings,
        #[serde(rename = "baseRevision")]
        base_revision: i64,
    },
    Payment {
        payment: OneOff,
    },
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Review {
    pub approve: bool,
    pub reason: String,
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Generate {
    pub month: String,
}
#[derive(Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PayrollQuery {
    pub status: Option<String>,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

async fn rights(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    identity: &AuthenticatedIdentity,
    permission: &str,
) -> Result<bool, DomainError> {
    let r = access::load_access(tx, tenant, &identity.subject).await?;
    Ok(access::require_permission(&r, permission).is_ok())
}
async fn employee(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    active: bool,
) -> Result<String, DomainError> {
    let row = sqlx::query_as::<_, (String, String, bool)>(
        "SELECT name,status,is_employee FROM staff WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    if active && (row.1 != "active" || !row.2) {
        return Err(DomainError::Conflict("Pagamento exige funcionário ativo"));
    }
    Ok(row.0)
}
async fn settings(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<(i64, Value), DomainError> {
    Ok(sqlx::query_as::<_, (i64, Value)>(
        "SELECT revision,settings FROM staff_payroll_profiles WHERE tenant_id=$1 AND staff_id=$2",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(db)?
    .unwrap_or((0, json!(null))))
}
const REQUESTS: &str = "SELECT jsonb_build_object('id',r.id,'staffId',r.staff_id,'name',s.name,'kind',r.kind,'payload',r.payload,'baseRevision',r.base_revision,'revision',r.revision,'status',r.status,'requestedBy',r.requested_by,'reviewedBy',r.reviewed_by,'reason',r.review_reason,'createdAt',r.created_at,'reviewedAt',r.reviewed_at) FROM staff_payroll_requests r JOIN staff s ON s.tenant_id=r.tenant_id AND s.id=r.staff_id";
async fn detail(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
    can_edit: bool,
    can_approve: bool,
) -> Result<Value, DomainError> {
    let name = employee(tx, tenant, id, false).await?;
    let (revision, config) = settings(tx, tenant, id).await?;
    let requests:Vec<Value>=sqlx::query_scalar(&format!("{REQUESTS} WHERE r.tenant_id=$1 AND r.staff_id=$2 ORDER BY r.created_at DESC,r.id DESC LIMIT 100")).bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?;
    let payments:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',p.id,'revision',p.revision,'kind',o.kind,'competence',o.competence::text,'category',o.category,'note',o.note,'dueDate',p.due_date::text,'amount',(p.amount_cents::numeric/100)::numeric(16,2)::text,'paidAmount',(totals.paid::numeric/100)::numeric(16,2)::text,'status',p.status) FROM staff_payroll_obligations o JOIN payables p ON p.tenant_id=o.tenant_id AND p.staff_obligation_id=o.id CROSS JOIN LATERAL (SELECT COALESCE(sum(CASE WHEN x.kind='payment' THEN x.amount_cents ELSE -x.amount_cents END),0)::bigint AS paid FROM payable_payments x WHERE x.tenant_id=p.tenant_id AND x.payable_id=p.id) totals WHERE o.tenant_id=$1 AND o.staff_id=$2 ORDER BY p.due_date DESC,p.id DESC LIMIT 200").bind(tenant).bind(id).fetch_all(&mut **tx).await.map_err(db)?;
    Ok(
        json!({"tenantId":tenant,"staffId":id,"name":name,"revision":revision,"canEdit":can_edit,"canApprove":can_approve,"settings":config,"requests":requests,"payments":payments}),
    )
}
#[utoipa::path(get,path="/api/v1/staff/{id}/payroll",tag="StaffPayroll",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão financeira")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let approve = rights(&mut tx, tenant, &identity, APPROVE).await?;
    let v = detail(&mut tx, tenant, id, edit, approve).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, v["revision"].as_i64(), v))
}
#[utoipa::path(get,path="/api/v1/staff-payroll",tag="StaffPayroll",security(("bearerAuth"=[])),params(PayrollQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem permissão financeira")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<PayrollQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let q = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let status = q.status.unwrap_or("pending".into());
    if !["pending", "approved", "rejected", "cancelled", "all"].contains(&status.as_str()) {
        return Err(DomainError::Invalid("Situação inválida"));
    }
    let offset = q.offset.unwrap_or(0);
    let limit = q.limit.unwrap_or(25);
    if !(1..=100).contains(&limit) || offset > 10000 {
        return Err(DomainError::Invalid("Paginação inválida"));
    }
    let (tenant, mut tx, edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let approve = rights(&mut tx, tenant, &identity, APPROVE).await?;
    let rows:Vec<Value>=sqlx::query_scalar(&format!("{REQUESTS} WHERE r.tenant_id=$1 AND ($2='all' OR r.status=$2) ORDER BY r.created_at DESC,r.id DESC LIMIT $3 OFFSET $4")).bind(tenant).bind(&status).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut *tx).await.map_err(db)?;
    let total:i64=sqlx::query_scalar("SELECT count(*) FROM staff_payroll_requests WHERE tenant_id=$1 AND ($2='all' OR status=$2)").bind(tenant).bind(status).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":edit,"canApprove":approve,"data":rows,"total":total,"offset":offset,"limit":limit}),
    ))
}
#[utoipa::path(post,path="/api/v1/staff/{id}/payroll/requests",tag="StaffPayroll",request_body=Proposal,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=Value),(status=403,description="Sem permissão"),(status=409,description="Proposta desatualizada")))]
pub async fn propose(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<Proposal>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let Json(input) = payload.map_err(|_| DomainError::Invalid("Proposta inválida"))?;
    let request = json!({"staffId":id,"proposal":input});
    if let Some(v) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "staff.payroll.propose",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, Some(1), v));
    }
    employee(&mut tx, tenant, id, true).await?;
    let (base, kind, value) = match &input {
        Proposal::Settings {
            settings: s,
            base_revision,
        } => {
            s.validate()?;
            if settings(&mut tx, tenant, id).await?.0 != *base_revision {
                return Err(DomainError::StaleRevision);
            }
            (*base_revision, "settings", json!(s))
        }
        Proposal::Payment { payment: p } => {
            p.validate()?;
            (0, "payment", json!(p))
        }
    };
    let rid = Uuid::now_v7();
    sqlx::query("INSERT INTO staff_payroll_requests(id,tenant_id,staff_id,kind,payload,base_revision,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(rid).bind(tenant).bind(id).bind(kind).bind(value).bind(base).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "staff_payroll_request",
            id: rid,
            event: "staff.payroll.proposed",
            details: json!({"staffId":id,"kind":kind}),
        },
    )
    .await?;
    let v = json!({"id":rid,"revision":1,"status":"pending"});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "staff.payroll.propose",
        &request,
        &v,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), v))
}
fn month(raw: &str) -> Result<Date, DomainError> {
    if raw.len() != 7 {
        return Err(DomainError::Invalid(
            "Informe a competência no formato AAAA-MM",
        ));
    }
    sales::date(&format!("{raw}-01"))
}
fn due_date(first: Date, settings: &PayrollSettings) -> Result<Date, DomainError> {
    let mut d = first;
    let mut count = 0;
    for _ in 0..31 {
        if !matches!(d.weekday(), Weekday::Saturday | Weekday::Sunday)
            && !settings.excluded_dates.contains(&d.to_string())
        {
            count += 1;
        }
        if count == settings.business_day {
            return Ok(d);
        }
        d = d
            .next_day()
            .ok_or(DomainError::Invalid("Data fora do limite"))?;
        if d.month() != first.month() {
            break;
        }
    }
    Err(DomainError::Invalid(
        "Calendário sem dias úteis suficientes",
    ))
}
async fn originate(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    staff: Uuid,
    request: Uuid,
    competence: Date,
    kind: &str,
    payment: &OneOff,
) -> Result<Uuid, DomainError> {
    let name = employee(tx, tenant, staff, true).await?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO staff_payroll_obligations(id,tenant_id,staff_id,source_request_id,competence,kind,category,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(id).bind(tenant).bind(staff).bind(request).bind(competence).bind(kind).bind(&payment.category).bind(&payment.note).execute(&mut **tx).await.map_err(db)?;
    super::payables::originate_staff(
        tx,
        tenant,
        id,
        &name,
        sales::date(&payment.due_date)?,
        fixed(&payment.amount, 2)?,
    )
    .await
}
async fn generate_for(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    staff: Uuid,
    request: Uuid,
    first: Date,
    s: &PayrollSettings,
) -> Result<bool, DomainError> {
    if !s.recurring
        || first
            < sales::date(&s.starts_on)?
                .replace_day(1)
                .map_err(|_| DomainError::Invalid("Data inválida"))?
    {
        return Ok(false);
    }
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM staff_payroll_obligations WHERE tenant_id=$1 AND staff_id=$2 AND competence=$3 AND kind='salary')").bind(tenant).bind(staff).bind(first).fetch_one(&mut **tx).await.map_err(db)?;
    if exists {
        return Ok(false);
    }
    let due = due_date(first, s)?;
    originate(
        tx,
        tenant,
        staff,
        request,
        first,
        "salary",
        &OneOff {
            amount: s.salary.clone(),
            due_date: due.to_string(),
            category: "Salário".into(),
            note: format!("Salário · {}", first),
        },
    )
    .await?;
    Ok(true)
}
#[utoipa::path(post,path="/api/v1/staff-payroll/requests/{id}/review",tag="StaffPayroll",request_body=Review,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem autorização de aprovação"),(status=412,description="Revisão desatualizada")))]
pub async fn review(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<Review>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, APPROVE, true).await?;
    let Json(input) = payload.map_err(|_| DomainError::Invalid("Revisão inválida"))?;
    if input.reason.trim().chars().count() < 3
        || input.reason.chars().count() > 500
        || input.reason.chars().any(char::is_control)
    {
        return Err(DomainError::Invalid(
            "Informe o motivo da decisão (3 a 500 caracteres)",
        ));
    }
    let request =
        json!({"id":id,"revision":expected,"approve":input.approve,"reason":input.reason});
    if let Some(v) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "staff.payroll.review",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, v["revision"].as_i64(), v));
    }
    let (staff,kind,payload,base,rev,status)=sqlx::query_as::<_,(Uuid,String,Value,i64,i64,String)>("SELECT staff_id,kind,payload,base_revision,revision,status FROM staff_payroll_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if rev != expected {
        return Err(DomainError::StaleRevision);
    }
    if status != "pending" {
        return Err(DomainError::Conflict("Solicitação já decidida"));
    }
    if input.approve {
        employee(&mut tx, tenant, staff, true).await?;
        if kind == "settings" {
            let s: PayrollSettings = serde_json::from_value(payload.clone())
                .map_err(|_| DomainError::Invalid("Configuração inválida"))?;
            s.validate()?;
            if settings(&mut tx, tenant, staff).await?.0 != base {
                return Err(DomainError::Conflict(
                    "Salário ou Pix mudou. Envie uma proposta atualizada",
                ));
            }
            sqlx::query("INSERT INTO staff_payroll_profiles(tenant_id,staff_id,revision,settings) VALUES($1,$2,1,$3) ON CONFLICT(tenant_id,staff_id) DO UPDATE SET settings=$3,revision=staff_payroll_profiles.revision+1,updated_at=now()").bind(tenant).bind(staff).bind(payload).execute(&mut *tx).await.map_err(db)?;
            // Refresh only untouched future salary liabilities. Paid/part-paid history is immutable.
            let rows=sqlx::query_as::<_,(Uuid,Date)>("SELECT p.id,o.competence FROM payables p JOIN staff_payroll_obligations o ON o.tenant_id=p.tenant_id AND o.id=p.staff_obligation_id WHERE p.tenant_id=$1 AND o.staff_id=$2 AND o.kind='salary' AND p.status='open' AND p.due_date >= CURRENT_DATE AND NOT EXISTS(SELECT 1 FROM payable_payments x WHERE x.tenant_id=p.tenant_id AND x.payable_id=p.id)").bind(tenant).bind(staff).fetch_all(&mut *tx).await.map_err(db)?;
            for (pid, competence) in rows {
                if s.recurring && competence >= sales::date(&s.starts_on)?.replace_day(1).unwrap() {
                    super::payables::revise_staff_title(
                        &mut tx,
                        tenant,
                        pid,
                        fixed(&s.salary, 2)?,
                        due_date(competence, &s)?,
                    )
                    .await?;
                } else {
                    super::payables::cancel_staff_title(&mut tx, tenant, pid).await?;
                }
            }
            let today = time::OffsetDateTime::now_utc()
                .to_offset(time::UtcOffset::from_hms(-3, 0, 0).unwrap())
                .date();
            generate_for(
                &mut tx,
                tenant,
                staff,
                id,
                today.replace_day(1).unwrap(),
                &s,
            )
            .await?;
        } else {
            let p: OneOff = serde_json::from_value(payload)
                .map_err(|_| DomainError::Invalid("Pagamento inválido"))?;
            p.validate()?;
            let date = sales::date(&p.due_date)?;
            originate(
                &mut tx,
                tenant,
                staff,
                id,
                date.replace_day(1).unwrap(),
                "one_off",
                &p,
            )
            .await?;
        }
    }
    let status = if input.approve {
        "approved"
    } else {
        "rejected"
    };
    sqlx::query("UPDATE staff_payroll_requests SET status=$3,revision=revision+1,reviewed_by=$4,review_reason=$5,reviewed_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(status).bind(&identity.subject).bind(&input.reason).execute(&mut *tx).await.map_err(db)?;
    let v = json!({"id":id,"revision":rev+1,"status":status});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "staff_payroll_request",
            id,
            event: "staff.payroll.reviewed",
            details: json!({"staffId":staff,"status":status,"reason":input.reason}),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "staff.payroll.review",
        &request,
        &v,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(rev + 1), v))
}
#[utoipa::path(post,path="/api/v1/staff-payroll/generate",tag="StaffPayroll",request_body=Generate,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=200,body=Value),(status=403,description="Sem autorização")))]
pub async fn generate(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<Generate>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, APPROVE, true).await?;
    let Json(input) = payload.map_err(|_| DomainError::Invalid("Competência inválida"))?;
    let first = month(&input.month)?;
    let today = time::OffsetDateTime::now_utc().date();
    let max = today.year() + 1;
    if first.year() < today.year() - 1 || first.year() > max {
        return Err(DomainError::Invalid(
            "Competência fora do intervalo permitido",
        ));
    }
    let request = json!({"month":input.month});
    if let Some(v) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "staff.payroll.generate",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, Some(1), v));
    }
    let count = generate_month(&mut tx, tenant, first).await?;
    let v = json!({"month":input.month,"created":count});
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "staff_payroll",
            id: tenant,
            event: "staff.payroll.generated",
            details: v.clone(),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "staff.payroll.generate",
        &request,
        &v,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(1), v))
}
async fn generate_month(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    first: Date,
) -> Result<u32, DomainError> {
    let rows=sqlx::query_as::<_,(Uuid,Value,Uuid)>("SELECT p.staff_id,p.settings,(SELECT r.id FROM staff_payroll_requests r WHERE r.tenant_id=p.tenant_id AND r.staff_id=p.staff_id AND r.kind='settings' AND r.status='approved' ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1) AS request_id FROM staff_payroll_profiles p JOIN staff s ON s.tenant_id=p.tenant_id AND s.id=p.staff_id WHERE p.tenant_id=$1 AND s.status='active' AND s.is_employee AND p.settings->>'recurring'='true' ORDER BY p.staff_id").bind(tenant).fetch_all(&mut **tx).await.map_err(db)?;
    let mut count = 0;
    for (staff, payload, request) in rows {
        let s: PayrollSettings = serde_json::from_value(payload)
            .map_err(|_| DomainError::Invalid("Configuração inválida"))?;
        if generate_for(tx, tenant, staff, request, first, &s).await? {
            count += 1;
        }
    }
    Ok(count)
}
/// Called inside staff update's transaction: no route can bypass the financial approval gate.
pub async fn archive(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    staff: Uuid,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
) -> Result<(), DomainError> {
    let has_payroll:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM staff_payroll_profiles WHERE tenant_id=$1 AND staff_id=$2) OR EXISTS(SELECT 1 FROM staff_payroll_requests WHERE tenant_id=$1 AND staff_id=$2)").bind(tenant).bind(staff).fetch_one(&mut **tx).await.map_err(db)?;
    if !has_payroll {
        return Ok(());
    }
    if !rights(tx, tenant, identity, APPROVE).await? {
        return Err(access::AccessError::Forbidden.into());
    }
    let ids:Vec<Uuid>=sqlx::query_scalar("SELECT p.id FROM payables p JOIN staff_payroll_obligations o ON o.tenant_id=p.tenant_id AND o.id=p.staff_obligation_id WHERE p.tenant_id=$1 AND o.staff_id=$2 AND p.status='open'").bind(tenant).bind(staff).fetch_all(&mut **tx).await.map_err(db)?;
    for id in &ids {
        super::payables::cancel_staff_title(tx, tenant, *id).await?;
    }
    sqlx::query("UPDATE staff_payroll_profiles SET settings=jsonb_set(settings,'{recurring}','false'),revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND staff_id=$2").bind(tenant).bind(staff).execute(&mut **tx).await.map_err(db)?;
    sqlx::query("UPDATE staff_payroll_requests SET status='cancelled',revision=revision+1,reviewed_by=$3,review_reason='Funcionário desligado',reviewed_at=now() WHERE tenant_id=$1 AND staff_id=$2 AND status='pending'").bind(tenant).bind(staff).bind(&identity.subject).execute(&mut **tx).await.map_err(db)?;
    record(
        tx,
        tenant,
        identity,
        headers,
        DomainChange {
            kind: "staff",
            id: staff,
            event: "staff.payroll.stopped",
            details: json!({"cancelledTitles":ids.len(),"paidHistoryPreserved":true}),
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn business_days_skip_weekends_and_explicit_holidays() {
        let s = PayrollSettings {
            business_day: 5,
            excluded_dates: vec!["2026-11-02".into()],
            ..Default::default()
        };
        assert_eq!(
            due_date(month("2026-11").unwrap(), &s).unwrap().to_string(),
            "2026-11-09"
        );
        assert!(month("2026-13").is_err());
    }
}

/// Hourly reconciliation of the current month. Unique origin and tenant lock make replicas safe.
pub fn start_worker(state: AppState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(error) = worker_tick(&state).await {
                tracing::error!(
                    ?error,
                    "staff payroll recurrence failed; next reconciliation will retry"
                );
            }
        }
    })
}
async fn worker_tick(state: &AppState) -> Result<(), DomainError> {
    let tenants: Vec<Uuid> = sqlx::query_scalar("SELECT * FROM erp_staff_payroll_due_tenants()")
        .fetch_all(&state.database)
        .await
        .map_err(db)?;
    let today = time::OffsetDateTime::now_utc()
        .to_offset(time::UtcOffset::from_hms(-3, 0, 0).unwrap())
        .date();
    for tenant in tenants {
        let mut tx = access::tenant_transaction(state, tenant).await?;
        sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
            .bind(tenant)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        let count = generate_month(&mut tx, tenant, today.replace_day(1).unwrap()).await?;
        if count > 0 {
            let data = json!({"source":"approved-payroll-recurrence","month":format!("{}-{:02}",today.year(),u8::from(today.month())),"created":count});
            sqlx::query("INSERT INTO audit_log(tenant_id,action,entity_type,entity_id,details) VALUES($1,'staff.payroll.generated','staff_payroll',$1::text,$2)").bind(tenant).bind(&data).execute(&mut *tx).await.map_err(db)?;
            sqlx::query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'staff_payroll',$1::text,'staff.payroll.generated',$2)").bind(tenant).bind(&data).execute(&mut *tx).await.map_err(db)?;
        }
        tx.commit().await.map_err(db)?;
    }
    Ok(())
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SalaryChange {
    pub staff_id: Uuid,
    pub base_revision: i64,
    pub salary: String,
}
#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SalaryBatch {
    pub changes: Vec<SalaryChange>,
}
#[utoipa::path(post,path="/api/v1/staff-payroll/salaries",tag="StaffPayroll",request_body=SalaryBatch,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=Value),(status=403,description="Sem permissão"),(status=412,description="Revisão salarial mudou")))]
pub async fn salaries(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<SalaryBatch>, JsonRejection>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let Json(input) = payload.map_err(|_| DomainError::Invalid("Alterações inválidas"))?;
    if input.changes.is_empty() || input.changes.len() > 100 {
        return Err(DomainError::Invalid("Selecione de 1 a 100 funcionários"));
    }
    let request = json!(input);
    if let Some(v) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "staff.payroll.salaries",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, Some(1), v));
    }
    let mut seen = std::collections::HashSet::new();
    let mut ids = Vec::new();
    for change in input.changes {
        if !seen.insert(change.staff_id) {
            return Err(DomainError::Invalid("Funcionário repetido no lote"));
        }
        employee(&mut tx, tenant, change.staff_id, true).await?;
        let (rev, current) = settings(&mut tx, tenant, change.staff_id).await?;
        if rev != change.base_revision {
            return Err(DomainError::StaleRevision);
        }
        let mut s: PayrollSettings = serde_json::from_value(current).map_err(|_| {
            DomainError::Conflict(
                "Configure e aprove o salário inicial antes de usar a atualização em lote",
            )
        })?;
        s.salary = change.salary;
        s.validate()?;
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO staff_payroll_requests(id,tenant_id,staff_id,kind,payload,base_revision,requested_by) VALUES($1,$2,$3,'settings',$4,$5,$6)").bind(id).bind(tenant).bind(change.staff_id).bind(json!(s)).bind(rev).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
        record(
            &mut tx,
            tenant,
            &identity,
            &headers,
            DomainChange {
                kind: "staff_payroll_request",
                id,
                event: "staff.payroll.proposed",
                details: json!({"staffId":change.staff_id,"kind":"settings","batch":key}),
            },
        )
        .await?;
        ids.push(id);
    }
    let v = json!({"ids":ids,"revision":1,"status":"pending"});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "staff.payroll.salaries",
        &request,
        &v,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), v))
}
