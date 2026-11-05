use super::{auth::AuthenticatedIdentity, state::AppState};
use crate::domains::{DomainChange, DomainError, authorized, db, record, response, revision};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(FromRow, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowState {
    code: String,
    label: String,
    is_initial: bool,
    is_terminal: bool,
}

#[derive(FromRow, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowTransition {
    from_state: String,
    to_state: String,
    permission_code: String,
    requires_reason: bool,
}

#[derive(FromRow)]
struct WorkflowRow {
    id: Uuid,
    code: String,
    version: i32,
    name: String,
    status: String,
    revision: i64,
    created_at: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    id: Uuid,
    code: String,
    version: i32,
    name: String,
    status: String,
    revision: i64,
    created_at: String,
    states: Vec<WorkflowState>,
    transitions: Vec<WorkflowTransition>,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowStateInput {
    code: String,
    label: String,
    #[serde(default)]
    is_initial: bool,
    #[serde(default)]
    is_terminal: bool,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowTransitionInput {
    from_state: String,
    to_state: String,
    permission_code: String,
    #[serde(default = "default_requires_reason")]
    requires_reason: bool,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowInput {
    code: String,
    version: i32,
    name: String,
    states: Vec<WorkflowStateInput>,
    transitions: Vec<WorkflowTransitionInput>,
}

fn default_requires_reason() -> bool {
    true
}

fn valid_code(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some('a'..='z'))
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
        && value.len() <= 63
}

fn validate(input: &mut WorkflowInput) -> Result<(), DomainError> {
    input.code = input.code.trim().to_string();
    input.name = input.name.trim().to_string();
    if !valid_code(&input.code) {
        return Err(DomainError::Invalid("Código do fluxo inválido"));
    }
    if input.version < 1 || input.version > 9999 {
        return Err(DomainError::Invalid("Versão deve estar entre 1 e 9999"));
    }
    if input.name.is_empty() || input.name.len() > 120 || input.name.chars().any(char::is_control) {
        return Err(DomainError::Invalid(
            "Nome deve ter entre 1 e 120 caracteres",
        ));
    }
    if !(2..=32).contains(&input.states.len()) {
        return Err(DomainError::Invalid("Informe entre 2 e 32 estados"));
    }
    if !(1..=128).contains(&input.transitions.len()) {
        return Err(DomainError::Invalid("Informe entre 1 e 128 transições"));
    }
    let mut codes = HashSet::new();
    let mut initials = 0;
    let mut terminals = 0;
    for state in &mut input.states {
        state.code = state.code.trim().to_string();
        state.label = state.label.trim().to_string();
        if !valid_code(&state.code) || !codes.insert(state.code.clone()) {
            return Err(DomainError::Invalid(
                "Estados devem ter códigos válidos e únicos",
            ));
        }
        if state.label.is_empty()
            || state.label.len() > 120
            || state.label.chars().any(char::is_control)
        {
            return Err(DomainError::Invalid("Rótulo de estado inválido"));
        }
        initials += i32::from(state.is_initial);
        terminals += i32::from(state.is_terminal);
    }
    if initials != 1 || terminals == 0 {
        return Err(DomainError::Invalid(
            "Defina um estado inicial e ao menos um estado final",
        ));
    }
    let terminal_codes: HashSet<_> = input
        .states
        .iter()
        .filter(|state| state.is_terminal)
        .map(|state| state.code.as_str())
        .collect();
    let mut pairs = HashSet::new();
    for transition in &mut input.transitions {
        transition.from_state = transition.from_state.trim().to_string();
        transition.to_state = transition.to_state.trim().to_string();
        transition.permission_code = transition.permission_code.trim().to_string();
        if transition.from_state == transition.to_state
            || !codes.contains(&transition.from_state)
            || !codes.contains(&transition.to_state)
            || !pairs.insert((transition.from_state.clone(), transition.to_state.clone()))
        {
            return Err(DomainError::Invalid(
                "Transições devem ligar estados distintos e não podem se repetir",
            ));
        }
        if terminal_codes.contains(transition.from_state.as_str()) {
            return Err(DomainError::Invalid(
                "Estados finais não podem ter transições de saída",
            ));
        }
        if transition.permission_code.is_empty() || transition.permission_code.len() > 120 {
            return Err(DomainError::Invalid("Permissão da transição inválida"));
        }
    }
    Ok(())
}

async fn load(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    only: Option<Uuid>,
) -> Result<Vec<Workflow>, DomainError> {
    let rows: Vec<WorkflowRow> = sqlx::query_as("SELECT id,code,version,name,status,revision,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') created_at FROM system_config.workflow_definitions WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY code,version DESC,id")
        .bind(tenant).bind(only).fetch_all(&mut **tx).await.map_err(db)?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let states = sqlx::query_as("SELECT code,label,is_initial,is_terminal FROM system_config.workflow_states WHERE tenant_id=$1 AND workflow_id=$2 ORDER BY is_initial DESC,code")
            .bind(tenant).bind(row.id).fetch_all(&mut **tx).await.map_err(db)?;
        let transitions = sqlx::query_as("SELECT from_state,to_state,permission_code,requires_reason FROM system_config.workflow_transitions WHERE tenant_id=$1 AND workflow_id=$2 ORDER BY from_state,to_state")
            .bind(tenant).bind(row.id).fetch_all(&mut **tx).await.map_err(db)?;
        result.push(Workflow {
            id: row.id,
            code: row.code,
            version: row.version,
            name: row.name,
            status: row.status,
            revision: row.revision,
            created_at: row.created_at,
            states,
            transitions,
        });
    }
    Ok(result)
}

async fn replace_children(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    id: Uuid,
    input: &WorkflowInput,
) -> Result<(), DomainError> {
    let permissions: Vec<String> =
        sqlx::query_scalar("SELECT code FROM permissions WHERE code = ANY($1)")
            .bind(
                input
                    .transitions
                    .iter()
                    .map(|item| item.permission_code.clone())
                    .collect::<Vec<_>>(),
            )
            .fetch_all(&mut **tx)
            .await
            .map_err(db)?;
    if permissions.len()
        != input
            .transitions
            .iter()
            .map(|item| &item.permission_code)
            .collect::<HashSet<_>>()
            .len()
    {
        return Err(DomainError::Invalid("Uma ou mais permissões não existem"));
    }
    sqlx::query(
        "DELETE FROM system_config.workflow_transitions WHERE tenant_id=$1 AND workflow_id=$2",
    )
    .bind(tenant)
    .bind(id)
    .execute(&mut **tx)
    .await
    .map_err(db)?;
    sqlx::query("DELETE FROM system_config.workflow_states WHERE tenant_id=$1 AND workflow_id=$2")
        .bind(tenant)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(db)?;
    for state in &input.states {
        sqlx::query("INSERT INTO system_config.workflow_states(tenant_id,workflow_id,code,label,is_initial,is_terminal) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(tenant).bind(id).bind(&state.code).bind(&state.label).bind(state.is_initial).bind(state.is_terminal).execute(&mut **tx).await.map_err(db)?;
    }
    for transition in &input.transitions {
        sqlx::query("INSERT INTO system_config.workflow_transitions(tenant_id,workflow_id,from_state,to_state,permission_code,requires_reason) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(tenant).bind(id).bind(&transition.from_state).bind(&transition.to_state).bind(&transition.permission_code).bind(transition.requires_reason).execute(&mut **tx).await.map_err(db)?;
    }
    Ok(())
}

#[utoipa::path(get,path="/api/v1/system/workflows",tag="Platform",security(("bearerAuth"=[])),responses((status=200,body=serde_json::Value),(status=403,description="Sem permissão")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "system.workflows.manage",
        "system.workflows.manage",
        false,
    )
    .await?;
    let data = load(&mut tx, tenant, None).await?;
    let permissions:Vec<serde_json::Value>=sqlx::query_scalar("SELECT jsonb_build_object('code',code,'description',description) FROM permissions ORDER BY code").fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"data":data,"permissions":permissions,"canEdit":can_edit}),
    ))
}

