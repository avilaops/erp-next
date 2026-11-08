use std::{env, sync::Arc, time::Duration};

use anyhow::{Context, ensure};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{Attachment, MultiPart, SinglePart, header::ContentType},
    transport::smtp::authentication::Credentials,
};

#[derive(Debug, Clone)]
pub struct SmtpMailer {
    transport: Arc<AsyncSmtpTransport<Tokio1Executor>>,
    from: String,
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
        let port: u16 = env::var("SMTP_PORT")
            .unwrap_or_else(|_| "587".to_owned())
            .parse()
            .context("SMTP_PORT must be a valid port")?;
        let username =
            env::var("SMTP_USERNAME").context("SMTP_USERNAME is required when SMTP_HOST is set")?;
        let password =
            env::var("SMTP_PASSWORD").context("SMTP_PASSWORD is required when SMTP_HOST is set")?;
        let from = env::var("SMTP_FROM").context("SMTP_FROM is required when SMTP_HOST is set")?;
        let _ = from
            .parse::<lettre::message::Mailbox>()
            .context("SMTP_FROM must be a valid mailbox")?;
        ensure!(
            !username.is_empty() && !password.is_empty(),
            "SMTP credentials must not be empty"
        );
        let transport = AsyncSmtpTransport::<Tokio1Executor>::relay(&host)
            .context("failed to configure SMTP relay")?
            .port(port)
            .credentials(Credentials::new(username, password))
            .timeout(Some(Duration::from_secs(20)))
            .build();
        Ok(Some(Self {
            transport: Arc::new(transport),
            from,
        }))
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
