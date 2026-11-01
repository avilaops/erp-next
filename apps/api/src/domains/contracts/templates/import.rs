use super::*;
use reqwest::Method;

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Import {
    template_id: i64,
}

#[utoipa::path(get,path="/api/v1/contract-template-drafts/catalog",operation_id="template_catalog",tag="Sales",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=super::super::api::TemplateCatalog),(status=403),(status=409)))]
pub async fn catalog(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, edit) =
        authorized(&state, &headers, &identity, READ, MANAGE, false).await?;
    let imported: Vec<(i64, Uuid)> = sqlx::query_as("SELECT source_template_id,id FROM commercial_template_drafts WHERE tenant_id=$1 AND source_template_id IS NOT NULL")
        .bind(tenant).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    let mut data = Vec::new();
    if let Some(provider) = &state.contracts {
        for id in provider.template_ids(tenant) {
            let template = provider
                .request(Method::GET, &format!("templates/{id}"), None)
                .await?;
            if !template["archived_at"].is_null() {
                continue;
            }
            let supported = definition(&template).is_ok();
            data.push(json!({"id":id,"name":template["name"],"updatedAt":template["updated_at"],"canImport":supported,"draftId":imported.iter().find(|(source,_)|source==id).map(|(_,id)|id)}));
        }
    }
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":edit,"configured":state.contracts.is_some(),"data":data}),
    ))
}

#[utoipa::path(post,path="/api/v1/contract-template-drafts/{id}/import",operation_id="template_import",tag="Sales",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),request_body=Import,responses((status=200,body=super::super::api::TemplateImportResult),(status=403),(status=409),(status=422)))]
pub async fn import_template(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<Import>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(&state, &headers, &identity, READ, MANAGE, true).await?;
    let provider = super::super::provider(&state)?;
    if !provider.template_ids(tenant).contains(&input.template_id) {
        return Err(crate::platform::access::AccessError::Forbidden.into());
    }
    // One editable copy per source and company, including concurrent clicks with different keys.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("template-import:{tenant}:{}", input.template_id))
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let request = json!({"id":id,"templateId":input.template_id});
    if let Some(value) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "template.import",
        &request,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::OK, value["revision"].as_i64(), value));
    }
    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM commercial_template_drafts WHERE tenant_id=$1 AND source_template_id=$2",
    )
    .bind(tenant)
    .bind(input.template_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?;
    let draft_id = if let Some(existing) = existing {
        existing
    } else {
        let template = provider
            .request(
                Method::GET,
                &format!("templates/{}", input.template_id),
                None,
            )
            .await?;
        if !template["archived_at"].is_null() {
            return Err(DomainError::Conflict("Modelo arquivado"));
        }
        let definition = definition(&template)?;
        let url = template["documents"][0]["url"]
            .as_str()
            .ok_or(DomainError::Invalid("PDF do modelo indisponível"))?;
        let pdf = provider.pdf(url).await?;
        if pdf.len() > 5 * 1024 * 1024 {
            return Err(DomainError::Invalid("O modelo excede 5 MiB"));
        }
        let inserted = sqlx::query("INSERT INTO commercial_template_drafts(tenant_id,id,definition,pdf,source_template_id,source_snapshot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,id) DO NOTHING")
            .bind(tenant).bind(id).bind(serde_json::to_value(definition).map_err(|_|DomainError::Invalid("Modelo inválido"))?).bind(pdf).bind(input.template_id).bind(&template).execute(&mut *tx).await.map_err(db)?;
        if inserted.rows_affected() != 1 {
            return Err(DomainError::Conflict(
                "Este rascunho já existe. Abra o modelo salvo",
            ));
        }
        record(&mut tx,tenant,&identity,&headers,DomainChange{kind:"contract_template_draft",id,event:"contract_template.imported",details:json!({"sourceTemplateId":input.template_id,"sourceUpdatedAt":template["updated_at"]})}).await?;
        id
    };
    let rev: i64 = sqlx::query_scalar(
        "SELECT revision FROM commercial_template_drafts WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(draft_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    let value = json!({"id":draft_id,"tenantId":tenant,"revision":rev});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "template.import",
        &request,
        &value,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(rev), value))
}

fn unsupported() -> DomainError {
    DomainError::Invalid(
        "Este modelo usa documentos ou campos ainda não suportados pelo editor. O original foi preservado",
    )
}

