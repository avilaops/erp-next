use super::catalog::ProductInput;
use super::{DomainError, authorized, db, response};
use crate::platform::{auth::AuthenticatedIdentity, state::AppState};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

const IMPORT_PERMISSION: &str = "catalog.products.import";
const EXPORT_PERMISSION: &str = "catalog.products.export";
const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_ROWS: usize = 5_000;
type ExportRow = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    i64,
    String,
);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CsvImportInput {
    pub filename: String,
    pub content: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRow {
    line: usize,
    input: ProductInput,
    error: Option<String>,
    conflict: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportData {
    id: Uuid,
    filename: String,
    format: &'static str,
    status: String,
    rows: Vec<ImportRow>,
    valid: usize,
    invalid: usize,
    conflicts: usize,
    result: Option<serde_json::Value>,
}

#[derive(FromRow)]
struct JobRow {
    id: Uuid,
    source_name: String,
    status: String,
    rows: serde_json::Value,
    result: Option<serde_json::Value>,
}

fn parse_csv(content: &str) -> Result<Vec<Vec<String>>, &'static str> {
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    if text.len() > MAX_BYTES {
        return Err("Arquivo CSV acima do limite de 2 MiB");
    }
    if text.is_empty() {
        return Err("O arquivo CSV está vazio");
    }
    let delimiter = text
        .lines()
        .next()
        .map(|line| {
            [',', ';', '\t']
                .into_iter()
                .max_by_key(|d| line.matches(*d).count())
                .unwrap_or(',')
        })
        .unwrap_or(',');
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '"' {
            if quoted && chars.peek() == Some(&'"') {
                field.push('"');
                chars.next();
            } else {
                quoted = !quoted;
            }
        } else if ch == delimiter && !quoted {
            row.push(std::mem::take(&mut field));
        } else if (ch == '\n' || ch == '\r') && !quoted {
            if ch == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            row.push(std::mem::take(&mut field));
            if row.iter().any(|v| !v.trim().is_empty()) {
                rows.push(std::mem::take(&mut row));
            }
        } else {
            field.push(ch);
        }
    }
    if quoted {
        return Err("CSV inválido: aspas não fechadas");
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        if row.iter().any(|v| !v.trim().is_empty()) {
            rows.push(row);
        }
    }
    if rows.is_empty() || rows.len() > MAX_ROWS + 1 {
        return Err("O CSV deve conter entre 1 e 5000 linhas de dados");
    }
    Ok(rows)
}

fn cell(headers: &[String], row: &[String], names: &[&str]) -> String {
    names
        .iter()
        .find_map(|name| {
            headers
                .iter()
                .position(|header| header == name)
                .and_then(|i| row.get(i))
        })
        .map(|v| v.trim().to_owned())
        .unwrap_or_default()
}

