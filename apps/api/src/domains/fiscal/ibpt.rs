//! Versioned, tenant-bound approximate-tax tables. Never substitutes operation taxes.
use std::{collections::HashMap, io::Read, path::Path};

use anyhow::{Context, ensure};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{Date, Month};
use utoipa::ToSchema;
use uuid::Uuid;

use super::model::{exact_decimal, products_total, state_code};
use crate::{
    domains::{DomainError, authorized, db, response},
    platform::{auth::AuthenticatedIdentity, state::AppState},
};

const MAX_FILE: usize = 10 * 1024 * 1024;
const MAX_TOTAL: usize = 100 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Classification {
    Ncm,
    Nbs,
    Lc116,
}
#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GoodsOrigin {
    National,
    Imported,
}
#[derive(Clone, Debug, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IbptStatus {
    Available,
    NotConfigured,
    OutsideValidity,
    CodeNotFound,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IbptInput {
    pub uf: String,
    pub classification: Classification,
    pub code: String,
    pub ex: String,
    pub origin: GoodsOrigin,
    pub amount: String,
    pub as_of: String,
    pub version: Option<String>,
}
#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IbptMetadata {
    pub uf: String,
    pub classification: Classification,
    pub version: String,
    pub source: String,
    pub key: String,
    pub valid_from: String,
    pub valid_to: String,
    pub sha256: String,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IbptAmounts {
    pub federal: String,
    pub state: String,
    pub municipal: String,
    pub total: String,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IbptQuote {
    pub tenant_id: Uuid,
    pub status: IbptStatus,
    pub metadata: Option<IbptMetadata>,
    pub amounts: Option<IbptAmounts>,
    pub notice: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Table {
    uf: String,
    classification: Classification,
    version: String,
    source: String,
    key: String,
    valid_from: String,
    valid_to: String,
    license_reference: String,
    rows: Vec<Row>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Row {
    code: String,
    ex: String,
    national: String,
    imported: String,
    state: String,
    municipal: String,
}
struct Rates {
    national: i128,
    imported: i128,
    state: i128,
    municipal: i128,
}
struct Snapshot {
    tenant: Uuid,
    metadata: IbptMetadata,
    from: Date,
    to: Date,
    rows: HashMap<(String, String), Rates>,
}

#[derive(Default)]
pub struct IbptCatalog {
    snapshots: Vec<Snapshot>,
}

fn date(raw: &str) -> Option<Date> {
    let bytes = raw.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return None;
    }
    Date::from_calendar_date(
        raw[..4].parse().ok()?,
        Month::try_from(raw[5..7].parse::<u8>().ok()?).ok()?,
        raw[8..].parse().ok()?,
    )
    .ok()
}
fn text(raw: &str) -> bool {
    !raw.trim().is_empty() && raw.chars().count() <= 200 && !raw.chars().any(char::is_control)
}
fn valid_version(raw: &str) -> bool {
    let b = raw.as_bytes();
    b.len() == 6
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2] == b'.'
        && b[3].is_ascii_digit()
        && b[4] == b'.'
        && b[5].is_ascii_uppercase()
}
fn valid_code(classification: Classification, code: &str, ex: &str) -> bool {
    code.len()
        == match classification {
            Classification::Ncm => 8,
            Classification::Nbs => 9,
            Classification::Lc116 => 4,
        }
        && code.bytes().all(|c| c.is_ascii_digit())
        && !ex.is_empty()
        && ex.len() <= 3
        && ex.bytes().all(|c| c.is_ascii_digit())
}
fn rate(raw: &str) -> anyhow::Result<i128> {
    let value = exact_decimal(raw, 3, 4)
        .map_err(|_| anyhow::anyhow!("IBPT percentage requires four decimal places"))?;
    ensure!(value <= 1_000_000, "IBPT percentage exceeds 100 percent");
    Ok(value)
}

impl IbptCatalog {
    pub fn from_env() -> anyhow::Result<Self> {
        let Some(file) = std::env::var_os("ERP_IBPT_MANIFEST_FILE") else {
            return Ok(Self::default());
        };
        Self::load(Path::new(&file))
    }

    pub(super) fn load(path: &Path) -> anyhow::Result<Self> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Entry {
            tenant_id: Uuid,
            file: String,
            sha256: String,
        }
        let manifest = read_bounded(path, 64 * 1024)?;
        let entries: Vec<Entry> =
            serde_json::from_slice(&manifest).context("invalid IBPT manifest")?;
        ensure!(entries.len() <= 81, "IBPT manifest exceeds 81 snapshots");
        let mut catalog = Self::default();
        let mut total = 0;
        for entry in entries {
            ensure!(
                !entry.file.is_empty()
                    && !entry.file.contains(['/', '\\'])
                    && entry.file != "."
                    && entry.file != "..",
                "IBPT file must be a local basename"
            );
            let file = path.parent().unwrap_or(Path::new(".")).join(&entry.file);
            ensure!(
                !std::fs::symlink_metadata(&file)?.file_type().is_symlink(),
                "IBPT symlink is not allowed"
            );
            let bytes = read_bounded(&file, MAX_FILE)?;
            total += bytes.len();
            ensure!(total <= MAX_TOTAL, "IBPT catalog exceeds 100 MiB");
            catalog.import(entry.tenant_id, &bytes, &entry.sha256)?;
        }
        Ok(catalog)
    }

    pub(super) fn import(
        &mut self,
        tenant: Uuid,
        bytes: &[u8],
        expected: &str,
    ) -> anyhow::Result<()> {
        ensure!(bytes.len() <= MAX_FILE, "IBPT snapshot exceeds size limit");
        ensure!(
            expected.len() == 64 && expected.bytes().all(|c| c.is_ascii_hexdigit()),
            "invalid IBPT SHA-256"
        );
        let hash = format!("{:x}", Sha256::digest(bytes));
        ensure!(
            hash == expected.to_ascii_lowercase(),
            "IBPT integrity mismatch"
        );
        let table: Table =
            serde_json::from_slice(bytes).context("invalid IBPT snapshot contract")?;
        ensure!(
            state_code(&table.uf).is_some() && valid_version(&table.version),
            "invalid IBPT UF/version"
        );
        ensure!(
            text(&table.source) && text(&table.key) && text(&table.license_reference),
            "IBPT requires source, key and authorization reference"
        );
        let from = date(&table.valid_from).context("IBPT validFrom required as ISO date")?;
        let to = date(&table.valid_to).context("IBPT validTo required as ISO date")?;
        ensure!(to >= from, "IBPT validity is reversed");
        ensure!(
            !table.rows.is_empty() && table.rows.len() <= 20_000,
            "invalid IBPT row count"
        );
        let mut rows = HashMap::new();
        for row in table.rows {
            ensure!(
                valid_code(table.classification, &row.code, &row.ex),
                "invalid IBPT classification/code/EX"
            );
            let rates = Rates {
                national: rate(&row.national)?,
                imported: rate(&row.imported)?,
                state: rate(&row.state)?,
                municipal: rate(&row.municipal)?,
            };
            ensure!(
                rows.insert((row.code, row.ex), rates).is_none(),
                "duplicate IBPT code/EX"
            );
        }
        if let Some(previous) = self.snapshots.iter().find(|s| {
            s.tenant == tenant
                && s.metadata.uf == table.uf
                && s.metadata.classification == table.classification
                && s.metadata.version == table.version
        }) {
            ensure!(
                previous.metadata.sha256 == hash,
                "same IBPT version has divergent content"
            );
            return Ok(());
        }
        self.snapshots.push(Snapshot {
            tenant,
            from,
            to,
            rows,
            metadata: IbptMetadata {
                uf: table.uf,
                classification: table.classification,
                version: table.version,
                source: table.source,
                key: table.key,
                valid_from: table.valid_from,
                valid_to: table.valid_to,
                sha256: hash,
            },
        });
        Ok(())
    }

    pub fn quote(&self, tenant: Uuid, input: &IbptInput) -> Result<IbptQuote, DomainError> {
        if state_code(&input.uf).is_none()
            || !valid_code(input.classification, &input.code, &input.ex)
            || input.version.as_ref().is_some_and(|v| !valid_version(v))
        {
            return Err(DomainError::Invalid(
                "Informe UF, classificação, código, EX e versão IBPT válidos",
            ));
        }
        let as_of = date(&input.as_of).ok_or(DomainError::Invalid(
            "Informe a data da operação no formato AAAA-MM-DD",
        ))?;
        let cents = exact_decimal(&input.amount, 13, 2)?;
        let mut quote = IbptQuote {
            tenant_id: tenant,
            status: IbptStatus::NotConfigured,
            metadata: None,
            amounts: None,
            notice: "Estimativa informativa. Não substitui ICMS/IPI/PIS/COFINS/IBS/CBS da operação"
                .into(),
        };
        let candidates: Vec<_> = self
            .snapshots
            .iter()
            .filter(|s| {
                s.tenant == tenant
                    && s.metadata.uf == input.uf
                    && s.metadata.classification == input.classification
                    && input
                        .version
                        .as_ref()
                        .is_none_or(|v| v == &s.metadata.version)
            })
            .collect();
        let selected = candidates
            .iter()
            .filter(|s| s.from <= as_of && as_of <= s.to)
            .max_by_key(|s| (s.from, &s.metadata.version));
        let Some(snapshot) = selected else {
            if let Some(nearest) = candidates
                .iter()
                .max_by_key(|s| (s.from, &s.metadata.version))
            {
                quote.status = IbptStatus::OutsideValidity;
                quote.metadata = Some(nearest.metadata.clone());
            }
            return Ok(quote);
        };
        quote.metadata = Some(snapshot.metadata.clone());
        let Some(rates) = snapshot.rows.get(&(input.code.clone(), input.ex.clone())) else {
            quote.status = IbptStatus::CodeNotFound;
            return Ok(quote);
        };
        let round = |rate: i128| -> i64 { ((cents * rate + 500_000) / 1_000_000) as i64 };
        let federal = round(match input.origin {
            GoodsOrigin::National => rates.national,
            GoodsOrigin::Imported => rates.imported,
        });
        let state = round(rates.state);
        let municipal = round(rates.municipal);
        quote.status = IbptStatus::Available;
        quote.amounts = Some(IbptAmounts {
            federal: products_total(federal),
            state: products_total(state),
            municipal: products_total(municipal),
            total: products_total(federal + state + municipal),
        });
        Ok(quote)
    }
}

fn read_bounded(path: &Path, maximum: usize) -> anyhow::Result<Vec<u8>> {
    let file = std::fs::File::open(path).context("IBPT file is not available")?;
    ensure!(file.metadata()?.is_file(), "IBPT requires regular files");
    let mut bytes = vec![];
    file.take(maximum as u64 + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= maximum, "IBPT file exceeds size limit");
    Ok(bytes)
}

#[utoipa::path(post,path="/api/v1/fiscal/ibpt/quote",request_body=IbptInput,
    responses((status=200,body=IbptQuote),(status=401),(status=403),(status=422)),tag="Fiscal",security(("bearerAuth"=[])))]
pub async fn quote(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    input: Result<Json<IbptInput>, JsonRejection>,
) -> Result<Response, DomainError> {
    let input = input
        .map_err(|_| DomainError::Invalid("Envie os parâmetros da estimativa IBPT"))?
        .0;
    let (tenant, tx, _) = authorized(
        &state,
        &headers,
        &identity,
        "fiscal.nfe.read",
        "fiscal.config.manage",
        false,
    )
    .await?;
    let result = state.ibpt.quote(tenant, &input)?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, None, result))
}
