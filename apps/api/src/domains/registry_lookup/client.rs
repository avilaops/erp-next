use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::sync::Semaphore;
use uuid::Uuid;

use super::{model::*, parse};

const MAX_CACHE: usize = 512;
const MAX_BODY: usize = 262_144;
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(3);
type CacheKey = (Uuid, LookupKind, String, Option<String>);

struct CacheEntry {
    expires: Instant,
    reply: LookupReply,
}
#[derive(Default)]
struct Memory {
    cache: HashMap<CacheKey, CacheEntry>,
    budgets: HashMap<&'static str, VecDeque<Instant>>,
    tenants: HashMap<Uuid, VecDeque<Instant>>,
}

#[derive(Clone)]
pub struct RegistryClient {
    http: reqwest::Client,
    memory: Arc<Mutex<Memory>>,
    in_flight: Arc<Semaphore>,
    endpoints: [String; 4],
    cnpj_ws_enabled: bool,
    positive_ttl: [Duration; 2],
}

#[derive(Clone, Copy)]
enum Provider {
    ViaCep = 0,
    BrasilCep = 1,
    BrasilCnpj = 2,
    CnpjWs = 3,
}
impl Provider {
    fn source(self) -> &'static str {
        match self {
            Self::ViaCep => "ViaCEP",
            Self::BrasilCep | Self::BrasilCnpj => "BrasilAPI",
            Self::CnpjWs => "CNPJ.ws",
        }
    }
}

fn now_string(time: OffsetDateTime) -> String {
    time.format(&Rfc3339).expect("RFC3339 timestamp")
}

fn reserve(queue: &mut VecDeque<Instant>, maximum: usize, now: Instant) -> bool {
    while queue
        .front()
        .is_some_and(|old| now.duration_since(*old) >= Duration::from_secs(60))
    {
        queue.pop_front();
    }
    if queue.len() >= maximum {
        return false;
    }
    queue.push_back(now);
    true
}

