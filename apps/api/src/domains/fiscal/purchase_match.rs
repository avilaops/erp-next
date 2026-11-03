//! A document link is distinct from physical receipt, stock and accounts payable.
use super::{
    FiscalError,
    incoming::ItemMapping,
    input,
    received_model::{self, ReceivedItem},
};
use crate::{
    domains::{
        DomainChange, DomainError, authorized, command_key, db, record, remember, replay, response,
        revision,
    },
    platform::{access, auth::AuthenticatedIdentity, state::AppState},
};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use std::collections::{BTreeMap, HashSet};
use uuid::Uuid;

#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatchInput {
    purchase_order_id: Uuid,
    purchase_revision: i64,
    items: Vec<ItemMapping>,
}

struct Prepared {
    items: Vec<ReceivedItem>,
    mapping: BTreeMap<i32, Uuid>,
    supplier: Uuid,
    preview: Value,
}

fn difference(
    differences: &mut Vec<Value>,
    code: &str,
    item: Option<i32>,
    blocking: bool,
    message: &str,
) {
    differences.push(json!({"code":code,"itemNumber":item,"blocking":blocking,"message":message}));
}

async fn prepare(
    tx: &mut Transaction<'_, Postgres>,
    tenant: Uuid,
    id: i64,
    request: &MatchInput,
) -> Result<Prepared, DomainError> {
    if request.items.is_empty() || request.items.len() > 100 || request.purchase_revision < 1 {
        return Err(DomainError::Invalid(
            "Informe revisão e de 1 a 100 itens fiscais mapeados",
        ));
    }
    let (xml, issuer, recipient, environment, key): (String,String,String,i16,String) = sqlx::query_as("SELECT xml,issuer_document,recipient_document,environment,access_key FROM fiscal_received_nfes WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    let current_tax_id: String = sqlx::query_scalar("SELECT tax_id FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut **tx)
        .await
        .map_err(db)?;
    if recipient != current_tax_id || !matches!(environment, 1 | 2) {
        return Err(DomainError::Conflict(
            "Destinatário ou ambiente da nota não corresponde à empresa",
        ));
    }
    super::production_events::ensure_operable(tx, tenant, &key, environment).await?;
    let items =
        received_model::inspect_purchase_items(&xml, &recipient).map_err(DomainError::Invalid)?;
    if items.len() != request.items.len() {
        return Err(DomainError::Invalid("Mapeie todos os itens da NF-e"));
    }
    let mut mapping = BTreeMap::new();
    let mut products = HashSet::new();
    for item in &request.items {
        if !items.iter().any(|source| source.number == item.item_number)
            || mapping.insert(item.item_number, item.product_id).is_some()
            || !products.insert(item.product_id)
        {
            return Err(DomainError::Invalid(
                "Itens fiscais e produtos devem ser conhecidos e sem repetição",
            ));
        }
    }
    let (supplier, supplier_tax, status, purchase_revision): (Uuid,String,String,i64) = sqlx::query_as("SELECT supplier_id,supplier_tax_id,status,revision FROM purchase_orders WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(request.purchase_order_id).fetch_optional(&mut **tx).await.map_err(db)?.ok_or(DomainError::NotFound)?;
    if purchase_revision != request.purchase_revision {
        return Err(DomainError::StaleRevision);
    }
    let mut differences = Vec::new();
    let linked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_received_purchase_links WHERE tenant_id=$1 AND (received_nfe_id=$2 OR purchase_order_id=$3))")
        .bind(tenant).bind(id).bind(request.purchase_order_id).fetch_one(&mut **tx).await.map_err(db)?;
    if linked {
        difference(
            &mut differences,
            "already_linked",
            None,
            true,
            "A nota ou a compra já possui vínculo fiscal.",
        );
    }
    let active_supplier: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM parties WHERE tenant_id=$1 AND id=$2 AND tax_id=$3 AND is_supplier AND status='active')")
        .bind(tenant).bind(supplier).bind(&issuer).fetch_one(&mut **tx).await.map_err(db)?;
    if supplier_tax != issuer || !active_supplier {
        difference(
            &mut differences,
            "supplier_mismatch",
            None,
            true,
            "O fornecedor ativo da compra deve corresponder ao emitente da NF-e.",
        );
    }
    let previous_receipts: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM purchase_receipts WHERE tenant_id=$1 AND order_id=$2)",
    )
    .bind(tenant)
    .bind(request.purchase_order_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(db)?;
    if status != "confirmed" || previous_receipts {
        difference(
            &mut differences,
            "purchase_not_eligible",
            None,
            true,
            "Selecione compra confirmada, sem recebimentos anteriores e sem outra NF-e vinculada.",
        );
    }
    let mut rows = Vec::new();
    for item in &items {
        let product = mapping[&item.number];
        let catalog: Option<(String, Option<String>, String)> =
            sqlx::query_as("SELECT unit,ncm,status FROM products WHERE tenant_id=$1 AND id=$2")
                .bind(tenant)
                .bind(product)
                .fetch_optional(&mut **tx)
                .await
                .map_err(db)?;
        let line: Option<(String,i64,i64,i64)> = sqlx::query_as("SELECT unit,quantity_micros,received_micros,cost_cents FROM purchase_order_lines WHERE tenant_id=$1 AND order_id=$2 AND product_id=$3")
            .bind(tenant).bind(request.purchase_order_id).bind(product).fetch_optional(&mut **tx).await.map_err(db)?;
        let (remaining, cost) = match line {
            Some((unit, ordered, received, cost)) => {
                if unit != item.unit {
                    difference(
                        &mut differences,
                        "unit_mismatch",
                        Some(item.number),
                        true,
                        "A unidade da compra difere da unidade comercial do XML.",
                    );
                }
                if item.quantity_micros > ordered - received {
                    difference(
                        &mut differences,
                        "quantity_exceeded",
                        Some(item.number),
                        true,
                        "A quantidade da nota excede o saldo pendente da compra.",
                    );
                }
                if cost != item.unit_cost_cents {
                    difference(
                        &mut differences,
                        "unit_cost_mismatch",
                        Some(item.number),
                        true,
                        "O custo posto por unidade da nota difere do custo aprovado na compra.",
                    );
                }
                (ordered - received, Some(cost))
            }
            None => {
                difference(
                    &mut differences,
                    "product_not_in_purchase",
                    Some(item.number),
                    true,
                    "O produto mapeado não pertence à compra selecionada.",
                );
                (0, None)
            }
        };
        match catalog {
            Some((unit, ncm, status)) => {
                if status != "active" || unit != item.unit {
                    difference(
                        &mut differences,
                        "catalog_mismatch",
                        Some(item.number),
                        true,
                        "O produto deve estar ativo e ter a mesma unidade comercial do XML.",
                    );
                }
                match ncm {
                    None => difference(
                        &mut differences,
                        "ncm_missing",
                        Some(item.number),
                        false,
                        "O produto não tem NCM cadastrado. Confira a classificação fiscal.",
                    ),
                    Some(ncm) if ncm != item.ncm => difference(
                        &mut differences,
                        "ncm_mismatch",
                        Some(item.number),
                        false,
                        "O NCM do catálogo difere do XML. Confira a classificação fiscal; o cadastro será preservado.",
                    ),
                    _ => {}
                }
            }
            None => difference(
                &mut differences,
                "product_unavailable",
                Some(item.number),
                true,
                "O produto mapeado não está disponível nesta empresa.",
            ),
        }
        rows.push(json!({"itemNumber":item.number,"productId":product,"name":item.name,"unit":item.unit,"ncm":item.ncm,"invoiceQuantityMicros":item.quantity_micros,"remainingQuantityMicros":remaining,"invoiceUnitCostCents":item.unit_cost_cents,"purchaseUnitCostCents":cost,"landedCents":item.landed_cents,"components":item.components}));
    }
    let can_confirm = !differences.iter().any(|value| value["blocking"] == true);
    let total: i64 = items.iter().map(|item| item.landed_cents).sum();
    let preview = json!({"receivedNfeId":id,"purchaseOrderId":request.purchase_order_id,"purchaseRevision":purchase_revision,"canConfirm":can_confirm,"invoiceTotalCents":total,"differences":differences,"items":rows});
    Ok(Prepared {
        items,
        mapping,
        supplier,
        preview,
    })
}

