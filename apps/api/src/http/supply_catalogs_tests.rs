use super::company_tests::{cleanup, setup};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const RESOURCES: [&str; 4] = ["warehouses", "product-groups", "tag-groups", "tags"];

#[sqlx::test(migrations = "../../migrations")]
async fn group_archive_racing_tag_creation_preserves_active_group_invariant(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    let group = create(&router, "tag-groups", input("tag-groups", "RACE")).await;
    let uri = format!("/api/v1/tag-groups/{group}");
    let mut archived = input("tag-groups", "RACE");
    archived["status"] = json!("archived");
    let mut tag = input("tags", "RACE");
    tag["groupId"] = json!(group);
    let (archive, create) = tokio::join!(
        call(
            &router,
            "PUT",
            &uri,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            archived
        ),
        call(
            &router,
            "POST",
            "/api/v1/tags",
            "editor",
            None,
            Some(Uuid::now_v7()),
            tag
        )
    );
    assert!(
        (archive.0 == StatusCode::OK && create.0 == StatusCode::CONFLICT)
            || (archive.0 == StatusCode::CONFLICT && create.0 == StatusCode::CREATED),
        "archive={:?}, create={:?}",
        archive,
        create
    );
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tags t JOIN tag_groups g ON g.tenant_id=t.tenant_id AND g.id=t.group_id WHERE t.status='active' AND g.status='archived'").fetch_one(&admin).await.unwrap(), 0);
    cleanup(&admin, app, server, &role).await;
}

fn input(resource: &str, code: &str) -> Value {
    let mut value = json!({"code":code,"name":" Cadastro ","status":"active","notes":null});
    match resource {
        "warehouses" => value["location"] = json!(" Prateleira A "),
        "tags" => value["groupId"] = Value::Null,
        _ => {}
    }
    value
}
async fn grant(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999',code FROM permissions WHERE code IN ('catalog.products.read','catalog.products.manage','inventory.stock.read','inventory.stock.manage') ON CONFLICT DO NOTHING; INSERT INTO role_permissions(role_id,permission_code) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',code FROM permissions WHERE code IN ('catalog.products.read','inventory.stock.read') ON CONFLICT DO NOTHING;").execute(admin).await.unwrap();
}
async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    subject: &str,
    revision: Option<i64>,
    key: Option<Uuid>,
    body: Value,
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {subject}"))
        .header("x-tenant-id", TENANT)
        .header("content-type", "application/json");
    if let Some(revision) = revision {
        request = request.header("if-match", format!("\"{revision}\""));
    }
    if let Some(key) = key {
        request = request.header("idempotency-key", key.to_string());
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    (
        parts.status,
        parts.headers,
        serde_json::from_slice(&to_bytes(body, 100000).await.unwrap()).unwrap(),
    )
}
async fn create(router: &Router, resource: &str, value: Value) -> String {
    let response = call(
        router,
        "POST",
        &format!("/api/v1/{resource}"),
        "editor",
        None,
        Some(Uuid::now_v7()),
        value,
    )
    .await;
    assert_eq!(response.0, StatusCode::CREATED, "{}", response.2);
    response.2["data"]["id"].as_str().unwrap().to_owned()
}

