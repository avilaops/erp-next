//! Immutable photo versions. Originals remain private; derivatives keep their colors.
use super::{DomainError, db};
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{ImageDecoder, ImageFormat, ImageReader};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use std::io::Cursor;
use uuid::Uuid;

pub struct Asset {
    pub variant: &'static str,
    pub filename: &'static str,
    pub media_type: &'static str,
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

fn prepare(value: &str) -> Result<Vec<Asset>, DomainError> {
    let invalid =
        || DomainError::Invalid("Use uma foto JPG, PNG ou WebP de até 10 MB e 16 megapixels");
    let (prefix, encoded) = value.split_once(',').ok_or_else(invalid)?;
    let (format, filename, media_type) = match prefix {
        "data:image/jpeg;base64" => (ImageFormat::Jpeg, "source.jpg", "image/jpeg"),
        "data:image/png;base64" => (ImageFormat::Png, "source.png", "image/png"),
        "data:image/webp;base64" => (ImageFormat::WebP, "source.webp", "image/webp"),
        _ => return Err(invalid()),
    };
    if encoded.len() > 14_000_000 {
        return Err(invalid());
    }
    let original = STANDARD.decode(encoded).map_err(|_| invalid())?;
    if original.len() > 10_000_000 || image::guess_format(&original).ok() != Some(format) {
        return Err(invalid());
    }
    let mut reader = ImageReader::with_format(Cursor::new(&original), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(6000);
    limits.max_image_height = Some(6000);
    limits.max_alloc = Some(128_000_000);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| invalid())?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > 16_000_000 {
        return Err(invalid());
    }
    let orientation = decoder.orientation().map_err(|_| invalid())?;
    let mut image = image::DynamicImage::from_decoder(decoder).map_err(|_| invalid())?;
    image.apply_orientation(orientation);
    let mut assets = Vec::new();
    for (variant, filename, size) in [
        ("webp", "web.webp", 1600),
        ("thumbnail", "thumbnail.webp", 400),
    ] {
        let resized = image.thumbnail(size, size).to_rgba8();
        let mut bytes = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut bytes)
            .encode(
                &resized,
                resized.width(),
                resized.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|_| invalid())?;
        assets.push(Asset {
            variant,
            filename,
            media_type: "image/webp",
            bytes,
            width: resized.width(),
            height: resized.height(),
        });
    }
    assets.push(Asset {
        variant: "source",
        filename,
        media_type,
        bytes: original,
        width,
        height,
    });
    Ok(assets)
}

pub async fn store(
    tx: &mut Transaction<'_, Postgres>,
    gateway: &super::catalog_publication::MediaGateway,
    tenant: Uuid,
    product: Uuid,
    subject: &str,
    collection: &str,
    value: String,
) -> Result<Uuid, DomainError> {
    let assets = tokio::task::spawn_blocking(move || prepare(&value))
        .await
        .map_err(|_| DomainError::Invalid("Não foi possível processar a foto"))??;
    let sku: String =
        sqlx::query_scalar("SELECT sku FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE")
            .bind(tenant)
            .bind(product)
            .fetch_one(&mut **tx)
            .await
            .map_err(db)?;
    if !sku.starts_with("LD-")
        || !sku
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(DomainError::Invalid("SKU não habilitado para a biblioteca"));
    }
    let original_hash = format!(
        "{:x}",
        Sha256::digest(
            &assets
                .iter()
                .find(|a| a.variant == "source")
                .expect("source asset")
                .bytes
        )
    );
    let version: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(version),0)+1 FROM product_media_assets WHERE tenant_id=$1 AND product_id=$2").bind(tenant).bind(product).fetch_one(&mut **tx).await.map_err(db)?;
    let mut main = None;
    for asset in assets {
        let key = format!(
            "ludus/catalogo/uploads/{original_hash}/{collection}/{sku}/{}",
            asset.filename
        );
        let sha = format!("{:x}", Sha256::digest(&asset.bytes));
        gateway
            .upload(&key, asset.media_type, &sha, asset.bytes.clone())
            .await?;
        let storage = format!("r2://ludus-equipamentos-midias/{key}");
        sqlx::query("INSERT INTO system_config.files(tenant_id,storage_key,original_name,media_type,byte_size,sha256,status,created_by) SELECT $1,$2,$3,$4,$5,$6,'available',id FROM identities WHERE auth_subject=$7 ON CONFLICT(tenant_id,storage_key) DO NOTHING")
            .bind(tenant).bind(&storage).bind(format!("{sku}-{}",asset.filename)).bind(asset.media_type).bind(asset.bytes.len() as i64).bind(&sha).bind(subject).execute(&mut **tx).await.map_err(db)?;
        let fid: Uuid = sqlx::query_scalar("SELECT id FROM system_config.files WHERE tenant_id=$1 AND storage_key=$2 AND sha256=$3 AND status='available'").bind(tenant).bind(&storage).bind(&sha).fetch_one(&mut **tx).await.map_err(db)?;
        sqlx::query("INSERT INTO system_config.file_versions(tenant_id,file_id,version,content_file_id) VALUES($1,$2,1,$2) ON CONFLICT DO NOTHING").bind(tenant).bind(fid).execute(&mut **tx).await.map_err(db)?;
        let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM product_media_assets WHERE tenant_id=$1 AND product_id=$2 AND file_id=$3 ORDER BY version DESC LIMIT 1").bind(tenant).bind(product).bind(fid).fetch_optional(&mut **tx).await.map_err(db)?;
        let mid = if let Some(id) = existing {
            id
        } else {
            sqlx::query_scalar("INSERT INTO product_media_assets(tenant_id,product_id,file_id,collection,variant,version,width_px,height_px) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id")
                .bind(tenant).bind(product).bind(fid).bind(collection).bind(asset.variant).bind(version).bind(asset.width as i32).bind(asset.height as i32).fetch_one(&mut **tx).await.map_err(db)?
        };
        if asset.variant == "webp" {
            main = Some(mid);
        }
    }
    main.ok_or(DomainError::Invalid("Imagem principal ausente"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_is_preserved_and_derivatives_keep_color_and_transparency() {
        let photo = image::RgbaImage::from_pixel(20, 10, image::Rgba([20, 50, 230, 180]));
        let mut original = Cursor::new(Vec::new());
        photo.write_to(&mut original, ImageFormat::Png).unwrap();
        let bytes = original.into_inner();
        let assets = prepare(&format!(
            "data:image/png;base64,{}",
            STANDARD.encode(&bytes)
        ))
        .unwrap();
        assert_eq!(
            assets.iter().find(|a| a.variant == "source").unwrap().bytes,
            bytes
        );
        for asset in assets.iter().filter(|a| a.variant != "source") {
            assert_eq!(
                image::load_from_memory(&asset.bytes)
                    .unwrap()
                    .to_rgba8()
                    .get_pixel(0, 0)
                    .0,
                [20, 50, 230, 180]
            );
        }
        assert!(prepare("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(prepare("data:image/png;base64,bm90LWEtcGhvdG8=").is_err());
    }
}