impl RegistryClient {
    pub fn new(cnpj_ws_enabled: bool) -> anyhow::Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(1))
                .timeout(PROVIDER_TIMEOUT)
                .build()?,
            memory: Arc::new(Mutex::new(Memory::default())),
            in_flight: Arc::new(Semaphore::new(8)),
            endpoints: [
                "https://viacep.com.br/ws".into(),
                "https://brasilapi.com.br/api/cep/v2".into(),
                "https://brasilapi.com.br/api/cnpj/v1".into(),
                "https://publica.cnpj.ws/cnpj".into(),
            ],
            cnpj_ws_enabled,
            positive_ttl: [Duration::from_secs(86_400), Duration::from_secs(21_600)],
        })
    }

    pub async fn lookup(&self, tenant: Uuid, input: &LookupInput) -> LookupReply {
        let now = Instant::now();
        let timestamp = OffsetDateTime::now_utc();
        let key = (tenant, input.kind, input.value.clone(), input.state.clone());
        let mut reply = LookupReply {
            tenant_id: tenant,
            kind: input.kind,
            value: input.value.clone(),
            status: LookupStatus::Unavailable,
            data: None,
            source: None,
            source_updated_at: None,
            fetched_at: now_string(timestamp),
            expires_at: None,
            cached: false,
            attempts: vec![],
            warnings: vec![],
        };
        {
            let mut memory = self.memory.lock().expect("registry cache mutex");
            memory.cache.retain(|_, entry| entry.expires > now);
            if let Some(entry) = memory.cache.get(&key) {
                let mut cached = entry.reply.clone();
                cached.cached = true;
                return cached;
            }
            memory.tenants.retain(|_, queue| {
                queue
                    .back()
                    .is_some_and(|last| now.duration_since(*last) < Duration::from_secs(60))
            });
            if (memory.tenants.len() >= MAX_CACHE && !memory.tenants.contains_key(&tenant))
                || !reserve(memory.tenants.entry(tenant).or_default(), 20, now)
            {
                reply.warnings.push(
                    "Limite de consultas atingido. Aguarde um minuto ou preencha manualmente"
                        .into(),
                );
                return reply;
            }
        }
        let _permit = match self.in_flight.try_acquire() {
            Ok(permit) => permit,
            Err(_) => {
                reply
                    .warnings
                    .push("Consultas ocupadas. Continue o preenchimento manual".into());
                return reply;
            }
        };
        if input.kind == LookupKind::Ie
            && (!self.cnpj_ws_enabled
                || input.value.bytes().any(|c| c.is_ascii_alphabetic())
                || !input
                    .state
                    .as_deref()
                    .is_some_and(|s| IE_STATES.contains(&s)))
        {
            reply.status = LookupStatus::Unsupported;
            reply.warnings.push("Consulta IE indisponível para esta fonte, UF ou documento. Confirme no cadastro estadual; ausência não significa isenção".into());
            return reply;
        }
        let providers = match input.kind {
            LookupKind::Cep => vec![Provider::ViaCep, Provider::BrasilCep],
            LookupKind::Ie => vec![Provider::CnpjWs],
            LookupKind::Cnpj => {
                let mut providers = vec![Provider::BrasilCnpj];
                if self.cnpj_ws_enabled && input.value.bytes().all(|c| c.is_ascii_digit()) {
                    providers.push(Provider::CnpjWs);
                }
                providers
            }
        };
        let mut all_absent = true;
        for provider in providers {
            let source = provider.source();
            let allowed = {
                let mut memory = self.memory.lock().expect("registry budget mutex");
                reserve(
                    memory.budgets.entry(source).or_default(),
                    if source == "CNPJ.ws" { 3 } else { 30 },
                    Instant::now(),
                )
            };
            if !allowed {
                all_absent = false;
                reply.attempts.push(LookupAttempt {
                    source: source.into(),
                    outcome: "rate_limited".into(),
                });
                continue;
            }
            let url = format!(
                "{}/{}{}",
                self.endpoints[provider as usize],
                input.value,
                if matches!(provider, Provider::ViaCep) {
                    "/json"
                } else {
                    ""
                }
            );
            match self.fetch(&url).await {
                Ok((404, _)) => reply.attempts.push(LookupAttempt {
                    source: source.into(),
                    outcome: "not_found".into(),
                }),
                Ok((200, value))
                    if matches!(provider, Provider::ViaCep)
                        && (value.get("erro") == Some(&Value::Bool(true))
                            || value.get("erro") == Some(&Value::String("true".into()))) =>
                {
                    reply.attempts.push(LookupAttempt {
                        source: source.into(),
                        outcome: "not_found".into(),
                    });
                }
                Ok((200, value)) => {
                    if let Some((data, source_date)) = parse::parse(
                        source,
                        input.kind,
                        &input.value,
                        input.state.as_deref(),
                        &value,
                    ) {
                        reply.attempts.push(LookupAttempt {
                            source: source.into(),
                            outcome: "found".into(),
                        });
                        reply.status = LookupStatus::Found;
                        if data.generic_postal_code {
                            reply.warnings.push("CEP genérico ou endereço incompleto. Complete os campos manualmente".into());
                        }
                        if input.kind != LookupKind::Cep {
                            reply.warnings.push("Consulta cadastral não determina regime tributário, crédito ou condição de contribuinte. Confira a data da fonte".into());
                        }
                        if source == "CNPJ.ws" && data.state_registrations.is_empty() {
                            reply.warnings.push("Inscrição estadual não informada na base consultada; situação desconhecida".into());
                        }
                        reply.data = Some(data);
                        reply.source = Some(source.into());
                        reply.source_updated_at = source_date;
                        let ttl = self.positive_ttl[usize::from(input.kind != LookupKind::Cep)];
                        // Start cache age after the response, never while the provider is still pending.
                        let fetched = OffsetDateTime::now_utc();
                        reply.fetched_at = now_string(fetched);
                        reply.expires_at = Some(now_string(
                            fetched + time::Duration::seconds(ttl.as_secs() as i64),
                        ));
                        let mut memory = self.memory.lock().expect("registry cache mutex");
                        if memory.cache.len() >= MAX_CACHE
                            && let Some(oldest) = memory
                                .cache
                                .iter()
                                .min_by_key(|(_, v)| v.expires)
                                .map(|(k, _)| k.clone())
                        {
                            memory.cache.remove(&oldest);
                        }
                        memory.cache.insert(
                            key,
                            CacheEntry {
                                expires: Instant::now() + ttl,
                                reply: reply.clone(),
                            },
                        );
                        return reply;
                    }
                    all_absent = false;
                    reply.attempts.push(LookupAttempt {
                        source: source.into(),
                        outcome: "malformed_response".into(),
                    });
                }
                Ok((status, _)) => {
                    all_absent = false;
                    reply.attempts.push(LookupAttempt {
                        source: source.into(),
                        outcome: if status == 429 {
                            "rate_limited"
                        } else {
                            "unavailable"
                        }
                        .into(),
                    });
                }
                Err(()) => {
                    all_absent = false;
                    reply.attempts.push(LookupAttempt {
                        source: source.into(),
                        outcome: "unavailable".into(),
                    });
                }
            }
        }
        if all_absent {
            reply.status = LookupStatus::NotFound;
        }
        reply.warnings.push("Consulta sem resultado disponível. Isso não comprova cadastro inválido; continue manualmente".into());
        reply
    }

    async fn fetch(&self, url: &str) -> Result<(u16, Value), ()> {
        let mut response = self
            .http
            .get(url)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|_| ())?;
        let status = response.status().as_u16();
        if status != 200 {
            return Ok((status, Value::Null));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_BODY as u64)
        {
            return Err(());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
            if bytes.len() + chunk.len() > MAX_BODY {
                return Err(());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes)
            .map(|value| (status, value))
            .map_err(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Json, Router, routing::get};
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn input(kind: LookupKind, value: &str) -> LookupInput {
        LookupInput {
            kind,
            value: value.into(),
            context: LookupContext::Party,
            state: None,
        }
    }
    async fn fixture() -> (
        RegistryClient,
        Arc<AtomicUsize>,
        tokio::task::JoinHandle<()>,
    ) {
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        let router = Router::new()
            .route("/via/{code}/json", get(|| async {
                Json(json!({"cep":"00000000","uf":"SP","localidade":"Wrong identity"}))
            }))
            .route("/brasil/{code}", get(move || {
                let counter = counter.clone();
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Json(json!({"cep":"01001000","state":"SP","city":"São Paulo","street":"Praça da Sé","neighborhood":"Sé"}))
                }
            }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let mut client = RegistryClient::new(true).unwrap();
        client.endpoints = [
            format!("http://{address}/via"),
            format!("http://{address}/brasil"),
            format!("http://{address}/cnpj"),
            format!("http://{address}/ws"),
        ];
        (client, hits, task)
    }

    #[tokio::test]
    async fn fallback_cache_tenant_isolation_and_expiration_are_real_http_behaviors() {
        let (client, hits, task) = fixture().await;
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let request = input(LookupKind::Cep, "01001000");
        let first = client.lookup(a, &request).await;
        assert!(matches!(first.status, LookupStatus::Found));
        assert_eq!(first.source.as_deref(), Some("BrasilAPI"));
        assert_eq!(first.attempts[0].outcome, "malformed_response");
        assert!(!first.cached);
        assert!(client.lookup(a, &request).await.cached);
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        assert!(!client.lookup(b, &request).await.cached);
        assert_eq!(hits.load(Ordering::SeqCst), 2);
        for entry in client.memory.lock().unwrap().cache.values_mut() {
            entry.expires = Instant::now();
        }
        assert!(!client.lookup(a, &request).await.cached);
        assert_eq!(hits.load(Ordering::SeqCst), 3);
        task.abort();
    }

    #[tokio::test]
    async fn failures_are_not_cached_and_letters_never_reach_numeric_fallback() {
        let (client, _, task) = fixture().await;
        let tenant = Uuid::now_v7();
        for _ in 0..2 {
            let reply = client
                .lookup(tenant, &input(LookupKind::Cnpj, "12ABC34501DE35"))
                .await;
            assert!(matches!(reply.status, LookupStatus::NotFound));
            assert!(!reply.cached);
            assert_eq!(reply.attempts.len(), 1);
            assert_eq!(reply.attempts[0].source, "BrasilAPI");
        }
        task.abort();
    }

    #[tokio::test]
    async fn timeout_oversized_body_invalid_json_and_redirects_use_the_fallback() {
        use axum::response::IntoResponse;
        let router = Router::new()
            .route(
                "/slow/{code}/json",
                get(|| async {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    Json(json!({"cep":"01001000","uf":"SP","localidade":"São Paulo"}))
                }),
            )
            .route(
                "/oversized/{code}/json",
                get(|| async { "x".repeat(MAX_BODY + 1) }),
            )
            .route("/invalid/{code}/json", get(|| async { "not JSON" }))
            .route(
                "/redirect/{code}/json",
                get(|| async {
                    (
                        axum::http::StatusCode::FOUND,
                        [("location", "/slow/01001000/json")],
                    )
                        .into_response()
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let primary = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let (mut client, _, fallback) = fixture().await;
        for path in ["slow", "oversized", "invalid", "redirect"] {
            client.endpoints[0] = format!("http://{address}/{path}");
            let result = client
                .lookup(Uuid::now_v7(), &input(LookupKind::Cep, "01001000"))
                .await;
            assert!(matches!(result.status, LookupStatus::Found), "{path}");
            assert_eq!(result.source.as_deref(), Some("BrasilAPI"), "{path}");
            assert_eq!(result.attempts[0].outcome, "unavailable", "{path}");
        }
        primary.abort();
        fallback.abort();
    }

    #[tokio::test]
    async fn cnpj_ws_quota_is_shared_across_tenants_and_disabled_ie_is_unknown() {
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        let router = Router::new().route("/ws/{cnpj}", get(move |axum::extract::Path(cnpj): axum::extract::Path<String>| {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Json(json!({"razao_social":"Synthetic enterprise","estabelecimento":{"cnpj":cnpj}}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let primary = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let (mut client, _, fallback) = fixture().await;
        client.endpoints[3] = format!("http://{address}/ws");
        for (index, cnpj) in [
            "04252011000110",
            "19131243000197",
            "27865757000102",
            "11222333000181",
        ]
        .iter()
        .enumerate()
        {
            let reply = client
                .lookup(Uuid::now_v7(), &input(LookupKind::Cnpj, cnpj))
                .await;
            assert_eq!(matches!(reply.status, LookupStatus::Found), index < 3);
            if index == 3 {
                assert_eq!(reply.attempts.last().unwrap().outcome, "rate_limited");
            }
        }
        assert_eq!(hits.load(Ordering::SeqCst), 3);
        client.cnpj_ws_enabled = false;
        let mut ie = input(LookupKind::Ie, "04252011000110");
        ie.state = Some("SP".into());
        let reply = client.lookup(Uuid::now_v7(), &ie).await;
        assert!(matches!(reply.status, LookupStatus::Unsupported));
        assert!(reply.data.is_none());
        assert_eq!(hits.load(Ordering::SeqCst), 3);
        primary.abort();
        fallback.abort();
    }

    #[test]
    fn sliding_limit_does_not_reset_at_a_wall_clock_boundary() {
        let now = Instant::now();
        let mut queue = VecDeque::new();
        for i in 0..3 {
            assert!(reserve(&mut queue, 3, now + Duration::from_millis(i)));
        }
        assert!(!reserve(&mut queue, 3, now + Duration::from_secs(59)));
        assert!(reserve(&mut queue, 3, now + Duration::from_secs(60)));
        assert!(!reserve(&mut queue, 3, now + Duration::from_secs(60)));
    }
}
