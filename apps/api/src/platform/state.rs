use sqlx::PgPool;

use super::auth::AuthClient;

#[derive(Clone)]
pub struct AppState {
    pub catalog_media: Option<crate::domains::catalog_publication::MediaGateway>,
    pub ibpt: std::sync::Arc<crate::domains::fiscal::ibpt::IbptCatalog>,
    pub registry: Option<std::sync::Arc<crate::domains::registry_lookup::RegistryClient>>,
    pub subscriptions: Option<super::subscriptions::provider::MercadoPago>,
    pub auth: AuthClient,
    pub database: PgPool,
    pub invitations: Option<super::invitations::ProvisioningClient>,
    pub mail: Option<super::mail::SmtpMailer>,
    pub danfe: Option<crate::domains::fiscal::danfe_client::DanfeClient>,
    pub fiscal_engine: Option<crate::domains::fiscal::engine_client::FiscalEngine>,
    pub nfe_production_enabled: bool,
    pub nfe_production_tenant_id: Option<uuid::Uuid>,
    pub certificates:
        Option<std::sync::Arc<crate::domains::fiscal::certificate_crypto::CertificateVault>>,
    pub contracts: Option<crate::domains::contracts::provider::Docuseal>,
    pub assistant: Option<crate::domains::assistant::InferenceClient>,
    pub monitor: Option<crate::domains::fiscal::sefaz_client::Sefaz>,
}

impl AppState {
    pub fn new(database: PgPool, auth: AuthClient) -> Self {
        Self {
            catalog_media: None,
            ibpt: std::sync::Arc::new(crate::domains::fiscal::ibpt::IbptCatalog::default()),
            registry: None,
            subscriptions: None,
            auth,
            database,
            invitations: None,
            mail: None,
            danfe: None,
            fiscal_engine: None,
            nfe_production_enabled: false,
            nfe_production_tenant_id: None,
            certificates: None,
            contracts: None,
            assistant: None,
            monitor: None,
        }
    }

    pub fn with_subscriptions(
        mut self,
        client: Option<super::subscriptions::provider::MercadoPago>,
    ) -> Self {
        self.subscriptions = client;
        self
    }

    pub fn with_registry(
        mut self,
        client: crate::domains::registry_lookup::RegistryClient,
    ) -> Self {
        self.registry = Some(std::sync::Arc::new(client));
        self
    }

    pub fn with_ibpt(mut self, catalog: crate::domains::fiscal::ibpt::IbptCatalog) -> Self {
        self.ibpt = std::sync::Arc::new(catalog);
        self
    }

    pub fn with_assistant(
        mut self,
        client: Option<crate::domains::assistant::InferenceClient>,
    ) -> Self {
        self.assistant = client;
        self
    }

    pub fn with_fiscal_engine(
        mut self,
        client: Option<crate::domains::fiscal::engine_client::FiscalEngine>,
    ) -> Self {
        self.fiscal_engine = client;
        self
    }

    pub fn with_nfe_production_enabled(mut self, enabled: bool) -> Self {
        self.nfe_production_enabled = enabled;
        self
    }

    pub fn with_nfe_production_tenant_id(mut self, tenant: Option<uuid::Uuid>) -> Self {
        self.nfe_production_tenant_id = tenant;
        self
    }

    pub fn nfe_production_enabled_for(&self, tenant: uuid::Uuid) -> bool {
        self.nfe_production_enabled
            && self
                .nfe_production_tenant_id
                .is_none_or(|allowed| allowed == tenant)
    }

    pub fn with_monitor(
        mut self,
        monitor: Option<crate::domains::fiscal::sefaz_client::Sefaz>,
    ) -> Self {
        self.monitor = monitor;
        self
    }

    pub fn with_certificates(
        mut self,
        vault: Option<std::sync::Arc<crate::domains::fiscal::certificate_crypto::CertificateVault>>,
    ) -> Self {
        self.certificates = vault;
        self
    }

    pub fn with_invitations(
        mut self,
        client: Option<super::invitations::ProvisioningClient>,
    ) -> Self {
        self.invitations = client;
        self
    }

    pub fn with_mail(mut self, mailer: Option<super::mail::SmtpMailer>) -> Self {
        self.mail = mailer;
        self
    }

    pub fn with_contracts(
        mut self,
        client: Option<crate::domains::contracts::provider::Docuseal>,
    ) -> Self {
        self.contracts = client;
        self
    }

    pub fn with_danfe(
        mut self,
        client: Option<crate::domains::fiscal::danfe_client::DanfeClient>,
    ) -> Self {
        self.danfe = client;
        self
    }
}