async fn find_job(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: Uuid,
) -> Result<ImportData, DomainError> {
    let job: JobRow = sqlx::query_as("SELECT id,source_name,status,rows,result FROM product_import_jobs WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let rows: Vec<ImportRow> = serde_json::from_value(job.rows)
        .map_err(|_| DomainError::Invalid("Resultado de importação inválido"))?;
    let valid = rows
        .iter()
        .filter(|row| row.error.is_none() && !row.conflict)
        .count();
    let invalid = rows.iter().filter(|row| row.error.is_some()).count();
    let conflicts = rows.iter().filter(|row| row.conflict).count();
    Ok(ImportData {
        id: job.id,
        filename: job.source_name,
        format: "csv",
        status: job.status,
        rows,
        valid,
        invalid,
        conflicts,
        result: job.result,
    })
}

pub async fn preview(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Json(input): Json<CsvImportInput>,
) -> Result<Response, DomainError> {
    let content_bytes = input.content.as_bytes();
    if input.filename.len() > 160 || !input.filename.to_ascii_lowercase().ends_with(".csv") {
        return Err(DomainError::Invalid("Selecione um arquivo CSV"));
    }
    if content_bytes.len() > MAX_BYTES {
        return Err(DomainError::Invalid("Arquivo CSV acima do limite de 2 MiB"));
    }
    let digest = format!("{:x}", Sha256::digest(content_bytes));
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        IMPORT_PERMISSION,
        IMPORT_PERMISSION,
        true,
    )
    .await?;
    if let Some(id) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM product_import_jobs WHERE tenant_id=$1 AND source_sha256=$2",
    )
    .bind(tenant)
    .bind(&digest)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db)?
    {
        let data = find_job(&mut tx, tenant, id).await?;
        tx.commit().await.map_err(db)?;
        return Ok(response(
            StatusCode::OK,
            None,
            serde_json::json!({"data":data}),
        ));
    }
    let table = parse_csv(&input.content).map_err(DomainError::Invalid)?;
    if table.len() < 2 {
        return Err(DomainError::Invalid(
            "O CSV não contém registros de produtos",
        ));
    }
    let headers_csv: Vec<String> = table[0]
        .iter()
        .map(|v| v.trim().to_ascii_lowercase())
        .collect();
    let allowed = [
        "sku",
        "codigo",
        "name",
        "nome",
        "unit",
        "unidade",
        "base_price",
        "preco",
        "price",
        "ncm",
        "cest",
        "status",
    ];
    if headers_csv
        .iter()
        .all(|header| !allowed.contains(&header.as_str()))
        || !headers_csv
            .iter()
            .any(|header| ["sku", "codigo"].contains(&header.as_str()))
        || !headers_csv
            .iter()
            .any(|header| ["name", "nome"].contains(&header.as_str()))
    {
        return Err(DomainError::Invalid(
            "O CSV precisa conter as colunas SKU e nome",
        ));
    }
    let skus: Vec<String> = table
        .iter()
        .skip(1)
        .map(|row| cell(&headers_csv, row, &["sku", "codigo"]).to_ascii_uppercase())
        .collect();
    let existing: Vec<String> =
        sqlx::query_scalar("SELECT sku FROM products WHERE tenant_id=$1 AND sku = ANY($2)")
            .bind(tenant)
            .bind(&skus)
            .fetch_all(&mut *tx)
            .await
            .map_err(db)?;
    let mut rows = Vec::new();
    for (index, raw) in table.iter().skip(1).enumerate() {
        let mut item = ProductInput {
            sku: cell(&headers_csv, raw, &["sku", "codigo"]),
            name: cell(&headers_csv, raw, &["name", "nome"]),
            unit: cell(&headers_csv, raw, &["unit", "unidade"]),
            ncm: Some(cell(&headers_csv, raw, &["ncm"])).filter(|v| !v.is_empty()),
            cest: Some(cell(&headers_csv, raw, &["cest"])).filter(|v| !v.is_empty()),
            base_price: cell(&headers_csv, raw, &["base_price", "preco", "price"]),
            status: {
                let value = cell(&headers_csv, raw, &["status"]);
                if value.is_empty() {
                    "active".into()
                } else {
                    value
                }
            },
            category_id: None,
            photo_data_url: None,
            structure_colors: Some(Vec::new()),
            upholstery_colors: Some(Vec::new()),
            arm_colors: None,
            plate_holder_colors: Some(Vec::new()),
            plate_holder_types: Some(Vec::new()),
            plate_holder_type: None,
        };
        let error = item
            .validate()
            .err()
            .map(|_| "Linha inválida: confira SKU, nome, unidade, preço, NCM e CEST".to_owned());
        let conflict = error.is_none()
            && (existing.iter().any(|sku| sku == &item.sku) || skus[..index].contains(&item.sku));
        rows.push(ImportRow {
            line: index + 2,
            input: item,
            error,
            conflict,
        });
    }
    let id = Uuid::now_v7();
    let rows_json = serde_json::to_value(&rows)
        .map_err(|_| DomainError::Invalid("Não foi possível preparar a prévia"))?;
    sqlx::query("INSERT INTO product_import_jobs(id,tenant_id,source_sha256,source_name,format,status,rows,created_by_identity_id) SELECT $1,$2,$3,$4,'csv','previewed',$5,id FROM identities WHERE auth_subject=$6").bind(id).bind(tenant).bind(digest).bind(&input.filename).bind(rows_json).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    let data = find_job(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::CREATED,
        None,
        serde_json::json!({"data":data}),
    ))
}

pub async fn get_import(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        IMPORT_PERMISSION,
        IMPORT_PERMISSION,
        false,
    )
    .await?;
    let data = find_job(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        serde_json::json!({"data":data}),
    ))
}

