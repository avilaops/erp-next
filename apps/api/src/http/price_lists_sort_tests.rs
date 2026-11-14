use super::company_tests::{cleanup, setup};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;

async fn list(router: &Router, query: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .uri(format!("/api/v1/price-lists?{query}"))
        .header("x-tenant-id", "11111111-1111-4111-8111-111111111111")
        .header("authorization", "Bearer editor")
        .body(Body::empty())
        .unwrap();
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn pages(router: &Router, field: &str, order: &str) -> Vec<Value> {
    let mut rows = Vec::new();
    for offset in [0, 25] {
        let (status, result) = list(
            router,
            &format!("q=Lista&sortBy={field}&sortOrder={order}&offset={offset}&limit=25"),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["total"], 35);
        rows.extend(result["data"].as_array().unwrap().iter().cloned());
    }
    assert_eq!(rows.len(), 35);
    let ids = rows
        .iter()
        .map(|row| row["id"].as_str().unwrap())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(ids.len(), 35, "every row appears exactly once across pages");
    rows
}

#[sqlx::test(migrations = "../../migrations")]
async fn price_list_sorting_is_global_typed_natural_nullable_and_tenant_scoped(admin: PgPool) {
    let (router, application, server, role) = setup(&admin).await;
    sqlx::raw_sql(r#"
        INSERT INTO role_permissions(role_id,permission_code) VALUES
        ('99999999-9999-4999-8999-999999999999','catalog.products.read');
        INSERT INTO products(id,tenant_id,sku,name,unit,price_cents,status)
        SELECT md5('sort-product-'||n)::uuid,'11111111-1111-4111-8111-111111111111',
               'P-'||n,'Produto '||n,'UN',100,'active' FROM generate_series(1,100) n;
        INSERT INTO price_lists(id,tenant_id,code,name,status,valid_from,valid_until)
        SELECT md5('sort-list-'||n)::uuid,'11111111-1111-4111-8111-111111111111',
               'L'||n,CASE WHEN n%2=0 THEN 'Lista Árvore ' ELSE 'Lista arvore ' END||n,
               CASE WHEN n%2=0 THEN 'active' ELSE 'archived' END,
               CASE WHEN n%4=0 THEN NULL ELSE DATE '2026-01-01'+n END,
               CASE WHEN n%4=0 THEN NULL ELSE DATE '2027-01-01'+n END
        FROM generate_series(1,35) n;
        INSERT INTO price_list_items(tenant_id,price_list_id,product_id,price_cents)
        SELECT '11111111-1111-4111-8111-111111111111',md5('sort-list-'||n)::uuid,
               md5('sort-product-'||p)::uuid,100
        FROM generate_series(1,35) n CROSS JOIN generate_series(1,100) p
        WHERE p<=CASE n%3 WHEN 0 THEN 100 WHEN 1 THEN 2 ELSE 10 END;
        INSERT INTO price_lists(id,tenant_id,code,name,status)
        VALUES(md5('sort-other-tenant')::uuid,'22222222-2222-4222-8222-222222222222','L0','Lista Árvore 0','active');
    "#).execute(&admin).await.unwrap();
    for field in ["code", "name"] {
        let rows = pages(&router, field, "asc").await;
        assert_eq!(
            rows.iter()
                .map(|row| row["code"].as_str().unwrap().to_owned())
                .collect::<Vec<_>>(),
            (1..=35).map(|n| format!("L{n}")).collect::<Vec<_>>()
        );
        let rows = pages(&router, field, "desc").await;
        assert_eq!(
            rows.iter()
                .map(|row| row["code"].as_str().unwrap().to_owned())
                .collect::<Vec<_>>(),
            (1..=35).rev().map(|n| format!("L{n}")).collect::<Vec<_>>()
        );
    }
    let counts = pages(&router, "itemCount", "asc")
        .await
        .into_iter()
        .map(|row| row["itemCount"].as_i64().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(counts, [vec![2; 12], vec![10; 12], vec![100; 11]].concat());
    let statuses = pages(&router, "status", "asc").await;
    assert!(
        statuses[..18].iter().all(|row| row["status"] == "archived"),
        "Arquivada sorts before Ativa as displayed"
    );
    assert!(statuses[18..].iter().all(|row| row["status"] == "active"));
    for field in ["validFrom", "validUntil"] {
        for order in ["asc", "desc"] {
            let rows = pages(&router, field, order).await;
            assert!(
                rows[27..].iter().all(|row| row[field].is_null()),
                "null dates remain last for {order}"
            );
            let dates = rows[..27]
                .iter()
                .map(|row| row[field].as_str().unwrap())
                .collect::<Vec<_>>();
            assert!(dates.windows(2).all(|pair| if order == "asc" {
                pair[0] <= pair[1]
            } else {
                pair[0] >= pair[1]
            }));
        }
    }
    let (status, filtered) =
        list(&router, "status=active&sortBy=code&sortOrder=desc&limit=25").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(filtered["total"], 17);
    assert_eq!(filtered["data"][0]["code"], "L34");
    for query in [
        "sortBy=name%3BDROP%20TABLE%20price_lists",
        "sortBy=name&sortOrder=DESC",
        "sortBy=itemCount&sortOrder=desc%20NULLS%20FIRST",
        "sortOrder=desc",
        "sortBy=price",
        "sortBy=name&unknown=1",
    ] {
        assert_eq!(
            list(&router, query).await.0,
            StatusCode::UNPROCESSABLE_ENTITY,
            "accepted {query}"
        );
    }
    cleanup(&admin, application, server, &role).await;
}
