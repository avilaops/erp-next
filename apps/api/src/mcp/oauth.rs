//! OAuth issuer for MCP. Auth Ávila credentials are never downstream tokens.
use super::McpState;
use crate::platform::auth::{AuthenticatedIdentity, VerifiedEmail};
use axum::{
    Extension, Form, Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use rsa::rand_core::{OsRng, RngCore};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

pub type Failure = (StatusCode, Json<Value>);
pub fn error(status: StatusCode, code: &str) -> Failure {
    (status, Json(json!({"error":code})))
}
fn invalid() -> Failure {
    error(StatusCode::BAD_REQUEST, "invalid_grant")
}
fn db(error_value: sqlx::Error) -> Failure {
    tracing::error!(%error_value,"MCP OAuth storage operation failed");
    error(StatusCode::SERVICE_UNAVAILABLE, "temporarily_unavailable")
}
pub fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn random(prefix: &str) -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    format!("{prefix}{}", URL_SAFE_NO_PAD.encode(bytes))
}
fn same(a: &str, b: &str) -> bool {
    let a = Sha256::digest(a.as_bytes());
    let b = Sha256::digest(b.as_bytes());
    a.iter()
        .zip(b.iter())
        .fold(0u8, |d, (a, b)| d | std::hint::black_box(a ^ b))
        == 0
}

