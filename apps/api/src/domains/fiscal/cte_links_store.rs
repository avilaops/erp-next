use super::model::*;
use super::super::cte_inspection::{self, CteCommercialFacts};
use crate::{domains::{DomainError, db}, platform::{access, valid_document}};
use sqlx::{FromRow, Postgres, Transaction};
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

pub(super) struct Rights { pub manage: bool, pub parties: bool, pub purchase: bool, pub sale: bool }
impl Rights {
    pub fn can(&self, kind: CteLinkKind) -> bool { self.manage && self.parties && match kind { CteLinkKind::Purchase=>self.purchase, CteLinkKind::Sale=>self.sale } }
}
pub(super) async fn rights(tx: &mut Transaction<'_,Postgres>, tenant: Uuid, subject: &str) -> Result<Rights,DomainError> {
    let access=access::load_access(tx,tenant,subject).await?;
    access::require_permission(&access,"fiscal.cte.read")?;
    let has=|p|access::require_permission(&access,p).is_ok();
    Ok(Rights{manage:has("fiscal.cte.link"),parties:has("catalog.parties.read"),purchase:has("purchasing.orders.read"),sale:has("sales.orders.read")})
}

pub(super) struct Source { pub id: Uuid, pub inspection: Uuid, pub hash: String, pub company: String, pub company_name: String, pub facts: CteCommercialFacts }
#[derive(FromRow)]
struct Original { company_tax_id: String, xml: String, xml_sha256: String, kind: String, schema_name: String, current_tax_id: String, legal_name: String }
pub(super) async fn source(tx: &mut Transaction<'_,Postgres>, tenant: Uuid, id: Uuid) -> Result<Source,DomainError> {
    let row: Original=sqlx::query_as("SELECT d.company_tax_id,d.xml,d.xml_sha256,d.kind,d.schema_name,t.tax_id AS current_tax_id,t.legal_name FROM fiscal_cte_distribution_documents d JOIN tenants t ON t.id=d.tenant_id WHERE d.tenant_id=$1 AND d.id=$2 AND d.environment=2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if row.current_tax_id!=row.company_tax_id || !row.current_tax_id.bytes().all(|b|b.is_ascii_digit()) || !valid_document(&row.current_tax_id,"juridica") {
        return Err(DomainError::Conflict("O CNPJ atual diverge da coleta; confira a empresa antes de vincular"));
    }
    if row.kind!="full" || row.schema_name!="procCTe_v4.00.xsd" { return Err(DomainError::Conflict("Conferência CT-e suportada obrigatória antes do vínculo")); }
    let (inspection, metadata):(Uuid,serde_json::Value)=sqlx::query_as("SELECT id,metadata FROM fiscal_cte_inspections WHERE tenant_id=$1 AND document_id=$2 AND source_xml_sha256=$3 AND inspector_version='cte-received-v1'")
        .bind(tenant).bind(id).bind(&row.xml_sha256).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::Conflict("Confira o XML CT-e antes de criar vínculos comerciais"))?;
    let facts=cte_inspection::commercial_facts(metadata,&row.xml,&row.company_tax_id).map_err(|_|DomainError::Conflict("A conferência não corresponde ao XML preservado; nenhum vínculo foi aplicado"))?;
    Ok(Source{id,inspection,hash:row.xml_sha256,company:row.company_tax_id,company_name:row.legal_name,facts})
}

pub(super) async fn revision(tx: &mut Transaction<'_,Postgres>, tenant: Uuid, doc: Uuid) -> Result<i64,DomainError> {
    sqlx::query_scalar("SELECT 1+(SELECT count(*) FROM fiscal_cte_commercial_links WHERE tenant_id=$1 AND document_id=$2)+(SELECT count(*) FROM fiscal_cte_commercial_unlinks WHERE tenant_id=$1 AND document_id=$2)")
        .bind(tenant).bind(doc).fetch_one(&mut **tx).await.map_err(db)
}
pub(super) async fn carrier(tx: &mut Transaction<'_,Postgres>, tenant: Uuid, source: &Source, rights: &Rights) -> Result<CteCarrierChoice,DomainError> {
    let own=source.company==source.facts.carrier_tax_id;
    if own { return Ok(CteCarrierChoice{party_id:None,tax_id:source.company.clone(),name:source.company_name.clone(),own_company:true,available:rights.parties}); }
    let found:Option<(Uuid,String)>=if rights.parties {
        sqlx::query_as("SELECT id,legal_name FROM parties WHERE tenant_id=$1 AND tax_id=$2 AND status='active' AND person_type='juridica'")
            .bind(tenant).bind(&source.facts.carrier_tax_id).fetch_optional(&mut **tx).await.map_err(db)?
    } else { None };
    Ok(CteCarrierChoice{party_id:found.as_ref().map(|r|r.0),tax_id:source.facts.carrier_tax_id.clone(),name:found.as_ref().map(|r|r.1.clone()).or_else(||source.facts.carrier_name.clone()).unwrap_or_else(||"Transportadora do XML".to_owned()),own_company:false,available:found.is_some()})
}

