//! One typed MCP tool per implemented, user-authenticated OpenAPI operation.
use axum::{body::Body, http::Request};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone)]
pub struct Tool {
    pub name: String,
    pub method: String,
    pub path: String,
    pub definition: Value,
    parameters: Vec<Value>,
    body_required: bool,
    content_type: Option<String>,
}

fn references(value: &mut Value, definitions: &Map<String, Value>, found: &mut Map<String, Value>) {
    match value {
        Value::Object(object) => {
            if let Some(reference) = object.get_mut("$ref")
                && let Some(name) = reference
                    .as_str()
                    .and_then(|r| r.strip_prefix("#/components/schemas/"))
                    .map(str::to_owned)
            {
                *reference = json!(format!("#/$defs/{name}"));
                if !found.contains_key(&name) {
                    found.insert(name.clone(), Value::Null);
                    let mut definition = definitions
                        .get(&name)
                        .cloned()
                        .expect("OpenAPI reference exists");
                    references(&mut definition, definitions, found);
                    found.insert(name, definition);
                }
            }
            for entry in object.values_mut() {
                references(entry, definitions, found);
            }
        }
        Value::Array(items) => {
            for item in items {
                references(item, definitions, found);
            }
        }
        _ => {}
    }
}

pub fn catalog(document: &Value) -> Vec<Tool> {
    let empty = Map::new();
    let definitions = document["components"]["schemas"]
        .as_object()
        .unwrap_or(&empty);
    let mut tools = Vec::new();
    for (path, item) in document["paths"].as_object().expect("OpenAPI paths") {
        if !path.starts_with("/api/v1/") {
            continue;
        }
        for method in ["get", "post", "put", "patch", "delete"] {
            let operation = &item[method];
            if !operation["security"]
                .as_array()
                .is_some_and(|security| security.iter().any(|s| s.get("bearerAuth").is_some()))
            {
                continue;
            }
            let parameters: Vec<Value> = item["parameters"]
                .as_array()
                .into_iter()
                .flatten()
                .chain(operation["parameters"].as_array().into_iter().flatten())
                .cloned()
                .collect();
            let mut properties = Map::new();
            let mut required = Vec::new();
            // The ERP business router is tenant-scoped except these identity
            // operations. Older fiscal annotations omitted the header even
            // though their handlers require it. Declare the MCP context here
            // without changing the existing public HTTP contract.
            if !["/api/v1/companies", "/api/v1/company-registration/lookup"]
                .contains(&path.as_str())
            {
                properties.insert("tenant_id".into(), json!({"type":"string","format":"uuid","description":"Empresa explícita, verificada pelas regras de acesso do ERP."}));
                required.push(json!("tenant_id"));
            }
            for (location, argument) in
                [("path", "path"), ("query", "query"), ("header", "headers")]
            {
                let mut fields = Map::new();
                let mut required_fields = Vec::new();
                for parameter in &parameters {
                    if parameter["in"] != location {
                        continue;
                    }
                    let name = parameter["name"].as_str().expect("parameter name");
                    if name.eq_ignore_ascii_case("x-tenant-id") {
                        properties.insert("tenant_id".into(), json!({"type":"string","format":"uuid","description":"Empresa explícita; associação e permissões são verificadas pela API."}));
                        if !required.contains(&json!("tenant_id")) {
                            required.push(json!("tenant_id"));
                        }
                        continue;
                    }
                    if ["authorization", "cookie", "host"]
                        .iter()
                        .any(|p| name.eq_ignore_ascii_case(p))
                    {
                        continue;
                    }
                    fields.insert(
                        name.to_owned(),
                        parameter
                            .get("schema")
                            .cloned()
                            .unwrap_or(json!({"type":"string"})),
                    );
                    if location == "path" || parameter["required"] == true {
                        required_fields.push(json!(name));
                    }
                }
                if !fields.is_empty() {
                    if !required_fields.is_empty() {
                        required.push(json!(argument));
                    }
                    properties.insert(argument.into(), json!({"type":"object","properties":fields,"required":required_fields,"additionalProperties":false}));
                }
            }
            let body_required = operation["requestBody"]["required"] == true;
            let content = operation["requestBody"]["content"].as_object();
            let content_type = content.and_then(|content| {
                if content.contains_key("application/json") {
                    Some("application/json".to_owned())
                } else {
                    content.keys().next().cloned()
                }
            });
            if let Some(content_type) = &content_type {
                let schema = operation["requestBody"]["content"][content_type]
                    .get("schema")
                    .cloned()
                    .unwrap_or(json!({"type":"string"}));
                properties.insert("body".into(), schema);
                if body_required {
                    required.push(json!("body"));
                }
            }
            let slug: String = format!("erp_{method}_{}", path.trim_start_matches("/api/v1/"))
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
                .collect();
            let digest = format!("{:x}", Sha256::digest(format!("{method}:{path}")));
            let name = if slug.len() > 64 {
                format!("{}_{}", &slug[..51], &digest[..12])
            } else {
                slug
            };
            let read_only = method == "get";
            let mut schema = json!({"type":"object","properties":properties,"required":required,"additionalProperties":false});
            let mut referenced = Map::new();
            references(&mut schema, definitions, &mut referenced);
            if !referenced.is_empty() {
                schema["$defs"] = Value::Object(referenced);
            }
            let description = format!("{} {}. {} {}",method.to_uppercase(),path,operation["summary"].as_str().unwrap_or("Operação implementada do ERP."),operation["description"].as_str().unwrap_or("Usa as permissões e regras da API. Preserve revisão e chave de idempotência em repetições."));
            let definition = json!({"name":name,"description":description,"inputSchema":schema,"annotations":{"readOnlyHint":read_only,"destructiveHint":!read_only,"idempotentHint":read_only || method=="put" || method=="delete","openWorldHint":true},"_meta":{"erp/path":path,"erp/method":method.to_uppercase()}});
            tools.push(Tool {
                name,
                method: method.to_uppercase(),
                path: path.clone(),
                definition,
                parameters,
                body_required,
                content_type,
            });
        }
    }
    tools.sort_by(|a, b| a.name.cmp(&b.name));
    let unique: BTreeSet<_> = tools.iter().map(|t| &t.name).collect();
    assert_eq!(unique.len(), tools.len(), "MCP tool names must be unique");
    tools
}

