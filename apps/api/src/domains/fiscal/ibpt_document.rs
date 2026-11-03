//! Server-owned estimates frozen with each draft revision, never accepted from a client.
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{
    ibpt::{
        Classification, GoodsOrigin, IbptAmounts, IbptCatalog, IbptInput, IbptMetadata, IbptStatus,
        date, valid_version,
    },
    model::{DraftInput, exact_decimal, products_total, state_code},
};
use crate::domains::DomainError;

const MAX_FISCAL_CENTS: i128 = 999_999_999_999_999;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IbptSelection {
    pub uf: String,
    pub as_of: String,
    pub items: Vec<IbptItemSelection>,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IbptItemSelection {
    pub ex: String,
    pub origin: GoodsOrigin,
    pub version: Option<String>,
}

impl IbptSelection {
    pub fn validate(&self, count: usize) -> Result<(), DomainError> {
        if state_code(&self.uf).is_none()
            || date(&self.as_of).is_none()
            || self.items.len() != count
            || count == 0
            || count > 990
            || self.items.iter().any(|item| {
                item.ex.is_empty()
                    || item.ex.len() > 3
                    || !item.ex.bytes().all(|c| c.is_ascii_digit())
                    || item.version.as_ref().is_some_and(|v| !valid_version(v))
            })
        {
            return Err(DomainError::Invalid(
                "IBPT exige UF, data válida e EX/origem explícitos para cada item",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IbptDocumentItem {
    pub item_code: String,
    /// NCM copied from the fiscal item, never inferred from its description.
    pub code: String,
    pub ex: String,
    pub origin: GoodsOrigin,
    /// Product value plus the declared per-item IPI in the supported NF-e scope.
    pub amount: String,
    pub metadata: IbptMetadata,
    pub amounts: IbptAmounts,
}

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IbptDocumentSnapshot {
    pub tenant_id: Uuid,
    pub uf: String,
    pub as_of: String,
    pub items: Vec<IbptDocumentItem>,
    pub amounts: IbptAmounts,
}

fn base(draft: &DraftInput, index: usize) -> Result<String, DomainError> {
    let product = exact_decimal(&draft.items[index].gross_total, 13, 2)?;
    let ipi_rate = draft
        .tax_declaration
        .as_ref()
        .and_then(|t| t.ipi_rate.as_deref())
        .map(|rate| exact_decimal(rate, 2, 4))
        .transpose()?
        .unwrap_or(0);
    let amount = product + (product * ipi_rate + 500_000) / 1_000_000;
    if amount > MAX_FISCAL_CENTS {
        return Err(DomainError::Invalid("Base IBPT excede o limite fiscal"));
    }
    Ok(products_total(amount as i64))
}

fn cents(amounts: &IbptAmounts) -> Result<[i128; 4], DomainError> {
    let values = [
        &amounts.federal,
        &amounts.state,
        &amounts.municipal,
        &amounts.total,
    ]
    .map(|v| exact_decimal(v, 13, 2));
    let [federal, state, municipal, total] = values;
    let values = [federal?, state?, municipal?, total?];
    if values[0] + values[1] + values[2] != values[3] || values[3] > MAX_FISCAL_CENTS {
        return Err(DomainError::Invalid(
            "Parcelas IBPT divergem do total ou excedem o limite fiscal",
        ));
    }
    Ok(values)
}

fn totals(values: [i128; 4]) -> Result<IbptAmounts, DomainError> {
    if values.iter().any(|value| *value > MAX_FISCAL_CENTS) {
        return Err(DomainError::Invalid("Total IBPT excede o limite fiscal"));
    }
    let [federal, state, municipal, total] = values.map(|v| products_total(v as i64));
    Ok(IbptAmounts {
        federal,
        state,
        municipal,
        total,
    })
}

pub fn snapshot(
    catalog: &IbptCatalog,
    tenant: Uuid,
    draft: &DraftInput,
) -> Result<Option<IbptDocumentSnapshot>, DomainError> {
    let Some(selection) = &draft.ibpt else {
        return Ok(None);
    };
    selection.validate(draft.items.len())?;
    let mut items = Vec::with_capacity(draft.items.len());
    let mut sum = [0_i128; 4];
    for (index, (item, choice)) in draft.items.iter().zip(&selection.items).enumerate() {
        let amount = base(draft, index)?;
        let quote = catalog.quote(
            tenant,
            &IbptInput {
                uf: selection.uf.clone(),
                classification: Classification::Ncm,
                code: item.ncm.clone(),
                ex: choice.ex.clone(),
                origin: choice.origin,
                amount: amount.clone(),
                as_of: selection.as_of.clone(),
                version: choice.version.clone(),
            },
        )?;
        if quote.status != IbptStatus::Available {
            return Err(DomainError::Conflict(
                "Estimativa IBPT indisponível: confira tabela, vigência, NCM/EX e versão; o cadastro manual foi preservado",
            ));
        }
        let metadata = quote
            .metadata
            .ok_or(DomainError::Conflict("Fonte IBPT não identificada"))?;
        let amounts = quote
            .amounts
            .ok_or(DomainError::Conflict("Estimativa IBPT não informada"))?;
        for (total, value) in sum.iter_mut().zip(cents(&amounts)?) {
            *total += value;
        }
        items.push(IbptDocumentItem {
            item_code: item.code.clone(),
            code: item.ncm.clone(),
            ex: choice.ex.clone(),
            origin: choice.origin,
            amount,
            metadata,
            amounts,
        });
    }
    Ok(Some(IbptDocumentSnapshot {
        tenant_id: tenant,
        uf: selection.uf.clone(),
        as_of: selection.as_of.clone(),
        items,
        amounts: totals(sum)?,
    }))
}

/// Check persisted provenance and exact bindings before allocating a fiscal number.
pub fn validate_for_issue(
    snapshot: Option<&IbptDocumentSnapshot>,
    tenant: Uuid,
    draft: &DraftInput,
    issued_at: &str,
) -> Result<(), DomainError> {
    let (selection, snapshot) = match (&draft.ibpt, snapshot) {
        (None, None) => return Ok(()),
        (Some(selection), Some(snapshot)) => (selection, snapshot),
        _ => {
            return Err(DomainError::Conflict(
                "Atualize o rascunho para conferir o snapshot IBPT",
            ));
        }
    };
    selection.validate(draft.items.len())?;
    let timestamp = OffsetDateTime::parse(issued_at, &Rfc3339)
        .map_err(|_| DomainError::Invalid("Data de emissão inválida"))?;
    let issue_date = timestamp
        .to_offset(UtcOffset::from_hms(-3, 0, 0).expect("SP offset"))
        .date();
    if snapshot.tenant_id != tenant
        || snapshot.uf != selection.uf
        || snapshot.as_of != selection.as_of
        || date(&snapshot.as_of) != Some(issue_date)
        || snapshot.items.len() != draft.items.len()
    {
        return Err(DomainError::Conflict(
            "Atualize a estimativa IBPT para os itens, empresa e data da emissão",
        ));
    }
    let mut sum = [0_i128; 4];
    for (index, ((item, choice), saved)) in draft
        .items
        .iter()
        .zip(&selection.items)
        .zip(&snapshot.items)
        .enumerate()
    {
        let meta = &saved.metadata;
        if saved.item_code != item.code
            || saved.code != item.ncm
            || saved.ex != choice.ex
            || saved.origin != choice.origin
            || saved.amount != base(draft, index)?
            || meta.uf != selection.uf
            || meta.classification != Classification::Ncm
            || !valid_version(&meta.version)
            || choice.version.as_ref().is_some_and(|v| *v != meta.version)
            || !date(&meta.valid_from).is_some_and(|from| from <= issue_date)
            || !date(&meta.valid_to).is_some_and(|to| issue_date <= to)
            || meta.source.trim().is_empty()
            || meta.key.trim().is_empty()
            || meta.sha256.len() != 64
            || !meta.sha256.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err(DomainError::Conflict(
                "Snapshot IBPT não corresponde ao item, versão ou vigência; atualize o rascunho",
            ));
        }
        for (total, value) in sum.iter_mut().zip(cents(&saved.amounts)?) {
            *total += value;
        }
    }
    if sum != cents(&snapshot.amounts)? {
        return Err(DomainError::Conflict(
            "Total IBPT diverge dos itens persistidos",
        ));
    }
    Ok(())
}
