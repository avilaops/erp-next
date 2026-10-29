use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;

use super::company_tests::{cleanup, setup, setup_with_danfe};
use crate::domains::fiscal::{
    danfe::FIXTURE,
    danfe_test_support::{PDF, provider},
};

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT: &str = "22222222-2222-4222-8222-222222222222";
const KEY: &str = "35261004252011000110550010000000011000000017";

async fn grant(admin: &PgPool) {
    sqlx::raw_sql(
        "INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('platform.integrations.manage','fiscal.received_nfe.manage') ON CONFLICT DO NOTHING;",
    )
    .execute(admin)
    .await
    .unwrap();
}

async fn request(
    router: &Router,
    method: &str,
    uri: &str,
    bearer: Option<&str>,
    tenant: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = bearer {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if let Some(tenant) = tenant {
        builder = builder.header("x-tenant-id", tenant);
    }
    let payload = match body {
        Some(value) => {
            builder = builder.header("content-type", "application/json");
            Body::from(value.to_string())
        }
        None => Body::empty(),
    };
    let response = router
        .clone()
        .oneshot(builder.body(payload).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    (
        parts.status,
        parts.headers,
        to_bytes(body, 9 * 1024 * 1024).await.unwrap().to_vec(),
    )
}

fn json_body(body: &[u8]) -> Value {
    serde_json::from_slice(body).unwrap()
}

async fn create_key(router: &Router) -> (String, String) {
    let (status, _, body) = request(
        router,
        "POST",
        "/api/v1/integrations/service-keys",
        Some("editor"),
        Some(TENANT),
        Some(json!({"name":"Lojas monitor de notas"})),
    )
    .await;
    let value = json_body(&body);
    assert_eq!(status, StatusCode::CREATED, "{value}");
    let id = value["id"].as_str().unwrap().to_owned();
    let key = value["key"].as_str().unwrap().to_owned();
    assert!(key.starts_with(&format!("erp_{TENANT}_")));
    (id, key)
}

#[sqlx::test(migrations = "../../migrations")]
async fn service_keys_are_hash_only_tenant_bound_and_revocable(admin: PgPool) {
    let (router, application, auth, role) = setup(&admin).await;
    grant(&admin).await;

    let (id, key) = create_key(&router).await;
    let stored: (String, Vec<u8>, Option<time::OffsetDateTime>) = sqlx::query_as(
        "SELECT key_prefix,key_hash,revoked_at FROM service_api_keys WHERE id=$1::uuid",
    )
    .bind(&id)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert!(!stored.0.contains(&key));
    assert_eq!(stored.1, Sha256::digest(key.as_bytes()).to_vec());
    assert!(stored.2.is_none());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM service_api_keys WHERE encode(key_hash,'hex') LIKE '%' || $1 || '%'",
        )
        .bind(&key)
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );

    let (status, _, body) = request(
        &router,
        "GET",
        "/api/v1/integrations/service-keys",
        Some("editor"),
        Some(TENANT),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let listed = json_body(&body);
    assert_eq!(listed["data"][0]["id"], id);
    assert!(listed.to_string().find(&key).is_none());

    assert_eq!(
        request(
            &router,
            "GET",
            "/api/v1/notas-recebidas",
            Some(&key.replacen(TENANT, OTHER_TENANT, 1)),
            None,
            None,
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );

    assert_eq!(
        request(
            &router,
            "DELETE",
            &format!("/api/v1/integrations/service-keys/{id}"),
            Some("editor"),
            Some(TENANT),
            None,
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(
            &router,
            "GET",
            "/api/v1/notas-recebidas",
            Some(&key),
            None,
            None,
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );

    drop(router);
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn import_is_recipient_only_exact_and_idempotent(admin: PgPool) {
    let (router, application, auth, role) = setup(&admin).await;
    grant(&admin).await;

    let mismatch = request(
        &router,
        "POST",
        "/api/v1/fiscal/received-nfes/import",
        Some("editor"),
        Some(TENANT),
        Some(json!({"xml":FIXTURE})),
    )
    .await;
    assert_eq!(mismatch.0, StatusCode::FORBIDDEN);

    sqlx::query("UPDATE tenants SET tax_id='19131243000197' WHERE id=$1::uuid")
        .bind(TENANT)
        .execute(&admin)
        .await
        .unwrap();
    let (first, concurrent) = tokio::join!(
        request(
            &router,
            "POST",
            "/api/v1/fiscal/received-nfes/import",
            Some("editor"),
            Some(TENANT),
            Some(json!({"xml":FIXTURE})),
        ),
        request(
            &router,
            "POST",
            "/api/v1/fiscal/received-nfes/import",
            Some("editor"),
            Some(TENANT),
            Some(json!({"xml":FIXTURE})),
        )
    );
    assert!(
        (first.0 == StatusCode::CREATED && concurrent.0 == StatusCode::OK)
            || (first.0 == StatusCode::OK && concurrent.0 == StatusCode::CREATED),
        "first={} concurrent={}",
        first.0,
        concurrent.0
    );
    let created = if first.0 == StatusCode::CREATED {
        &first
    } else {
        &concurrent
    };
    let saved = json_body(&created.2);
    let id = saved["id"].as_i64().unwrap();
    assert_eq!(saved["accessKey"], KEY);
    assert_eq!(saved["number"], 1);
    assert_eq!(saved["series"], 1);
    assert_eq!(saved["totalCents"], 1000);
    assert_eq!(saved["itemCount"], 1);

    let replay = request(
        &router,
        "POST",
        "/api/v1/fiscal/received-nfes/import",
        Some("editor"),
        Some(TENANT),
        Some(json!({"xml":FIXTURE})),
    )
    .await;
    assert_eq!(replay.0, StatusCode::OK);
    assert_eq!(replay.1["idempotency-replayed"], "true");
    assert_eq!(json_body(&replay.2)["id"], id);

    let changed = format!("{FIXTURE}\n");
    assert_eq!(
        request(
            &router,
            "POST",
            "/api/v1/fiscal/received-nfes/import",
            Some("editor"),
            Some(TENANT),
            Some(json!({"xml":changed})),
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let stored: (String, String) = sqlx::query_as(
        "SELECT xml,xml_sha256 FROM fiscal_received_nfes WHERE id=$1 AND tenant_id=$2::uuid",
    )
    .bind(id)
    .bind(TENANT)
    .fetch_one(&admin)
    .await
    .unwrap();
    assert_eq!(stored.0, FIXTURE);
    assert_eq!(
        stored.1,
        format!("{:x}", Sha256::digest(FIXTURE.as_bytes()))
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action='fiscal.received_nfe.imported'",
        )
        .fetch_one(&admin)
        .await
        .unwrap(),
        1
    );
    let mut isolated = application.begin().await.unwrap();
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(OTHER_TENANT)
        .execute(&mut *isolated)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM fiscal_received_nfes")
            .fetch_one(&mut *isolated)
            .await
            .unwrap(),
        0
    );
    isolated.commit().await.unwrap();

    let listing = request(
        &router,
        "GET",
        "/api/v1/fiscal/received-nfes?q=04252011000110&from=2026-10-01&to=2026-10-31",
        Some("editor"),
        Some(TENANT),
        None,
    )
    .await;
    assert_eq!(listing.0, StatusCode::OK);
    let listing = json_body(&listing.2);
    assert_eq!(listing["tenantId"], TENANT);
    assert_eq!(listing["total"], 1);
    assert_eq!(listing["data"][0]["id"], id);
    assert!(
        listing["data"][0]["issuedAt"]
            .as_str()
            .is_some_and(|value| value.starts_with("2026-10-"))
    );
    for uri in [
        "/api/v1/fiscal/received-nfes?q=absent",
        "/api/v1/fiscal/received-nfes?from=2027-01-01",
    ] {
        let filtered = request(&router, "GET", uri, Some("editor"), Some(TENANT), None).await;
        assert_eq!(filtered.0, StatusCode::OK);
        assert_eq!(json_body(&filtered.2)["total"], 0);
    }
    for uri in [
        "/api/v1/fiscal/received-nfes?limit=0",
        "/api/v1/fiscal/received-nfes?from=2026-02-30",
        "/api/v1/fiscal/received-nfes?from=2026-11-01&to=2026-10-01",
    ] {
        assert_eq!(
            request(&router, "GET", uri, Some("editor"), Some(TENANT), None)
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let xml_uri = format!("/api/v1/fiscal/received-nfes/{id}/xml");
    let xml = request(&router, "GET", &xml_uri, Some("editor"), Some(TENANT), None).await;
    assert_eq!(xml.0, StatusCode::OK);
    assert_eq!(xml.2, FIXTURE.as_bytes());
    assert_eq!(xml.1["x-xml-sha256"], saved["xmlSha256"].as_str().unwrap());
    for uri in ["/api/v1/fiscal/received-nfes", xml_uri.as_str()] {
        assert_eq!(
            request(&router, "GET", uri, Some("reader"), Some(TENANT), None)
                .await
                .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request(&router, "GET", uri, None, Some(TENANT), None)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
    }
    sqlx::raw_sql("INSERT INTO roles(id,tenant_id,code,name) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','fiscal','Fiscal'); INSERT INTO role_permissions(role_id,permission_code) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','fiscal.received_nfe.manage'); INSERT INTO tenant_memberships(id,tenant_id,identity_id,status) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','active'); INSERT INTO membership_roles(membership_id,role_id) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc');").execute(&admin).await.unwrap();
    let other_listing = request(
        &router,
        "GET",
        "/api/v1/fiscal/received-nfes",
        Some("editor"),
        Some(OTHER_TENANT),
        None,
    )
    .await;
    assert_eq!(other_listing.0, StatusCode::OK);
    assert_eq!(json_body(&other_listing.2)["total"], 0);
    assert_eq!(
        request(
            &router,
            "GET",
            &xml_uri,
            Some("editor"),
            Some(OTHER_TENANT),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );

    drop(router);
    cleanup(&admin, application, auth, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn lojas_lists_and_downloads_exact_xml_and_generated_danfe(admin: PgPool) {
    let (client, provider_task, _) = provider("json").await;
    let (router, application, auth, role) = setup_with_danfe(&admin, Some(client)).await;
    grant(&admin).await;
    sqlx::query("UPDATE tenants SET tax_id='19131243000197' WHERE id=$1::uuid")
        .bind(TENANT)
        .execute(&admin)
        .await
        .unwrap();
    let (_, key) = create_key(&router).await;
    let imported = request(
        &router,
        "POST",
        "/api/v1/fiscal/received-nfes/import",
        Some("editor"),
        Some(TENANT),
        Some(json!({"xml":FIXTURE})),
    )
    .await;
    assert_eq!(imported.0, StatusCode::CREATED);
    let id = json_body(&imported.2)["id"].as_i64().unwrap();
    let other_key = format!("erp_{OTHER_TENANT}_{}", "a".repeat(64));
    sqlx::query("INSERT INTO service_api_keys(id,tenant_id,name,key_prefix,key_hash,created_by_identity_id) VALUES(gen_random_uuid(),$1::uuid,'Outra integração','erp_other_fixture_1234',$2,'33333333-3333-4333-8333-333333333333')")
        .bind(OTHER_TENANT)
        .bind(Sha256::digest(other_key.as_bytes()).to_vec())
        .execute(&admin)
        .await
        .unwrap();

    let listed = request(
        &router,
        "GET",
        "/api/v1/notas-recebidas",
        Some(&key),
        None,
        None,
    )
    .await;
    assert_eq!(listed.0, StatusCode::OK);
    let list = json_body(&listed.2);
    assert_eq!(list["pendencias"], json!([]));
    assert_eq!(list["notas"][0]["id"], id);
    assert_eq!(list["notas"][0]["chave"], KEY);
    assert_eq!(list["notas"][0]["numero"], 1);
    assert_eq!(list["notas"][0]["serie"], 1);
    assert_eq!(list["notas"][0]["valor"], 10.0);
    assert_eq!(list["notas"][0]["itens"], 1);
    assert!(list["notas"][0]["compra_id"].is_null());
    assert_eq!(
        list["notas"][0]["fornecedor"],
        json!({
            "documento":"04252011000110",
            "nome":"EMITENTE DE TESTE SEM VALOR FISCAL",
            "vinculado":false,
            "id":null
        })
    );

    let xml = request(
        &router,
        "GET",
        &format!("/api/v1/notas-recebidas/{id}/xml"),
        Some(&key),
        None,
        None,
    )
    .await;
    assert_eq!(xml.0, StatusCode::OK);
    assert_eq!(xml.1["content-type"], "application/xml; charset=utf-8");
    assert_eq!(xml.1["cache-control"], "no-store");
    assert_eq!(xml.2, FIXTURE.as_bytes());

    let pdf = request(
        &router,
        "GET",
        &format!("/api/v1/notas-recebidas/{id}/danfe"),
        Some(&key),
        None,
        None,
    )
    .await;
    assert_eq!(pdf.0, StatusCode::OK);
    assert_eq!(pdf.1["content-type"], "application/pdf");
    assert_eq!(pdf.1["cache-control"], "no-store");
    assert_eq!(pdf.2, STANDARD.decode(PDF.trim()).unwrap());
    assert_eq!(
        request(
            &router,
            "GET",
            &format!("/api/v1/notas-recebidas/{id}/xml"),
            Some(&other_key),
            None,
            None,
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );

    for uri in [
        "/api/v1/notas-recebidas/999999/xml",
        "/api/v1/notas-recebidas/999999/danfe",
    ] {
        assert_eq!(
            request(&router, "GET", uri, Some(&key), None, None).await.0,
            StatusCode::NOT_FOUND
        );
    }

    provider_task.abort();
    drop(router);
    cleanup(&admin, application, auth, &role).await;
}
