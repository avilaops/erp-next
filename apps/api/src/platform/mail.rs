use std::{env, sync::Arc, time::Duration};

use super::mail_settings::{MailSettingsData, SmtpSecurity};
use anyhow::{Context, ensure};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{Attachment, MultiPart, SinglePart, header::ContentType},
    transport::smtp::authentication::Credentials,
};

#[derive(Clone)]
pub struct SmtpMailer {
    transport: Arc<AsyncSmtpTransport<Tokio1Executor>>,
    from: String,
    settings: MailSettingsData,
}

impl std::fmt::Debug for SmtpMailer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Lettre's transport owns credentials. Never delegate Debug to it.
        formatter.write_str("SmtpMailer { credentials: [REDACTED] }")
    }
}

#[derive(Clone)]
pub struct MailAttachment {
    pub filename: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

impl SmtpMailer {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let host = match env::var("SMTP_HOST")
            .ok()
            .filter(|value| !value.trim().is_empty())
        {
            Some(value) => value,
            None => return Ok(None),
        };
        let security = match env::var("SMTP_SECURITY")
            .unwrap_or_else(|_| "starttls".to_owned())
            .as_str()
        {
            "starttls" => SmtpSecurity::Starttls,
            "tls" => SmtpSecurity::Tls,
            _ => anyhow::bail!("SMTP_SECURITY must be starttls or tls"),
        };
        let port: u16 = env::var("SMTP_PORT")
            .unwrap_or_else(|_| match security {
                SmtpSecurity::Starttls => "587".to_owned(),
                SmtpSecurity::Tls => "465".to_owned(),
            })
            .parse()
            .context("SMTP_PORT must be a valid port")?;
        let username =
            env::var("SMTP_USERNAME").context("SMTP_USERNAME is required when SMTP_HOST is set")?;
        let password = zeroize::Zeroizing::new(
            env::var("SMTP_PASSWORD").context("SMTP_PASSWORD is required when SMTP_HOST is set")?,
        );
        let from = env::var("SMTP_FROM").context("SMTP_FROM is required when SMTP_HOST is set")?;
        let mailbox = from
            .parse::<lettre::message::Mailbox>()
            .context("SMTP_FROM must be a valid mailbox")?;
        Self::configured(
            &host,
            port,
            security,
            &username,
            &password,
            mailbox.name.as_deref().unwrap_or(""),
            mailbox.email.as_ref(),
        )
        .map(Some)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn configured(
        host: &str,
        port: u16,
        security: SmtpSecurity,
        username: &str,
        password: &str,
        from_name: &str,
        from_address: &str,
    ) -> anyhow::Result<Self> {
        ensure!(
            !username.is_empty() && !password.is_empty() && port != 0,
            "SMTP credentials must not be empty"
        );
        let mailbox = lettre::message::Mailbox::new(
            (!from_name.is_empty()).then(|| from_name.to_owned()),
            from_address.parse()?,
        );
        // Both constructors enforce TLS and validate server certificates.
        // starttls_relay requires STARTTLS; it never falls back to plaintext.
        let transport = match security {
            SmtpSecurity::Starttls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host),
            SmtpSecurity::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(host),
        }
        .context("failed to configure SMTP relay")?
        .port(port)
        .credentials(Credentials::new(username.to_owned(), password.to_owned()))
        .timeout(Some(Duration::from_secs(20)))
        .build();
        Ok(Self {
            transport: Arc::new(transport),
            from: mailbox.to_string(),
            settings: MailSettingsData {
                enabled: true,
                name: String::new(),
                host: host.to_owned(),
                port,
                security,
                username: username.to_owned(),
                from_name: from_name.to_owned(),
                from_address: from_address.to_owned(),
                password_set: true,
            },
        })
    }

    pub fn settings(&self) -> &MailSettingsData {
        &self.settings
    }

    pub(super) fn set_settings(&mut self, settings: MailSettingsData) {
        self.settings = settings;
    }

    pub async fn send_with_attachments(
        &self,
        recipients: &[String],
        subject: &str,
        body: &str,
        attachments: &[MailAttachment],
    ) -> anyhow::Result<()> {
        ensure!(!recipients.is_empty(), "at least one recipient is required");
        let builder = Message::builder().from(self.from.parse()?);
        let builder = recipients
            .iter()
            .try_fold(builder, |builder, recipient| {
                Ok::<_, anyhow::Error>(builder.to(recipient.parse()?))
            })?
            .subject(subject);
        let parts = attachments.iter().map(|attachment| {
            let content_type = ContentType::parse(&attachment.content_type).unwrap_or_else(|_| {
                ContentType::parse("application/octet-stream").expect("static content type")
            });
            Attachment::new(attachment.filename.clone())
                .body(attachment.bytes.clone(), content_type)
        });
        let message = parts.fold(
            MultiPart::mixed().singlepart(SinglePart::plain(body.to_owned())),
            |multipart, part| multipart.singlepart(part),
        );
        self.transport.send(builder.multipart(message)?).await?;
        Ok(())
    }
}