fn scalar(value: &Value) -> Result<String, &'static str> {
    match value {
        Value::String(s) => Ok(s.clone()),
        Value::Number(_) | Value::Bool(_) => Ok(value.to_string()),
        _ => Err("Parâmetro precisa ser um valor escalar"),
    }
}
fn segment(value: &str) -> Result<String, &'static str> {
    if value.is_empty() || value == "." || value == ".." || value.chars().any(|c| c.is_control()) {
        return Err("Parâmetro de caminho inválido");
    }
    Ok(value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect())
}

impl Tool {
    pub fn read_only(&self) -> bool {
        self.method == "GET"
    }
    pub fn request(&self, arguments: &Value) -> Result<Request<Body>, &'static str> {
        let args = arguments
            .as_object()
            .ok_or("Argumentos precisam ser um objeto")?;
        let allowed = self.definition["inputSchema"]["properties"]
            .as_object()
            .expect("properties");
        if args.keys().any(|key| !allowed.contains_key(key)) {
            return Err("Argumento desconhecido");
        }
        for key in self.definition["inputSchema"]["required"]
            .as_array()
            .expect("required")
        {
            if !args.contains_key(key.as_str().expect("name")) {
                return Err("Argumento obrigatório ausente");
            }
        }
        let mut path = self.path.clone();
        let mut query = BTreeMap::<String, Vec<String>>::new();
        let mut request = Request::builder().method(self.method.as_str());
        if let Some(tenant) = args.get("tenant_id") {
            let tenant = tenant
                .as_str()
                .and_then(|s| uuid::Uuid::parse_str(s).ok())
                .ok_or("Empresa inválida")?;
            request = request.header("x-tenant-id", tenant.to_string());
        }
        for (argument, location) in [("path", "path"), ("query", "query"), ("headers", "header")] {
            if let Some(values) = args.get(argument) {
                let values = values.as_object().ok_or("Grupo de parâmetros inválido")?;
                for (name, value) in values {
                    if name.eq_ignore_ascii_case("x-tenant-id") {
                        return Err("Use tenant_id para selecionar a empresa");
                    }
                    let parameter = self
                        .parameters
                        .iter()
                        .find(|p| p["in"] == location && p["name"] == *name)
                        .ok_or("Parâmetro desconhecido")?;
                    match location {
                        "path" => {
                            path = path.replace(&format!("{{{name}}}"), &segment(&scalar(value)?)?)
                        }
                        "query" => {
                            let list = if let Some(items) = value.as_array() {
                                items.iter().map(scalar).collect::<Result<Vec<_>, _>>()?
                            } else {
                                vec![scalar(value)?]
                            };
                            let list = if parameter["explode"] == false {
                                vec![list.join(",")]
                            } else {
                                list
                            };
                            query.insert(name.clone(), list);
                        }
                        _ => {
                            if ["authorization", "cookie", "host"]
                                .iter()
                                .any(|p| name.eq_ignore_ascii_case(p))
                            {
                                return Err("Cabeçalho não autorizado");
                            }
                            request = request.header(name, scalar(value)?);
                        }
                    }
                }
                for parameter in self.parameters.iter().filter(|p| {
                    p["in"] == location && (p["required"] == true || location == "path")
                }) {
                    let name = parameter["name"].as_str().expect("name");
                    if !name.eq_ignore_ascii_case("x-tenant-id") && !values.contains_key(name) {
                        return Err("Parâmetro obrigatório ausente");
                    }
                }
            }
        }
        if path.contains('{') || path.contains('}') {
            return Err("Parâmetro de caminho ausente");
        }
        let mut url = reqwest::Url::parse(&format!("http://erp.internal{path}"))
            .map_err(|_| "Caminho inválido")?;
        for (key, values) in query {
            for value in values {
                url.query_pairs_mut().append_pair(&key, &value);
            }
        }
        let uri = format!(
            "{}{}",
            url.path(),
            url.query().map(|q| format!("?{q}")).unwrap_or_default()
        );
        request = request.uri(uri).header(
            "accept",
            "application/json, application/pdf, application/xml, text/event-stream",
        );
        let body = match args.get("body") {
            Some(value) => {
                let content_type = self
                    .content_type
                    .as_deref()
                    .ok_or("Esta operação não recebe corpo")?;
                request = request.header("content-type", content_type);
                if content_type == "application/json" {
                    Body::from(value.to_string())
                } else {
                    Body::from(scalar(value)?)
                }
            }
            None if self.body_required => return Err("Corpo obrigatório"),
            None => Body::empty(),
        };
        request.body(body).map_err(|_| "Requisição inválida")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_covers_every_user_operation_and_exports_a_ci_artifact() {
        let doc = crate::http::openapi::value();
        let tools = catalog(&doc);
        let expected = doc["paths"]
            .as_object()
            .unwrap()
            .iter()
            .filter(|(p, _)| p.starts_with("/api/v1/"))
            .map(|(_, p)| {
                ["get", "post", "put", "patch", "delete"]
                    .iter()
                    .filter(|m| {
                        p[**m]["security"]
                            .as_array()
                            .is_some_and(|s| s.iter().any(|x| x.get("bearerAuth").is_some()))
                    })
                    .count()
            })
            .sum::<usize>();
        assert_eq!(tools.len(), expected);
        assert!(tools.len() > 150);
        if let Some(path) = std::env::var_os("ERP_MCP_CATALOG_OUTPUT") {
            std::fs::write(
                path,
                serde_json::to_vec_pretty(&tools.iter().map(|t| &t.definition).collect::<Vec<_>>())
                    .unwrap(),
            )
            .unwrap();
        }
    }
    #[test]
    fn path_arguments_cannot_change_the_destination_or_inject_headers() {
        let tools = catalog(&crate::http::openapi::value());
        let tool = tools
            .iter()
            .find(|t| t.method == "GET" && t.path == "/api/v1/products/{id}")
            .unwrap();
        assert!(
            tool.request(
                &json!({"tenant_id":"11111111-1111-4111-8111-111111111111","path":{"id":".."}})
            )
            .is_err()
        );
        assert!(tool.request(&json!({"tenant_id":"11111111-1111-4111-8111-111111111111","path":{"id":"one"},"headers":{"Authorization":"Bearer anything"}})).is_err());
    }
}
