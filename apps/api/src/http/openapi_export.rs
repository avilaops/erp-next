// Included only under cfg(test). No configuration, database or HTTP startup.
#[test]
fn export_openapi_contract_artifact() {
    let document = ApiDoc::openapi();
    assert!(!document.paths.paths.is_empty());
    if let Some(output) = std::env::var_os("ERP_OPENAPI_OUTPUT") {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
            .expect("create a new contract artifact");
        serde_json::to_writer_pretty(&file, &document).expect("serialize OpenAPI");
        file.sync_all().expect("sync OpenAPI artifact");
    }
}
