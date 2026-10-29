use sqlx::PgPool;

use super::auth::AuthClient;

#[derive(Clone)]
pub struct AppState {
    pub auth: AuthClient,
    pub database: PgPool,
    pub invitations: Option<super::invitations::ProvisioningClient>,
    pub danfe: Option<crate::domains::fiscal::danfe_client::DanfeClient>,
    pub contracts: Option<crate::domains::contracts::provider::Docuseal>,
}

impl AppState {
    pub fn new(database: PgPool, auth: AuthClient) -> Self {
        Self {
            auth,
            database,
            invitations: None,
            danfe: None,
            contracts: None,
        }
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
