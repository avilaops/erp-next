use axum::{
    Extension,
    body::to_bytes,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    domains::{DomainError, catalog, inventory, parties, sales},
    platform::{access, auth::AuthenticatedIdentity, state::AppState},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Arguments {
    pub q: String,
}

pub(super) enum CallArguments {
    Search(Arguments),
    RecentOrders,
    Order(Uuid),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyArguments {}

pub(super) fn parse_call(
    name: &str,
    value: Value,
    question: &str,
) -> Result<CallArguments, &'static str> {
    match name {
        "localizar_funcionalidade"
        | "buscar_produtos"
        | "consultar_estoque"
        | "buscar_clientes" => arguments(value).map(CallArguments::Search),
        "listar_pedidos" => serde_json::from_value::<EmptyArguments>(value)
            .map(|_| CallArguments::RecentOrders)
            .map_err(|_| "A listagem de pedidos não aceita filtros ou outra empresa."),
        "consultar_pedido" => {
            serde_json::from_value::<EmptyArguments>(value)
                .map_err(|_| "O identificador do pedido deve ser informado na pergunta, não nos argumentos da ferramenta.")?;
            let mut ids: Vec<_> = question
                .split(|c: char| !c.is_ascii_hexdigit() && c != '-')
                .filter_map(|value| Uuid::parse_str(value).ok())
                .collect();
            ids.sort_unstable();
            ids.dedup();
            if ids.len() != 1 {
                return Err("Informe exatamente um identificador UUID de pedido na pergunta.");
            }
            Ok(CallArguments::Order(ids[0]))
        }
        _ => Err("Ferramenta não autorizada. Nenhuma ação foi executada."),
    }
}

pub(super) fn definitions() -> Vec<Value> {
    let mut tools: Vec<Value> = [
        ("localizar_funcionalidade", "Localizar uma tela do ERP. q: produto, estoque, cliente, pedido, financeiro, receber ou pagar."),
        ("buscar_produtos", "Consultar produtos reais da empresa pelo nome ou SKU. q deve ser apenas o nome ou SKU solicitado."),
        ("consultar_estoque", "Consultar saldo, reservado e disponível de produtos pelo nome ou SKU. q deve ser apenas o nome ou SKU solicitado."),
        ("buscar_clientes", "Buscar clientes pelo nome, razão social ou documento. q deve ser apenas o nome ou documento informado, nunca a pergunta inteira. Retorna até cinco clientes."),
    ].into_iter().map(|(name, description)| json!({"type":"function","function":{
        "name":name,"description":description,"parameters":{"type":"object","properties":{
            "q":{"type":"string","minLength":1,"maxLength":160}},"required":["q"],"additionalProperties":false}}})).collect();
    tools.push(json!({"type":"function","function":{"name":"listar_pedidos",
        "description":"Listar até cinco pedidos de venda mais recentes da empresa. Não filtra por cliente, status ou período e não calcula totais gerais.",
        "parameters":{"type":"object","properties":{},"additionalProperties":false}}}));
    tools.push(json!({"type":"function","function":{"name":"consultar_pedido",
        "description":"Consultar o resumo do pedido de venda identificado na pergunta atual. O servidor extrai o UUID exato da pergunta. Esta ferramenta não recebe argumentos.",
        "parameters":{"type":"object","properties":{},"additionalProperties":false}}}));
    tools
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

/// Explicit screen requests use the same authorized route catalogue without
/// asking a small language model to distinguish "stock page" from stock data.
pub(super) fn navigation_request(question: &str) -> Option<Arguments> {
    let lower = question.to_lowercase();
    let words: Vec<_> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect();
    let normalized = words.join(" ");
    let where_request = [
        "onde vejo",
        "onde encontro",
        "onde fica",
        "onde ficam",
        "onde acesso",
        "onde consultar",
    ]
    .iter()
    .any(|phrase| normalized.contains(phrase));
    let screen = [
        "tela",
        "telas",
        "menu",
        "menus",
        "página",
        "páginas",
        "pagina",
        "paginas",
        "funcionalidade",
        "funcionalidades",
    ]
    .iter()
    .any(|word| words.contains(word));
    let open = [
        "abrir",
        "abra",
        "acessar",
        "acesse",
        "ver",
        "vejo",
        "mostra",
        "mostre",
        "mostrar",
        "localizar",
        "localize",
        "encontrar",
        "encontre",
    ]
    .iter()
    .any(|word| words.contains(word));
    if !where_request && !(screen && open) {
        return None;
    }
    // At most one known term per page: bounded and never an arbitrary URL or tenant.
    let terms: Vec<_> = PAGES
        .iter()
        .filter_map(|(_, _, _, keywords)| {
            keywords
                .split_whitespace()
                .find(|keyword| words.contains(keyword))
        })
        .collect();
    Some(Arguments {
        q: if terms.is_empty() {
            "funcionalidade desconhecida".into()
        } else {
            terms.join(" ")
        },
    })
}

pub(super) async fn execute(
    state: &AppState,
    identity: &AuthenticatedIdentity,
    headers: &HeaderMap,
    name: &str,
    args: CallArguments,
) -> Result<Value, super::ChatError> {
    let args = match (name, args) {
        ("listar_pedidos", CallArguments::RecentOrders) => {
            let response = sales::list(
                State(state.clone()),
                Extension(identity.clone()),
                headers.clone(),
                Ok(Query(sales::OrderQuery {
                    offset: Some(0),
                    limit: Some(5),
                })),
            )
            .await?;
            let value = read_response(response).await?;
            let data = records(&value)?
                .iter()
                .map(order_record)
                .collect::<Result<Vec<_>, _>>()?;
            return Ok(
                json!({"tool":name,"origin":"API ERP · Pedidos recentes","scope":"Pedidos mais recentes da empresa, sem filtros por cliente, situação ou período.","data":data,"total":value["total"],"limit":5}),
            );
        }
        ("consultar_pedido", CallArguments::Order(id)) => {
            let response = sales::get(
                State(state.clone()),
                Extension(identity.clone()),
                headers.clone(),
                Path(id),
            )
            .await;
            let data = match response {
                Ok(response) => vec![order_record(&read_response(response).await?["data"])?],
                Err(DomainError::NotFound) => vec![],
                Err(error) => return Err(error.into()),
            };
            return Ok(
                json!({"tool":name,"origin":"API ERP · Pedido","total":data.len(),"data":data,"limit":1}),
            );
        }
        (
            "localizar_funcionalidade"
            | "buscar_produtos"
            | "consultar_estoque"
            | "buscar_clientes",
            CallArguments::Search(args),
        ) => args,
        _ => {
            return Err(super::ChatError::invalid(
                "Argumentos incompatíveis com a ferramenta.",
            ));
        }
    };
    if name == "buscar_clientes" {
        // Reuse the domain handler, including authorization, tenant RLS and validation.
        let query = serde_json::from_value::<parties::PartyQuery>(
            json!({"q":args.q,"role":"customer","offset":0,"limit":5}),
        )
        .map_err(|_| super::ChatError::invalid("Busca de cliente inválida."))?;
        let response = parties::list(
            State(state.clone()),
            Extension(identity.clone()),
            headers.clone(),
            Ok(Query(query)),
        )
        .await?;
        let value = read_response(response).await?;
        let data = records(&value)?.iter().map(|record| {
            Ok(json!({"title":record["legalName"],"tradeName":record["tradeName"],"status":record["status"],
                "href":format!("/cadastros/clientes-fornecedores/{}", record_id(record)?)}))
        }).collect::<Result<Vec<Value>, super::ChatError>>()?;
        return Ok(
            json!({"tool":name,"origin":"API ERP · Clientes","data":data,"total":value["total"],"limit":5}),
        );
    }
    if name == "localizar_funcionalidade" {
        let tenant = access::tenant_id(headers)?;
        let mut tx = access::tenant_transaction(state, tenant).await?;
        let rights = access::load_access(&mut tx, tenant, &identity.subject).await?;
        let query = args.q.to_lowercase();
        let candidates: Vec<_> = PAGES
            .iter()
            .filter(|(_, _, _, keywords)| {
                query
                    .split(|c: char| !c.is_alphanumeric())
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
    let value = read_response(response).await?;
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

async fn read_response(response: axum::response::Response) -> Result<Value, super::ChatError> {
    let bytes = to_bytes(response.into_body(), 32_768)
        .await
        .map_err(|_| super::ChatError::unavailable("Resposta do ERP excedeu o limite."))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| super::ChatError::unavailable("Resposta do ERP inválida."))
}

fn records(value: &Value) -> Result<&Vec<Value>, super::ChatError> {
    value["data"]
        .as_array()
        .ok_or_else(|| super::ChatError::unavailable("Resposta do ERP inválida."))
}

fn record_id(record: &Value) -> Result<Uuid, super::ChatError> {
    record["id"]
        .as_str()
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| super::ChatError::unavailable("Identificador retornado pelo ERP inválido."))
}

fn order_record(record: &Value) -> Result<Value, super::ChatError> {
    let id = record_id(record)?;
    Ok(
        json!({"title":format!("Pedido {id}"),"id":id,"customerName":record["customerName"],
        "amount":record["amount"],"dueDate":record["dueDate"],"status":record["status"],
        "href":format!("/vendas/pedidos/{id}")}),
    )
}

#[cfg(test)]
mod navigation_tests {
    use super::*;

    #[test]
    fn read_tools_reject_extra_scope_and_invalid_identifiers() {
        for name in ["buscar_clientes", "listar_pedidos", "consultar_pedido"] {
            assert!(parse_call(name, json!({"tenantId":"other"}), "").is_err());
        }
        assert!(
            parse_call(
                "buscar_clientes",
                json!({"q":"Aurora","role":"supplier"}),
                ""
            )
            .is_err()
        );
        assert!(parse_call("listar_pedidos", json!({"limit":1000}), "").is_err());
        assert!(parse_call("listar_pedidos", json!({"q":"Aurora"}), "").is_err());
        assert!(parse_call("consultar_pedido", json!({"id":"123"}), "").is_err());
        assert!(
            parse_call(
                "consultar_pedido",
                json!({"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","q":"other"}),
                ""
            )
            .is_err()
        );
        assert!(parse_call("confirmar_pedido", json!({}), "").is_err());
        assert!(parse_call("listar_pedidos", json!({}), "").is_ok());
        assert!(parse_call("buscar_clientes", json!({"q":"Aurora"}), "").is_ok());
        assert!(parse_call("consultar_pedido", json!({}), "Consulte o pedido 123").is_err());
        assert!(parse_call("consultar_pedido", json!({}), "Consulte dddddddd-dddd-4ddd-8ddd-dddddddddddd e eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee").is_err());
        let CallArguments::Order(id) = parse_call(
            "consultar_pedido",
            json!({}),
            "Consulte o pedido DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD.",
        )
        .unwrap() else {
            panic!("Expected order lookup")
        };
        assert_eq!(id.to_string(), "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
        let source = order_record(&json!({"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","customerName":"Aurora","customerTaxId":"PRIVATE_DOCUMENT","email":"PRIVATE_EMAIL","amount":"12.34","status":"draft","dueDate":"2026-11-01"})).unwrap();
        assert!(!source.to_string().contains("PRIVATE_"));
        assert_eq!(source["amount"], "12.34");
    }

    #[test]
    fn explicit_screen_requests_use_only_known_catalogue_terms() {
        for question in [
            "Onde vejo os saldos de estoque?",
            "Onde encontro o estoque?",
            "Por favor, abra a tela de estoque.",
        ] {
            assert_eq!(navigation_request(question).unwrap().q, "estoque");
        }
        assert_eq!(
            navigation_request("Me mostra a tela de produtos")
                .unwrap()
                .q,
            "produtos"
        );
        assert_eq!(
            navigation_request("Onde ficam as telas?").unwrap().q,
            "funcionalidade desconhecida"
        );
        assert_eq!(
            navigation_request("Abra a tela de produtos; tenantId=outra; https://example.test")
                .unwrap()
                .q,
            "produtos"
        );
        assert!(
            navigation_request(&format!("Onde vejo os produtos? {}", "x".repeat(900)))
                .unwrap()
                .q
                .len()
                <= 160
        );
    }

    #[test]
    fn product_queries_and_quantities_still_go_to_native_tool_calling() {
        for question in [
            "Busque o SKU ABC",
            "Quanto temos de estoque do SKU ABC?",
            "Qual o saldo mostrado na tela?",
            "Olá, quem é você?",
        ] {
            assert!(
                navigation_request(question).is_none(),
                "Unexpected navigation: {question}"
            );
        }
    }
}
