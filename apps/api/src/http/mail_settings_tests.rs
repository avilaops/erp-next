use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const PATH: &str = "/api/v1/platform/mail-settings";

fn settings() -> Value {
    json!({"enabled":true,"name":"Correio da plataforma","host":"smtp.example.test","port":587,
        "security":"starttls","username":"smtp-user","password":"secret-test-only",
        "fromName":"Empresa","fromAddress":"sales@example.test"})
}

async fn call(
    router: &Router,
    method: &str,
    subject: &str,
    revision: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(PATH)
        .header("authorization", format!("Bearer {subject}"))
        .header("content-type", "application/json");
    if let Some(revision) = revision {
        request = request.header("if-match", revision);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn platform_mail_settings_require_global_administrator_and_encrypt_secret(admin: PgPool) {
    let vault = crate::domains::fiscal::certificate_crypto::tests::vault();
    let (router, application, server, role) =
        super::company_tests::setup_with_certificates(&admin, vault.clone()).await;
    assert_eq!(
        call(&router, "GET", "editor", None, Value::Null).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&router, "PUT", "editor", Some("\"0\""), settings())
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO platform_administrators(auth_subject,granted_by,reason) VALUES('editor','test','SMTP settings test')").execute(&admin).await.unwrap();
    let (status, initial) = call(&router, "GET", "editor", None, Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{initial}");
    assert_eq!(initial["revision"], 0);
    assert_eq!(initial["source"], "unconfigured");
    assert_eq!(initial["encryptionReady"], true);
    assert_eq!(
        call(&router, "PUT", "editor", None, settings()).await.0,
        StatusCode::PRECONDITION_REQUIRED
    );
    let (status, saved) = call(&router, "PUT", "editor", Some("\"0\""), settings()).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["revision"], 1);
    assert_eq!(saved["source"], "platform");
    assert_eq!(saved["data"]["passwordSet"], true);
    assert!(saved["data"].get("password").is_none());
    assert!(!saved.to_string().contains("secret-test-only"));
    let (context,key_id,nonce,ciphertext):(String,String,Vec<u8>,Vec<u8>)=sqlx::query_as("SELECT secret_context,secret_key_id,secret_nonce,secret_ciphertext FROM platform_mail_settings").fetch_one(&admin).await.unwrap();
    let sealed = crate::domains::fiscal::certificate_crypto::SealedCertificate {
        key_id,
        nonce,
        ciphertext,
    };
    assert_eq!(
        &*vault.open_settings_secret(&context, &sealed).unwrap(),
        b"secret-test-only"
    );
    assert!(
        vault
            .open_settings_secret(&(context.clone() + "other-host"), &sealed)
            .is_err()
    );
    assert_eq!(
        call(&router, "GET", "reader", None, Value::Null).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&router, "PUT", "editor", Some("\"0\""), settings())
            .await
            .0,
        StatusCode::PRECONDITION_FAILED
    );
    let mut update = settings();
    update.as_object_mut().unwrap().remove("password");
    update["fromName"] = json!("Outro nome");
    assert_eq!(
        call(&router, "PUT", "editor", Some("\"1\""), update.clone())
            .await
            .0,
        StatusCode::OK
    );
    for field in ["host", "username", "port", "security"] {
        let mut changed = update.clone();
        changed[field] = match field {
            "port" => json!(465),
            "security" => json!("tls"),
            _ => json!("changed.example.test"),
        };
        assert_eq!(
            call(&router, "PUT", "editor", Some("\"2\""), changed)
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{field}"
        );
    }
    update["password"] = json!("replacement-test-only");
    update["host"] = json!("changed.example.test");
    assert_eq!(
        call(&router, "PUT", "editor", Some("\"2\""), update)
            .await
            .0,
        StatusCode::OK
    );
    let (new_context, key_id, nonce, ciphertext): (String, String, Vec<u8>, Vec<u8>) =
        sqlx::query_as("SELECT secret_context,secret_key_id,secret_nonce,secret_ciphertext FROM platform_mail_settings")
            .fetch_one(&admin).await.unwrap();
    let replacement = crate::domains::fiscal::certificate_crypto::SealedCertificate {
        key_id,
        nonce,
        ciphertext,
    };
    assert_eq!(
        &*vault
            .open_settings_secret(&new_context, &replacement)
            .unwrap(),
        b"replacement-test-only"
    );
    assert!(vault.open_settings_secret(&context, &replacement).is_err());
    let (_, reread) = call(&router, "GET", "editor", None, Value::Null).await;
    assert!(!reread.to_string().contains("replacement-test-only"));
    assert!(reread["data"].get("password").is_none());
    let audit: String =
        sqlx::query_scalar("SELECT coalesce(jsonb_agg(details)::text,'') FROM audit_log")
            .fetch_one(&admin)
            .await
            .unwrap();
    assert!(!audit.contains("secret-test-only") && !audit.contains("replacement-test-only"));
    let mut tx = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.auth_subject','reader',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query("UPDATE platform_mail_settings SET revision=revision+1")
            .execute(&mut *tx)
            .await
            .unwrap()
            .rows_affected(),
        0
    );
    assert!(sqlx::query("INSERT INTO platform_mail_settings(singleton,data,revision) VALUES(true,'{}',9) ON CONFLICT(singleton) DO UPDATE SET revision=9").execute(&mut *tx).await.is_err());
    tx.rollback().await.unwrap();
    sqlx::query("UPDATE platform_administrators SET active=false WHERE auth_subject='editor'")
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(
        call(&router, "PUT", "editor", Some("\"3\""), settings())
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn platform_mail_settings_resolve_immediately_and_disabled_prevents_fallback(admin: PgPool) {
    use crate::platform::{
        auth::AuthClient,
        mail::SmtpMailer,
        mail_settings::{self, SmtpSecurity},
        state::AppState,
    };
    let vault = crate::domains::fiscal::certificate_crypto::tests::vault();
    let (router, application, server, role) =
        super::company_tests::setup_with_certificates(&admin, vault.clone()).await;
    sqlx::query("INSERT INTO platform_administrators(auth_subject,granted_by,reason) VALUES('editor','test','SMTP settings test')").execute(&admin).await.unwrap();
    let fallback = SmtpMailer::configured(
        "fallback.example.test",
        587,
        SmtpSecurity::Starttls,
        "user",
        "password",
        "Fallback",
        "fallback@example.test",
    )
    .unwrap();
    let state = AppState::new(
        application.clone(),
        AuthClient::new("http://127.0.0.1:1/userinfo".to_owned()),
    )
    .with_certificates(Some(vault))
    .with_mail(Some(fallback));
    assert!(mail_settings::resolve(&state).await.unwrap().is_some());
    assert_eq!(
        call(&router, "PUT", "editor", Some("\"0\""), settings())
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        mail_settings::resolve(&state)
            .await
            .unwrap()
            .unwrap()
            .settings()
            .host,
        "smtp.example.test"
    );
    let mut command_tx = application.begin().await.unwrap();
    assert_eq!(
        mail_settings::resolve_in(&state, &mut command_tx)
            .await
            .unwrap()
            .unwrap()
            .settings()
            .host,
        "smtp.example.test"
    );
    command_tx.rollback().await.unwrap();
    let mut disabled = settings();
    disabled["enabled"] = json!(false);
    disabled.as_object_mut().unwrap().remove("password");
    assert_eq!(
        call(&router, "PUT", "editor", Some("\"1\""), disabled)
            .await
            .0,
        StatusCode::OK
    );
    assert!(mail_settings::resolve(&state).await.unwrap().is_none());
    let mut command_tx = application.begin().await.unwrap();
    assert!(
        mail_settings::resolve_in(&state, &mut command_tx)
            .await
            .unwrap()
            .is_none()
    );
    command_tx.rollback().await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sales_order_email_deliveries")
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(count, 0);
    super::company_tests::cleanup(&admin, application, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn platform_mail_settings_concurrent_initial_saves_and_missing_encryption(admin: PgPool) {
    let (router, application, server, role) = super::company_tests::setup(&admin).await;
    sqlx::query("INSERT INTO platform_administrators(auth_subject,granted_by,reason) VALUES('editor','test','SMTP settings test')").execute(&admin).await.unwrap();
    assert_eq!(
        call(&router, "GET", "editor", None, Value::Null).await.1["encryptionReady"],
        false
    );
    assert_eq!(
        call(&router, "PUT", "editor", Some("\"0\""), settings())
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut disabled = settings();
    disabled["enabled"] = json!(false);
    disabled.as_object_mut().unwrap().remove("password");
    let (first, second) = tokio::join!(
        call(&router, "PUT", "editor", Some("\"0\""), disabled.clone()),
        call(&router, "PUT", "editor", Some("\"0\""), disabled)
    );
    let mut statuses = [first.0.as_u16(), second.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 412]);
    super::company_tests::cleanup(&admin, application, server, &role).await;
}