#[derive(FromRow)]
pub(super) struct LinkRow {
    pub id: Uuid, pub carrier_party_id: Option<Uuid>, pub carrier_tax_id: String, pub carrier_name: String,
    pub purchase_order_id: Option<Uuid>, pub sales_order_id: Option<Uuid>, pub counterparty_name: String,
    pub order_amount_cents: i64, pub order_revision: i64, pub freight_cents: i64, pub reason: String,
    pub created_at: time::OffsetDateTime,
}
pub(super) async fn active(tx: &mut Transaction<'_,Postgres>, tenant: Uuid, doc: Uuid) -> Result<Vec<LinkRow>,DomainError> {
    sqlx::query_as("SELECT l.id,l.carrier_party_id,l.carrier_tax_id,l.carrier_name,l.purchase_order_id,l.sales_order_id,l.counterparty_name,l.order_amount_cents,l.order_revision,l.freight_cents,l.reason,l.created_at FROM fiscal_cte_commercial_links l WHERE l.tenant_id=$1 AND l.document_id=$2 AND NOT EXISTS(SELECT 1 FROM fiscal_cte_commercial_unlinks u WHERE u.tenant_id=l.tenant_id AND u.link_id=l.id) ORDER BY l.created_at,l.id")
        .bind(tenant).bind(doc).fetch_all(&mut **tx).await.map_err(db)
}
pub(super) async fn view(tx: &mut Transaction<'_,Postgres>,tenant: Uuid, source: &Source, rights: &Rights) -> Result<CteCommercialLinks,DomainError> {
    let rows=active(tx,tenant,source.id).await?;
    let allocated=rows.iter().try_fold(0_i64,|sum,row|sum.checked_add(row.freight_cents)).ok_or(access::AccessError::Internal)?;
    let mut data=Vec::with_capacity(rows.len());
    for row in rows {
        let (kind,order_id)=match (row.purchase_order_id,row.sales_order_id) { (Some(id),None)=>(CteLinkKind::Purchase,id), (None,Some(id))=>(CteLinkKind::Sale,id), _=>return Err(access::AccessError::Internal.into()) };
        data.push(CteCommercialLink{id:row.id,kind,order_id,carrier_party_id:row.carrier_party_id,carrier_tax_id:row.carrier_tax_id,carrier_name:row.carrier_name,counterparty_name:row.counterparty_name,order_amount_cents:row.order_amount_cents.to_string(),order_revision:row.order_revision,freight_cents:row.freight_cents.to_string(),reason:row.reason,created_at:row.created_at.format(&Rfc3339).map_err(|_|access::AccessError::Internal)?,can_unlink:rights.can(kind)});
    }
    Ok(CteCommercialLinks{tenant_id:tenant,document_id:source.id,inspection_id:source.inspection,source_xml_sha256:source.hash.clone(),revision:revision(tx,tenant,source.id).await?,service_cents:source.facts.service_cents.to_string(),allocated_cents:allocated.to_string(),can_link_purchase:rights.can(CteLinkKind::Purchase),can_link_sale:rights.can(CteLinkKind::Sale),carrier:carrier(tx,tenant,source,rights).await?,data})
}

pub(super) fn order_query(kind: CteLinkKind) -> (&'static str,&'static str,&'static str) {
    match kind {
        CteLinkKind::Purchase=>("purchase_orders","supplier","status IN ('confirmed','partially_received','received','closed')"),
        CteLinkKind::Sale=>("sales_orders","customer","status IN ('confirmed','completed')"),
    }
}
pub(super) async fn options(tx:&mut Transaction<'_,Postgres>,tenant:Uuid,source:&Source,query:CteLinkOptionsQuery) -> Result<CteCommercialOptions,DomainError> {
    let offset=query.offset.unwrap_or(0); let limit=query.limit.unwrap_or(25);
    if offset>100000 || !(1..=50).contains(&limit) { return Err(DomainError::Invalid("Paginação de pedidos inválida")); }
    let (table,party,status)=order_query(query.kind);
    let data=sqlx::query_as(&format!("SELECT id,{party}_name AS counterparty_name,{party}_tax_id AS counterparty_tax_id,due_date::text AS due_date,amount_cents::text AS amount_cents,status,revision FROM {table} WHERE tenant_id=$1 AND {status} ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3"))
        .bind(tenant).bind(i64::from(limit)).bind(i64::from(offset)).fetch_all(&mut **tx).await.map_err(db)?;
    let total=sqlx::query_scalar(&format!("SELECT count(*) FROM {table} WHERE tenant_id=$1 AND {status}"))
        .bind(tenant).fetch_one(&mut **tx).await.map_err(db)?;
    Ok(CteCommercialOptions{tenant_id:tenant,document_id:source.id,source_xml_sha256:source.hash.clone(),kind:query.kind,data,total,offset,limit})
}
#[derive(FromRow)]
pub(super) struct Target { pub counterparty_name:String, pub amount_cents:i64, pub revision:i64, pub eligible:bool }
pub(super) async fn target(tx:&mut Transaction<'_,Postgres>,tenant:Uuid,kind:CteLinkKind,id:Uuid) -> Result<Target,DomainError> {
    let (table,party,status)=order_query(kind);
    let row:Target=sqlx::query_as(&format!("SELECT {party}_name AS counterparty_name,amount_cents,revision,{status} AS eligible FROM {table} WHERE tenant_id=$1 AND id=$2 FOR SHARE"))
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if !row.eligible { return Err(DomainError::Conflict("O pedido precisa estar confirmado e não cancelado para receber vínculo CT-e")); }
    Ok(row)
}
