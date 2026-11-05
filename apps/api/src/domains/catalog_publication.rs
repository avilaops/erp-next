//! Tenant-authorized catalog drafts and explicit, retryable publication.
use super::{DomainChange, DomainError, authorized, command_key, db, record, response, revision};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Clone)]
pub struct MediaGateway {
    client: reqwest::Client,
    origin: String,
    token: String,
    tenant: Uuid,
}
impl MediaGateway {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let Ok(origin) = std::env::var("CATALOG_MEDIA_ORIGIN") else {
            return Ok(None);
        };
        let url = reqwest::Url::parse(&origin)?;
        anyhow::ensure!(
            url.scheme() == "https"
                && url.host_str() == Some("ludusequipamentos.com")
                && url.path() == "/",
            "Invalid catalog origin"
        );
        let token = std::env::var("CATALOG_MEDIA_TOKEN")?;
        anyhow::ensure!(token.len() >= 32, "Catalog credential too short");
        Ok(Some(Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            origin: origin.trim_end_matches('/').to_string(),
            token,
            tenant: std::env::var("CATALOG_MEDIA_TENANT")?.parse()?,
        }))
    }
    fn for_tenant(state: &AppState, tenant: Uuid) -> Result<&Self, DomainError> {
        state
            .catalog_media
            .as_ref()
            .filter(|g| g.tenant == tenant)
            .ok_or(DomainError::Conflict(
                "Publicação não configurada para esta empresa",
            ))
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogProfileInput {
    pub collection: String,
    pub muscle_group: String,
    pub technical_category: String,
    pub dimensions_mm: [i32; 3],
    pub description: String,
    pub weight: String,
    pub weight_stack: String,
    pub main_media_id: Uuid,
}
impl CatalogProfileInput {
    fn validate(&self) -> Result<(), DomainError> {
        if !["core", "premium"].contains(&self.collection.as_str())
            || [&self.muscle_group, &self.technical_category]
                .iter()
                .any(|s| s.trim().is_empty() || s.chars().count() > 80)
            || self.dimensions_mm.iter().any(|v| !(1..=50000).contains(v))
            || self.description.chars().count() > 4000
            || self.weight.chars().count() > 80
            || self.weight_stack.chars().count() > 80
        {
            return Err(DomainError::Invalid(
                "Confira linha, grupo e dimensões em milímetros",
            ));
        }
        Ok(())
    }
}
#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileRow {
    revision: i64,
    collection: String,
    muscle_group: String,
    technical_category: String,
    dimensions_mm: Vec<i32>,
    description: String,
    weight: String,
    weight_stack: String,
    public_path: String,
    main_media_id: Uuid,
}
async fn profile(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<ProfileRow, DomainError> {
    sqlx::query_as("SELECT revision,collection,muscle_group,technical_category,dimensions_mm,description,weight,weight_stack,public_path,main_media_id FROM product_catalog_profiles WHERE tenant_id=$1 AND product_id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)
}
async fn assets(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Value, DomainError> {
    sqlx::query_scalar::<_,Value>("SELECT COALESCE(jsonb_agg(jsonb_build_object('id',m.id,'variant',m.variant,'version',m.version,'width',m.width_px,'height',m.height_px,'mediaType',f.media_type) ORDER BY m.version DESC,m.variant),'[]'::jsonb) FROM product_media_assets m JOIN system_config.files f ON (f.tenant_id,f.id)=(m.tenant_id,m.file_id) WHERE m.tenant_id=$1 AND m.product_id=$2 AND f.status='available'")
        .bind(tenant).bind(id).fetch_one(&mut **tx).await.map_err(db)
}
#[utoipa::path(get,operation_id="catalog_profile_get",path="/api/v1/products/{id}/catalog",tag="Catalog",security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,description="Rascunho e galeria")))]
pub async fn get(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        false,
    )
    .await?;
    let data = profile(&mut tx, tenant, id).await?;
    let media = assets(&mut tx, tenant, id).await?;
    let revision = data.revision;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        json!({"tenantId":tenant,"canEdit":can_edit,"data":data,"assets":media}),
    ))
}
#[utoipa::path(put,operation_id="catalog_profile_put",path="/api/v1/products/{id}/catalog",tag="Catalog",request_body=CatalogProfileInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,description="Rascunho salvo"),(status=412,description="Revisão alterada")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<CatalogProfileInput>,
) -> Result<Response, DomainError> {
    input.validate()?;
    let expected = revision(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        true,
    )
    .await?;
    if !sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM product_media_assets m JOIN system_config.files f ON (f.tenant_id,f.id)=(m.tenant_id,m.file_id) WHERE m.tenant_id=$1 AND m.product_id=$2 AND m.id=$3 AND m.variant IN ('webp','black','thumbnail') AND f.status='available')")
        .bind(tenant).bind(id).bind(input.main_media_id).fetch_one(&mut *tx).await.map_err(db)? { return Err(DomainError::Invalid("Selecione uma imagem de apresentação deste produto")); }
    let changed=sqlx::query("UPDATE product_catalog_profiles SET collection=$4,muscle_group=$5,technical_category=$6,dimensions_mm=$7,description=$8,weight=$9,weight_stack=$10,main_media_id=$11,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND product_id=$2 AND revision=$3")
        .bind(tenant).bind(id).bind(expected).bind(&input.collection).bind(input.muscle_group.trim()).bind(input.technical_category.trim()).bind(input.dimensions_mm.to_vec()).bind(&input.description).bind(&input.weight).bind(&input.weight_stack).bind(input.main_media_id).execute(&mut *tx).await.map_err(db)?;
    if changed.rows_affected() != 1 {
        return Err(DomainError::StaleRevision);
    }
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "product",
            id,
            event: "catalog.profile.updated",
            details: json!({"revision":expected+1}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(expected + 1),
        json!({"saved":true,"revision":expected+1}),
    ))
}
#[utoipa::path(get,operation_id="catalog_media_get",path="/api/v1/products/{id}/media/{media_id}",tag="Catalog",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("media_id"=Uuid,Path)),responses((status=200,description="Imagem privada autorizada")))]
pub async fn media(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path((id, media_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        false,
    )
    .await?;
    let file=sqlx::query_as::<_,(String,String,i64)>("SELECT f.storage_key,f.media_type,f.byte_size FROM product_media_assets m JOIN system_config.files f ON (f.tenant_id,f.id)=(m.tenant_id,m.file_id) WHERE m.tenant_id=$1 AND m.product_id=$2 AND m.id=$3 AND f.status='available'")
        .bind(tenant).bind(id).bind(media_id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    tx.commit().await.map_err(db)?;
    let gateway = MediaGateway::for_tenant(&state, tenant)?;
    let key = file
        .0
        .strip_prefix("r2://ludus-equipamentos-midias/ludus/catalogo/")
        .ok_or(DomainError::NotFound)?;
    if key.contains("..")
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/-._".contains(&b))
        || file.2 > 20_000_000
    {
        return Err(DomainError::NotFound);
    }
    let mut reply = gateway
        .client
        .get(format!("{}/midias/_private/{key}", gateway.origin))
        .bearer_auth(&gateway.token)
        .send()
        .await
        .map_err(|_| DomainError::Conflict("Imagem temporariamente indisponível"))?;
    if !reply.status().is_success() || reply.content_length().is_some_and(|n| n > 20_000_000) {
        return Err(DomainError::Conflict("Imagem indisponível"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = reply
        .chunk()
        .await
        .map_err(|_| DomainError::Conflict("Falha ao carregar imagem"))?
    {
        if bytes.len() + chunk.len() > 20_000_000 {
            return Err(DomainError::Conflict("Imagem acima do limite"));
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() as i64 != file.2 {
        return Err(DomainError::Conflict("Tamanho de imagem divergente"));
    }
    Ok(Response::builder()
        .header("Content-Type", file.1)
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(bytes))
        .expect("valid image response"))
}

async fn snapshot(tx: &mut Transaction<'_, Postgres>, tenant: Uuid) -> Result<Value, DomainError> {
    sqlx::query_scalar("SELECT COALESCE(jsonb_agg(jsonb_build_object('code',p.sku,'nome',p.name,'colecao',c.collection,'grupo_muscular',c.muscle_group,'linha',c.technical_category,'dim',c.dimensions_mm,'descricao',c.description,'peso',c.weight,'bateria',c.weight_stack,'url',c.public_path,'imageKey',replace(f.storage_key,'r2://ludus-equipamentos-midias/',''),'revision',c.revision) ORDER BY p.sku),'[]'::jsonb) FROM product_catalog_profiles c JOIN products p ON (p.tenant_id,p.id)=(c.tenant_id,c.product_id) JOIN product_media_assets m ON (m.tenant_id,m.id,m.product_id)=(c.tenant_id,c.main_media_id,c.product_id) JOIN system_config.files f ON (f.tenant_id,f.id)=(m.tenant_id,m.file_id) WHERE c.tenant_id=$1 AND p.status='active' AND f.status='available' AND m.variant<>'source'")
        .bind(tenant).fetch_one(&mut **tx).await.map_err(db)
}
fn fingerprint(products: &Value) -> String {
    format!("{:x}", Sha256::digest(products.to_string().as_bytes()))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishInput {
    pub preview_hash: String,
}
#[utoipa::path(get,operation_id="catalog_publication_preview",path="/api/v1/catalog-publication",tag="Catalog",security(("bearerAuth"=[])),responses((status=200,description="Prévia sem preços e publicação atual")))]
pub async fn preview(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        false,
    )
    .await?;
    let products = snapshot(&mut tx, tenant).await?;
    let publication=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',id,'sequence',sequence,'publishedAt',published_at) FROM catalog_publications WHERE tenant_id=$1 AND status='published' ORDER BY sequence DESC LIMIT 1").bind(tenant).fetch_optional(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"tenantId":tenant,"canEdit":can_edit,"configured":state.catalog_media.as_ref().is_some_and(|g|g.tenant==tenant),"previewHash":fingerprint(&products),"products":products,"publication":publication}),
    ))
}
#[utoipa::path(post,operation_id="catalog_publication_publish",path="/api/v1/catalog-publication",tag="Catalog",request_body=PublishInput,security(("bearerAuth"=[])),responses((status=200,description="Publicação explícita concluída")))]
pub async fn publish(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Json(input): Json<PublishInput>,
) -> Result<Response, DomainError> {
    let key = command_key(&headers)?;
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        true,
    )
    .await?;
    let gateway = MediaGateway::for_tenant(&state, tenant)?;
    let old = sqlx::query_scalar::<_, Value>(
        "SELECT snapshot FROM catalog_publications WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant)
    .bind(key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?;
    if let Some(previous) = &old
        && fingerprint(&previous["products"]) != input.preview_hash
    {
        return Err(DomainError::Conflict(
            "Esta chave já pertence a outra prévia",
        ));
    }
    if old.is_none() {
        let products = snapshot(&mut tx, tenant).await?;
        if fingerprint(&products) != input.preview_hash {
            return Err(DomainError::Conflict(
                "O catálogo mudou. Revise a prévia antes de publicar",
            ));
        }
        if products
            .as_array()
            .is_none_or(|a| a.is_empty() || a.len() > 1000)
        {
            return Err(DomainError::Invalid("Catálogo vazio ou acima do limite"));
        }
        sqlx::query("INSERT INTO catalog_publications(tenant_id,id,snapshot) VALUES($1,$2,$3)")
            .bind(tenant)
            .bind(key)
            .bind(json!({"id":key,"products":products}))
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    // Persist the exact snapshot before network I/O so a retry never publishes a later draft.
    tx.commit().await.map_err(db)?;
    let (_, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        true,
    )
    .await?;
    let (mut payload,sequence,status)=sqlx::query_as::<_,(Value,i64,String)>("SELECT snapshot,sequence,status FROM catalog_publications WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(tenant).bind(key).fetch_one(&mut *tx).await.map_err(db)?;
    if status != "published" {
        payload["sequence"] = json!(sequence);
        let reply = gateway
            .client
            .post(format!("{}/midias/_publish", gateway.origin))
            .bearer_auth(&gateway.token)
            .json(&payload)
            .send()
            .await
            .map_err(|_| {
                DomainError::Conflict("Publicação pendente. Repita para conferir a mesma versão")
            })?;
        if !reply.status().is_success() {
            return Err(DomainError::Conflict(
                "Publicação não confirmada. Confira a versão atual antes de repetir",
            ));
        }
        sqlx::query("UPDATE catalog_publications SET status='published',published_at=now() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(key).execute(&mut *tx).await.map_err(db)?;
        record(
            &mut tx,
            tenant,
            &identity,
            &headers,
            DomainChange {
                kind: "catalog",
                id: key,
                event: "catalog.published",
                details: json!({"sequence":sequence}),
            },
        )
        .await?;
    }
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        json!({"id":key,"sequence":sequence,"published":true}),
    ))
}
