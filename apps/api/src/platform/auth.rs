use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use super::state::AppState;

#[derive(Clone)]
pub struct AuthClient {
    http: reqwest::Client,
    userinfo_url: Url,
}

#[derive(Clone, Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedIdentity {
    pub subject: String,
    pub email: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
struct UserInfoResponse {
    sub: String,
    email: String,
    name: Option<String>,
}

impl AuthClient {
    pub fn new(userinfo_url: String) -> Self {
        let userinfo_url =
            Url::parse(&userinfo_url).expect("userinfo URL was already validated by configuration");
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(5))
                .build()
                .expect("valid Auth HTTP client configuration"),
            userinfo_url,
        }
    }

    async fn authenticate(
        &self,
        headers: &HeaderMap,
    ) -> Result<AuthenticatedIdentity, AuthFailure> {
        let token = bearer_token(headers)?;
        let response = self
            .http
            .get(self.userinfo_url.clone())
            .bearer_auth(token)
            .header(header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| {
                tracing::error!(%error, "Auth userinfo request failed");
                AuthFailure::Unavailable
            })?;

        match response.status() {
            StatusCode::OK => {}
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                return Err(AuthFailure::InvalidToken);
            }
            status => {
                tracing::error!(%status, "Auth userinfo returned an unexpected status");
                return Err(AuthFailure::Unavailable);
            }
        }

        let profile = response.json::<UserInfoResponse>().await.map_err(|error| {
            tracing::error!(%error, "Auth userinfo returned an invalid profile");
            AuthFailure::Unavailable
        })?;
        let subject = profile.sub.trim().to_owned();
        let email = profile.email.trim().to_lowercase();
        if subject.is_empty() || email.is_empty() {
            return Err(AuthFailure::Unavailable);
        }
        let name = profile
            .name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| email.clone());

        Ok(AuthenticatedIdentity {
            subject,
            email,
            name,
        })
    }
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    match state.auth.authenticate(request.headers()).await {
        Ok(identity) => {
            request.extensions_mut().insert(identity);
            next.run(request).await
        }
        Err(failure) => failure.into_response(),
    }
}

#[derive(Debug)]
enum AuthFailure {
    MissingToken,
    InvalidToken,
    Unavailable,
}

impl IntoResponse for AuthFailure {
    fn into_response(self) -> Response {
        let (status, code, title) = match self {
            Self::MissingToken => (
                StatusCode::UNAUTHORIZED,
                "missing_token",
                "Credencial de acesso ausente",
            ),
            Self::InvalidToken => (
                StatusCode::UNAUTHORIZED,
                "invalid_token",
                "Credencial de acesso inválida",
            ),
            Self::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "auth_unavailable",
                "Serviço de autenticação indisponível",
            ),
        };
        (
            status,
            [(header::CONTENT_TYPE, "application/problem+json")],
            axum::Json(serde_json::json!({
                "type": format!("https://erp.avilaops.com/problems/{code}"),
                "title": title,
                "status": status.as_u16(),
            })),
        )
            .into_response()
    }
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, AuthFailure> {
    let value = headers
        .get(header::AUTHORIZATION)
        .ok_or(AuthFailure::MissingToken)?
        .to_str()
        .map_err(|_| AuthFailure::InvalidToken)?;
    let (scheme, token) = value.split_once(' ').ok_or(AuthFailure::InvalidToken)?;
    if !scheme.eq_ignore_ascii_case("bearer") || token.trim().is_empty() {
        return Err(AuthFailure::InvalidToken);
    }
    Ok(token.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_bearer_token_case_insensitively() {
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, "bEaReR token-value".parse().unwrap());

        assert_eq!(bearer_token(&headers).unwrap(), "token-value");
    }

    #[test]
    fn rejects_missing_or_empty_tokens() {
        assert!(matches!(
            bearer_token(&HeaderMap::new()),
            Err(AuthFailure::MissingToken)
        ));
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, "Bearer  ".parse().unwrap());
        assert!(matches!(
            bearer_token(&headers),
            Err(AuthFailure::InvalidToken)
        ));
    }
}
