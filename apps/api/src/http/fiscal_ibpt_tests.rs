use super::*;
use crate::{domains::fiscal::ibpt::IbptCatalog, http::company_tests::setup_with_ibpt};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// Synthetic rates exercise persistence; this fixture is not an authorized IBPT table.
struct CatalogFixture {
    directory: PathBuf,
    sha256: String,
}

impl CatalogFixture {
    fn new(tenant: &str) -> Self {
        let directory = std::env::temp_dir().join(format!("erp-ibpt-http-{}", Uuid::now_v7()));
        std::fs::create_dir(&directory).unwrap();
        let table = json!({
            "uf":"SP", "classification":"ncm", "version":"26.2.C",
            "source":"Synthetic persistence fixture", "key":"synthetic-http-key",
            "validFrom":"2026-10-20", "validTo":"2026-11-30",
            "licenseReference":"synthetic-test-only-no-license-assertion",
            "rows":[{"code":"00000000", "ex":"0", "national":"10.0000",
                "imported":"20.0000", "state":"12.0000", "municipal":"0.0000"}]
        });
        let bytes = serde_json::to_vec(&table).unwrap();
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        std::fs::write(directory.join("table.json"), bytes).unwrap();
        std::fs::write(
            directory.join("manifest.json"),
            serde_json::to_vec(&json!([{
                "tenantId":tenant, "file":"table.json", "sha256":sha256
            }]))
            .unwrap(),
        )
        .unwrap();
        Self { directory, sha256 }
    }

    fn load(&self) -> IbptCatalog {
        IbptCatalog::load(&self.directory.join("manifest.json")).unwrap()
    }

    fn expected_snapshot(&self) -> Value {
        json!({
            "tenantId":TENANT, "uf":"SP", "asOf":"2026-11-03",
            "items":[{
                "itemCode":"TEST", "code":"00000000", "ex":"0", "origin":"national",
                "amount":"1.00",
                "metadata":{
                    "uf":"SP", "classification":"ncm", "version":"26.2.C",
                    "source":"Synthetic persistence fixture", "key":"synthetic-http-key",
                    "validFrom":"2026-10-20", "validTo":"2026-11-30", "sha256":self.sha256
                },
                "amounts":{"federal":"0.10", "state":"0.12", "municipal":"0.00", "total":"0.22"}
            }],
            "amounts":{"federal":"0.10", "state":"0.12", "municipal":"0.00", "total":"0.22"}
        })
    }
}

impl Drop for CatalogFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn selected_draft() -> Value {
    let mut value = draft();
    value["ibpt"] = json!({
        "uf":"SP", "asOf":"2026-11-03",
        "items":[{"ex":"0", "origin":"national", "version":"26.2.C"}]
    });
    value
}

async fn persisted_snapshot(admin: &PgPool, id: &str) -> Option<Value> {
    sqlx::query_scalar::<_, Option<Value>>(
        "SELECT ibpt_snapshot FROM fiscal_nfe_drafts WHERE tenant_id=$1 AND id=$2",
    )
    .bind(Uuid::parse_str(TENANT).unwrap())
    .bind(Uuid::parse_str(id).unwrap())
    .fetch_one(admin)
    .await
    .unwrap()
}

