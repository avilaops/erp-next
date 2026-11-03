// Company-scoped supply preferences and operational validation.
pub mod purchase {
    use crate::domains::{
        DomainChange, DomainError, db, decimal, fixed, record, response, revision,
    };
    use crate::platform::{access, auth::AuthenticatedIdentity, state::AppState};
    use axum::{
        Extension, Json,
        extract::{State, rejection::JsonRejection},
        http::{HeaderMap, StatusCode},
        response::Response,
    };
    use serde::{Deserialize, Serialize};
    use sqlx::{FromRow, Postgres, Transaction};
    use uuid::Uuid;

    #[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct PurchaseSettingsInput {
        minimum_order_amount: String,
        maximum_payment_term_days: u16,
        require_supplier_contact: bool,
    }

    impl PurchaseSettingsInput {
        fn validate(&self) -> Result<i64, DomainError> {
            let amount = fixed(&self.minimum_order_amount, 2)?;
            if amount > 99_999_999_999_999 || self.maximum_payment_term_days > 3650 {
                return Err(DomainError::Invalid(
                    "Valor mínimo ou prazo fora do limite permitido",
                ));
            }
            Ok(amount)
        }
    }

    #[derive(FromRow)]
    struct SettingsRow {
        revision: i64,
        minimum_order_amount_cents: i64,
        maximum_payment_term_days: i32,
        require_supplier_contact: bool,
    }

    impl SettingsRow {
        fn data(&self) -> PurchaseSettingsInput {
            PurchaseSettingsInput {
                minimum_order_amount: decimal(self.minimum_order_amount_cents, 2),
                maximum_payment_term_days: self.maximum_payment_term_days as u16,
                require_supplier_contact: self.require_supplier_contact,
            }
        }
    }

    #[derive(Serialize, utoipa::ToSchema)]
    #[serde(rename_all = "camelCase")]
    pub struct PurchaseSettingsSnapshot {
        tenant_id: Uuid,
        revision: i64,
        can_edit: bool,
        data: Option<PurchaseSettingsInput>,
    }

    async fn transaction<'a>(
        state: &'a AppState,
        headers: &HeaderMap,
        identity: &AuthenticatedIdentity,
        write: bool,
    ) -> Result<(Uuid, Transaction<'a, Postgres>, bool), DomainError> {
        let tenant = access::tenant_id(headers)?;
        let mut tx = access::tenant_transaction(state, tenant).await?;
        if write {
            sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
                .bind(tenant)
                .execute(&mut *tx)
                .await
                .map_err(db)?;
        }
        let member = access::load_access(&mut tx, tenant, &identity.subject).await?;
        let can_edit = access::require_permission(&member, "platform.company.manage").is_ok();
        if write {
            access::require_permission(&member, "platform.company.manage")?;
        } else if !can_edit
            && !["platform.company.read", "purchasing.orders.read"]
                .iter()
                .any(|permission| access::require_permission(&member, permission).is_ok())
        {
            return Err(access::AccessError::Forbidden.into());
        }
        Ok((tenant, tx, can_edit))
    }

    async fn load(
        tx: &mut Transaction<'_, Postgres>,
        tenant: Uuid,
    ) -> Result<Option<SettingsRow>, DomainError> {
        sqlx::query_as("SELECT revision,minimum_order_amount_cents,maximum_payment_term_days,require_supplier_contact FROM purchase_settings WHERE tenant_id=$1")
        .bind(tenant).fetch_optional(&mut **tx).await.map_err(db)
    }

    #[utoipa::path(get,path="/api/v1/purchase-settings",operation_id="get_purchase_settings",tag="Purchasing",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=PurchaseSettingsSnapshot),(status=403,description="Sem acesso à configuração")))]
    pub async fn get_purchase(
        State(state): State<AppState>,
        Extension(identity): Extension<AuthenticatedIdentity>,
        headers: HeaderMap,
    ) -> Result<Response, DomainError> {
        let (tenant, mut tx, can_edit) = transaction(&state, &headers, &identity, false).await?;
        let row = load(&mut tx, tenant).await?;
        let current = row.as_ref().map_or(1, |row| row.revision);
        let data = row.as_ref().map(SettingsRow::data);
        tx.commit().await.map_err(db)?;
        Ok(response(
            StatusCode::OK,
            Some(current),
            PurchaseSettingsSnapshot {
                tenant_id: tenant,
                revision: current,
                can_edit,
                data,
            },
        ))
    }

    #[utoipa::path(put,path="/api/v1/purchase-settings",operation_id="put_purchase_settings",tag="Purchasing",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),request_body=PurchaseSettingsInput,responses((status=200,body=PurchaseSettingsSnapshot),(status=403,description="Exige gestão da empresa"),(status=412,description="Revisão alterada"),(status=422,description="Configuração inválida"),(status=428,description="Revisão obrigatória")))]
    pub async fn put_purchase(
        State(state): State<AppState>,
        Extension(identity): Extension<AuthenticatedIdentity>,
        headers: HeaderMap,
        payload: Result<Json<PurchaseSettingsInput>, JsonRejection>,
    ) -> Result<Response, DomainError> {
        let expected = revision(&headers)?;
        let Json(input) = payload.map_err(|_| {
            DomainError::Invalid("Preencha os três parâmetros, sem campos desconhecidos")
        })?;
        let amount = input.validate()?;
        let (tenant, mut tx, can_edit) = transaction(&state, &headers, &identity, true).await?;
        let previous = load(&mut tx, tenant).await?;
        let current = previous.as_ref().map_or(1, |row| row.revision);
        if expected != current {
            return Err(DomainError::StaleRevision);
        }
        let next = current
            .checked_add(1)
            .ok_or(access::AccessError::Internal)?;
        sqlx::query("INSERT INTO purchase_settings(tenant_id,minimum_order_amount_cents,maximum_payment_term_days,require_supplier_contact,revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id) DO UPDATE SET minimum_order_amount_cents=$2,maximum_payment_term_days=$3,require_supplier_contact=$4,revision=$5,updated_at=now()")
        .bind(tenant).bind(amount).bind(i32::from(input.maximum_payment_term_days)).bind(input.require_supplier_contact).bind(next).execute(&mut *tx).await.map_err(db)?;
        let data = PurchaseSettingsInput {
            minimum_order_amount: decimal(amount, 2),
            ..input
        };
        record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "purchase_settings", id: tenant, event: "purchase.settings.updated", details: serde_json::json!({"previousRevision":current,"revision":next,"previous":previous.as_ref().map(SettingsRow::data),"data":data}) }).await?;
        tx.commit().await.map_err(db)?;
        Ok(response(
            StatusCode::OK,
            Some(next),
            PurchaseSettingsSnapshot {
                tenant_id: tenant,
                revision: next,
                can_edit,
                data: Some(data),
            },
        ))
    }

    pub(crate) async fn validate_purchase_confirmation(
        tx: &mut Transaction<'_, Postgres>,
        tenant: Uuid,
        amount: &str,
        due_date: &str,
        supplier_id: Uuid,
    ) -> Result<(), DomainError> {
        let Some(settings) = load(tx, tenant).await? else {
            return Ok(());
        };
        if fixed(amount, 2)? < settings.minimum_order_amount_cents {
            return Err(DomainError::Conflict(
                "Pedido abaixo do valor mínimo configurado em Preferências / Compras",
            ));
        }
        let due = crate::domains::sales::date(due_date)?;
        let within_term: bool = sqlx::query_scalar("SELECT $1::date <= (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date + $2::integer")
        .bind(due).bind(settings.maximum_payment_term_days).fetch_one(&mut **tx).await.map_err(db)?;
        if !within_term {
            return Err(DomainError::Conflict(
                "Vencimento excede o prazo máximo configurado em Preferências / Compras",
            ));
        }
        if settings.require_supplier_contact {
            let contact: bool = sqlx::query_scalar("SELECT NULLIF(btrim(email),'') IS NOT NULL OR NULLIF(btrim(phone),'') IS NOT NULL FROM parties WHERE tenant_id=$1 AND id=$2")
            .bind(tenant).bind(supplier_id).fetch_one(&mut **tx).await.map_err(db)?;
            if !contact {
                return Err(DomainError::Conflict(
                    "Preencha e-mail ou telefone no cadastro do fornecedor antes de confirmar o pedido",
                ));
            }
        }
        Ok(())
    }
}
pub mod inventory {
    use crate::domains::{DomainChange, DomainError, db, record, response, revision};
    use crate::platform::{access, auth::AuthenticatedIdentity, state::AppState};
    use axum::{
        Extension, Json,
        extract::{State, rejection::JsonRejection},
        http::{HeaderMap, StatusCode},
        response::Response,
    };
    use serde::{Deserialize, Serialize};
    use sqlx::{FromRow, Postgres, Transaction};
    use uuid::Uuid;

