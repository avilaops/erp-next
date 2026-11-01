use sqlx::PgPool;

use super::auth::AuthClient;

#[derive(Clone)]
pub struct AppState {
    pub auth: AuthClient,
    pub database: PgPool,
    pub invitations: Option<super::invitations::ProvisioningClient>,
    pub danfe: Option<crate::domains::fiscal::danfe_client::DanfeClient>,
    pub fiscal_engine: Option<crate::domains::fiscal::engine_client::FiscalEngine>,
    pub certificates:
        Option<std::sync::Arc<crate::domains::fiscal::certificate_crypto::CertificateVault>>,
    pub contracts: Option<crate::domains::contracts::provider::Docuseal>,
    pub assistant: Option<crate::domains::assistant::InferenceClient>,
    pub monitor: Option<crate::domains::fiscal::sefaz_client::Sefaz>,
}

impl AppState {
    pub fn new(database: PgPool, auth: AuthClient) -> Self {
        Self {
            auth,
            database,
            invitations: None,
            danfe: None,
            fiscal_engine: None,
            certificates: None,
            contracts: None,
            assistant: None,
            monitor: None,
        }
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