async fn assert_no_draft_side_effects(admin: &PgPool) {
    for table in [
        "fiscal_nfe_drafts",
        "domain_commands",
        "fiscal_number_sequences",
        "fiscal_nfe_documents",
    ] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(admin)
                .await
                .unwrap(),
            0,
            "unexpected mutation in {table}"
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action LIKE 'fiscal.nfe.%'",
        )
        .fetch_one(admin)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM outbox_events WHERE event_type LIKE 'fiscal.nfe.%'",
        )
        .fetch_one(admin)
        .await
        .unwrap(),
        0
    );
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_ibpt_snapshot_is_persisted_with_provenance_and_replayed_exactly(admin: PgPool) {
    let fixture = CatalogFixture::new(TENANT);
    let (router, app, server, role) = setup_with_ibpt(&admin, fixture.load()).await;
    seed(&admin).await;
    configure(&router).await;
    let body = selected_draft();
    let key = Uuid::now_v7();
    let created = create(&router, key, body.clone()).await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    let expected = fixture.expected_snapshot();
    assert_eq!(created.2["data"]["ibptSnapshot"], expected);
    assert_eq!(persisted_snapshot(&admin, id).await, Some(expected.clone()));
    let uri = format!("/api/v1/fiscal/nfe/{id}");
    let fetched = Call::new("GET", &uri, Value::Null).send(&router).await;
    assert_eq!(fetched.0, StatusCode::OK, "{}", fetched.2);
    assert_eq!(fetched.2["data"]["ibptSnapshot"], expected);
    let page = Call::new("GET", "/api/v1/fiscal/nfe?limit=1", Value::Null)
        .send(&router)
        .await;
    assert_eq!(page.0, StatusCode::OK, "{}", page.2);
    assert_eq!(page.2["data"][0]["ibptSnapshot"], expected);

    // Replaying does not prepare against the issuer again or replace the saved snapshot.
    sqlx::query("DELETE FROM fiscal_profiles WHERE tenant_id=$1")
        .bind(Uuid::parse_str(TENANT).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let replayed = create(&router, key, body.clone()).await;
    assert_eq!(replayed.0, StatusCode::CREATED, "{}", replayed.2);
    assert_eq!(replayed.1["idempotency-replayed"], "true");
    assert_eq!(replayed.2, created.2);
    assert_eq!(persisted_snapshot(&admin, id).await, Some(expected));
    assert_eq!(
        create(&router, Uuid::now_v7(), body).await.0,
        StatusCode::CONFLICT
    );
    for table in ["fiscal_nfe_drafts", "domain_commands"] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            1
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='fiscal.nfe.draft.created'",
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        1
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_ibpt_updates_recalculate_preserve_manual_fields_and_remove_as_sql_null(
    admin: PgPool,
) {
    let fixture = CatalogFixture::new(TENANT);
    let (router, app, server, role) = setup_with_ibpt(&admin, fixture.load()).await;
    seed(&admin).await;
    configure(&router).await;
    let created = create(&router, Uuid::now_v7(), selected_draft()).await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/fiscal/nfe/{id}");
    let mut changed = selected_draft();
    changed["operationNature"] = json!("Operação manual preservada");
    changed["taxRuleReference"] = json!("manual-accountant-instruction");
    changed["items"][0]["description"] = json!("Descrição manual preservada");
    changed["items"][0]["quantity"] = json!("2.0000");
    changed["items"][0]["unitPrice"] = json!("1.0000000000");
    changed["items"][0]["grossTotal"] = json!("2.00");
    changed["productsTotal"] = json!("2.00");
    let mut update = Call::new("PUT", &uri, changed.clone());
    update.revision = Some("\"1\"");
    let saved = update.send(&router).await;
    assert_eq!(saved.0, StatusCode::OK, "{}", saved.2);
    assert_eq!(saved.1["etag"], "\"2\"");
    assert_eq!(saved.2["data"]["revision"], 2);
    let mut expected = fixture.expected_snapshot();
    expected["items"][0]["amount"] = json!("2.00");
    let amounts = json!({"federal":"0.20", "state":"0.24", "municipal":"0.00", "total":"0.44"});
    expected["items"][0]["amounts"] = amounts.clone();
    expected["amounts"] = amounts;
    assert_eq!(saved.2["data"]["ibptSnapshot"], expected);
    assert_eq!(persisted_snapshot(&admin, id).await, Some(expected.clone()));
    for field in [
        "operationNature",
        "taxRuleReference",
        "recipient",
        "items",
        "productsTotal",
        "ibpt",
    ] {
        assert_eq!(
            saved.2["data"]["input"][field], changed[field],
            "manual field {field}"
        );
    }

    // A stale update cannot erase or recalculate an already committed revision.
    let mut stale = Call::new("PUT", &uri, draft());
    stale.revision = Some("\"1\"");
    assert_eq!(stale.send(&router).await.0, StatusCode::PRECONDITION_FAILED);
    let fetched = Call::new("GET", &uri, Value::Null).send(&router).await;
    assert_eq!(fetched.2, saved.2);
    assert_eq!(persisted_snapshot(&admin, id).await, Some(expected));

    changed["ibpt"] = Value::Null;
    let mut remove = Call::new("PUT", &uri, changed.clone());
    remove.revision = Some("\"2\"");
    let removed = remove.send(&router).await;
    assert_eq!(removed.0, StatusCode::OK, "{}", removed.2);
    assert_eq!(removed.2["data"]["revision"], 3);
    assert!(removed.2["data"]["ibptSnapshot"].is_null());
    assert_eq!(persisted_snapshot(&admin, id).await, None);
    for field in [
        "operationNature",
        "taxRuleReference",
        "recipient",
        "items",
        "productsTotal",
    ] {
        assert_eq!(removed.2["data"]["input"][field], changed[field]);
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='fiscal.nfe.draft.updated'",
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        2
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_ibpt_rejects_foreign_tenant_reader_writes_and_client_snapshot_forgery(
    admin: PgPool,
) {
    let fixture = CatalogFixture::new(TENANT);
    let (router, app, server, role) = setup_with_ibpt(&admin, fixture.load()).await;
    seed(&admin).await;
    configure(&router).await;
    for (tenant, subject) in [(OTHER, "editor"), (TENANT, "reader")] {
        let mut denied = Call::new("POST", "/api/v1/fiscal/nfe", selected_draft());
        denied.tenant = tenant;
        denied.subject = subject;
        denied.key = Some(Uuid::now_v7());
        assert_eq!(denied.send(&router).await.0, StatusCode::FORBIDDEN);
    }
    let mut forged = selected_draft();
    forged["ibptSnapshot"] = fixture.expected_snapshot();
    assert_eq!(
        create(&router, Uuid::now_v7(), forged).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut forged = selected_draft();
    forged["ibpt"]["items"][0]["amounts"] = json!({"total":"0.01"});
    assert_eq!(
        create(&router, Uuid::now_v7(), forged).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_no_draft_side_effects(&admin).await;
    let created = create(&router, Uuid::now_v7(), selected_draft()).await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/fiscal/nfe/{id}");
    for method in ["GET", "PUT"] {
        let mut denied = Call::new(method, &uri, selected_draft());
        denied.tenant = OTHER;
        denied.revision = Some("\"1\"");
        assert_eq!(denied.send(&router).await.0, StatusCode::FORBIDDEN);
    }
    let mut denied = Call::new("PUT", &uri, selected_draft());
    denied.subject = "reader";
    denied.revision = Some("\"1\"");
    assert_eq!(denied.send(&router).await.0, StatusCode::FORBIDDEN);
    assert_eq!(
        persisted_snapshot(&admin, id).await,
        Some(fixture.expected_snapshot())
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_ibpt_missing_catalog_rejects_without_partial_draft_or_numbering(admin: PgPool) {
    let (router, app, server, role) = setup_with_ibpt(&admin, IbptCatalog::default()).await;
    seed(&admin).await;
    configure(&router).await;
    let rejected = create(&router, Uuid::now_v7(), selected_draft()).await;
    assert_eq!(rejected.0, StatusCode::CONFLICT, "{}", rejected.2);
    assert_eq!(rejected.2["code"], "ibpt_not_available");
    assert_no_draft_side_effects(&admin).await;
    // Manual drafts remain usable when approximate-tax tables have not been configured.
    let manual = create(&router, Uuid::now_v7(), draft()).await;
    assert_eq!(manual.0, StatusCode::CREATED, "{}", manual.2);
    assert_eq!(
        persisted_snapshot(&admin, manual.2["data"]["id"].as_str().unwrap()).await,
        None
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_ibpt_catalog_never_borrows_another_tenants_table(admin: PgPool) {
    let fixture = CatalogFixture::new(OTHER);
    let (router, app, server, role) = setup_with_ibpt(&admin, fixture.load()).await;
    seed(&admin).await;
    configure(&router).await;
    let rejected = create(&router, Uuid::now_v7(), selected_draft()).await;
    assert_eq!(rejected.0, StatusCode::CONFLICT, "{}", rejected.2);
    assert_eq!(rejected.2["code"], "ibpt_not_available");
    assert_no_draft_side_effects(&admin).await;
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn fiscal_ibpt_unavailable_selection_rejects_atomically_and_preserves_existing_draft(
    admin: PgPool,
) {
    let fixture = CatalogFixture::new(TENANT);
    let (router, app, server, role) = setup_with_ibpt(&admin, fixture.load()).await;
    seed(&admin).await;
    configure(&router).await;
    let mut unavailable = Vec::new();
    for date in ["2026-10-19", "2026-12-01"] {
        let mut body = selected_draft();
        body["ibpt"]["asOf"] = json!(date);
        unavailable.push(body);
    }
    let mut body = selected_draft();
    body["items"][0]["ncm"] = json!("99999999");
    unavailable.push(body);
    let mut body = selected_draft();
    body["ibpt"]["items"][0]["ex"] = json!("1");
    unavailable.push(body);
    let mut body = selected_draft();
    body["ibpt"]["items"][0]["version"] = json!("26.2.D");
    unavailable.push(body);
    let mut body = selected_draft();
    body["ibpt"]["uf"] = json!("RJ");
    unavailable.push(body);
    for body in &unavailable {
        let rejected = create(&router, Uuid::now_v7(), body.clone()).await;
        assert_eq!(rejected.0, StatusCode::CONFLICT, "{}", rejected.2);
        assert_eq!(rejected.2["code"], "ibpt_not_available");
        assert_no_draft_side_effects(&admin).await;
    }
    let created = create(&router, Uuid::now_v7(), selected_draft()).await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let id = created.2["data"]["id"].as_str().unwrap();
    let uri = format!("/api/v1/fiscal/nfe/{id}");
    for body in unavailable {
        let mut update = Call::new("PUT", &uri, body);
        update.revision = Some("\"1\"");
        let rejected = update.send(&router).await;
        assert_eq!(rejected.0, StatusCode::CONFLICT, "{}", rejected.2);
        assert_eq!(rejected.2["code"], "ibpt_not_available");
        let after = Call::new("GET", &uri, Value::Null).send(&router).await;
        assert_eq!(after.2, created.2);
        assert_eq!(
            persisted_snapshot(&admin, id).await,
            Some(fixture.expected_snapshot())
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='fiscal.nfe.draft.updated'",
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    cleanup(&admin, app, server, &role).await;
}