    #[derive(Clone, Deserialize, Serialize, utoipa::ToSchema)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct InventorySettingsInput {
        allow_manual_movements: bool,
        minimum_reason_length: u16,
    }

    impl InventorySettingsInput {
        fn validate(&self) -> Result<(), DomainError> {
            if !(3..=200).contains(&self.minimum_reason_length) {
                return Err(DomainError::Invalid(
                    "O motivo mínimo deve ter entre 3 e 200 caracteres",
                ));
            }
            Ok(())
        }
    }

    #[derive(FromRow)]
    struct SettingsRow {
        revision: i64,
        allow_manual_movements: bool,
        minimum_reason_length: i32,
    }

    impl SettingsRow {
        fn data(&self) -> InventorySettingsInput {
            InventorySettingsInput {
                allow_manual_movements: self.allow_manual_movements,
                minimum_reason_length: self.minimum_reason_length as u16,
            }
        }
    }

    #[derive(Serialize, utoipa::ToSchema)]
    #[serde(rename_all = "camelCase")]
    pub struct InventorySettingsSnapshot {
        tenant_id: Uuid,
        revision: i64,
        can_edit: bool,
        data: Option<InventorySettingsInput>,
    }

    async fn transaction<'a>(
        state: &'a AppState,
        headers: &HeaderMap,
        identity: &AuthenticatedIdentity,
        write: bool,
    ) -> Result<(Uuid, Transaction<'a, Postgres>, bool), DomainError> {
        let tenant = access::tenant_id(headers)?;
        let mut tx = access::tenant_transaction(state, tenant).await?;
        if write {
            sqlx::query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE")
                .bind(tenant)
                .execute(&mut *tx)
                .await
                .map_err(db)?;
        }
        let member = access::load_access(&mut tx, tenant, &identity.subject).await?;
        let can_edit = access::require_permission(&member, "platform.company.manage").is_ok();
        if write {
            access::require_permission(&member, "platform.company.manage")?;
        } else if !can_edit
            && !["platform.company.read", "inventory.stock.read"]
                .iter()
                .any(|permission| access::require_permission(&member, permission).is_ok())
        {
            return Err(access::AccessError::Forbidden.into());
        }
        Ok((tenant, tx, can_edit))
    }

    async fn load(
        tx: &mut Transaction<'_, Postgres>,
        tenant: Uuid,
    ) -> Result<Option<SettingsRow>, DomainError> {
        sqlx::query_as("SELECT revision,allow_manual_movements,minimum_reason_length FROM inventory_settings WHERE tenant_id=$1")
        .bind(tenant).fetch_optional(&mut **tx).await.map_err(db)
    }

    #[utoipa::path(get,path="/api/v1/inventory-settings",operation_id="get_inventory_settings",tag="Inventory",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header)),responses((status=200,body=InventorySettingsSnapshot),(status=403,description="Sem acesso à configuração")))]
    pub async fn get_inventory(
        State(state): State<AppState>,
        Extension(identity): Extension<AuthenticatedIdentity>,
        headers: HeaderMap,
    ) -> Result<Response, DomainError> {
        let (tenant, mut tx, can_edit) = transaction(&state, &headers, &identity, false).await?;
        let row = load(&mut tx, tenant).await?;
        let current = row.as_ref().map_or(1, |row| row.revision);
        let data = row.as_ref().map(SettingsRow::data);
        tx.commit().await.map_err(db)?;
        Ok(response(
            StatusCode::OK,
            Some(current),
            InventorySettingsSnapshot {
                tenant_id: tenant,
                revision: current,
                can_edit,
                data,
            },
        ))
    }

    #[utoipa::path(put,path="/api/v1/inventory-settings",operation_id="put_inventory_settings",tag="Inventory",security(("bearerAuth"=[])),params(("X-Tenant-Id"=Uuid,Header),("If-Match"=String,Header)),request_body=InventorySettingsInput,responses((status=200,body=InventorySettingsSnapshot),(status=403,description="Exige gestão da empresa"),(status=412,description="Revisão alterada"),(status=422,description="Configuração inválida"),(status=428,description="Revisão obrigatória")))]
    pub async fn put_inventory(
        State(state): State<AppState>,
        Extension(identity): Extension<AuthenticatedIdentity>,
        headers: HeaderMap,
        payload: Result<Json<InventorySettingsInput>, JsonRejection>,
    ) -> Result<Response, DomainError> {
        let expected = revision(&headers)?;
        let Json(input) = payload.map_err(|_| {
            DomainError::Invalid("Preencha os dois parâmetros, sem campos desconhecidos")
        })?;
        input.validate()?;
        let (tenant, mut tx, can_edit) = transaction(&state, &headers, &identity, true).await?;
        let previous = load(&mut tx, tenant).await?;
        let current = previous.as_ref().map_or(1, |row| row.revision);
        if expected != current {
            return Err(DomainError::StaleRevision);
        }
        let next = current
            .checked_add(1)
            .ok_or(access::AccessError::Internal)?;
        sqlx::query("INSERT INTO inventory_settings(tenant_id,allow_manual_movements,minimum_reason_length,revision) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id) DO UPDATE SET allow_manual_movements=$2,minimum_reason_length=$3,revision=$4,updated_at=now()")
        .bind(tenant).bind(input.allow_manual_movements).bind(i32::from(input.minimum_reason_length)).bind(next).execute(&mut *tx).await.map_err(db)?;
        let data = input;
        record(&mut tx, tenant, &identity, &headers, DomainChange { kind: "inventory_settings", id: tenant, event: "inventory.settings.updated", details: serde_json::json!({"previousRevision":current,"revision":next,"previous":previous.as_ref().map(SettingsRow::data),"data":data}) }).await?;
        tx.commit().await.map_err(db)?;
        Ok(response(
            StatusCode::OK,
            Some(next),
            InventorySettingsSnapshot {
                tenant_id: tenant,
                revision: next,
                can_edit,
                data: Some(data),
            },
        ))
    }

    pub(crate) async fn validate_manual_movement(
        tx: &mut Transaction<'_, Postgres>,
        tenant: Uuid,
        reason: &str,
    ) -> Result<(), DomainError> {
        let Some(settings) = load(tx, tenant).await? else {
            return Ok(());
        };
        if !settings.allow_manual_movements {
            return Err(DomainError::Conflict(
                "Movimentações manuais desabilitadas em Preferências / Estoque",
            ));
        }
        if reason.chars().count() < settings.minimum_reason_length as usize {
            return Err(DomainError::Invalid(
                "Motivo menor que o mínimo configurado em Preferências / Estoque",
            ));
        }
        Ok(())
    }
}
pub(crate) use inventory::validate_manual_movement;
pub use inventory::{get_inventory, put_inventory};
pub(crate) use purchase::validate_purchase_confirmation;
pub use purchase::{get_purchase, put_purchase};
