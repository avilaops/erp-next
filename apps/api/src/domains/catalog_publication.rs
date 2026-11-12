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
    pub(super) async fn upload(
        &self,
        key: &str,
        media_type: &str,
        sha: &str,
        bytes: Vec<u8>,
    ) -> Result<(), DomainError> {
        let path = key
            .strip_prefix("ludus/catalogo/uploads/")
            .ok_or(DomainError::Invalid("Localizador de imagem inválido"))?;
        let result = self
            .client
            .put(format!("{}/midias/_upload/{path}", self.origin))
            .bearer_auth(&self.token)
            .header("Content-Type", media_type)
            .header("X-Content-Sha256", sha)
            .body(bytes)
            .send()
            .await
            .map_err(|_| {
                DomainError::Conflict("Envio não confirmado; a versão anterior foi preservada")
            })?;
        if !result.status().is_success() {
            return Err(DomainError::Conflict(
                "Não foi possível registrar a foto no R2",
            ));
        }
        Ok(())
    }
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
pub struct CatalogSource {
    pub title: String,
    pub url: String,
    pub pdf_page: Option<u32>,
    pub printed_page: Option<u32>,
}

fn deserialize_required_main_media<'de, D>(deserializer: D) -> Result<Option<Uuid>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<Uuid>::deserialize(deserializer)
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
    // A deliberate null keeps the legacy photo; absence must never remove media.
    #[serde(deserialize_with = "deserialize_required_main_media")]
    #[schema(required = true)]
    pub main_media_id: Option<Uuid>,
    /// Omission preserves metadata written by newer clients; empty clears it.
    pub manufacturer: Option<String>,
    pub manufacturer_model: Option<String>,
    pub catalog_product_name: Option<String>,
    pub live_area: Option<String>,
    pub catalog_sources: Option<Vec<CatalogSource>>,
    #[serde(default)]
    pub new_image: Option<String>,
}
impl CatalogProfileInput {
    fn validate(&mut self) -> Result<(), DomainError> {
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
        for (value, limit) in [
            (&mut self.manufacturer, 80),
            (&mut self.manufacturer_model, 80),
            (&mut self.catalog_product_name, 200),
            (&mut self.live_area, 200),
        ] {
            if let Some(value) = value {
                *value = value.trim().to_owned();
                if value.chars().count() > limit || value.chars().any(char::is_control) {
                    return Err(DomainError::Invalid("Confira os dados do fabricante"));
                }
            }
        }
        if let Some(sources) = &mut self.catalog_sources {
            if sources.len() > 10 {
                return Err(DomainError::Invalid("Cadastre até dez fontes do catálogo"));
            }
            for source in sources {
                source.title = source.title.trim().to_owned();
                source.url = source.url.trim().to_owned();
                let url = reqwest::Url::parse(&source.url)
                    .map_err(|_| DomainError::Invalid("Informe uma fonte HTTPS válida"))?;
                if source.title.is_empty()
                    || source.title.chars().count() > 160
                    || source.title.chars().any(char::is_control)
                    || source.url.len() > 2048
                    || url.scheme() != "https"
                    || url.host_str().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                    || [source.pdf_page, source.printed_page]
                        .into_iter()
                        .flatten()
                        .any(|page| !(1..=10000).contains(&page))
                {
                    return Err(DomainError::Invalid(
                        "Confira título, endereço HTTPS e páginas da fonte",
                    ));
                }
            }
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
    main_media_id: Option<Uuid>,
    manufacturer: String,
    manufacturer_model: String,
    catalog_product_name: String,
    live_area: String,
    catalog_sources: Value,
}
async fn profile(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Option<ProfileRow>, DomainError> {
    sqlx::query_as("SELECT revision,collection,muscle_group,technical_category,dimensions_mm,description,weight,weight_stack,public_path,main_media_id,manufacturer,manufacturer_model,catalog_product_name,live_area,catalog_sources FROM product_catalog_profiles WHERE tenant_id=$1 AND product_id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)
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
    let category: Option<Option<String>> = sqlx::query_scalar("SELECT c.code FROM products p LEFT JOIN product_categories c ON (c.tenant_id,c.id)=(p.tenant_id,p.category_id) WHERE p.tenant_id=$1 AND p.id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
    let category = category.ok_or(DomainError::NotFound)?;
    let default_collection = if category.as_deref() == Some("PREMIUM") {
        "premium"
    } else {
        "core"
    };
    let data = profile(&mut tx, tenant, id).await?;
    let media = assets(&mut tx, tenant, id).await?;
    let revision = data.as_ref().map_or(0, |profile| profile.revision);
    let media_configured = state
        .catalog_media
        .as_ref()
        .is_some_and(|gateway| gateway.tenant == tenant);
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(revision),
        json!({"tenantId":tenant,"productId":id,"canEdit":can_edit,"data":data,"assets":media,"defaultCollection":default_collection,"mediaConfigured":media_configured}),
    ))
}
#[utoipa::path(put,operation_id="catalog_profile_put",path="/api/v1/products/{id}/catalog",tag="Catalog",request_body=CatalogProfileInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path)),responses((status=200,description="Rascunho salvo"),(status=412,description="Revisão alterada")))]
pub async fn put(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(mut input): Json<CatalogProfileInput>,
) -> Result<Response, DomainError> {
    input.validate()?;
    let expected = if headers
        .get(axum::http::header::IF_MATCH)
        .and_then(|value| value.to_str().ok())
        == Some("\"0\"")
    {
        0
    } else {
        revision(&headers)?
    };
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        true,
    )
    .await?;
    // Serialize profile creation and updates through the existing product row.
    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(tenant)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    .ok_or(DomainError::NotFound)?;
    let current: Option<i64> = sqlx::query_scalar("SELECT revision FROM product_catalog_profiles WHERE tenant_id=$1 AND product_id=$2 FOR UPDATE").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?;
    if current.unwrap_or(0) != expected {
        return Err(DomainError::StaleRevision);
    }
    if let Some(image) = input.new_image.take() {
        let gateway = MediaGateway::for_tenant(&state, tenant)?;
        input.main_media_id = Some(
            super::catalog_images::store(
                &mut tx,
                gateway,
                tenant,
                id,
                &identity.subject,
                &input.collection,
                image,
            )
            .await?,
        );
    }
    if let Some(main_media_id) = input.main_media_id
        && !sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM product_media_assets m JOIN system_config.files f ON (f.tenant_id,f.id)=(m.tenant_id,m.file_id) WHERE m.tenant_id=$1 AND m.product_id=$2 AND m.id=$3 AND m.variant IN ('webp','black','thumbnail') AND f.status='available')")
            .bind(tenant).bind(id).bind(main_media_id).fetch_one(&mut *tx).await.map_err(db)? {
        return Err(DomainError::Invalid("Selecione uma imagem de apresentação deste produto"));
    }
    let sources = input.catalog_sources.as_ref().map(|sources| json!(sources));
    if current.is_none() {
        let path = format!(
            "/{}/product-{id}/",
            if input.collection == "core" {
                "core"
            } else {
                "loja"
            }
        );
        sqlx::query("INSERT INTO product_catalog_profiles(tenant_id,product_id,collection,muscle_group,technical_category,dimensions_mm,description,weight,weight_stack,main_media_id,public_path,manufacturer,manufacturer_model,catalog_product_name,live_area,catalog_sources) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
            .bind(tenant).bind(id).bind(&input.collection).bind(input.muscle_group.trim()).bind(input.technical_category.trim()).bind(input.dimensions_mm.to_vec()).bind(&input.description).bind(&input.weight).bind(&input.weight_stack).bind(input.main_media_id).bind(path)
            .bind(input.manufacturer.as_deref().unwrap_or("")).bind(input.manufacturer_model.as_deref().unwrap_or("")).bind(input.catalog_product_name.as_deref().unwrap_or("")).bind(input.live_area.as_deref().unwrap_or("")).bind(sources.unwrap_or_else(||json!([])))
            .execute(&mut *tx).await.map_err(db)?;
    } else {
        let changed=sqlx::query("UPDATE product_catalog_profiles SET collection=$4,muscle_group=$5,technical_category=$6,dimensions_mm=$7,description=$8,weight=$9,weight_stack=$10,main_media_id=$11,manufacturer=COALESCE($12,manufacturer),manufacturer_model=COALESCE($13,manufacturer_model),catalog_product_name=COALESCE($14,catalog_product_name),live_area=COALESCE($15,live_area),catalog_sources=COALESCE($16,catalog_sources),revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND product_id=$2 AND revision=$3")
            .bind(tenant).bind(id).bind(expected).bind(&input.collection).bind(input.muscle_group.trim()).bind(input.technical_category.trim()).bind(input.dimensions_mm.to_vec()).bind(&input.description).bind(&input.weight).bind(&input.weight_stack).bind(input.main_media_id)
            .bind(&input.manufacturer).bind(&input.manufacturer_model).bind(&input.catalog_product_name).bind(&input.live_area).bind(sources)
            .execute(&mut *tx).await.map_err(db)?;
        if changed.rows_affected() != 1 {
            return Err(DomainError::StaleRevision);
        }
    }
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "product",
            id,
            event: if current.is_none() {
                "catalog.profile.created"
            } else {
                "catalog.profile.updated"
            },
            details: json!({"revision":expected+1}),
        },
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(expected + 1),
        json!({"saved":true,"revision":expected+1,"mainMediaId":input.main_media_id}),
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
