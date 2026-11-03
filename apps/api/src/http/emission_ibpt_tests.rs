//! HTTP issuance boundary with synthetic rates and a loopback engine double.
//! XML/XSD coverage lives in the real fiscal engine suite; no SEFAZ is contacted.
use super::*;
use crate::domains::fiscal::ibpt::IbptCatalog;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use time::{Duration, OffsetDateTime, UtcOffset};

struct CatalogFixture(PathBuf);

impl CatalogFixture {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!("erp-ibpt-issue-{}", Uuid::now_v7()));
        std::fs::create_dir(&directory).unwrap();
        let bytes = serde_json::to_vec(&json!({
            "uf":"SP", "classification":"ncm", "version":"26.2.C",
            "source":"Synthetic issuance fixture", "key":"synthetic-issue-key",
            "validFrom":"2000-01-01", "validTo":"2099-12-31",
            "licenseReference":"synthetic-test-only-no-license-assertion",
            "rows":[{"code":"00000000", "ex":"0", "national":"10.0000",
                "imported":"20.0000", "state":"12.0000", "municipal":"0.0000"}]
        }))
        .unwrap();
        let digest = format!("{:x}", Sha256::digest(&bytes));
        std::fs::write(directory.join("table.json"), bytes).unwrap();
        std::fs::write(
            directory.join("manifest.json"),
            serde_json::to_vec(&json!([{
                "tenantId":TENANT, "file":"table.json", "sha256":digest
            }]))
            .unwrap(),
        )
        .unwrap();
        Self(directory)
    }

    fn load(&self) -> IbptCatalog {
        IbptCatalog::load(&self.0.join("manifest.json")).unwrap()
    }
}

impl Drop for CatalogFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn selected(at: OffsetDateTime) -> Value {
    let mut input = draft();
    input["ibpt"] = json!({
        "uf":"SP", "asOf":at.to_offset(UtcOffset::from_hms(-3, 0, 0).unwrap()).date().to_string(),
        "items":[{"ex":"0", "origin":"national", "version":"26.2.C"}]
    });
    input
}

