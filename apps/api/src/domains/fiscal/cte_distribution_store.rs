//! Store the complete source batch before committing its independent CT-e cursor.
use crate::domains::{DomainError, db};
use roxmltree::Document;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

const ZERO: &str = "000000000000000";
const CTE: &str = "http://www.portalfiscal.inf.br/cte";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Batch {
    pub code: String,
    pub last_nsu: String,
    pub max_nsu: String,
    pub next_nsu: Option<String>,
    pub documents: Vec<DistributedDocument>,
}
#[derive(Deserialize)]
pub(super) struct DistributedDocument {
    pub nsu: String,
    pub schema: String,
    pub kind: String,
    pub xml: String,
}

pub(super) fn valid_nsu(nsu: &str) -> bool {
    nsu.len() == 15 && nsu.bytes().all(|byte| byte.is_ascii_digit())
}

pub(super) fn parse_batch(value: Value, requested: &str) -> Result<Batch, DomainError> {
    let invalid = || DomainError::Invalid("Lote de distribuição CT-e inválido");
    let batch: Batch = serde_json::from_value(value).map_err(|_| invalid())?;
    if !valid_nsu(requested)
        || batch.code.len() != 3
        || !batch.code.bytes().all(|byte| byte.is_ascii_digit())
        || !valid_nsu(&batch.last_nsu)
        || !valid_nsu(&batch.max_nsu)
        || batch.documents.len() > 50
    {
        return Err(invalid());
    }
    if !matches!(batch.code.as_str(), "137" | "138") {
        if batch.next_nsu.is_some() || !batch.documents.is_empty() {
            return Err(invalid());
        }
        return Ok(batch);
    }
    if batch.next_nsu.as_deref() != Some(batch.last_nsu.as_str())
        || batch.last_nsu.as_str() < requested
        || batch.last_nsu > batch.max_nsu
        || (batch.code == "137") != batch.documents.is_empty()
        || (batch.code == "138" && batch.last_nsu == requested)
    {
        return Err(invalid());
    }
    let mut previous = requested;
    let mut bytes = 0;
    for doc in &batch.documents {
        bytes += doc.xml.len();
        if !valid_nsu(&doc.nsu)
            || doc.nsu.as_str() <= previous
            || doc.nsu > batch.last_nsu
            || doc.xml.is_empty()
            || doc.xml.len() > 2_097_152
            || bytes > 8_388_608
            || doc.schema.len() > 100
            || !doc.schema.ends_with(".xsd")
            || !doc
                .schema
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
        {
            return Err(invalid());
        }
        let xml = Document::parse_with_options(
            &doc.xml,
            roxmltree::ParsingOptions {
                allow_dtd: false,
                nodes_limit: 100_000,
                ..Default::default()
            },
        )
        .map_err(|_| invalid())?;
        let root = xml.root_element();
        let full = schema_version(&doc.schema, "procCTe_v");
        let event = schema_version(&doc.schema, "procEventoCTe_v");
        let expected = if full {
            "full"
        } else if event {
            "event"
        } else {
            "unrecognized"
        };
        if doc.kind != expected
            || ((full || event)
                && (root.tag_name().namespace() != Some(CTE)
                    || root.tag_name().name() != if full { "cteProc" } else { "procEventoCTe" }))
        {
            return Err(invalid());
        }
        previous = &doc.nsu;
    }
    Ok(batch)
}

fn schema_version(schema: &str, prefix: &str) -> bool {
    schema
        .strip_prefix(prefix)
        .and_then(|s| s.strip_suffix(".xsd"))
        .and_then(|s| s.split_once('.'))
        .is_some_and(|(major, minor)| {
            !major.is_empty()
                && !minor.is_empty()
                && major
                    .bytes()
                    .chain(minor.bytes())
                    .all(|b| b.is_ascii_digit())
        })
}

pub(super) async fn snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    can_query: bool,
) -> Result<Value, DomainError> {
    let value: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('tenantId',tenant_id,'environment','homologation','companyTaxId',company_tax_id,'lastNsu',last_nsu,'maxNsu',max_nsu,'revision',revision,'nextQueryAt',next_query_at,'lastCode',last_code,'running',COALESCE(lease_until>clock_timestamp(),false)) FROM fiscal_cte_distribution_state WHERE tenant_id=$1 AND environment=2")
        .bind(tenant).fetch_optional(&mut **tx).await.map_err(db)?;
    let mut value = value.unwrap_or_else(|| json!({"tenantId":tenant,"environment":"homologation","companyTaxId":null,"lastNsu":ZERO,"maxNsu":ZERO,"revision":1,"nextQueryAt":null,"lastCode":null,"running":false}));
    value["canQuery"] = json!(can_query);
    Ok(value)
}

pub(super) async fn save_documents(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    run: Uuid,
    company_tax_id: &str,
    documents: &[DistributedDocument],
) -> Result<(), DomainError> {
    for doc in documents {
        let hash = format!("{:x}", Sha256::digest(doc.xml.as_bytes()));
        sqlx::query("INSERT INTO fiscal_cte_distribution_documents(tenant_id,id,run_id,environment,company_tax_id,nsu,schema_name,kind,xml,xml_sha256) VALUES($1,$2,$3,2,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,environment,company_tax_id,nsu) DO NOTHING")
            .bind(tenant).bind(Uuid::now_v7()).bind(run).bind(company_tax_id).bind(&doc.nsu).bind(&doc.schema).bind(&doc.kind).bind(&doc.xml).bind(&hash).execute(&mut **tx).await.map_err(db)?;
        let identical: bool = sqlx::query_scalar("SELECT xml_sha256=$4 AND schema_name=$5 AND kind=$6 AND xml=$7 FROM fiscal_cte_distribution_documents WHERE tenant_id=$1 AND environment=2 AND company_tax_id=$2 AND nsu=$3")
            .bind(tenant).bind(company_tax_id).bind(&doc.nsu).bind(hash).bind(&doc.schema).bind(&doc.kind).bind(&doc.xml).fetch_one(&mut **tx).await.map_err(db)?;
        if !identical {
            return Err(DomainError::Conflict(
                "NSU CT-e existente com outro conteúdo",
            ));
        }
    }
    Ok(())
}
