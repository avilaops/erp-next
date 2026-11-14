use super::company_tests::{cleanup, setup};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";

async fn permissions(admin: &PgPool) {
    sqlx::raw_sql("INSERT INTO role_permissions(role_id,permission_code) SELECT '99999999-9999-4999-8999-999999999999'::uuid,code FROM permissions ON CONFLICT DO NOTHING")
        .execute(admin).await.unwrap();
}

async fn get(router: &Router, uri: &str) -> (StatusCode, Value) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("x-tenant-id", TENANT)
                .header("authorization", "Bearer editor")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn rows(router: &Router, uri: &str) -> Vec<Value> {
    let (status, body) = get(router, uri).await;
    assert_eq!(status, StatusCode::OK, "{uri}: {body}");
    body["data"].as_array().unwrap().clone()
}

fn strings<'a>(data: &'a [Value], field: &str) -> Vec<&'a str> {
    data.iter()
        .map(|row| row[field].as_str().unwrap())
        .collect()
}

#[sqlx::test(migrations = "../../migrations")]
async fn product_sort_is_global_natural_numeric_stable_and_tenant_filtered(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    // Physical insertion order and unpadded lexical order both differ from the requested order.
    sqlx::query("INSERT INTO products(tenant_id,id,sku,name,unit,price_cents,status) SELECT $1,md5('sort-product-'||i)::uuid,'SORT-'||i,'Produto '||i,'UN',CASE i%3 WHEN 0 THEN 200 WHEN 1 THEN 1000 ELSE 10000 END,CASE WHEN i%2=0 THEN 'active' ELSE 'archived' END FROM generate_series(160,1,-1) i")
        .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO products(tenant_id,id,sku,name,unit,price_cents,status) VALUES ('22222222-2222-4222-8222-222222222222',md5('foreign-sort')::uuid,'FOREIGN','Produto 0','UN',1,'active')")
        .execute(&admin).await.unwrap();
    for direction in ["asc", "desc"] {
        let mut actual = Vec::new();
        for offset in [0, 50, 100, 150] {
            let uri = format!(
                "/api/v1/products?sortBy=name&sortOrder={direction}&limit=50&offset={offset}"
            );
            let (status, body) = get(&router, &uri).await;
            assert_eq!(status, StatusCode::OK, "{body}");
            assert_eq!(body["total"], 160);
            actual.extend(
                strings(body["data"].as_array().unwrap(), "name")
                    .into_iter()
                    .map(str::to_owned),
            );
        }
        let mut expected: Vec<_> = (1..=160).map(|n| format!("Produto {n}")).collect();
        if direction == "desc" {
            expected.reverse();
        }
        assert_eq!(actual, expected);
    }
    let filtered = rows(
        &router,
        "/api/v1/products?q=Produto&status=active&sortBy=name&sortOrder=desc&limit=100",
    )
    .await;
    assert_eq!(
        strings(&filtered, "name"),
        (1..=80)
            .rev()
            .map(|i| format!("Produto {}", i * 2))
            .collect::<Vec<_>>()
    );
    for direction in ["asc", "desc"] {
        let mut data = rows(
            &router,
            &format!("/api/v1/products?sortBy=price&sortOrder={direction}&limit=100"),
        )
        .await;
        data.extend(
            rows(
                &router,
                &format!(
                    "/api/v1/products?sortBy=price&sortOrder={direction}&limit=100&offset=100"
                ),
            )
            .await,
        );
        let values: Vec<f64> = strings(&data, "basePrice")
            .iter()
            .map(|s| s.parse().unwrap())
            .collect();
        assert!(values.windows(2).all(|p| if direction == "asc" {
            p[0] <= p[1]
        } else {
            p[0] >= p[1]
        }));
        assert_eq!(values.len(), 160);
        assert!(values.contains(&2.0) && values.contains(&10.0) && values.contains(&100.0));
        assert_eq!(values[0], if direction == "asc" { 2.0 } else { 100.0 });
    }
    let ties = [
        (Uuid::from_u128(1), "Árvore 2"),
        (Uuid::from_u128(2), "arvore 2"),
        (Uuid::from_u128(3), "ARVORE 2"),
        (Uuid::from_u128(4), "Arvore 10"),
        (Uuid::from_u128(5), "árvore 100"),
    ];
    for (id, name) in ties {
        sqlx::query("INSERT INTO products(tenant_id,id,sku,name,unit,price_cents,status) VALUES($1,$2,$3,$4,'UN',200,'active')")
            .bind(Uuid::parse_str(TENANT).unwrap()).bind(id).bind(format!("TIE-{id}"))
            .bind(name).execute(&admin).await.unwrap();
    }
    for (direction, expected) in [("asc", vec![1, 2, 3, 4, 5]), ("desc", vec![5, 4, 1, 2, 3])] {
        let data = rows(
            &router,
            &format!("/api/v1/products?q=TIE-&sortBy=name&sortOrder={direction}&limit=100"),
        )
        .await;
        assert_eq!(
            strings(&data, "id"),
            expected
                .into_iter()
                .map(|i| Uuid::from_u128(i).to_string())
                .collect::<Vec<_>>()
        );
    }
    let default_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM products WHERE tenant_id=$1 ORDER BY name,id LIMIT 25")
            .bind(Uuid::parse_str(TENANT).unwrap())
            .fetch_all(&admin)
            .await
            .unwrap();
    assert_eq!(
        strings(&rows(&router, "/api/v1/products").await, "id"),
        default_ids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn catalog_lists_reject_invalid_direction_unknown_fields_and_injection(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    for (endpoint, valid) in [
        ("products", "name"),
        ("parties", "legalName"),
        ("staff", "name"),
        ("warehouses", "code"),
        ("stock", "quantity"),
    ] {
        for query in [
            "sortOrder=asc".to_owned(),
            "sortBy=unknown".to_owned(),
            "sortBy=name%3BDROP%20TABLE%20products".to_owned(),
            format!("sortBy={valid}&sortOrder=ASC"),
            format!("sortBy={valid}&sortOrder=desc%20NULLS%20FIRST"),
            format!("sortBy={valid}&sortOrder="),
            format!("sortBy={valid}&unexpected=true"),
        ] {
            let uri = format!("/api/v1/{endpoint}?{query}");
            assert_eq!(
                get(&router, &uri).await.0,
                StatusCode::UNPROCESSABLE_ENTITY,
                "{uri}"
            );
        }
    }
    assert_eq!(
        get(&router, "/api/v1/products?sortBy=name").await.0,
        StatusCode::OK
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn references_sort_all_families_and_warehouse_nulls_last_in_both_directions(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    for (table, endpoint, extra_columns, extra_values) in [
        (
            "product_categories",
            "product-categories",
            ",sort_order",
            ",0",
        ),
        (
            "financial_categories",
            "financial-categories",
            ",direction",
            ",'income'",
        ),
        (
            "financial_accounts",
            "financial-accounts",
            ",account_type",
            ",'cash'",
        ),
        (
            "payment_methods",
            "payment-methods",
            ",modality,settlement_days",
            ",'cash',0",
        ),
        ("warehouses", "warehouses", "", ""),
        ("product_groups", "product-groups", "", ""),
        ("tag_groups", "tag-groups", "", ""),
        ("tags", "tags", "", ""),
    ] {
        sqlx::query(&format!("INSERT INTO {table}(tenant_id,id,code,name,status,revision{extra_columns}) SELECT $1,md5('{table}'||i)::uuid,'C'||i,'Nome '||i,CASE WHEN i=2 THEN 'archived' ELSE 'active' END,1{extra_values} FROM generate_series(1,30) i"))
            .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
        let data = rows(
            &router,
            &format!("/api/v1/{endpoint}?sortBy=code&sortOrder=desc&limit=2&offset=1"),
        )
        .await;
        assert_eq!(strings(&data, "code"), ["C29", "C28"], "{endpoint}");
        let data = rows(&router, &format!("/api/v1/{endpoint}?sortBy=name&limit=2")).await;
        assert_eq!(strings(&data, "name"), ["Nome 1", "Nome 2"], "{endpoint}");
        let data = rows(
            &router,
            &format!("/api/v1/{endpoint}?sortBy=status&limit=1"),
        )
        .await;
        assert_eq!(
            data[0]["status"], "archived",
            "status must use Arquivado before Ativo: {endpoint}"
        );
        if table != "warehouses" {
            assert_eq!(
                get(&router, &format!("/api/v1/{endpoint}?sortBy=location"))
                    .await
                    .0,
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
    }
    sqlx::query("UPDATE warehouses SET location=CASE code WHEN 'C1' THEN 'Área 2' WHEN 'C2' THEN 'area 10' ELSE NULL END WHERE tenant_id=$1")
        .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    for (direction, expected) in [("asc", ["C1", "C2"]), ("desc", ["C2", "C1"])] {
        let data = rows(
            &router,
            &format!("/api/v1/warehouses?sortBy=location&sortOrder={direction}&limit=100"),
        )
        .await;
        assert_eq!(&strings(&data, "code")[..2], expected);
        assert!(data[2..].iter().all(|row| row["location"].is_null()));
        assert!(
            strings(&data[2..], "id")
                .windows(2)
                .all(|pair| pair[0] < pair[1])
        );
    }
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn parties_and_staff_sort_by_displayed_relationship_job_contact_and_status(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    sqlx::query("INSERT INTO parties(tenant_id,id,person_type,legal_name,tax_id,is_customer,is_supplier,status,email,phone) SELECT $1,md5('party-sort-'||i)::uuid,'fisica','Pessoa '||i,lpad(i::text,11,'0'),i<>3,i<>1,CASE WHEN i=2 THEN 'archived' ELSE 'active' END,CASE i WHEN 1 THEN 'z@test.test' WHEN 2 THEN 'a@test.test' ELSE NULL END,CASE WHEN i=3 THEN '11999999999' ELSE NULL END FROM generate_series(1,3) i")
        .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    let data = rows(&router, "/api/v1/parties?sortBy=relationship&sortOrder=asc").await;
    assert_eq!(
        strings(&data, "legalName"),
        ["Pessoa 1", "Pessoa 2", "Pessoa 3"]
    );
    assert_eq!(
        rows(&router, "/api/v1/parties?sortBy=status").await[0]["status"],
        "archived"
    );
    assert_eq!(
        strings(
            &rows(&router, "/api/v1/parties?sortBy=contact").await,
            "legalName"
        ),
        ["Pessoa 3", "Pessoa 2", "Pessoa 1"]
    );
    assert_eq!(
        strings(
            &rows(&router, "/api/v1/parties?sortBy=taxId&sortOrder=desc").await,
            "legalName"
        ),
        ["Pessoa 3", "Pessoa 2", "Pessoa 1"]
    );
    sqlx::query("INSERT INTO staff(tenant_id,id,code,name,job_title,is_employee,is_seller,status,email) SELECT $1,('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'S'||i,'Equipe '||i,CASE WHEN i=1 THEN 'Analista' ELSE NULL END,true,i=3,CASE WHEN i=1 THEN 'archived' ELSE 'active' END,CASE i WHEN 1 THEN 'z@test.test' WHEN 2 THEN 'a@test.test' ELSE NULL END FROM generate_series(1,3) i")
        .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    assert_eq!(
        strings(
            &rows(&router, "/api/v1/staff?sortBy=jobTitle").await,
            "name"
        ),
        ["Equipe 1", "Equipe 2", "Equipe 3"]
    );
    assert_eq!(
        strings(&rows(&router, "/api/v1/staff?sortBy=status").await, "name"),
        ["Equipe 2", "Equipe 3", "Equipe 1"]
    );
    assert_eq!(
        strings(&rows(&router, "/api/v1/staff?sortBy=contact").await, "name"),
        ["Equipe 2", "Equipe 3", "Equipe 1"]
    );
    assert_eq!(
        strings(
            &rows(&router, "/api/v1/staff?sortBy=code&sortOrder=desc").await,
            "code"
        ),
        ["S3", "S2", "S1"]
    );
    cleanup(&admin, app, server, &role).await;
}

#[sqlx::test(migrations = "../../migrations")]
async fn stock_sorts_native_balances_reserved_and_available_before_pagination(admin: PgPool) {
    let (router, app, server, role) = setup(&admin).await;
    permissions(&admin).await;
    sqlx::query("INSERT INTO products(tenant_id,id,sku,name,unit,price_cents,status) SELECT $1,md5('stock-sort-'||i)::uuid,'STOCK-'||i,'Estoque '||i,'UN',100,'active' FROM generate_series(1,30) i")
        .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO stock_balances(tenant_id,product_id,quantity_micros) SELECT tenant_id,id,CASE sku WHEN 'STOCK-1' THEN 2000000 WHEN 'STOCK-2' THEN 10000000 ELSE 100000000 END FROM products WHERE tenant_id=$1")
        .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO parties(tenant_id,id,person_type,legal_name,tax_id,is_customer,is_supplier,status) VALUES($1,md5('stock-customer')::uuid,'fisica','Cliente','12345678901',true,false,'active')")
        .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO sales_orders(tenant_id,id,customer_id,customer_name,customer_tax_id,due_date,amount_cents,status) VALUES($1,md5('stock-order')::uuid,md5('stock-customer')::uuid,'Cliente','12345678901',current_date,900,'confirmed')")
        .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    sqlx::query("INSERT INTO sales_order_lines(tenant_id,order_id,line_number,product_id,sku,name,unit,quantity_micros,price_cents,amount_cents) VALUES($1,md5('stock-order')::uuid,1,md5('stock-sort-2')::uuid,'STOCK-2','Estoque 2','UN',9000000,100,900)")
        .bind(Uuid::parse_str(TENANT).unwrap()).execute(&admin).await.unwrap();
    assert_eq!(
        strings(
            &rows(&router, "/api/v1/stock?sortBy=quantity&limit=2").await,
            "name"
        ),
        ["Estoque 1", "Estoque 2"]
    );
    assert_eq!(
        rows(
            &router,
            "/api/v1/stock?sortBy=reserved&sortOrder=desc&limit=1"
        )
        .await[0]["name"],
        "Estoque 2"
    );
    assert_eq!(
        strings(
            &rows(&router, "/api/v1/stock?sortBy=available&limit=2").await,
            "name"
        ),
        ["Estoque 2", "Estoque 1"]
    );
    assert_eq!(
        strings(
            &rows(
                &router,
                "/api/v1/stock?sortBy=name&sortOrder=desc&limit=2&offset=1"
            )
            .await,
            "name"
        ),
        ["Estoque 29", "Estoque 28"]
    );
    cleanup(&admin, app, server, &role).await;
}
