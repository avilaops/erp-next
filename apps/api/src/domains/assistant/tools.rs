use axum::{
    Extension,
    body::to_bytes,
    extract::{Query, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    domains::{catalog, inventory},
    platform::{access, auth::AuthenticatedIdentity, state::AppState},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Arguments {
    pub q: String,
}

pub(super) fn arguments(value: Value) -> Result<Arguments, &'static str> {
    let mut args: Arguments =
        serde_json::from_value(value).map_err(|_| "Argumentos da consulta inválidos.")?;
    args.q = args.q.trim().to_owned();
    if args.q.is_empty() || args.q.chars().count() > 160 {
        return Err("Informe um nome ou SKU de até 160 caracteres.");
    }
    Ok(args)
}

// The server owns every route and permission; the model supplies only a search term.
const PAGES: &[(&str, &str, &str, &str)] = &[
    (
        "Produtos",
        "/cadastros/produtos",
        "catalog.products.read",
        "produto produtos catálogo catalogo sku preço preco",
    ),
    (
        "Estoque",
        "/estoque/saldos",
        "inventory.stock.read",
        "estoque saldo saldos disponível disponivel reservado",
    ),
    (
        "Clientes e fornecedores",
        "/cadastros/clientes-fornecedores",
        "catalog.parties.read",
        "cliente clientes fornecedor fornecedores",
    ),
    (
        "Pedidos de venda",
        "/vendas/pedidos",
        "sales.orders.read",
        "pedido pedidos venda vendas",
    ),
    (
        "Contas a receber",
        "/financeiro/contas-receber",
        "finance.receivables.read",
        "financeiro finanças receber recebimento",
    ),
    (
        "Contas a pagar",
        "/financeiro/contas-pagar",
        "finance.payables.read",
        "financeiro finanças pagar pagamento",
    ),
];

pub(super) async fn execute(
    state: &AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    name: &str,
    args: Arguments,
) -> Result<Value, super::ChatError> {
    if name == "localizar_funcionalidade" {
        let tenant = access::tenant_id(headers)?;
        let mut tx = access::tenant_transaction(state, tenant).await?;
        let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
        let query = args.q.to_lowercase();
        let candidates: Vec<_> = PAGES
            .iter()
            .filter(|(_, _, _, keywords)| {
                query
                    .split_whitespace()
                    .filter(|word| word.chars().count() >= 3)
                    .any(|word| keywords.split_whitespace().any(|keyword| keyword == word))
            })
            .collect();
        let data: Vec<_> = candidates
            .iter()
            .filter(|(_, _, permission, _)| access::require_permission(&rights, permission).is_ok())
            .map(|(title, href, _, _)| json!({"title":title,"href":href}))
            .collect();
        if !candidates.is_empty() && data.is_empty() {
            return Err(access::AccessError::Forbidden.into());
        }
        tx.commit().await.map_err(access::database_error)?;
        return Ok(
            json!({"tool":name,"origin":"Catálogo de funcionalidades do ERP","data":data,"total":data.len()}),
        );
    }
    let query = Ok(Query(catalog::ProductQuery {
        q: Some(args.q),
        status: None,
        offset: Some(0),
        limit: Some(5),
    }));
    let response = match name {
        "buscar_produtos" => {
            catalog::list(
                State(state.clone()),
                Extension(identity.clone()),
                headers.clone(),
                query,
            )
            .await?
        }
        "consultar_estoque" => {
            inventory::balances(
                State(state.clone()),
                Extension(identity.clone()),
                headers.clone(),
                query,
            )
            .await?
        }
        _ => {
            return Err(super::ChatError::invalid(
                "Ferramenta não autorizada. Nenhuma ação foi executada.",
            ));
        }
    };
    let bytes = to_bytes(response.into_body(), 32_768)
        .await
        .map_err(|_| super::ChatError::unavailable("Resposta do ERP excedeu o limite."))?;
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| super::ChatError::unavailable("Resposta do ERP inválida."))?;
    let data: Vec<Value> = value["data"].as_array().ok_or_else(|| super::ChatError::unavailable("Resposta do ERP inválida."))?.iter().map(|record| {
        let id = if name == "buscar_produtos" { &record["id"] } else { &record["productId"] };
        let mut item = json!({"title":record["name"],"sku":record["sku"],"unit":record["unit"],"status":record["status"],
            "href":format!("/cadastros/produtos/{}", id.as_str().unwrap_or_default())});
        if name == "buscar_produtos" { item["basePrice"] = record["basePrice"].clone(); }
        else { for field in ["quantity", "reserved", "available"] { item[field] = record[field].clone(); } }
        item
    }).collect();
    Ok(
        json!({"tool":name,"origin":if name == "buscar_produtos" {"API ERP · Produtos"} else {"API ERP · Estoque"},
        "data":data,"total":value["total"],"limit":5}),
    )
}