async fn create_selected(router: &Router, at: OffsetDateTime) -> Value {
    let created = call(
        router,
        "POST",
        "/api/v1/fiscal/nfe",
        "editor",
        None,
        Some(Uuid::now_v7()),
        selected(at),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    created.2["data"].clone()
}

#[sqlx::test(migrations = "../../migrations")]
async fn issue_forwards_the_owned_ibpt_revision_and_replay_does_not_prepare_again(admin: PgPool) {
    let (_, app, auth, role) = setup(&admin).await;
    let fixture = CatalogFixture::new();
    let (router, tasks, calls) =
        services_with_ibpt(&admin, app.clone(), "authorized", fixture.load()).await;
    let created = create_selected(&router, OffsetDateTime::now_utc()).await;
    let uri = format!(
        "/api/v1/fiscal/nfe/{}/issue",
        created["id"].as_str().unwrap()
    );
    let key = Uuid::now_v7();
    let issued = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(issued.0, StatusCode::OK, "{}", issued.2);
    assert_eq!(issued.2["status"], "authorized");
    assert_eq!(issued.2["number"], 1);
    {
        let sent = calls.lock().unwrap();
        assert_eq!(
            sent.iter()
                .map(|(operation, _)| operation.as_str())
                .collect::<Vec<_>>(),
            ["prepare", "authorize"]
        );
        let preparation = &sent[0].1;
        assert_eq!(preparation["tenantId"], TENANT);
        assert_eq!(preparation["ibptSnapshot"], created["ibptSnapshot"]);
        assert_eq!(preparation["draft"]["ibpt"], created["input"]["ibpt"]);
        assert_eq!(preparation["ibptSnapshot"]["items"][0]["amount"], "1.00");
        assert_eq!(
            preparation["ibptSnapshot"]["amounts"],
            json!({"federal":"0.10", "state":"0.12", "municipal":"0.00", "total":"0.22"})
        );
        assert_eq!(
            preparation["ibptSnapshot"]["items"][0]["metadata"]["source"],
            "Synthetic issuance fixture"
        );
        assert_eq!(sent[1].1["ibptSnapshot"], created["ibptSnapshot"]);
    }
    let replayed = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(replayed.0, StatusCode::OK);
    assert_eq!(replayed.2, issued.2);
    assert_eq!(calls.lock().unwrap().len(), 2);
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, app, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn issue_refuses_a_previous_day_estimate_before_reserving_a_number(admin: PgPool) {
    let (_, app, auth, role) = setup(&admin).await;
    let fixture = CatalogFixture::new();
    let (router, tasks, calls) =
        services_with_ibpt(&admin, app.clone(), "authorized", fixture.load()).await;
    let created = create_selected(&router, OffsetDateTime::now_utc() - Duration::days(1)).await;
    let uri = format!(
        "/api/v1/fiscal/nfe/{}/issue",
        created["id"].as_str().unwrap()
    );
    let commands: i64 = sqlx::query_scalar("SELECT count(*) FROM domain_commands")
        .fetch_one(&admin)
        .await
        .unwrap();
    let refused = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(Uuid::now_v7()),
        Value::Null,
    )
    .await;
    assert_eq!(refused.0, StatusCode::CONFLICT, "{}", refused.2);
    assert!(calls.lock().unwrap().is_empty());
    for table in ["fiscal_nfe_documents", "fiscal_number_sequences"] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&admin)
                .await
                .unwrap(),
            0
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM domain_commands")
            .fetch_one(&admin)
            .await
            .unwrap(),
        commands
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='fiscal.nfe.requested'"
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, app, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn issue_resumes_the_reserved_date_then_reconciles_the_same_signed_xml_without_snapshot(
    admin: PgPool,
) {
    let (_, app, auth, role) = setup(&admin).await;
    let fixture = CatalogFixture::new();
    let (router, tasks, calls) =
        services_with_ibpt(&admin, app.clone(), "uncertain", fixture.load()).await;
    let reserved_at = OffsetDateTime::now_utc() - Duration::days(1);
    let created = create_selected(&router, reserved_at).await;
    let id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let issued_at = reserved_at
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    // Model a process that stopped after durable number allocation, before prepare.
    sqlx::query("INSERT INTO fiscal_number_sequences(tenant_id,environment,series,next_number) VALUES($1::uuid,'homologation',1,2)").bind(TENANT).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO fiscal_nfe_documents(tenant_id,id,status,series,number,issued_at,random_code) VALUES($1::uuid,$2,'preparing',1,1,$3,'48291736')").bind(TENANT).bind(id).bind(&issued_at).execute(&admin).await.unwrap();
    let uri = format!("/api/v1/fiscal/nfe/{id}/issue");
    let key = Uuid::now_v7();
    let uncertain = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(uncertain.0, StatusCode::ACCEPTED, "{}", uncertain.2);
    assert_eq!(uncertain.2["status"], "unknown");
    let signed: String =
        sqlx::query_scalar("SELECT signed_xml FROM fiscal_nfe_documents WHERE id=$1")
            .bind(id)
            .fetch_one(&admin)
            .await
            .unwrap();
    {
        let sent = calls.lock().unwrap();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0].0, "prepare");
        assert_eq!(sent[0].1["issuedAt"], issued_at);
        assert_eq!(sent[0].1["ibptSnapshot"], created["ibptSnapshot"]);
        assert_eq!(sent[1].1["signedXml"], signed);
    }
    // Once XML is signed, reconciliation must not rebuild it from mutable draft data.
    sqlx::query("UPDATE fiscal_nfe_drafts SET ibpt_snapshot=NULL WHERE id=$1")
        .bind(id)
        .execute(&admin)
        .await
        .unwrap();
    let reconciled = call(
        &router,
        "POST",
        &uri,
        "editor",
        Some("\"1\""),
        Some(key),
        Value::Null,
    )
    .await;
    assert_eq!(reconciled.0, StatusCode::OK, "{}", reconciled.2);
    assert_eq!(reconciled.2["status"], "authorized");
    let sent = calls.lock().unwrap().clone();
    assert_eq!(
        sent.iter()
            .map(|(operation, _)| operation.as_str())
            .collect::<Vec<_>>(),
        ["prepare", "authorize", "consult"]
    );
    assert_eq!(sent[2].1["signedXml"], signed);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT signed_xml FROM fiscal_nfe_documents WHERE id=$1")
            .bind(id)
            .fetch_one(&admin)
            .await
            .unwrap(),
        signed
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT next_number FROM fiscal_number_sequences")
            .fetch_one(&admin)
            .await
            .unwrap(),
        2
    );
    for task in tasks {
        task.abort();
    }
    cleanup(&admin, app, auth, &role).await;
}