#[sqlx::test(migrations = "../../migrations")]
async fn supply_catalogs_persist_replay_enforce_revisions_and_permissions(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    for resource in RESOURCES {
        let uri = format!("/api/v1/{resource}");
        let mut value = input(resource, " base ");
        let key = Uuid::now_v7();
        let created = call(
            &router,
            "POST",
            &uri,
            "editor",
            None,
            Some(key),
            value.clone(),
        )
        .await;
        assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
        assert_eq!(created.1["etag"], "\"1\"");
        assert_eq!(created.2["data"]["code"], "BASE");
        assert_eq!(created.2["data"]["name"], "Cadastro");
        if resource == "warehouses" {
            assert_eq!(created.2["data"]["location"], "Prateleira A");
        }
        if resource.ends_with("groups") {
            assert!(created.2["data"].get("location").is_none());
        }
        let replay = call(
            &router,
            "POST",
            &uri,
            "editor",
            None,
            Some(key),
            value.clone(),
        )
        .await;
        assert_eq!(replay.2, created.2);
        assert_eq!(replay.1["idempotency-replayed"], "true");
        for (actor, key, expected) in [
            ("reader", Some(Uuid::now_v7()), StatusCode::FORBIDDEN),
            ("editor", None, StatusCode::PRECONDITION_REQUIRED),
            ("editor", Some(Uuid::now_v7()), StatusCode::CONFLICT),
        ] {
            assert_eq!(
                call(&router, "POST", &uri, actor, None, key, value.clone())
                    .await
                    .0,
                expected
            );
        }
        let item = format!("{uri}/{}", created.2["data"]["id"].as_str().unwrap());
        value["status"] = json!("archived");
        let key = Uuid::now_v7();
        let saved = call(
            &router,
            "PUT",
            &item,
            "editor",
            Some(1),
            Some(key),
            value.clone(),
        )
        .await;
        assert_eq!(saved.0, StatusCode::OK, "{}", saved.2);
        assert_eq!(saved.1["etag"], "\"2\"");
        assert_eq!(
            call(
                &router,
                "PUT",
                &item,
                "editor",
                Some(1),
                Some(key),
                value.clone()
            )
            .await
            .2,
            saved.2
        );
        assert_eq!(
            call(
                &router,
                "PUT",
                &item,
                "editor",
                Some(1),
                Some(Uuid::now_v7()),
                value.clone()
            )
            .await
            .0,
            StatusCode::PRECONDITION_FAILED
        );
        assert_eq!(
            call(&router, "GET", &item, "reader", None, None, Value::Null)
                .await
                .2["data"],
            saved.2["data"]
        );
        let listed = call(
            &router,
            "GET",
            &format!("{uri}?q=BASE&status=archived&limit=1"),
            "reader",
            None,
            None,
            Value::Null,
        )
        .await;
        assert_eq!(listed.2["total"], 1);
        assert_eq!(listed.2["canEdit"], false);
        value["unknown"] = json!(true);
        assert_eq!(
            call(
                &router,
                "PUT",
                &item,
                "editor",
                Some(2),
                Some(Uuid::now_v7()),
                value
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM audit_log WHERE entity_type IN ('warehouses','product_groups','tag_groups','tags')").fetch_one(&admin).await.unwrap(),8);
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn supply_catalogs_isolate_foreign_records_and_group_links(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    for resource in RESOURCES {
        let table = resource.replace('-', "_");
        let id = Uuid::now_v7();
        sqlx::query(&format!("INSERT INTO {table}(id,tenant_id,code,name,status,revision) VALUES($1,$2,'FOREIGN','Outra empresa','active',1)"))
            .bind(id).bind(Uuid::parse_str(OTHER).unwrap()).execute(&admin).await.unwrap();
        let uri = format!("/api/v1/{resource}/{id}");
        assert_eq!(
            call(&router, "GET", &uri, "editor", None, None, Value::Null)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            call(
                &router,
                "PUT",
                &uri,
                "editor",
                Some(1),
                Some(Uuid::now_v7()),
                input(resource, "FOREIGN")
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("/api/v1/{resource}"),
                "editor",
                None,
                None,
                Value::Null
            )
            .await
            .2["total"],
            0
        );
        let mut tx = app.begin().await.unwrap();
        sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
            .bind(TENANT)
            .execute(&mut *tx)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&mut *tx)
                .await
                .unwrap(),
            0
        );
        tx.rollback().await.unwrap();
        if resource == "tag-groups" {
            let mut tag = input("tags", "LOCAL");
            tag["groupId"] = json!(id);
            assert_eq!(
                call(
                    &router,
                    "POST",
                    "/api/v1/tags",
                    "editor",
                    None,
                    Some(Uuid::now_v7()),
                    tag
                )
                .await
                .0,
                StatusCode::CONFLICT
            );
        }
    }
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn tag_group_archival_preserves_history_and_blocks_active_relations(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    grant(&admin).await;
    let group = create(&router, "tag-groups", input("tag-groups", "GROUP")).await;
    let group_uri = format!("/api/v1/tag-groups/{group}");
    let mut tag = input("tags", "TAG");
    tag["groupId"] = json!(group);
    let id = create(&router, "tags", tag.clone()).await;
    let tag_uri = format!("/api/v1/tags/{id}");
    let mut archived_group = input("tag-groups", "GROUP");
    archived_group["status"] = json!("archived");
    assert_eq!(
        call(
            &router,
            "PUT",
            &group_uri,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            archived_group.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    tag["status"] = json!("archived");
    assert_eq!(
        call(
            &router,
            "PUT",
            &tag_uri,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            tag.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &router,
            "PUT",
            &group_uri,
            "editor",
            Some(1),
            Some(Uuid::now_v7()),
            archived_group
        )
        .await
        .0,
        StatusCode::OK
    );
    tag["status"] = json!("active");
    assert_eq!(
        call(
            &router,
            "PUT",
            &tag_uri,
            "editor",
            Some(2),
            Some(Uuid::now_v7()),
            tag.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    tag["code"] = json!("NEW");
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/tags",
            "editor",
            None,
            Some(Uuid::now_v7()),
            tag.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    tag["groupId"] = Value::Null;
    assert_eq!(
        call(
            &router,
            "PUT",
            &tag_uri,
            "editor",
            Some(2),
            Some(Uuid::now_v7()),
            tag
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut invalid = input("warehouses", "INVALID");
    invalid["location"] = json!("x".repeat(201));
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/v1/warehouses",
            "editor",
            None,
            Some(Uuid::now_v7()),
            invalid
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    cleanup(&admin, app, server, &role).await;
}