pub async fn confirm(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        IMPORT_PERMISSION,
        IMPORT_PERMISSION,
        true,
    )
    .await?;
    let key = super::command_key(&headers)?;
    let job: JobRow = sqlx::query_as("SELECT id,source_name,status,rows,result FROM product_import_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(tenant).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if job.status == "imported" {
        let data = find_job(&mut tx, tenant, id).await?;
        tx.commit().await.map_err(db)?;
        return Ok(response(
            StatusCode::OK,
            None,
            serde_json::json!({"data":data}),
        ));
    }
    let rows: Vec<ImportRow> =
        serde_json::from_value(job.rows).map_err(|_| DomainError::Invalid("Prévia inválida"))?;
    let mut imported = 0usize;
    for row in rows
        .iter()
        .filter(|row| row.error.is_none() && !row.conflict)
    {
        let mut item = row.input.clone();
        let cents = item
            .validate()
            .map_err(|_| DomainError::Invalid("A prévia não é mais válida"))?;
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO products(id,tenant_id,sku,name,unit,ncm,cest,price_cents,status,structure_colors,upholstery_colors,plate_holder_colors,plate_holder_types,plate_holder_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'')").bind(id).bind(tenant).bind(item.sku).bind(item.name).bind(item.unit).bind(item.ncm).bind(item.cest).bind(cents).bind(item.status).bind(Vec::<String>::new()).bind(Vec::<String>::new()).bind(Vec::<String>::new()).bind(Vec::<String>::new()).execute(&mut *tx).await.map_err(|_| DomainError::Conflict("SKU já cadastrado nesta empresa"))?;
        imported += 1;
    }
    let result = serde_json::json!({"imported":imported,"total":rows.len()});
    sqlx::query("UPDATE product_import_jobs SET status='imported',result=$3,completed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2").bind(tenant).bind(id).bind(&result).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO audit_log(tenant_id,identity_id,action,entity_type,entity_id,details) SELECT $1,id,'products.imported','product_import',$2,$3 FROM identities WHERE auth_subject=$4").bind(tenant).bind(id.to_string()).bind(&result).bind(&identity.subject).execute(&mut *tx).await.map_err(db)?;
    sqlx::query("INSERT INTO outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,'product_import',$2,'products.imported',$3)").bind(tenant).bind(id.to_string()).bind(&result).execute(&mut *tx).await.map_err(db)?;
    let _ = key;
    let data = find_job(&mut tx, tenant, id).await?;
    tx.commit().await.map_err(db)?;
    Ok(response(
        StatusCode::OK,
        None,
        serde_json::json!({"data":data}),
    ))
}

#[derive(Deserialize)]
pub struct ExportQuery {
    pub q: Option<String>,
    pub status: Option<String>,
}
pub async fn export(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Query(query): Query<ExportQuery>,
) -> Result<Response, DomainError> {
    let (tenant, mut tx, _) = authorized(
        &state,
        &headers,
        &identity,
        EXPORT_PERMISSION,
        EXPORT_PERMISSION,
        false,
    )
    .await?;
    if query.q.as_deref().unwrap_or("").chars().count() > 160
        || query
            .status
            .as_deref()
            .is_some_and(|s| !["active", "archived"].contains(&s))
    {
        return Err(DomainError::Invalid("Filtro de exportação inválido"));
    }
    let rows: Vec<ExportRow> = sqlx::query_as("SELECT sku,name,unit,ncm,cest,price_cents,status FROM products WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR strpos(lower(name),lower($3))>0 OR strpos(lower(sku),lower($3))>0) ORDER BY name,sku").bind(tenant).bind(&query.status).bind(query.q.as_deref().map(str::trim).filter(|q| !q.is_empty())).fetch_all(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    let mut csv = String::from("sku,name,unit,ncm,cest,base_price,status\r\n");
    for (sku, name, unit, ncm, cest, cents, status) in rows {
        let fields = [
            sku,
            name,
            unit,
            ncm.unwrap_or_default(),
            cest.unwrap_or_default(),
            format!("{}.{:02}", cents / 100, cents % 100),
            status,
        ];
        csv.push_str(&fields.map(|field| csv_cell(&field)).join(","));
        csv.push_str("\r\n");
    }
    let mut result = Response::new(csv.into());
    *result.status_mut() = StatusCode::OK;
    result.headers_mut().insert(
        header::CONTENT_TYPE,
        "text/csv; charset=utf-8".parse().unwrap(),
    );
    result.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        "attachment; filename=produtos.csv".parse().unwrap(),
    );
    Ok(result)
}
fn csv_cell(value: &str) -> String {
    let mut value = value.to_owned();
    if value.starts_with('=')
        || value.starts_with('+')
        || value.starts_with('-')
        || value.starts_with('@')
    {
        value.insert(0, '\'');
    }
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::{csv_cell, parse_csv};

    #[test]
    fn parses_quoted_fields_and_semicolon_delimiters() {
        let rows = parse_csv("sku;name\nA-1;\"Mesa; grande\"\n").unwrap();
        assert_eq!(rows[1][0], "A-1");
        assert_eq!(rows[1][1], "Mesa; grande");
    }

    #[test]
    fn rejects_unclosed_quotes_and_large_files() {
        assert!(parse_csv("sku,name\n\"broken\n").is_err());
        assert!(parse_csv(&format!("sku,name\n{}", "x".repeat(2 * 1024 * 1024))).is_err());
    }

    #[test]
    fn neutralizes_formula_cells_and_quotes_special_values() {
        assert_eq!(csv_cell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
        assert_eq!(csv_cell("Nome, especial"), "\"Nome, especial\"");
        assert_eq!(csv_cell("Ele \"disse\""), "\"Ele \"\"disse\"\"\"");
    }
}