fn definition(template: &Value) -> Result<Definition, DomainError> {
    let documents = template["documents"].as_array().ok_or_else(unsupported)?;
    let schema = template["schema"].as_array().ok_or_else(unsupported)?;
    if documents.len() != 1 || schema.len() != 1 || schema[0]["dynamic"].as_bool() == Some(true) {
        return Err(unsupported());
    }
    let attachment = documents[0]["uuid"].as_str().ok_or_else(unsupported)?;
    let submitters = template["submitters"].as_array().ok_or_else(unsupported)?;
    let roles = submitters
        .iter()
        .map(|s| {
            s["name"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(unsupported)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut fields = Vec::new();
    let mut pages = 1;
    for field in template["fields"].as_array().ok_or_else(unsupported)? {
        // Reject unsupported semantics rather than silently deleting them in the editor.
        if field["readonly"].as_bool() == Some(true)
            || !field["default_value"].is_null()
            || ["conditions", "options"]
                .iter()
                .any(|key| field[*key].as_array().is_some_and(|a| !a.is_empty()))
            || field["validation"]
                .as_object()
                .is_some_and(|o| !o.is_empty())
            || field["preferences"]
                .as_object()
                .is_some_and(|o| o.keys().any(|key| key != "font_size"))
        {
            return Err(unsupported());
        }
        let areas = field["areas"].as_array().ok_or_else(unsupported)?;
        if areas.is_empty()
            || areas.len() > 100
            || areas
                .iter()
                .any(|area| area["attachment_uuid"].as_str() != Some(attachment))
        {
            return Err(unsupported());
        }
        let area = &areas[0];
        let page = area["page"]
            .as_u64()
            .filter(|p| *p < 100)
            .ok_or_else(unsupported)? as u32
            + 1;
        pages = pages.max(page);
        let additional_areas = areas
            .iter()
            .skip(1)
            .map(|area| {
                let position = |key: &str| {
                    area[key]
                        .as_f64()
                        .map(|v| (v * 10000.0).round() / 100.0)
                        .ok_or_else(unsupported)
                };
                let page = area["page"]
                    .as_u64()
                    .filter(|p| *p < 100)
                    .ok_or_else(unsupported)? as u32
                    + 1;
                pages = pages.max(page);
                Ok(Area {
                    page,
                    x: position("x")?,
                    y: position("y")?,
                    width: position("w")?,
                    height: position("h")?,
                })
            })
            .collect::<Result<Vec<_>, DomainError>>()?;
        let role = submitters
            .iter()
            .find(|s| s["uuid"] == field["submitter_uuid"])
            .and_then(|s| s["name"].as_str())
            .ok_or_else(unsupported)?;
        let position = |key: &str| {
            area[key]
                .as_f64()
                .map(|v| (v * 10000.0).round() / 100.0)
                .ok_or_else(unsupported)
        };
        fields.push(Field {
            id: field["uuid"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .ok_or_else(unsupported)?,
            name: field["name"].as_str().ok_or_else(unsupported)?.into(),
            kind: field["type"].as_str().ok_or_else(unsupported)?.into(),
            role: role.into(),
            required: field["required"].as_bool().unwrap_or(false),
            page,
            x: position("x")?,
            y: position("y")?,
            width: position("w")?,
            height: position("h")?,
            additional_areas,
            font_size: match &field["preferences"]["font_size"] {
                Value::Null => None,
                value => Some(
                    value
                        .as_f64()
                        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
                        .ok_or_else(unsupported)?,
                ),
            },
        });
    }
    let result = Definition {
        name: template["name"].as_str().ok_or_else(unsupported)?.into(),
        pages,
        roles,
        fields,
    };
    result.validate()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_font_and_all_positions() {
        let area = json!({"attachment_uuid":"pdf","page":0,"x":0.1,"y":0.2,"w":0.3,"h":0.05});
        let mut template = json!({"name":"Modelo","schema":[{"attachment_uuid":"pdf"}],"documents":[{"uuid":"pdf"}],"submitters":[{"uuid":"customer","name":"Cliente"}],"fields":[{"uuid":Uuid::new_v4(),"name":"Nome","type":"text","submitter_uuid":"customer","preferences":{"font_size":"14"},"areas":[area]}]});
        let imported = definition(&template).unwrap();
        assert_eq!(imported.fields[0].font_size, Some(14.0));
        assert_eq!(imported.fields[0].page, 1);
        assert_eq!(imported.fields[0].x, 10.0);
        template["fields"][0]["areas"]
            .as_array_mut()
            .unwrap()
            .push(area);
        assert_eq!(
            definition(&template).unwrap().fields[0]
                .additional_areas
                .len(),
            1
        );
    }
}