#[utoipa::path(post,path="/api/v1/system/workflows",tag="Platform",security(("bearerAuth"=[])),request_body=WorkflowInput,responses((status=201,body=Workflow),(status=409,description="Versão já existente"),(status=422,description="Dados inválidos")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<WorkflowInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.workflows.manage",
        "system.workflows.manage",
        true,
    )
    .await?;
    let Json(mut input) = payload
        .map_err(|_| DomainError::Invalid("Fluxo inválido ou contém campos desconhecidos"))?;
    validate(&mut input)?;
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM system_config.workflow_definitions WHERE tenant_id=$1 AND code=$2 AND version=$3)").bind(tenant).bind(&input.code).bind(input.version).fetch_one(&mut *tx).await.map_err(db)?;
    if exists {
        return Err(DomainError::Conflict("Já existe esta versão do fluxo"));
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO system_config.workflow_definitions(tenant_id,id,code,version,name) VALUES($1,$2,$3,$4,$5)").bind(tenant).bind(id).bind(&input.code).bind(input.version).bind(&input.name).execute(&mut *tx).await.map_err(db)?;
    replace_children(&mut tx, tenant, id, &input).await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "workflow",
            id,
            event: "workflow.created",
            details: json!({"code":input.code,"version":input.version}),
        },
    )
    .await?;
    let data = load(&mut tx, tenant, Some(id))
        .await?
        .pop()
        .ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::CREATED,
        Some(data.revision),
        json!({"tenantId":tenant,"data":data}),
    ))
}