async fn access_match<'a>(
    state: &'a AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    write: bool,
) -> Result<(Uuid, Transaction<'a, Postgres>), DomainError> {
    let (tenant, mut tx, _) = authorized(
        state,
        headers,
        identity,
        "fiscal.received_nfe.manage",
        "fiscal.received_nfe.manage",
        write,
    )
    .await?;
    let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
    access::require_permission(&rights, "purchasing.orders.read")?;
    if write {
        access::require_permission(&rights, "purchasing.orders.manage")?;
    }
    Ok((tenant, tx))
}

#[utoipa::path(post,path="/api/v1/fiscal/received-nfes/{id}/purchase/preview",tag="Fiscal",request_body=MatchInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=i64,Path)),responses((status=200,body=Value),(status=403,description="Sem permissão fiscal ou de compras"),(status=404,description="Nota ou compra ausente"),(status=412,description="Compra alterada"),(status=422,description="Mapeamento inválido")))]
pub async fn preview(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    payload: Result<Json<MatchInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let request = input(payload)?;
    let (tenant, mut tx) = access_match(&state, &identity, &headers, false).await?;
    let result = prepare(&mut tx, tenant, id, &request).await?.preview;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::OK, Some(1), result))
}

#[utoipa::path(post,path="/api/v1/fiscal/received-nfes/{id}/purchase/match",tag="Fiscal",request_body=MatchInput,security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("id"=i64,Path),("If-Match"=String,Header),("Idempotency-Key"=Uuid,Header)),responses((status=201,body=Value),(status=403,description="Sem permissão"),(status=404,description="Nota ou compra ausente"),(status=409,description="Divergências ou vínculo existente"),(status=412,description="Revisão desatualizada"),(status=428,description="Revisão e chave obrigatórias")))]
pub async fn link(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    payload: Result<Json<MatchInput>, JsonRejection>,
) -> Result<Response, FiscalError> {
    let request = input(payload)?;
    let expected = revision(&headers)?;
    let key = command_key(&headers)?;
    let (tenant, mut tx) = access_match(&state, &identity, &headers, true).await?;
    let command = json!({"receivedNfeId":id,"revision":expected,"input":request});
    if let Some(previous) = replay(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.received.match",
        &command,
    )
    .await?
    {
        tx.commit().await.map_err(db)?;
        return Ok(response(StatusCode::CREATED, Some(2), previous));
    }
    let linked: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fiscal_received_purchase_links WHERE tenant_id=$1 AND received_nfe_id=$2)")
        .bind(tenant).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
    if expected != if linked { 2 } else { 1 } {
        return Err(DomainError::StaleRevision.into());
    }
    let prepared = prepare(&mut tx, tenant, id, &request).await?;
    if prepared.preview["canConfirm"] != true {
        return Err(DomainError::Conflict(
            "Resolva as divergências impeditivas antes de confirmar o vínculo documental",
        )
        .into());
    }
    sqlx::query("INSERT INTO fiscal_received_purchase_links(tenant_id,received_nfe_id,purchase_order_id,supplier_id) VALUES($1,$2,$3,$4)")
        .bind(tenant).bind(id).bind(request.purchase_order_id).bind(prepared.supplier).execute(&mut *tx).await.map_err(db)?;
    for item in prepared.items {
        sqlx::query("INSERT INTO fiscal_received_item_costs(tenant_id,received_nfe_id,item_number,product_id,purchase_order_id,unit,quantity_micros,unit_cost_cents,merchandise_cents,landed_cents,components) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
            .bind(tenant).bind(id).bind(item.number).bind(prepared.mapping[&item.number]).bind(request.purchase_order_id).bind(item.unit).bind(item.quantity_micros).bind(item.unit_cost_cents).bind(item.merchandise_cents).bind(item.landed_cents).bind(item.components).execute(&mut *tx).await.map_err(db)?;
    }
    sqlx::query("UPDATE purchase_orders SET revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2")
        .bind(tenant).bind(request.purchase_order_id).execute(&mut *tx).await.map_err(db)?;
    record(&mut tx,tenant,&identity,&headers,DomainChange {kind:"purchase_order",id:request.purchase_order_id,event:"fiscal.received.purchase_linked",details:json!({"receivedNfeId":id,"previousRevision":request.purchase_revision,"revision":request.purchase_revision+1,"preview":prepared.preview})}).await?;
    let result =
        json!({"receivedNfeId":id,"purchaseOrderId":request.purchase_order_id,"revision":2});
    remember(
        &mut tx,
        tenant,
        &identity.subject,
        key,
        "fiscal.received.match",
        &command,
        &result,
    )
    .await?;
    tx.commit().await.map_err(db)?;
    Ok(response(StatusCode::CREATED, Some(2), result))
}
