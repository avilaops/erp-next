use super::{
    DomainChange, DomainError, authorized, command_key, db, decimal, fixed, record, remember,
    replay, response, revision,
};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProductInput {
    /// UUID da categoria; vazio remove o vínculo, omitido preserva na edição.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub photo_data_url: Option<String>,
    pub sku: String,
    pub name: String,
    pub unit: String,
    pub ncm: Option<String>,
    pub cest: Option<String>,
    pub base_price: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure_colors: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub swing_arm_colors: Option<Vec<String>>,
    /// Referência explícita à paleta do catálogo; vazio remove, omissão preserva.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finishing_palette: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upholstery_colors: Option<Vec<String>>,
    /// Campo legado: clientes anteriores usavam armColors para as cores dos anilheiros.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arm_colors: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plate_holder_colors: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plate_holder_types: Option<Vec<String>>,
    /// Campo legado: clientes anteriores aceitavam apenas um tipo por produto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plate_holder_type: Option<String>,
}
impl ProductInput {
    pub(crate) fn validate(&mut self) -> Result<i64, DomainError> {
        if let Some(legacy) = self.arm_colors.take() {
            if self.plate_holder_colors.as_ref().is_some_and(|current| {
                current.len() != legacy.len()
                    || current.iter().zip(&legacy).any(|(current, legacy)| {
                        !current.trim().eq_ignore_ascii_case(legacy.trim())
                    })
            }) {
                return Err(DomainError::Invalid(
                    "Informe as cores dos anilheiros apenas em plateHolderColors",
                ));
            }
            if self.plate_holder_colors.is_none() {
                self.plate_holder_colors = Some(legacy);
            }
        }
        if let Some(legacy) = self.plate_holder_type.take() {
            if legacy.trim().is_empty() {
                if self
                    .plate_holder_types
                    .as_ref()
                    .is_some_and(|current| !current.is_empty())
                {
                    return Err(DomainError::Invalid(
                        "Informe os tipos de anilheiro apenas em plateHolderTypes",
                    ));
                }
                if self.plate_holder_types.is_none() {
                    self.plate_holder_types = Some(Vec::new());
                }
            } else {
                let normalized = match legacy.trim().to_lowercase().as_str() {
                    "standard" => "Standard",
                    "olympic" | "olímpico" => "Olímpico",
                    _ => {
                        return Err(DomainError::Invalid(
                            "Tipo de anilheiro deve ser Olímpico ou Standard",
                        ));
                    }
                };
                if self.plate_holder_types.as_ref().is_some_and(|current| {
                    current.len() != 1 || !current[0].trim().eq_ignore_ascii_case(normalized)
                }) {
                    return Err(DomainError::Invalid(
                        "Informe os tipos de anilheiro apenas em plateHolderTypes",
                    ));
                }
                if self.plate_holder_types.is_none() {
                    self.plate_holder_types = Some(vec![normalized.to_owned()]);
                }
            }
        }
        if let Some(category) = &mut self.category_id {
            *category = category.trim().to_owned();
            if !category.is_empty() && Uuid::parse_str(category).is_err() {
                return Err(DomainError::Invalid("Categoria inválida"));
            }
        }
        if let Some(photo) = self
            .photo_data_url
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            let invalid = || {
                DomainError::Invalid(
                    "Foto exige JPEG válido com até 256 KiB; selecione a imagem novamente",
                )
            };
            if photo.len() > 350000 {
                return Err(invalid());
            }
            let encoded = photo
                .strip_prefix("data:image/jpeg;base64,")
                .ok_or_else(invalid)?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|_| invalid())?;
            if bytes.len() > 262144
                || !bytes.starts_with(&[0xff, 0xd8, 0xff])
                || !bytes.ends_with(&[0xff, 0xd9])
            {
                return Err(invalid());
            }
        }
        self.sku = self.sku.trim().to_ascii_uppercase();
        self.name = self.name.trim().to_owned();
        self.unit = self.unit.trim().to_ascii_uppercase();
        if self.sku.is_empty()
            || self.sku.len() > 80
            || !self
                .sku
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._/-".contains(&c))
        {
            return Err(DomainError::Invalid(
                "SKU deve conter até 80 letras ASCII, números, ponto, barra, hífen ou sublinhado",
            ));
        }
        if self.name.is_empty() || self.name.chars().count() > 200 {
            return Err(DomainError::Invalid(
                "Nome deve conter de 1 a 200 caracteres",
            ));
        }
        if self.unit.is_empty()
            || self.unit.len() > 6
            || !self.unit.bytes().all(|c| c.is_ascii_uppercase())
        {
            return Err(DomainError::Invalid("Unidade deve conter de 1 a 6 letras"));
        }
        for (code, size) in [(&self.ncm, 8), (&self.cest, 7)] {
            if code
                .as_ref()
                .is_some_and(|s| s.len() != size || !s.bytes().all(|c| c.is_ascii_digit()))
            {
                return Err(DomainError::Invalid(
                    "NCM exige 8 dígitos e CEST exige 7; use null para não informado",
                ));
            }
        }
        if !["active", "archived"].contains(&self.status.as_str()) {
            return Err(DomainError::Invalid("Situação inválida"));
        }
        for options in [
            &mut self.structure_colors,
            &mut self.swing_arm_colors,
            &mut self.upholstery_colors,
            &mut self.plate_holder_colors,
            &mut self.plate_holder_types,
        ]
        .into_iter()
        .flatten()
        {
            if options.len() > 32 {
                return Err(DomainError::Invalid(
                    "Cadastre até 32 opções por acabamento",
                ));
            }
            let mut names = std::collections::HashSet::new();
            for name in options {
                *name = name.trim().to_owned();
                if name.is_empty()
                    || name.chars().count() > 60
                    || name.chars().any(char::is_control)
                    || !names.insert(name.to_lowercase())
                {
                    return Err(DomainError::Invalid(
                        "Opções exigem nomes únicos de 1 a 60 caracteres, sem caracteres de controle",
                    ));
                }
            }
        }
        if self.plate_holder_types.as_ref().is_some_and(|types| {
            types.len() > 2
                || types
                    .iter()
                    .any(|value| !["Olímpico", "Standard"].contains(&value.as_str()))
        }) {
            return Err(DomainError::Invalid(
                "Tipo de anilheiro deve ser Olímpico ou Standard",
            ));
        }
        if let Some(palette) = &mut self.finishing_palette {
            *palette = palette.trim().to_owned();
            if !["", "dhz-hammerforce-pro", "dhz-sforce"].contains(&palette.as_str()) {
                return Err(DomainError::Invalid("Paleta de catálogo desconhecida"));
            }
        }
        fixed(&self.base_price, 2)
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub photo_url: Option<String>,
    pub upholstery_configurable: bool,
    pub id: Uuid,
    pub revision: i64,
    pub has_photo: bool,
    #[serde(flatten)]
    pub data: ProductInput,
}
#[derive(FromRow)]
struct ProductRow {
    main_media_id: Option<Uuid>,
    upholstery_configurable: bool,
    category_id: Option<Uuid>,
    has_photo: bool,
    photo_data_url: Option<String>,
    id: Uuid,
    sku: String,
    name: String,
    unit: String,
    ncm: Option<String>,
    cest: Option<String>,
    price_cents: i64,
    status: String,
    revision: i64,
    structure_colors: Vec<String>,
    swing_arm_colors: Vec<String>,
    finishing_palette: String,
    upholstery_colors: Vec<String>,
    plate_holder_colors: Vec<String>,
    plate_holder_types: Vec<String>,
    plate_holder_type: String,
}
impl From<ProductRow> for Product {
    fn from(r: ProductRow) -> Self {
        let mut plate_holder_types = r.plate_holder_types;
        if plate_holder_types.is_empty() {
            match r.plate_holder_type.as_str() {
                "standard" => plate_holder_types.push("Standard".to_owned()),
                "olympic" => plate_holder_types.push("Olímpico".to_owned()),
                _ => {}
            }
        }
        let plate_holder_type = match plate_holder_types.as_slice() {
            [kind] if kind == "Standard" => Some("standard".to_owned()),
            [kind] if kind == "Olímpico" => Some("olympic".to_owned()),
            _ => None,
        };
        Self {
            photo_url: r
                .main_media_id
                .map(|media| format!("/api/erp/products/{}/media/{media}", r.id)),
            upholstery_configurable: r.upholstery_configurable,
            id: r.id,
            revision: r.revision,
            has_photo: r.has_photo,
            data: ProductInput {
                category_id: r.category_id.map(|id| id.to_string()),
                photo_data_url: r.photo_data_url,
                sku: r.sku,
                name: r.name,
                unit: r.unit,
                ncm: r.ncm,
                cest: r.cest,
                base_price: decimal(r.price_cents, 2),
                status: r.status,
                structure_colors: Some(r.structure_colors),
                swing_arm_colors: Some(r.swing_arm_colors),
                finishing_palette: Some(r.finishing_palette),
                upholstery_colors: Some(r.upholstery_colors),
                arm_colors: None,
                plate_holder_colors: Some(r.plate_holder_colors),
                plate_holder_types: Some(plate_holder_types),
                plate_holder_type,
            },
        }
    }
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProductSnapshot {
    tenant_id: Uuid,
    can_edit: bool,
    data: Product,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProductList {
    upholstery_configurable: bool,
    tenant_id: Uuid,
    can_edit: bool,
    data: Vec<Product>,
    total: i64,
    offset: u32,
    limit: u32,
}
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct ProductQuery {
    pub category_id: Option<Uuid>,
    pub q: Option<String>,
    pub status: Option<String>,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}
pub fn page(query: &ProductQuery) -> Result<(String, u32, u32), DomainError> {
    let q = query.q.as_deref().unwrap_or("").trim().to_owned();
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(25);
    if q.chars().count() > 160 || offset > 100000 || !(1..=100).contains(&limit) {
        return Err(DomainError::Invalid(
            "Busca até 160 caracteres, offset até 100000 e limit de 1 a 100",
        ));
    }
    if query
        .status
        .as_deref()
        .is_some_and(|s| !["active", "archived"].contains(&s))
    {
        return Err(DomainError::Invalid("Filtro de situação inválido"));
    }
    Ok((q, offset, limit))
}
pub async fn load(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<Product, DomainError> {
    sqlx::query_as::<_,ProductRow>("SELECT (SELECT main_media_id FROM product_catalog_profiles WHERE tenant_id=products.tenant_id AND product_id=products.id) AS main_media_id,COALESCE((SELECT (data->>'upholsteryConfigurable')::boolean FROM registration_settings WHERE tenant_id=products.tenant_id AND section='products'),true) AS upholstery_configurable,id,sku,name,unit,ncm,cest,price_cents,status,revision,category_id,structure_colors,swing_arm_colors,finishing_palette,upholstery_colors,plate_holder_colors,plate_holder_types,plate_holder_type,photo_data_url,(COALESCE(photo_data_url,'')<>'' OR EXISTS(SELECT 1 FROM product_catalog_profiles WHERE tenant_id=products.tenant_id AND product_id=products.id AND main_media_id IS NOT NULL)) AS has_photo FROM products WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.map(Into::into).ok_or(DomainError::NotFound)
}
fn product_error(error: sqlx::Error) -> DomainError {
    if error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation())
    {
        DomainError::Conflict("SKU já cadastrado nesta empresa")
    } else {
        db(error)
    }
}

fn legacy_plate_holder_type(types: Option<&[String]>) -> &'static str {
    match types {
        Some([kind]) if kind == "Standard" => "standard",
        Some([kind]) if kind == "Olímpico" => "olympic",
        _ => "",
    }
}

fn category_uuid(input: &ProductInput) -> Option<Uuid> {
    input
        .category_id
        .as_deref()
        .and_then(|id| Uuid::parse_str(id).ok())
}

async fn validate_category(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    category: Option<Uuid>,
) -> Result<(), DomainError> {
    if let Some(id) = category {
        let available = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM product_categories WHERE tenant_id=$1 AND id=$2 AND status='active')")
            .bind(tenant).bind(id).fetch_one(&mut **tx).await.map_err(db)?;
        if !available {
            return Err(DomainError::Invalid(
                "Selecione uma categoria ativa desta empresa",
            ));
        }
    }
    Ok(())
}

#[utoipa::path(get,path="/api/v1/products",tag="Catalog",security(("bearerAuth"=[])),params(ProductQuery,("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ProductList),(status=401,description="Credencial inválida"),(status=403,description="Sem permissão"),(status=422,description="Filtros inválidos")))]
pub async fn list(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    query: Result<Query<ProductQuery>, QueryRejection>,
) -> Result<Response, DomainError> {
    let query = query
        .map_err(|_| DomainError::Invalid("Filtros inválidos"))?
        .0;
    let (q, offset, limit) = page(&query)?;
    let (tenant, mut tx, can_edit) = authorized(
        &state,
        &headers,
        &identity,
        "catalog.products.read",
        "catalog.products.manage",
        false,
    )
    .await?;
    let rows=sqlx::query_as::<_,ProductRow>("SELECT (SELECT main_media_id FROM product_catalog_profiles WHERE tenant_id=products.tenant_id AND product_id=products.id) AS main_media_id,COALESCE((SELECT (data->>'upholsteryConfigurable')::boolean FROM registration_settings WHERE tenant_id=products.tenant_id AND section='products'),true) AS upholstery_configurable,id,sku,name,unit,ncm,cest,price_cents,status,revision,category_id,structure_colors,swing_arm_colors,finishing_palette,upholstery_colors,plate_holder_colors,plate_holder_types,plate_holder_type,NULL::text AS photo_data_url,(COALESCE(photo_data_url,'')<>'' OR EXISTS(SELECT 1 FROM product_catalog_profiles WHERE tenant_id=products.tenant_id AND product_id=products.id AND main_media_id IS NOT NULL)) AS has_photo FROM products WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND (strpos(lower(name),lower($3))>0 OR strpos(lower(sku),lower($3))>0) AND ($6::uuid IS NULL OR category_id=$6) ORDER BY name,id LIMIT $4 OFFSET $5")
        .bind(tenant).bind(&query.status).bind(&q).bind(i64::from(limit)).bind(i64::from(offset)).bind(query.category_id).fetch_all(&mut *tx).await.map_err(db)?;
    let (_, settings) = super::registration_settings::load(&mut tx, tenant, "products").await?;
    let total=sqlx::query_scalar("SELECT count(*) FROM products WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND (strpos(lower(name),lower($3))>0 OR strpos(lower(sku),lower($3))>0) AND ($4::uuid IS NULL OR category_id=$4)")
        .bind(tenant).bind(&query.status).bind(&q).bind(query.category_id).fetch_one(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        ProductList {
            upholstery_configurable: settings["upholsteryConfigurable"] != false,
            tenant_id: tenant,
            can_edit,
            data: rows.into_iter().map(Into::into).collect(),
            total,
            offset,
            limit,
        },
    ))
}
#[utoipa::path(get,path="/api/v1/products/{id}",tag="Catalog",security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=ProductSnapshot),(status=404,description="Produto não encontrado"),(status=403,description="Sem permissão")))]
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
    let data = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(data.revision),
        ProductSnapshot {
            tenant_id: tenant,
            can_edit,
            data,
        },
    ))
}
#[utoipa::path(post,path="/api/v1/products",tag="Catalog",request_body=ProductInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=ProductSnapshot),(status=409,description="SKU ou chave em conflito"),(status=422,description="Cadastro inválido"),(status=428,description="Chave obrigatória"),(status=403,description="Sem permissão")))]
pub async fn create(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    payload: Result<Json<ProductInput>, JsonRejection>,
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
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let cents = input.validate()?;
    let request =
        serde_json::to_value(&input).map_err(|_| crate::platform::access::AccessError::Internal)?;
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "product.create",
        &request,
    )
    .await?
    {
        let rev = previous["data"]["revision"].as_i64();
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, rev, previous));
    }
    let (_, settings) = super::registration_settings::load(&mut tx, tenant, "products").await?;
    if settings["upholsteryConfigurable"] == false
        && input
            .upholstery_colors
            .as_ref()
            .is_some_and(|colors| !colors.is_empty())
    {
        return Err(DomainError::Invalid(
            "O estofado é padrão nesta empresa; não cadastre opções de cor",
        ));
    }
    if settings["requireNcm"] == true && input.ncm.as_deref().unwrap_or("").is_empty()
        || settings["requireCest"] == true && input.cest.as_deref().unwrap_or("").is_empty()
    {
        return Err(DomainError::Invalid(
            "NCM ou CEST obrigatório conforme a configuração da empresa",
        ));
    }
    let id = Uuid::now_v7();
    let category = category_uuid(&input);
    validate_category(&mut tx, tenant, category).await?;
    sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,ncm,cest,price_cents,status,structure_colors,upholstery_colors,plate_holder_colors,plate_holder_types,plate_holder_type,photo_data_url,category_id,swing_arm_colors,finishing_palette) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)")
        .bind(id).bind(tenant).bind(&input.sku).bind(&input.name).bind(&input.unit).bind(&input.ncm).bind(&input.cest).bind(cents).bind(&input.status).bind(input.structure_colors.as_deref().unwrap_or_default()).bind(input.upholstery_colors.as_deref().unwrap_or_default()).bind(input.plate_holder_colors.as_deref().unwrap_or_default()).bind(input.plate_holder_types.as_deref().unwrap_or_default()).bind(legacy_plate_holder_type(input.plate_holder_types.as_deref())).bind(&input.photo_data_url).bind(category).bind(input.swing_arm_colors.as_deref().unwrap_or_default()).bind(input.finishing_palette.as_deref().unwrap_or("")).execute(&mut *tx).await.map_err(product_error)?;
    let result = serde_json::to_value(ProductSnapshot {
        tenant_id: tenant,
        can_edit: true,
        data: load(&mut tx, tenant, id).await?,
    })
    .map_err(|_| crate::platform::access::AccessError::Internal)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "product",
            id,
            event: "product.created",
            details: serde_json::json!({"revision":1,"sku":input.sku}),
        },
    )
    .await?;
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "product.create",
        &request,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(1), result))
}
#[utoipa::path(put,path="/api/v1/products/{id}",tag="Catalog",request_body=ProductInput,security(("bearerAuth"=[])),params(("id"=Uuid,Path),("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),responses((status=200,body=ProductSnapshot),(status=404,description="Produto não encontrado"),(status=409,description="SKU, unidade ou saldo em conflito"),(status=412,description="Revisão divergente"),(status=422,description="Cadastro inválido"),(status=428,description="Revisão obrigatória"),(status=403,description="Sem permissão")))]
pub async fn update(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    payload: Result<Json<ProductInput>, JsonRejection>,
) -> Result<Response, DomainError> {
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
    let Json(mut input) =
        payload.map_err(|_| DomainError::Invalid("JSON inválido ou campos desconhecidos"))?;
    let cents = input.validate()?;
    let (_, settings) = super::registration_settings::load(&mut tx, tenant, "products").await?;
    if settings["upholsteryConfigurable"] == false
        && input
            .upholstery_colors
            .as_ref()
            .is_some_and(|colors| !colors.is_empty())
    {
        return Err(DomainError::Invalid(
            "O estofado é padrão nesta empresa; não cadastre opções de cor",
        ));
    }
    if settings["requireNcm"] == true && input.ncm.as_deref().unwrap_or("").is_empty()
        || settings["requireCest"] == true && input.cest.as_deref().unwrap_or("").is_empty()
    {
        return Err(DomainError::Invalid(
            "NCM ou CEST obrigatório conforme a configuração da empresa",
        ));
    }
    let previous = load(&mut tx, tenant, id).await?;
    if input.category_id.is_none() {
        input.category_id.clone_from(&previous.data.category_id);
    }
    let category = category_uuid(&input);
    if category != category_uuid(&previous.data) {
        validate_category(&mut tx, tenant, category).await?;
    }
    if input.photo_data_url.is_none() {
        input
            .photo_data_url
            .clone_from(&previous.data.photo_data_url);
    }
    if input.structure_colors.is_none() {
        input
            .structure_colors
            .clone_from(&previous.data.structure_colors);
    }
    if input.upholstery_colors.is_none() {
        input
            .upholstery_colors
            .clone_from(&previous.data.upholstery_colors);
    }
    if input.swing_arm_colors.is_none() {
        input
            .swing_arm_colors
            .clone_from(&previous.data.swing_arm_colors);
    }
    if input.finishing_palette.is_none() {
        input
            .finishing_palette
            .clone_from(&previous.data.finishing_palette);
    }
    if input.plate_holder_colors.is_none() {
        input
            .plate_holder_colors
            .clone_from(&previous.data.plate_holder_colors);
    }
    if input.plate_holder_types.is_none() {
        input
            .plate_holder_types
            .clone_from(&previous.data.plate_holder_types);
    }
    if previous.revision != expected {
        return Err(DomainError::StaleRevision);
    }
    if input.unit != previous.data.unit
        && sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM stock_movements WHERE tenant_id=$1 AND product_id=$2)",
        )
        .bind(tenant)
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?
    {
        return Err(DomainError::Conflict(
            "Unidade não pode mudar após movimentação de estoque",
        ));
    }
    if input.status=="archived" && sqlx::query_scalar::<_,i64>("SELECT COALESCE((SELECT quantity_micros FROM stock_balances WHERE tenant_id=$1 AND product_id=$2),0)").bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)? !=0 { return Err(DomainError::Conflict("Regularize o saldo antes de arquivar o produto")); }
    let next = expected
        .checked_add(1)
        .ok_or(crate::platform::access::AccessError::Internal)?;
    sqlx::query("UPDATE products SET sku=$3,name=$4,unit=$5,ncm=$6,cest=$7,price_cents=$8,status=$9,revision=$10,structure_colors=$11,upholstery_colors=$12,plate_holder_colors=$13,plate_holder_types=$14,plate_holder_type=$15,photo_data_url=$16,category_id=$17,swing_arm_colors=$18,finishing_palette=$19,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).bind(&input.sku).bind(&input.name).bind(&input.unit).bind(&input.ncm).bind(&input.cest).bind(cents).bind(&input.status).bind(next).bind(input.structure_colors.as_deref().unwrap_or_default()).bind(input.upholstery_colors.as_deref().unwrap_or_default()).bind(input.plate_holder_colors.as_deref().unwrap_or_default()).bind(input.plate_holder_types.as_deref().unwrap_or_default()).bind(legacy_plate_holder_type(input.plate_holder_types.as_deref())).bind(&input.photo_data_url).bind(category).bind(input.swing_arm_colors.as_deref().unwrap_or_default()).bind(input.finishing_palette.as_deref().unwrap_or("")).execute(&mut *tx).await.map_err(product_error)?;
    record(
        &mut tx,
        tenant,
        &identity,
        &headers,
        DomainChange {
            kind: "product",
            id,
            event: "product.updated",
            details: serde_json::json!({"previousRevision":expected,"revision":next}),
        },
    )
    .await?;
    let data = load(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        Some(next),
        ProductSnapshot {
            tenant_id: tenant,
            can_edit: true,
            data,
        },
    ))
}