#[utoipa::path(put,path="/api/v1/system/workflows/{id}",tag="Platform",security(("bearerAuth"=[])),request_body=WorkflowInput,responses((status=200,body=Workflow),(status=409,description="Somente rascunhos podem ser editados"),(status=412,description="Revisão alterada")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    payload: Result<Json<WorkflowInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.workflows.manage",
        "system.workflows.manage",
        true,
    )
    .await?;
    let Json(mut input) = payload
        .map_err(|_| DomainError::Invalid("Fluxo inválido ou contém campos desconhecidos"))?;
    validate(&mut input)?;
    let current:Option<(String,i32,String,i64)>=sqlx::query_as("SELECT code,version,status,revision FROM system_config.workflow_definitions WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
    let Some((code, version, status, current_revision)) = current else {
        return Err(DomainError::NotFound);
    };
    if status != "draft" {
        return Err(DomainError::Conflict(
            "Somente rascunhos podem ser editados",
        ));
    }
    if current_revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if code != input.code || version != input.version {
        return Err(DomainError::Invalid(
            "Código e versão não podem ser alterados",
        ));
    }
    sqlx::query("UPDATE system_config.workflow_definitions SET name=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(&input.name).execute(&mut *tx).await.map_err(db)?;
    replace_children(&mut tx, tenant, id, &input).await?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "workflow",
            id,
            event: "workflow.updated",
            details: json!({"revision":expected+1}),
        },
    )
    .await?;
    let data = load(&mut tx, tenant, Some(id))
        .await?
        .pop()
        .ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data.revision),
        json!({"tenantId":tenant,"data":data}),
    ))
}

async fn change_status(
    state: AppState,
    identity: AuthenticatedIdentity,
    id: Uuid,
    headers: HeaderMap,
    target: &'static str,
    event: &'static str,
) -> Result<Response, DomainError> {
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "system.workflows.manage",
        "system.workflows.manage",
        true,
    )
    .await?;
    let current: Option<(String, String, i64)> = sqlx::query_as("SELECT code,status,revision FROM system_config.workflow_definitions WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
    let Some((code, status, current_revision)) = current else {
        return Err(DomainError::NotFound);
    };
    if current_revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if (target == "published" && status != "draft")
        || (target == "archived" && status != "published")
    {
        return Err(DomainError::Conflict("Transição de situação não permitida"));
    }
    if target == "published" {
        let published: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM system_config.workflow_definitions WHERE tenant_id=$1 AND code=$2 AND status='published' AND id<>$3)")
            .bind(tenant).bind(code).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
        if published {
            return Err(DomainError::Conflict(
                "Arquive a versão publicada antes de publicar outra",
            ));
        }
    }
    let changed=sqlx::query("UPDATE system_config.workflow_definitions SET status=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2 AND revision=$4").bind(tenant).bind(id).bind(target).bind(expected).execute(&mut *tx).await.map_err(db)?.rows_affected();
    if changed == 0 {
        return Err(DomainError::StaleRevision);
    }
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "workflow",
            id,
            event,
            details: json!({"status":target,"revision":expected+1}),
        },
    )
    .await?;
    let data = load(&mut tx, tenant, Some(id))
        .await?
        .pop()
        .ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data.revision),
        json!({"tenantId":tenant,"data":data}),
    ))
}

#[utoipa::path(post,path="/api/v1/system/workflows/{id}/publish",tag="Platform",security(("bearerAuth"=[])),responses((status=200,body=Workflow),(status=409,description="Fluxo inválido para publicação"),(status=412,description="Revisão alterada")))]
pub async fn publish(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    change_status(
        state,
        identity,
        id,
        headers,
        "published",
        "workflow.published",
    )
    .await
}

#[utoipa::path(post,path="/api/v1/system/workflows/{id}/archive",tag="Platform",security(("bearerAuth"=[])),responses((status=200,body=Workflow),(status=409,description="Somente fluxos publicados podem ser arquivados"),(status=412,description="Revisão alterada")))]
pub async fn archive(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    change_status(
        state,
        identity,
        id,
        headers,
        "archived",
        "workflow.archived",
    )
    .await
}