#[derive(Deserialize)]
pub struct Registration {
    redirect_uris: Vec<String>,
    client_name: Option<String>,
    token_endpoint_auth_method: Option<String>,
    grant_types: Option<Vec<String>>,
    response_types: Option<Vec<String>>,
}
fn valid_redirect(value: &str) -> bool {
    if value.len() > 1024 || value.contains('*') || value.chars().any(|c| c.is_control()) {
        return false;
    }
    reqwest::Url::parse(value).is_ok_and(|u| {
        u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
            && u.fragment().is_none()
            && (u.scheme() == "https"
                || (u.scheme() == "http"
                    && matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))))
    })
}
pub async fn register(
    State(state): State<McpState>,
    Json(input): Json<Registration>,
) -> Result<Response, Failure> {
    let method = input
        .token_endpoint_auth_method
        .as_deref()
        .unwrap_or("none");
    if input.redirect_uris.is_empty()
        || input.redirect_uris.len() > 10
        || input.redirect_uris.iter().any(|u| !valid_redirect(u))
        || !["none", "client_secret_post", "client_secret_basic"].contains(&method)
        || input.grant_types.as_ref().is_some_and(|v| {
            v.iter()
                .any(|t| !["authorization_code", "refresh_token"].contains(&t.as_str()))
        })
        || input
            .response_types
            .as_ref()
            .is_some_and(|v| v.iter().any(|t| t != "code"))
    {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_client_metadata"));
    }
    let name = input.client_name.unwrap_or_else(|| "Cliente MCP".into());
    if name.is_empty() || name.len() > 200 {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_client_metadata"));
    }
    let id = random("mcp_client_");
    let secret = (method != "none").then(|| random("mcp_secret_"));
    // Serialize the issuer-wide registration quota; client-controlled proxy headers are not trusted.
    let mut tx = state.app.database.begin().await.map_err(db)?;
    sqlx::query("SELECT pg_advisory_xact_lock(697241068)")
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let recent: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM mcp_oauth_clients WHERE created_at>now()-interval '1 hour'",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    if recent >= 200 {
        return Err(error(StatusCode::TOO_MANY_REQUESTS, "registration_limit"));
    }
    sqlx::query("INSERT INTO mcp_oauth_clients(id,name,redirects,auth_method,secret_hash) VALUES($1,$2,$3,$4,$5)")
        .bind(&id).bind(&name).bind(json!(input.redirect_uris)).bind(method).bind(secret.as_deref().map(hash)).execute(&mut *tx).await.map_err(db)?;
    tx.commit().await.map_err(db)?;
    let mut result = json!({"client_id":id,"client_name":name,"redirect_uris":input.redirect_uris,"token_endpoint_auth_method":method,"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"scope":"erp.read erp.write"});
    if let Some(secret) = secret {
        result["client_secret"] = json!(secret);
        result["client_secret_expires_at"] = json!(0);
    }
    Ok((
        StatusCode::CREATED,
        [("cache-control", "no-store")],
        Json(result),
    )
        .into_response())
}

#[derive(Clone, Deserialize)]
pub struct Authorization {
    client_id: String,
    redirect_uri: String,
    response_type: String,
    code_challenge: String,
    code_challenge_method: String,
    scope: Option<String>,
    resource: String,
    state: Option<String>,
}
#[derive(FromRow)]
struct Client {
    name: String,
    redirects: Value,
    auth_method: String,
    secret_hash: Option<String>,
}
async fn client(state: &McpState, id: &str) -> Result<Client, Failure> {
    if id.len() > 100 {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_client"));
    }
    sqlx::query_as(
        "SELECT name,redirects,auth_method,secret_hash FROM mcp_oauth_clients WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(&state.app.database)
    .await
    .map_err(db)?
    .ok_or(error(StatusCode::BAD_REQUEST, "invalid_client"))
}
fn scopes(value: Option<&str>) -> Result<String, Failure> {
    let mut items = value
        .unwrap_or("erp.read erp.write")
        .split_whitespace()
        .collect::<Vec<_>>();
    items.sort_unstable();
    items.dedup();
    if items.is_empty() || items.iter().any(|s| !["erp.read", "erp.write"].contains(s)) {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_scope"));
    }
    Ok(items.join(" "))
}
async fn validate(state: &McpState, input: &Authorization) -> Result<(Client, String), Failure> {
    if input.response_type != "code"
        || input.resource != state.resource()
        || input.state.as_ref().is_some_and(|s| s.len() > 512)
        || input.code_challenge_method != "S256"
        || input.code_challenge.len() != 43
        || !input
            .code_challenge
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_request"));
    }
    let client = client(state, &input.client_id).await?;
    if !client.redirects.as_array().is_some_and(|u| {
        u.iter()
            .any(|s| s.as_str() == Some(input.redirect_uri.as_str()))
    }) {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_redirect_uri"));
    }
    Ok((client, scopes(input.scope.as_deref())?))
}
pub async fn authorization_request(
    State(state): State<McpState>,
    Query(input): Query<Authorization>,
) -> Result<Json<Value>, Failure> {
    let (client, scope) = validate(&state, &input).await?;
    Ok(Json(
        json!({"client_name":client.name,"redirect_uri":input.redirect_uri,"scope":scope}),
    ))
}
pub async fn grant(
    State(state): State<McpState>,
    Extension(identity): Extension<AuthenticatedIdentity>,
    Extension(verified): Extension<VerifiedEmail>,
    Json(input): Json<Authorization>,
) -> Result<Response, Failure> {
    let (_, scope) = validate(&state, &input).await?;
    let id = Uuid::now_v7();
    let code = random("mcp_code_");
    let mut tx = state.app.database.begin().await.map_err(db)?;
    sqlx::query("INSERT INTO mcp_oauth_grants(id,client_id,subject,email,name,verified_email,scope,resource) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(id).bind(&input.client_id).bind(identity.subject).bind(identity.email).bind(identity.name).bind(verified.0).bind(scope).bind(state.resource()).execute(&mut *tx).await.map_err(db)?;
    sqlx::query(
        "INSERT INTO mcp_oauth_codes(hash,grant_id,redirect_uri,challenge) VALUES($1,$2,$3,$4)",
    )
    .bind(hash(&code))
    .bind(id)
    .bind(&input.redirect_uri)
    .bind(input.code_challenge)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    let mut redirect = reqwest::Url::parse(&input.redirect_uri).map_err(|_| invalid())?;
    redirect.query_pairs_mut().append_pair("code", &code);
    if let Some(client_state) = input.state {
        redirect
            .query_pairs_mut()
            .append_pair("state", &client_state);
    }
    Ok((
        StatusCode::CREATED,
        [("cache-control", "no-store")],
        Json(json!({"redirect_uri":redirect.as_str()})),
    )
        .into_response())
}
#[derive(Deserialize)]
pub struct TokenInput {
    grant_type: Option<String>,
    client_id: Option<String>,
    client_secret: Option<String>,
    code: Option<String>,
    redirect_uri: Option<String>,
    code_verifier: Option<String>,
    refresh_token: Option<String>,
    resource: Option<String>,
    scope: Option<String>,
    token: Option<String>,
}
async fn authenticate_client(
    state: &McpState,
    headers: &HeaderMap,
    input: &TokenInput,
) -> Result<String, Failure> {
    let mut id = input.client_id.clone().unwrap_or_default();
    let mut secret = input.client_secret.clone();
    let mut basic = false;
    if let Some(header) = headers.get("authorization") {
        if secret.is_some() {
            return Err(error(StatusCode::UNAUTHORIZED, "invalid_client"));
        }
        let encoded = header
            .to_str()
            .ok()
            .and_then(|s| s.strip_prefix("Basic "))
            .ok_or(error(StatusCode::UNAUTHORIZED, "invalid_client"))?;
        let decoded = String::from_utf8(
            STANDARD
                .decode(encoded)
                .map_err(|_| error(StatusCode::UNAUTHORIZED, "invalid_client"))?,
        )
        .map_err(|_| error(StatusCode::UNAUTHORIZED, "invalid_client"))?;
        let (basic_id, basic_secret) = decoded
            .split_once(':')
            .ok_or(error(StatusCode::UNAUTHORIZED, "invalid_client"))?;
        let decode = |s: &str| {
            let mut u = reqwest::Url::parse("https://erp.invalid").expect("fixed URL");
            u.set_query(Some(&format!("v={s}")));
            u.query_pairs()
                .next()
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default()
        };
        let basic_id = decode(basic_id);
        if !id.is_empty() && id != basic_id {
            return Err(error(StatusCode::UNAUTHORIZED, "invalid_client"));
        }
        id = basic_id;
        secret = Some(decode(basic_secret));
        basic = true;
    }
    let client = client(state, &id).await?;
    let valid = match client.auth_method.as_str() {
        "none" => secret.is_none() && !basic,
        "client_secret_basic" => {
            basic
                && secret
                    .as_ref()
                    .zip(client.secret_hash.as_ref())
                    .is_some_and(|(s, h)| same(&hash(s), h))
        }
        "client_secret_post" => {
            !basic
                && secret
                    .as_ref()
                    .zip(client.secret_hash.as_ref())
                    .is_some_and(|(s, h)| same(&hash(s), h))
        }
        _ => false,
    };
    if !valid {
        return Err(error(StatusCode::UNAUTHORIZED, "invalid_client"));
    }
    Ok(id)
}

async fn issue(
    tx: &mut Transaction<'_, Postgres>,
    grant: Uuid,
    scope: &str,
) -> Result<Response, Failure> {
    let access = random("mcp_at_");
    let refresh = random("mcp_rt_");
    sqlx::query("INSERT INTO mcp_oauth_tokens(hash,grant_id,kind,expires_at) SELECT $1,id,'access',LEAST(expires_at,now()+interval '15 minutes') FROM mcp_oauth_grants WHERE id=$3 UNION ALL SELECT $2,id,'refresh',expires_at FROM mcp_oauth_grants WHERE id=$3")
        .bind(hash(&access)).bind(hash(&refresh)).bind(grant).execute(&mut **tx).await.map_err(db)?;
    Ok(([("cache-control","no-store"),("pragma","no-cache")],Json(json!({"access_token":access,"token_type":"Bearer","expires_in":900,"refresh_token":refresh,"scope":scope}))).into_response())
}

pub async fn token(
    State(state): State<McpState>,
    headers: HeaderMap,
    Form(input): Form<TokenInput>,
) -> Result<Response, Failure> {
    if input.resource.as_deref() != Some(state.resource().as_str()) {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_target"));
    }
    let client_id = authenticate_client(&state, &headers, &input).await?;
    let mut tx = state.app.database.begin().await.map_err(db)?;
    let (grant, scope) = match input.grant_type.as_deref() {
        Some("authorization_code") => {
            let verifier = input.code_verifier.as_deref().ok_or_else(invalid)?;
            if !(43..=128).contains(&verifier.len())
                || !verifier
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-._~".contains(&b))
            {
                return Err(invalid());
            }
            let code = input
                .code
                .as_deref()
                .filter(|s| s.len() < 200)
                .ok_or_else(invalid)?;
            let row=sqlx::query_as::<_,(Uuid,String,String,String)>("SELECT g.id,g.scope,c.redirect_uri,c.challenge FROM mcp_oauth_codes c JOIN mcp_oauth_grants g ON g.id=c.grant_id WHERE c.hash=$1 AND g.client_id=$2 AND g.resource=$3 AND c.consumed_at IS NULL AND c.expires_at>now() AND g.revoked_at IS NULL AND g.expires_at>now() FOR UPDATE OF c,g")
                .bind(hash(code)).bind(&client_id).bind(state.resource()).fetch_optional(&mut *tx).await.map_err(db)?.ok_or_else(invalid)?;
            if input.redirect_uri.as_deref() != Some(row.2.as_str())
                || !same(
                    &URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
                    &row.3,
                )
            {
                return Err(invalid());
            }
            sqlx::query("UPDATE mcp_oauth_codes SET consumed_at=now() WHERE hash=$1")
                .bind(hash(code))
                .execute(&mut *tx)
                .await
                .map_err(db)?;
            (row.0, row.1)
        }
        Some("refresh_token") => {
            let refresh = input
                .refresh_token
                .as_deref()
                .filter(|s| s.len() < 200)
                .ok_or_else(invalid)?;
            let row=sqlx::query_as::<_,(Uuid,String,bool)>("SELECT g.id,g.scope,t.consumed_at IS NOT NULL FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id=t.grant_id WHERE t.hash=$1 AND t.kind='refresh' AND g.client_id=$2 AND g.resource=$3 AND t.expires_at>now() AND g.revoked_at IS NULL AND g.expires_at>now() FOR UPDATE OF t,g")
                .bind(hash(refresh)).bind(&client_id).bind(state.resource()).fetch_optional(&mut *tx).await.map_err(db)?.ok_or_else(invalid)?;
            if row.2 {
                sqlx::query("UPDATE mcp_oauth_grants SET revoked_at=now() WHERE id=$1")
                    .bind(row.0)
                    .execute(&mut *tx)
                    .await
                    .map_err(db)?;
                tx.commit().await.map_err(db)?;
                return Err(invalid());
            }
            if input.scope.as_deref().is_some_and(|s| s != row.1) {
                return Err(error(StatusCode::BAD_REQUEST, "invalid_scope"));
            }
            sqlx::query("UPDATE mcp_oauth_tokens SET consumed_at=now() WHERE hash=$1")
                .bind(hash(refresh))
                .execute(&mut *tx)
                .await
                .map_err(db)?;
            (row.0, row.1)
        }
        _ => return Err(error(StatusCode::BAD_REQUEST, "unsupported_grant_type")),
    };
    let response = issue(&mut tx, grant, &scope).await?;
    tx.commit().await.map_err(db)?;
    Ok(response)
}
pub async fn revoke(
    State(state): State<McpState>,
    headers: HeaderMap,
    Form(input): Form<TokenInput>,
) -> Result<StatusCode, Failure> {
    let client_id = authenticate_client(&state, &headers, &input).await?;
    let value = input
        .token
        .as_deref()
        .filter(|s| s.len() < 200)
        .ok_or_else(invalid)?;
    sqlx::query("UPDATE mcp_oauth_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE client_id=$1 AND id IN (SELECT grant_id FROM mcp_oauth_tokens WHERE hash=$2)").bind(client_id).bind(hash(value)).execute(&state.app.database).await.map_err(db)?;
    Ok(StatusCode::OK)
}
#[derive(FromRow)]
pub struct Credential {
    pub subject: String,
    pub email: String,
    pub name: String,
    pub verified_email: bool,
    pub scope: String,
}
pub async fn credential(
    state: &McpState,
    headers: &HeaderMap,
) -> Result<Credential, Box<Response>> {
    let challenge = || {
        let mut response = error(StatusCode::UNAUTHORIZED, "invalid_token").into_response();
        response.headers_mut().insert(
            "www-authenticate",
            format!(
                "Bearer resource_metadata=\"{}/.well-known/oauth-protected-resource/mcp\"",
                state.origin
            )
            .parse()
            .expect("validated origin"),
        );
        Box::new(response)
    };
    let value = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split_once(' '))
        .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
        .map(|(_, t)| t.trim())
        .filter(|s| s.starts_with("mcp_at_") && s.len() < 200)
        .ok_or_else(challenge)?;
    sqlx::query_as("SELECT g.subject,g.email,g.name,g.verified_email,g.scope FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id=t.grant_id WHERE t.hash=$1 AND t.kind='access' AND t.expires_at>now() AND g.resource=$2 AND g.revoked_at IS NULL AND g.expires_at>now()")
        .bind(hash(value)).bind(state.resource()).fetch_optional(&state.app.database).await.map_err(|e|Box::new(db(e).into_response()))?.ok_or_else(challenge)
}
