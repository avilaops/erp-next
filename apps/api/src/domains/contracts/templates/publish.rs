use super::*;
use reqwest::Method;

#[utoipa::path(post,path="/api/v1/contract-template-drafts/{id}/publish",operation_id="template_publish",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=super::super::api::TemplatePublishResult),(status=403),(status=409),(status=412),(status=422),(status=428)))]
pub async fn publish(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let rev = revision(&headers)?;
    let provider = super::super::provider(&state)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("template:{tenant}:{id}"))
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let request = json!({"id":id,"revision":rev});
    let previous = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "template.publish",
        &request,
    )
    .await?;
    let version_id = if let Some(previous) = previous {
        previous["id"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .ok_or(DomainError::NotFound)?
    } else {
        let (definition,pdf,current):(Value,Vec<u8>,i64) = sqlx::query_as("SELECT definition,pdf,revision FROM commercial_template_drafts WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
        if current != rev {
            return Err(DomainError::StaleRevision);
        }
        let parsed: Definition = serde_json::from_value(definition.clone())
            .map_err(|_| DomainError::Invalid("Modelo inválido"))?;
        parsed.validate()?;
        if parsed.roles.iter().any(|role| {
            !parsed
                .fields
                .iter()
                .any(|field| field.role == *role && field.kind == "signature" && field.required)
        }) {
            return Err(DomainError::Invalid(
                "Inclua uma assinatura obrigatória para cada participante",
            ));
        }
        let raw = definition.to_string();
        let hash = super::super::model::digest(
            format!("{}:{raw}", super::super::model::digest(&pdf)).as_bytes(),
        );
        let version_id:Uuid = sqlx::query_scalar("INSERT INTO commercial_template_versions(tenant_id,id,draft_id,draft_revision,definition_json,pdf,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,draft_id,draft_revision) DO UPDATE SET draft_id=EXCLUDED.draft_id RETURNING id")
            .bind(tenant).bind(Uuid::now_v7()).bind(id).bind(rev).bind(raw).bind(pdf).bind(hash).fetch_one(&mut *tx).await.map_err(db)?;
        remember(
            &mut tx,
            tenant,
            &identity.subject,
            key,
            "template.publish",
            &request,
            &json!({"id":version_id}),
        )
        .await?;
        version_id
    };
    let (raw,pdf,hash,external):(String,Vec<u8>,String,Option<i64>) = sqlx::query_as("SELECT definition_json,pdf,request_hash,external_id FROM commercial_template_versions WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(version_id).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    if let Some(external) = external {
        return Ok(response(
            StatusCode::OK,
            Some(rev),
            json!({"id":version_id,"externalId":external,"revision":rev,"status":"published"}),
        ));
    }
    // Every retry reconciles before sending. The portal serializes this publication
    // identifier, including when a previous request is still running after a timeout.
    let path = format!("avila/templates/{version_id}");
    let mut confirmed = provider.request(Method::GET, &path, None).await?;
    if confirmed["found"] == false {
        confirmed = provider
            .request(
                Method::POST,
                &path,
                Some(&json!({"definitionJson":raw,"pdfBase64":STANDARD.encode(pdf)})),
            )
            .await?;
    }
    if confirmed["found"] != true
        || confirmed["requestHash"].as_str() != Some(&hash)
        || confirmed["archived"] != false
    {
        return Err(DomainError::Conflict(
            "Publicação divergente ou arquivada no serviço. Confira o modelo antes de continuar",
        ));
    }
    let external = confirmed["id"]
        .as_i64()
        .filter(|v| *v > 0)
        .ok_or(DomainError::Conflict("O serviço não confirmou o modelo"))?;
    let (_, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let changed = sqlx::query("UPDATE commercial_template_versions SET external_id=$3,published_at=now() WHERE tenant_id=$1 AND id=$2 AND external_id IS NULL").bind(tenant).bind(version_id).bind(external).execute(&mut *tx).await.map_err(db)?;
    if changed.rows_affected() == 1 {
        record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"contract_template_version",id:version_id,event:"contract_template.published",details:json!({"draftId":id,"revision":rev,"externalId":external,"requestHash":hash})}).await?;
    }
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(rev),
        json!({"id":version_id,"externalId":external,"revision":rev,"status":"published"}),
    ))
}

pub async fn template_ids(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: Uuid,
    provider: &super::super::provider::Docuseal,
) -> Result<Vec<i64>, DomainError> {
    let mut ids = provider.template_ids(tenant).to_vec();
    let published:Vec<i64> = sqlx::query_scalar("SELECT external_id FROM commercial_template_versions WHERE tenant_id=$1 AND external_id IS NOT NULL ORDER BY published_at DESC LIMIT 100").bind(tenant).fetch_all(&mut **tx).await.map_err(db)?;
    ids.extend(published);
    ids.sort_unstable();
    ids.dedup();
    Ok(ids)
}
